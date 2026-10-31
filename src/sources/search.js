// "Search a city" mode: businesses of one type in a place, turned into the items every source yields (see records.js),
// then audited like any other business.
//
// Google Maps first (googleMaps.js, since 2026-11-01): current listings with rating and reviews, including businesses
// that list no website at all, which become "lead without a website" rows. If Google Maps doesn't answer, the search
// runs on Overture Maps open data instead (overture.js): there, only businesses that list a website are kept, since
// Overture often just lacks a website it doesn't know about, and closed places, unlikely places and chains are skipped.
//
// Until 2026-10-29 this used OpenStreetMap's Overpass servers, which were down all of 2026-10-28 and failed real runs.
import { Actor, log } from 'apify';
import { CATEGORIES, categoryMatcher, categoryLabel } from './categories.js';
import { geocode, bboxSizeKm } from './geocode.js';
import { latestPlacesRelease, findCandidates, readDetails } from './overture.js';
import { GOOGLE_TERMS, GoogleMapsError, searchGoogleMaps } from './googleMaps.js';

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

async function* fromGoogleMaps({ category, maxBusinesses }, place, counters) {
    const proxyConfiguration = Actor.isAtHome() ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: 'US' }) : null;
    const g = {};
    log.info(`Searching Google Maps for "${GOOGLE_TERMS[category]}" in ${place.name}`);
    for await (const p of searchGoogleMaps({ term: GOOGLE_TERMS[category], bbox: place.bbox, countryCode: place.countryCode, maxPlaces: maxBusinesses, proxyConfiguration, counts: g })) {
        if (p.status !== 'open') continue; // closed places aren't leads
        counters.found++;
        if (!p.website) counters.noWebsiteListed++;
        yield googlePlaceToItem(p, { countryCode: place.countryCode });
    }
    log.info(`Google Maps: ${counters.found} open ${CATEGORIES[category].title.toLowerCase()} found, ${counters.noWebsiteListed} with no website listed`
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

/**
 * Businesses of one category in one place, as items for toBusinessRecord().
 * @param {{ category: string, location: string, maxBusinesses: number }} search
 * @param {{ found: number, chains: number, noWebsiteListed: number, overLimit: number, place: string|null, source?: string, fellBack?: string|null }} counters
 */
export async function* discoverBusinesses(search, counters) {
    let place;
    try {
        place = await geocode(search.location);
    } catch (err) {
        err.sourceDown = true;
        throw err;
    }
    if (!place) throw new SearchInputError(`Couldn't find a place called "${search.location}". Try adding the country, e.g. "Denver, USA".`);
    const { widthKm, heightKm } = bboxSizeKm(place.bbox);
    if (widthKm > MAX_AREA_KM || heightKm > MAX_AREA_KM) {
        throw new SearchInputError(`"${place.name}" covers about ${Math.round(widthKm)} x ${Math.round(heightKm)} km. Search a city, town or district (up to ${MAX_AREA_KM} km across) instead.`);
    }
    counters.place = place.name;

    counters.source = 'google_maps';
    try {
        yield* fromGoogleMaps(search, place, counters);
        return;
    } catch (err) {
        // Google only fails a search that found nothing; then the whole search runs on Overture's open data.
        if (!(err instanceof GoogleMapsError) || counters.found > 0) throw err;
        log.warning(`${err.message}. Searching Overture Maps instead.`);
        Object.assign(counters, { source: 'overture', fellBack: err.message, found: 0, noWebsiteListed: 0 });
    }
    yield* fromOverture(search, place, counters);
}
