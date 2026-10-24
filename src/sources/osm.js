// "Search a city" mode: find businesses of one type in a place on OpenStreetMap, then audit them like any other
// source. Geocoding uses Nominatim and the search uses the Overpass API, both free and keyless, one request each per
// run, with an identifying User-Agent as their usage policies ask. Business data © OpenStreetMap contributors (ODbL).
//
// Only businesses that list a website (or a social page in the website field) are kept. On OpenStreetMap a missing
// website tag usually means nobody added one, not that the business has no site, so those aren't sold as leads.
// Chains (anything tagged with a brand:wikidata) are skipped too: their sites are run by head office.
import { log } from 'apify';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OSM_USER_AGENT = 'WebsiteGapFinder/0.1 (Apify Actor; +https://apify.com/m_ctim/website-gap-finder)';

/** Search categories: the input's dropdown values, the OpenStreetMap tags they cover, and the label each tag gets. */
export const CATEGORIES = {
    plumber: { title: 'Plumbers', tags: [['craft', 'plumber', 'Plumber']] },
    electrician: { title: 'Electricians', tags: [['craft', 'electrician', 'Electrician']] },
    hvac: { title: 'Heating and air conditioning (HVAC)', tags: [['craft', 'hvac', 'HVAC contractor']] },
    roofer: { title: 'Roofers', tags: [['craft', 'roofer', 'Roofer']] },
    carpenter: { title: 'Carpenters and joiners', tags: [['craft', 'carpenter', 'Carpenter'], ['craft', 'joiner', 'Joiner']] },
    painter: { title: 'Painters and decorators', tags: [['craft', 'painter', 'Painter']] },
    hair: { title: 'Hair salons and barbers', tags: [['shop', 'hairdresser', 'Hair salon']] },
    beauty: { title: 'Beauty and nail salons', tags: [['shop', 'beauty', 'Beauty salon']] },
    massage: { title: 'Massage and spas', tags: [['shop', 'massage', 'Massage'], ['leisure', 'spa', 'Spa']] },
    tattoo: { title: 'Tattoo and piercing studios', tags: [['shop', 'tattoo', 'Tattoo studio']] },
    dentist: { title: 'Dentists', tags: [['amenity', 'dentist', 'Dentist'], ['healthcare', 'dentist', 'Dentist']] },
    doctor: { title: 'Doctors and clinics', tags: [['amenity', 'doctors', 'Doctor'], ['amenity', 'clinic', 'Clinic']] },
    physio: { title: 'Physiotherapists', tags: [['healthcare', 'physiotherapist', 'Physiotherapist']] },
    vet: { title: 'Veterinarians', tags: [['amenity', 'veterinary', 'Veterinarian']] },
    optician: { title: 'Opticians', tags: [['shop', 'optician', 'Optician']] },
    gym: { title: 'Gyms and fitness studios', tags: [['leisure', 'fitness_centre', 'Gym']] },
    restaurant: { title: 'Restaurants', tags: [['amenity', 'restaurant', 'Restaurant']] },
    cafe: { title: 'Cafes', tags: [['amenity', 'cafe', 'Cafe']] },
    bakery: { title: 'Bakeries', tags: [['shop', 'bakery', 'Bakery']] },
    hotel: { title: 'Hotels and guest houses', tags: [['tourism', 'hotel', 'Hotel'], ['tourism', 'guest_house', 'Guest house']] },
    car_repair: { title: 'Car repair garages', tags: [['shop', 'car_repair', 'Car repair']] },
    car_dealer: { title: 'Car dealers', tags: [['shop', 'car', 'Car dealer']] },
    lawyer: { title: 'Lawyers', tags: [['office', 'lawyer', 'Lawyer']] },
    accountant: { title: 'Accountants', tags: [['office', 'accountant', 'Accountant']] },
    estate_agent: { title: 'Real estate agents', tags: [['office', 'estate_agent', 'Real estate agent']] },
    florist: { title: 'Florists', tags: [['shop', 'florist', 'Florist']] },
    clothes: { title: 'Clothing stores', tags: [['shop', 'clothes', 'Clothing store']] },
    furniture: { title: 'Furniture stores', tags: [['shop', 'furniture', 'Furniture store']] },
    photographer: { title: 'Photographers', tags: [['craft', 'photographer', 'Photographer'], ['shop', 'photo', 'Photo studio']] },
    driving_school: { title: 'Driving schools', tags: [['amenity', 'driving_school', 'Driving school']] },
    childcare: { title: 'Nurseries and childcare', tags: [['amenity', 'kindergarten', 'Nursery'], ['amenity', 'childcare', 'Childcare']] },
    laundry: { title: 'Laundry and dry cleaning', tags: [['shop', 'laundry', 'Laundry'], ['shop', 'dry_cleaning', 'Dry cleaner']] },
};

/** Where to search: an OpenStreetMap area (a city boundary) when Nominatim found one, otherwise a radius around a point. */
export function overpassScope(place) {
    if (place.osm_type === 'relation') return `area(id:${3_600_000_000 + Number(place.osm_id)})->.searchArea;`;
    if (place.osm_type === 'way') return `area(id:${2_400_000_000 + Number(place.osm_id)})->.searchArea;`;
    return null; // a point (node): search around it instead
}

