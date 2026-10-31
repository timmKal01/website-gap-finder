// Copied from local-business-leads/src/googleMaps.js on 2026-11-01; evolve independently.
// Google Maps search, read from the same data endpoint the Maps page loads its result list from
// (google.com/search?tbm=map). One request returns 20 places with name, address, phone, website, categories, rating,
// review count, opening hours and coordinates, about 1 KB each gzipped, so no browser is needed.
//
// On Apify, requests go through Apify's residential proxy (Google refuses most datacenter IPs), and a refused request
// is retried on a new proxy session. Locally there is no proxy: the machine's own connection is used.
//
// The endpoint is undocumented. The record layout (the array positions in parsePlace) was read from live responses on
// 2026-11-01. If Google changes it, fields come back empty, the tests in test/googleMaps.test.js show which, and a
// search that finds nothing falls back to Overture Maps.
import { log } from 'apify';
import { fetch, ProxyAgent } from 'undici';

/** What to type into Google Maps for each of the 32 business types. */
export const GOOGLE_TERMS = {
    plumber: 'plumber',
    electrician: 'electrician',
    hvac: 'hvac contractor',
    roofer: 'roofing contractor',
    carpenter: 'carpenter',
    painter: 'painter and decorator',
    hair: 'hair salon',
    beauty: 'beauty salon',
    massage: 'massage spa',
    tattoo: 'tattoo shop',
    dentist: 'dentist',
    doctor: 'medical clinic',
    physio: 'physiotherapist',
    vet: 'veterinarian',
    optician: 'optician',
    gym: 'gym',
    restaurant: 'restaurant',
    cafe: 'cafe',
    bakery: 'bakery',
    hotel: 'hotel',
    car_repair: 'auto repair shop',
    car_dealer: 'car dealer',
    lawyer: 'lawyer',
    accountant: 'accountant',
    estate_agent: 'real estate agency',
    florist: 'florist',
    clothes: 'clothing store',
    furniture: 'furniture store',
    photographer: 'photographer',
    driving_school: 'driving school',
    childcare: 'daycare',
    laundry: 'laundromat',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PAGE = 20;
const PAGE_GAP_MS = 1000;
const MAX_ATTEMPTS = 4;
// Places a little outside the searched area still count: Google's results don't stop at a city line.
const MARGIN_DEG = 0.02;

/** Google Maps didn't answer usefully (refused, changed, or down) after every retry. */
export class GoogleMapsError extends Error {}

/** The place records in one response: arrays with a name at [11] and coordinates at [9]. */
export function findPlaceRecords(json) {
    const found = [];
    const walk = (x, depth) => {
        if (!Array.isArray(x) || depth > 14) return;
        if (x.length > 30 && typeof x[11] === 'string' && Array.isArray(x[9])) {
            found.push(x);
            return;
        }
        for (const y of x) walk(y, depth + 1);
    };
    walk(json, 0);
    return found;
}

/** A website without Google's tracking parameters (utm_*). */
export function cleanWebsite(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
        return u.href;
    } catch {
        return url;
    }
}

/** One place record -> plain fields. Array positions as seen on 2026-11-01. */
export function parsePlace(p) {
    const cid = p[181]?.[5] ?? null;
    const placeId = typeof p[78] === 'string' ? p[78] : null;
    const days = Array.isArray(p[203]?.[0]) ? p[203][0] : [];
    // Where Google marks a closed business hasn't been seen live yet, so the whole record is searched for the label.
    const flat = JSON.stringify(p);
    return {
        name: p[11] ?? null,
        categories: Array.isArray(p[13]) ? p[13].filter((c) => typeof c === 'string') : [],
        address: p[39] ?? null,
        neighborhood: typeof p[14] === 'string' ? p[14] : null,
        locality: typeof p[166] === 'string' ? p[166] : null,
        countryCode: typeof p[243] === 'string' ? p[243] : null,
        phone: p[178]?.[0]?.[3] ?? p[178]?.[0]?.[0] ?? null,
        website: cleanWebsite(p[7]?.[0] ?? null),
        rating: typeof p[4]?.[7] === 'number' ? p[4][7] : null,
        reviewCount: typeof p[4]?.[8] === 'number' ? p[4][8] : null,
        latitude: p[9]?.[2] ?? null,
        longitude: p[9]?.[3] ?? null,
        placeId,
        cid,
        mapsUrl: cid ? `https://www.google.com/maps?cid=${cid}` : placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null,
        hours: days.map((d) => `${d[0]}: ${(d[3] ?? []).map((h) => h[0]).join(', ') || 'Closed'}`),
        status: /permanently closed/i.test(flat) ? 'permanently_closed' : /temporarily closed/i.test(flat) ? 'temporarily_closed' : 'open',
    };
}

