// The place the user typed -> a bounding box. OpenStreetMap's place search (Nominatim) first, Photon (komoot, built
// on the same data) if Nominatim doesn't answer. One request each at most, with an identifying User-Agent.
// Copied from local-business-leads; evolve independently.

const USER_AGENT = 'website-gap-finder/0.1 (+https://apify.com/m_ctim/website-gap-finder)';

async function getJson(url) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
    return res.json();
}

async function nominatim(location) {
    const params = new URLSearchParams({ q: location, format: 'jsonv2', limit: '1', addressdetails: '1' });
    const [hit] = await getJson(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!hit) return null;
    const [south, north, west, east] = hit.boundingbox.map(Number);
    return { name: hit.display_name, countryCode: hit.address?.country_code?.toUpperCase() ?? null, bbox: { xmin: west, xmax: east, ymin: south, ymax: north } };
}

async function photon(location) {
    const { features: [hit] = [] } = await getJson(`https://photon.komoot.io/api/?${new URLSearchParams({ q: location, limit: '1' })}`);
    if (!hit) return null;
    const p = hit.properties;
    const [lon, lat] = hit.geometry.coordinates;
    // Photon's extent is [west, north, east, south]; a point without one gets ~3 km around it.
    const [west, north, east, south] = p.extent ?? [lon - 0.03, lat + 0.03, lon + 0.03, lat - 0.03];
    const name = [p.name, p.city, p.state, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    return { name, countryCode: p.countrycode?.toUpperCase() ?? null, bbox: { xmin: west, xmax: east, ymin: south, ymax: north } };
}

/**
 * @returns {Promise<{ name: string, countryCode: string|null, bbox: { xmin: number, xmax: number, ymin: number, ymax: number } } | null>}
 *   null when neither service knows the place. Throws only when both services failed to answer.
 */
export async function geocode(location) {
    try {
        return await nominatim(location);
    } catch (first) {
        try {
            return await photon(location);
        } catch (second) {
            throw new Error(`The place search didn't answer (${first.message}; ${second.message})`);
        }
    }
}

/** Width and height of a bounding box in kilometres (roughly, at its latitude). */
export function bboxSizeKm({ xmin, xmax, ymin, ymax }) {
    const midLat = ((ymin + ymax) / 2) * (Math.PI / 180);
    return { widthKm: (xmax - xmin) * 111.32 * Math.cos(midLat), heightKm: (ymax - ymin) * 110.57 };
}