/** The Overpass query for one category in one place. `limit` caps how many elements come back. */
export function buildOverpassQuery(categoryKey, place, limit) {
    const category = CATEGORIES[categoryKey];
    if (!category) throw new Error(`Unknown search category "${categoryKey}"`);
    const scope = overpassScope(place);
    const filter = scope ? '(area.searchArea)' : `(around:5000,${Number(place.lat)},${Number(place.lon)})`;
    const parts = category.tags.map(([key, value]) => `nwr["${key}"="${value}"]["name"]${filter};`).join('');
    return `[out:json][timeout:90];${scope ?? ''}(${parts});out tags center ${limit};`;
}

const WEBSITE_TAGS = ['website', 'contact:website', 'url'];

/**
 * One OpenStreetMap element -> a business item in the shape the other sources use (see records.js),
 * or a reason it was skipped: 'chain' or 'noWebsiteListed'.
 */
export function elementToItem(el, { categoryKey, city, countryCode }) {
    const t = el.tags ?? {};
    if (!t.name) return { skip: 'unnamed' };
    if (t['brand:wikidata']) return { skip: 'chain' };
    const website = WEBSITE_TAGS.map((k) => t[k]).find(Boolean);
    if (!website) return { skip: 'noWebsiteListed' };
    const match = CATEGORIES[categoryKey].tags.find(([key, value]) => t[key] === value);
    let category = match ? match[2] : CATEGORIES[categoryKey].title;
    if (category === 'Hair salon' && /barber/i.test(t.name)) category = 'Barber shop';
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    return {
        item: {
            name: t.name,
            website: website.split(';')[0].trim(),
            phone: (t.phone ?? t['contact:phone'] ?? '').split(';')[0].trim() || undefined,
            address: [street, t['addr:postcode'], t['addr:city']].filter(Boolean).join(', ') || undefined,
            city: t['addr:city'] ?? city,
            countryCode: (t['addr:country'] ?? countryCode)?.toUpperCase(),
            category,
            placeId: `osm:${el.type}/${el.id}`,
        },
    };
}

async function fetchJson(url, init, what) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json', ...init?.headers }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
        const err = new Error(`${what} answered HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

/** The place the user typed, via Nominatim. */
async function geocode(location) {
    const params = new URLSearchParams({ q: location, format: 'jsonv2', limit: '1', addressdetails: '1' });
    const results = await fetchJson(`${NOMINATIM_URL}?${params}`, {}, 'The OpenStreetMap place search');
    if (!results.length) throw new Error(`OpenStreetMap couldn't find a place called "${location}". Try adding the country, e.g. "Denver, USA".`);
    return results[0];
}

/** The Overpass search. The public server is sometimes at capacity, so busy replies are retried with pauses. */
async function overpass(query) {
    const waits = [0, 15_000, 30_000, 45_000];
    let lastErr;
    for (const wait of waits) {
        if (wait) {
            log.info(`OpenStreetMap's search server is busy; trying again in ${wait / 1000} s`);
            await new Promise((r) => setTimeout(r, wait));
        }
        try {
            return await fetchJson(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, "OpenStreetMap's search server");
        } catch (err) {
            lastErr = err;
            if (err.status && ![429, 502, 503, 504].includes(err.status)) break; // not a busy server: don't retry
        }
    }
    throw new Error(`${lastErr.message}. It's a free public server that is sometimes at capacity; try again in a few minutes.`);
}

/**
 * Businesses of one category in one place, as items for toBusinessRecord().
 * @param {{ category: string, location: string, maxBusinesses: number }} search
 * @param {{ found: number, chains: number, noWebsiteListed: number, place: string|null }} counters
 */
export async function* discoverBusinesses({ category, location, maxBusinesses }, counters) {
    const place = await geocode(location);
    const address = place.address ?? {};
    const city = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? place.name ?? location;
    const countryCode = address.country_code?.toUpperCase();
    counters.place = place.display_name;
    log.info(`Searching OpenStreetMap for ${CATEGORIES[category].title.toLowerCase()} in ${place.display_name}`);

    // Most listings have no website tag (in tests only 7 to 38% had one), so ask for far more than will be kept.
    // Tags-only output is small, so even the 10,000 ceiling is a few MB.
    const fetchLimit = Math.min(10_000, Math.max(2_000, maxBusinesses * 20));
    const data = await overpass(buildOverpassQuery(category, place, fetchLimit));
    counters.capped = (data.elements?.length ?? 0) >= fetchLimit;
    let kept = 0;
    for (const el of data.elements ?? []) {
        counters.found++;
        const { item, skip } = elementToItem(el, { categoryKey: category, city, countryCode });
        if (skip === 'chain') counters.chains++;
        if (skip === 'noWebsiteListed') counters.noWebsiteListed++;
        if (!item) continue;
        if (kept >= maxBusinesses) {
            counters.overLimit++;
            continue;
        }
        kept++;
        yield item;
    }
    log.info(`OpenStreetMap: ${counters.found}${counters.capped ? '+' : ''} ${CATEGORIES[category].title.toLowerCase()} found, ${kept} with a website listed will be audited`
        + ` (${counters.noWebsiteListed} list no website, ${counters.chains} chains skipped${counters.overLimit ? `, ${counters.overLimit} over maxBusinesses` : ''})`);
}

