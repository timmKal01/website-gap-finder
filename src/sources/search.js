// "Search a city" mode: businesses of one type in a place, turned into the items every source yields (see records.js),
// then audited like any other business.
//
// Google Maps first (googleMaps.js, since 2026-11-01): current listings with rating and reviews, including businesses
// that list no website at all, which become "lead without a website" rows. If Google Maps doesn't answer, the search
// runs on Overture Maps open data instead (overture.js): there, only businesses that list a website are kept, since
// Overture often just lacks a website it doesn't know about, and closed places, unlikely places and chains are skipped.
//
// Until 2026-10-29 this used OpenStreetMap's Overpass servers, which were down all of 2026-10-28 and failed real runs.
//
// Since 2026-11-05 a search can name any business ("yoga studio") instead of one of the 32 types, and cover several
// places. A typed search has no Overture fallback, since Overture's categories can't be matched to free text.
import { Actor, log } from 'apify';
import { CATEGORIES, categoryMatcher, categoryLabel } from './categories.js';
import { geocode, bboxSizeKm } from './geocode.js';
import { latestPlacesRelease, findCandidates, readDetails } from './overture.js';
import { GOOGLE_TERMS, GoogleMapsError, searchGoogleMaps } from './googleMaps.js';
import { hasRealWebsite } from '../audit/classify.js';

const MIN_CONFIDENCE = 0.5; // Overture's confidence that a place exists, 0-1
const MAX_AREA_KM = 150; // wider than this would read most of a country's data

/** A problem with the input (an unknown or too-large place): reported as an error row, not a source outage. */
export class SearchInputError extends Error {}

const hasWebsite = (place) => (place.websites ?? []).some((w) => String(w ?? '').trim());
const isChain = (place) => Boolean(place.brand?.wikidata || place.brand?.names?.primary);

/** One Overture place (pass 1 and pass 2 fields merged) -> an item for toBusinessRecord(). */
export function placeToItem(place, { countryCode }) {
    const address = place.addresses?.[0] ?? {};
    return {
        name: place.names?.primary ?? null,
        website: (place.websites ?? []).find((w) => String(w ?? '').trim()) ?? null,
        phone: place.phones?.[0] ?? null,
        address: [address.freeform, address.locality, address.region, address.postcode].filter(Boolean).join(', ') || null,
        city: address.locality ?? null,
        countryCode: (address.country ?? countryCode ?? '').toUpperCase() || null,
        category: categoryLabel(place.taxonomy?.primary ?? place.basic_category),
        placeId: place.id ? `overture:${place.id}` : null,
    };
}

/** One Google Maps place (googleMaps.js parsePlace) -> an item for toBusinessRecord(). */
export function googlePlaceToItem(place, { countryCode }) {
    return {
        name: place.name,
        website: place.website,
        phone: place.phone,
        address: place.address,
        city: (place.locality ?? '').split(',')[0].trim() || null,
        countryCode: (place.countryCode ?? countryCode ?? '').toUpperCase() || null,
        category: place.categories[0] ?? null,
        categories: place.categories,
        placeId: place.placeId,
        mapsUrl: place.mapsUrl,
        rating: place.rating,
        reviewCount: place.reviewCount,
        permanentlyClosed: place.status === 'permanently_closed',
    };
}

// With onlyNoWebsite, Google lists established businesses (with websites) first, and in a test only about 1 in 8 Denver
// plumbers had none, so the search reads up to 10 places per lead wanted.
const NO_WEBSITE_READ_FACTOR = 10;

/** What the search looks for, as people say it: the typed term, or the business type's name. */
export const searchLabel = ({ term, category }) => term ?? CATEGORIES[category].title.toLowerCase();

async function* fromGoogleMaps({ category, term, maxBusinesses, onlyNoWebsite }, place, counters) {
    const proxyConfiguration = Actor.isAtHome() ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: 'US' }) : null;
    const g = {};
    const maxPlaces = onlyNoWebsite ? Math.min(1000, maxBusinesses * NO_WEBSITE_READ_FACTOR) : maxBusinesses;
    const query = term ?? GOOGLE_TERMS[category];
    let given = 0;
    log.info(`Searching Google Maps for "${query}" in ${place.name}${onlyNoWebsite ? ', keeping only businesses with no website' : ''}`);
    for await (const p of searchGoogleMaps({ term: query, bbox: place.bbox, countryCode: place.countryCode, maxPlaces, proxyConfiguration, counts: g })) {
        if (p.status !== 'open') continue; // closed places aren't leads
        counters.found++;
        const real = hasRealWebsite(p.website);
        if (!real) counters.noWebsiteListed++;
        if (onlyNoWebsite && real) {
            counters.withWebsite = (counters.withWebsite ?? 0) + 1;
            continue;
        }
        yield googlePlaceToItem(p, { countryCode: place.countryCode });
        if (++given >= maxBusinesses) break;
    }
    log.info(`Google Maps: ${counters.found} open ${searchLabel({ term, category })} found in ${place.name}, ${counters.noWebsiteListed} with no website listed`
        + ` (${g.pages} pages, ${g.outside} outside the area, ${g.retries} retries)`);
}

