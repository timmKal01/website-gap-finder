// Where the businesses come from.
//
// Two modes, which can be combined:
// - "search": find businesses of one type in a city in Overture Maps open data (search.js);
// - "enrich": audit businesses you already have, from another actor's dataset (e.g. a Google Maps
//   scraper) and/or the manual `businesses` list.
// Every source yields items that go through toBusinessRecord(), so main.js, the audit and the scoring
// don't care where a business came from.
import { Actor, log } from 'apify';
import { toBusinessRecord } from './records.js';
import { discoverBusinesses } from './search.js';

const PAGE_SIZE = 1000;

/** Items of an Apify dataset, page by page, so large datasets never sit in memory at once. */
async function* datasetItems(datasetId) {
    const client = Actor.apifyClient.dataset(datasetId);
    let offset = 0;
    for (;;) {
        let page;
        try {
            page = await client.listItems({ offset, limit: PAGE_SIZE, clean: true });
        } catch (err) {
            const hint = Actor.isAtHome() ? '' : ' Locally this needs an Apify token (apify login).';
            throw new Error(`Couldn't read dataset "${datasetId}": ${err.message}.${hint}`);
        }
        for (const item of page.items) yield item;
        offset += page.items.length;
        if (page.items.length === 0 || offset >= page.total) return;
    }
}

/**
 * Normalized business records from every source in the input, duplicates removed
 * (same Google place ID, or same name + address).
 * @param {{ datasetId?: string, businesses?: object[], search?: { category: string, location: string, maxBusinesses: number } }} input
 * @param {{ skippedClosed: number, skippedEmpty: number, duplicates: number, search: object }} counters
 */
export async function* loadBusinesses({ datasetId, businesses, search }, counters) {
    const seen = new Set();

    function* accept(item, source) {
        const record = { ...toBusinessRecord(item), source };
        if (!record.name && !record.website && !record.phoneRaw) {
            counters.skippedEmpty++;
            return;
        }
        if (record.permanentlyClosed) {
            counters.skippedClosed++;
            return;
        }
        const key = record.placeId ?? `${record.name ?? ''}|${record.address ?? record.website ?? ''}`.toLowerCase();
        if (seen.has(key)) {
            counters.duplicates++;
            return;
        }
        seen.add(key);
        yield record;
    }

    if (search) {
        for await (const item of discoverBusinesses(search, counters.search)) yield* accept(item, 'overture');
    }
    if (datasetId) {
        log.info(`Reading businesses from dataset ${datasetId}`);
        for await (const item of datasetItems(datasetId)) yield* accept(item, 'dataset');
    }
    for (const item of businesses ?? []) {
        if (item && typeof item === 'object') yield* accept(item, 'input');
        else counters.skippedEmpty++;
    }
}