const inBox = (place, { xmin, xmax, ymin, ymax }) => place.latitude != null
    && place.latitude >= ymin - MARGIN_DEG && place.latitude <= ymax + MARGIN_DEG
    && place.longitude >= xmin - MARGIN_DEG && place.longitude <= xmax + MARGIN_DEG;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage({ term, lat, lng, spanM, offset, gl, dispatcher }) {
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('tbm', 'map');
    url.searchParams.set('hl', 'en');
    if (gl) url.searchParams.set('gl', gl.toLowerCase());
    url.searchParams.set('q', term);
    url.searchParams.set('pb', `!4m8!1m3!1d${Math.round(spanM)}!2d${lng}!3d${lat}!3m2!1i1024!2i768!4f13.1!7i${PAGE}!8i${offset}!10b1`);
    const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        dispatcher,
        signal: AbortSignal.timeout(30_000), // covers the body too
    });
    const text = await res.text();
    if (!res.ok) throw new GoogleMapsError(`HTTP ${res.status}`);
    // A refusal or consent page is HTML, not the endpoint's JSON.
    if (!text.startsWith(")]}'")) throw new GoogleMapsError('Google returned a page instead of results');
    return findPlaceRecords(JSON.parse(text.slice(4)));
}

/**
 * Places for one search term in one area, in Google's order, until maxPlaces, the last page, or shouldStop().
 * @param {{ term: string, bbox: { xmin: number, xmax: number, ymin: number, ymax: number }, countryCode?: string|null,
 *   maxPlaces: number, proxyConfiguration?: object|null, shouldStop?: () => boolean, counts?: object }} options
 */
export async function* searchGoogleMaps({ term, bbox, countryCode = null, maxPlaces, proxyConfiguration = null, shouldStop = () => false, counts = {} }) {
    const lat = (bbox.ymin + bbox.ymax) / 2;
    const lng = (bbox.xmin + bbox.xmax) / 2;
    const widthM = (bbox.xmax - bbox.xmin) * 111_320 * Math.cos((lat * Math.PI) / 180);
    const heightM = (bbox.ymax - bbox.ymin) * 110_570;
    const spanM = Math.max(3000, Math.max(widthM, heightM) * 1.2);
    const newDispatcher = async () => (proxyConfiguration
        ? new ProxyAgent(await proxyConfiguration.newUrl(`gm${Math.random().toString(36).slice(2, 10)}`))
        : undefined);

    let dispatcher = await newDispatcher();
    const seen = new Set();
    let given = 0;
    Object.assign(counts, { pages: 0, read: 0, outside: 0, retries: 0 });
    // Twice the pages maxPlaces needs, since some results fall outside the area, and never past 50 pages.
    const maxPages = Math.min(50, Math.ceil(maxPlaces / PAGE) * 2 + 2);
    for (let page = 0; page < maxPages && given < maxPlaces && !shouldStop(); page++) {
        let records;
        for (let attempt = 1; ; attempt++) {
            try {
                records = await fetchPage({ term, lat, lng, spanM, offset: page * PAGE, gl: countryCode, dispatcher });
                break;
            } catch (err) {
                if (attempt >= MAX_ATTEMPTS) {
                    // Places already found are kept; only a search that found nothing counts as Google failing.
                    if (given > 0) return;
                    throw new GoogleMapsError(`Google Maps didn't return results after ${MAX_ATTEMPTS} tries: ${err.message}`);
                }
                counts.retries++;
                log.debug(`Google Maps page ${page + 1}: ${err.message}; retrying on a new proxy session`);
                await sleep(2000 * attempt);
                dispatcher = await newDispatcher();
            }
        }
        counts.pages++;
        let fresh = 0;
        for (const record of records) {
            const place = parsePlace(record);
            const key = place.cid ?? place.placeId ?? `${place.name}|${place.address}`;
            if (seen.has(key)) continue;
            seen.add(key);
            fresh++;
            counts.read++;
            if (!inBox(place, bbox)) {
                counts.outside++;
                continue;
            }
            given++;
            yield place;
            if (given >= maxPlaces) return;
        }
        if (records.length < PAGE || fresh === 0) return;
        await sleep(PAGE_GAP_MS);
    }
}
