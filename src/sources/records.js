// One normalized business record, whatever the source: a Google Maps scraper dataset, another
// actor's output, or the manual `businesses` list. Field names are matched loosely so common
// scrapers work without any mapping from the user.

const pick = (obj, ...keys) => {
    for (const key of keys) {
        const value = obj?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
};

const toNumber = (v) => {
    const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

const toInt = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
    const digits = String(v ?? '').replace(/[^\d]/g, '');
    return digits ? Number.parseInt(digits, 10) : null;
};

const clean = (v) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim() || null);

const MAPS_URL_RE = /^(https?:\/\/)?((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)/i;
export const isMapsUrl = (u) => typeof u === 'string' && MAPS_URL_RE.test(u.trim());

// Placeholder values people put in a "website" column when there is none.
const NO_WEBSITE_RE = /^(n\/?a|none|null|nil|no|-+|no website|not available)$/i;
const TRACKING_PARAMS_RE = /^(utm_\w+|fbclid|gclid|msclkid|yclid|_ga|mc_cid|mc_eid)$/i;

/**
 * Website value -> absolute URL without tracking parameters.
 * @returns {{ url: string|null, invalid: boolean }}
 */
export function normalizeWebsite(raw) {
    const text = clean(raw);
    if (!text || NO_WEBSITE_RE.test(text)) return { url: null, invalid: false };
    let candidate = text.replace(/^\/\//, 'https://');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
    try {
        const u = new URL(candidate);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return { url: text, invalid: true };
        for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS_RE.test(key)) u.searchParams.delete(key);
        u.hash = '';
        u.hostname = u.hostname.toLowerCase();
        return { url: u.href, invalid: false };
    } catch {
        return { url: text, invalid: true };
    }
}

/** Any source item -> the fields the audit and output use. */
export function toBusinessRecord(item) {
    const urlField = pick(item, 'url');
    const websiteRaw = pick(item, 'website', 'websiteUrl', 'site', 'web', 'domain') ?? (urlField && !isMapsUrl(urlField) ? urlField : null);
    const { url: website, invalid: websiteInvalid } = normalizeWebsite(websiteRaw);
    const categories = Array.isArray(item?.categories) ? item.categories.filter(Boolean) : [];

    return {
        name: clean(pick(item, 'title', 'name', 'businessName', 'companyName')),
        category: clean(pick(item, 'categoryName', 'category', 'type') ?? categories[0] ?? null),
        address: clean(pick(item, 'address', 'fullAddress', 'formattedAddress', 'street')),
        city: clean(pick(item, 'city', 'town', 'locality')),
        countryRaw: clean(pick(item, 'countryCode', 'country')),
        phoneRaw: clean(pick(item, 'phone', 'phoneUnformatted', 'phoneNumber', 'telephone', 'tel')),
        website,
        websiteInvalid,
        mapsUrl: clean(pick(item, 'mapsUrl', 'googleMapsUrl', 'placeUrl') ?? (isMapsUrl(urlField) ? urlField : null)),
        rating: toNumber(pick(item, 'totalScore', 'rating', 'stars', 'averageRating')),
        reviewCount: toInt(pick(item, 'reviewsCount', 'reviewCount', 'userRatingsTotal', 'numberOfReviews')),
        placeId: clean(pick(item, 'placeId', 'place_id', 'cid', 'googlePlaceId')),
        permanentlyClosed: item?.permanentlyClosed === true || item?.businessStatus === 'CLOSED_PERMANENTLY',
    };
}
