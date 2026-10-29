// Business places from Overture Maps (overturemaps.org): open data published as GeoParquet files on Amazon S3,
// readable without a key. The files are sorted by location, so a city only touches a few row groups. Each row group
// carries min/max statistics for the bbox columns, and those groups are read in two passes:
//   1. location, category, status, confidence and brand only, to find the candidates;
//   2. full details, only for the candidates chosen.
// Licenses: CDLA Permissive 2.0 (Meta, Microsoft and others), Apache 2.0 (Foursquare), CC0 (AllThePlaces).
// Copied from local-business-leads; evolve independently.
import { log } from 'apify';
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const BUCKET = 'https://overturemaps-us-west-2.s3.amazonaws.com';
// Gap Finder also needs websites in pass 1: it only audits places that list one.
const LIGHT_COLUMNS = ['bbox', 'basic_category', 'taxonomy', 'operating_status', 'confidence', 'brand', 'websites'];
// Pass 2 only reads what pass 1 didn't: the two are merged per place.
const DETAIL_COLUMNS = ['id', 'names', 'phones', 'addresses'];

/** fetch with retries, reading the whole body inside each attempt so a connection dropped mid-download is retried too. */
async function steadyFetch(url, init = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
            if (res.status >= 500 || res.status === 429) throw new Error(`S3 answered HTTP ${res.status}`);
            const body = await res.arrayBuffer();
            return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
        } catch (err) {
            lastErr = err;
            if (attempt < 4) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        }
    }
    throw lastErr;
}

const listXml = async (params) => (await steadyFetch(`${BUCKET}/?${new URLSearchParams({ 'list-type': '2', ...params })}`)).text();

/** The newest release that has places files: { release, files: [{ url, size }] }. */
export async function latestPlacesRelease() {
    const prefixes = [...(await listXml({ prefix: 'release/', delimiter: '/' })).matchAll(/<Prefix>(release\/[^<]+\/)<\/Prefix>/g)]
        .map((m) => m[1]).sort().reverse();
    for (const prefix of prefixes.slice(0, 3)) {
        const xml = await listXml({ prefix: `${prefix}theme=places/type=place/` });
        const files = [...xml.matchAll(/<Contents>.*?<Key>([^<]+\.parquet)<\/Key>.*?<Size>(\d+)<\/Size>.*?<\/Contents>/gs)]
            .map((m) => ({ url: `${BUCKET}/${m[1]}`, size: Number(m[2]) }));
        if (files.length) return { release: prefix.split('/')[1], files };
    }
    throw new Error('No Overture places release found on S3');
}

export const boxesOverlap = (a, b) => a.xmin <= b.xmax && a.xmax >= b.xmin && a.ymin <= b.ymax && a.ymax >= b.ymin;

/** A row group's bbox, from its column statistics. Null when the statistics are missing (then it must be read). */
export function rowGroupBox(rowGroup) {
    const stat = (name) => rowGroup.columns.find((c) => c.meta_data?.path_in_schema.join('.') === name)?.meta_data.statistics;
    const box = { xmin: stat('bbox.xmin')?.min_value, xmax: stat('bbox.xmax')?.max_value, ymin: stat('bbox.ymin')?.min_value, ymax: stat('bbox.ymax')?.max_value };
    return Object.values(box).every((v) => typeof v === 'number') ? box : null;
}

/**
 * Pass 1: every place in the box that passes `keep`, across all files, as candidates.
 * @param {{ files: {url: string, size: number}[], bbox: object, keep: (light: object) => boolean }} options
 * @returns {Promise<{ candidates: object[], inBox: number, bytes: number }>}
 */
export async function findCandidates({ files, bbox, keep }) {
    const candidates = [];
    let inBox = 0;
    for (const [fileIndex, { url, size }] of files.entries()) {
        // No byte cache: a city reads tens of MB, and keeping it all would double the memory a run needs.
        const file = await asyncBufferFromUrl({ url, byteLength: size, fetch: steadyFetch });
        const metadata = await parquetMetadataAsync(file);
        let start = 0;
        for (const [groupIndex, rowGroup] of metadata.row_groups.entries()) {
            const rows = Number(rowGroup.num_rows);
            const box = rowGroupBox(rowGroup);
            if (!box || boxesOverlap(box, bbox)) {
                const light = await parquetReadObjects({ file, metadata, compressors, columns: LIGHT_COLUMNS, rowStart: start, rowEnd: start + rows });
                light.forEach((place, i) => {
                    if (!place.bbox || !boxesOverlap(place.bbox, bbox)) return;
                    inBox++;
                    if (keep(place)) candidates.push({ file, metadata, group: `${fileIndex}:${groupIndex}`, rowIndex: start + i, light: place });
                });
            }
            start += rows;
        }
    }
    log.info(`Overture: ${inBox} places in the area, ${candidates.length} of the chosen type`);
    return { candidates, inBox };
}

/**
 * Pass 2: details for some candidates, merged with what pass 1 read. Each row group is read once, from its first to its
 * last chosen row: hyparquet fetches a group's column chunks in a couple of combined requests, so this costs a few
 * requests per group. (Per-row page reads with useOffsetIndex took a few requests per column per run instead, and
 * Chicago plumbers didn't finish in 5 minutes.) One group is decoded at a time and only the chosen rows are kept, and
 * there is no byte cache (the cache is what got the first platform run killed). Returns places in `chosen` order.
 */
export async function readDetails(chosen) {
    const byGroup = new Map();
    for (const c of chosen) {
        if (!byGroup.has(c.group)) byGroup.set(c.group, []);
        byGroup.get(c.group).push(c);
    }
    const details = new Map();
    for (const group of byGroup.values()) {
        const { file, metadata } = group[0];
        const rows = group.map((c) => c.rowIndex).sort((a, b) => a - b);
        const lo = rows[0];
        const read = await parquetReadObjects({ file, metadata, compressors, columns: DETAIL_COLUMNS, rowStart: lo, rowEnd: rows[rows.length - 1] + 1 });
        for (const c of group) details.set(c, { ...c.light, ...read[c.rowIndex - lo] });
    }
    return chosen.map((c) => details.get(c));
}