async function* fromOverture({ category, maxBusinesses }, place, counters) {
    const matches = categoryMatcher(category);
    let candidates;
    try {
        const { release, files } = await latestPlacesRelease();
        log.info(`Searching Overture Maps (release ${release}) for ${CATEGORIES[category].title.toLowerCase()} in ${place.name}`);
        ({ candidates } = await findCandidates({
            files,
            bbox: place.bbox,
            keep: (p) => {
                if (!matches(p)) return false;
                if ((p.operating_status && p.operating_status !== 'open') || (typeof p.confidence === 'number' && p.confidence < MIN_CONFIDENCE)) return false;
                counters.found++;
                if (isChain(p)) {
                    counters.chains++;
                    return false;
                }
                if (!hasWebsite(p)) {
                    counters.noWebsiteListed++;
                    return false;
                }
                return true;
            },
        }));
    } catch (err) {
        err.sourceDown = true;
        throw err;
    }
    candidates.sort((a, b) => (b.light.confidence ?? 0) - (a.light.confidence ?? 0));
    counters.overLimit = Math.max(0, candidates.length - maxBusinesses);
    const chosen = candidates.slice(0, maxBusinesses);
    log.info(`Overture: ${counters.found} open ${CATEGORIES[category].title.toLowerCase()} found, ${chosen.length} with a website listed will be audited`
        + ` (${counters.noWebsiteListed} list no website, ${counters.chains} chains skipped${counters.overLimit ? `, ${counters.overLimit} over maxBusinesses` : ''})`);

    // Details in batches, so the first audits start before every detail is read.
    for (let i = 0; i < chosen.length; i += 50) {
        let details;
        try {
            details = await readDetails(chosen.slice(i, i + 50));
        } catch (err) {
            err.sourceDown = true;
            throw err;
        }
        for (const p of details) yield placeToItem(p, { countryCode: place.countryCode });
    }
}

/** One place name -> its geocoded area, or an error saying why it can't be searched. */
async function findPlace(location) {
    let place;
    try {
        place = await geocode(location);
    } catch (err) {
        err.sourceDown = true;
        throw err;
    }
    if (!place) throw new SearchInputError(`Couldn't find a place called "${location}". Try adding the country, e.g. "Denver, USA".`);
    const { widthKm, heightKm } = bboxSizeKm(place.bbox);
    if (widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM) {
        throw new SearchInputError(`"${place.name}" covers about ${Math.round(widthKm)} x ${Math.round(heightKm)} km. Search a city, town or district (up to ${MAX_AREA_KM} km across) instead.`);
    }
    return place;
}

/** One place: Google Maps, or Overture Maps open data if Google doesn't answer (only for the 32 business types). */
async function* searchPlace(search, place, counters) {
    counters.source = 'google_maps';
    try {
        yield* fromGoogleMaps(search, place, counters);
        return;
    } catch (err) {
        // Google only fails a search that found nothing; then the whole search runs on Overture's open data.
        if (!(err instanceof GoogleMapsError) || counters.found > 0) throw err;
        // Overture often just doesn't know a business's website, so it can't tell who has none, and its categories
        // can't be matched to a typed search.
        if (search.onlyNoWebsite || !search.category) {
            err.sourceDown = true;
            err.message = `${err.message}. ${search.onlyNoWebsite ? 'A search for businesses with no website' : 'A search for a typed business'} needs Google Maps, so nothing was searched`;
            throw err;
        }
        log.warning(`${err.message}. Searching Overture Maps instead.`);
        Object.assign(counters, { source: 'overture', fellBack: err.message, found: 0, noWebsiteListed: 0 });
    }
    yield* fromOverture(search, place, counters);
}

/** One uncharged row for a place that couldn't be searched, when other places in the run could be. */
async function reportPlaceProblem({ location, err }) {
    await Actor.pushData(err.sourceDown
        ? { rowType: 'note', name: `Couldn't search "${location}" (not charged)`, note: `${err.message}. The other places were searched.`, auditedAt: new Date().toISOString() }
        : { rowType: 'error', name: `Couldn't search "${location}" (not charged)`, error: err.message, auditedAt: new Date().toISOString() });
}

const SUMMED = ['found', 'chains', 'noWebsiteListed', 'overLimit', 'withWebsite'];

/**
 * Businesses of one type (or a typed term) in one or more places, as items for toBusinessRecord().
 * Each place is searched on its own with its own maxBusinesses, and `counters` gets the totals.
 * @param {{ category: string|null, term?: string|null, location: string, locations?: string[], maxBusinesses: number, onlyNoWebsite?: boolean }} search
 * @param {{ found: number, chains: number, noWebsiteListed: number, overLimit: number, place: string|null, source?: string, fellBack?: string|null }} counters
 */
export async function* discoverBusinesses(search, counters) {
    const locations = search.locations?.length ? search.locations : [search.location];
    const names = [];
    const waiting = []; // places that failed before any place could be searched
    const sources = new Set();
    let searched = 0;
    for (const location of locations) {
        const one = { found: 0, chains: 0, noWebsiteListed: 0, overLimit: 0, place: null };
        try {
            const place = await findPlace(location);
            names.push(place.name);
            counters.place = names.join('; ');
            searched++;
            for (const problem of waiting.splice(0)) await reportPlaceProblem(problem);
            const tracked = searchPlace(search, place, one);
            for await (const item of tracked) {
                counters.source = one.source;
                yield item;
            }
        } catch (err) {
            // A one-place search fails as it always has: one row from main.js saying why.
            if (locations.length === 1) throw err;
            log.warning(`"${location}": ${err.message}`);
            if (searched) await reportPlaceProblem({ location, err });
            else waiting.push({ location, err });
        } finally {
            for (const k of SUMMED) if (one[k]) counters[k] = (counters[k] ?? 0) + one[k];
            if (one.source) sources.add(one.source);
            if (one.fellBack) counters.fellBack = [counters.fellBack, `${one.place}: ${one.fellBack}`].filter(Boolean).join('; ');
            counters.source = sources.has('google_maps') ? 'google_maps' : [...sources][0] ?? counters.source;
        }
    }
    if (!searched && waiting.length) {
        const first = waiting[0].err;
        first.message = `None of the ${waiting.length} places could be searched. ${waiting.map(({ location, err }) => `"${location}": ${err.message}`).join(' ')}`;
        throw first;
    }
}
