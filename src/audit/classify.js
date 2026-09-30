// What a website URL is before (or after) we fetch it: a social or listing page instead of a site,
// a free builder subdomain, a discontinued builder's domain, or a domain marketplace.
import { getDomain } from 'tldts';

// "Website" fields that point at someone else's platform. `key` is the socialLinks key.
const PROFILE_HOSTS = [
    { re: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/, platform: 'Facebook', key: 'facebook' },
    { re: /(^|\.)instagram\.com$/, platform: 'Instagram', key: 'instagram' },
    { re: /(^|\.)tiktok\.com$/, platform: 'TikTok', key: 'tiktok' },
    { re: /(^|\.)(twitter\.com|x\.com)$/, platform: 'X (Twitter)', key: 'x' },
    { re: /(^|\.)linkedin\.com$/, platform: 'LinkedIn', key: 'linkedin' },
    { re: /(^|\.)(youtube\.com|youtu\.be)$/, platform: 'YouTube', key: 'youtube' },
    { re: /(^|\.)pinterest\.[a-z.]+$/, platform: 'Pinterest', key: 'pinterest' },
    { re: /(^|\.)(snapchat\.com)$/, platform: 'Snapchat', key: 'snapchat' },
    { re: /(^|\.)threads\.(net|com)$/, platform: 'Threads', key: 'threads' },
    { re: /(^|\.)(linktr\.ee|linkin\.bio|beacons\.ai|bio\.link|lnk\.bio|taplink\.cc)$/, platform: 'link-in-bio page', key: 'linkInBio' },
    { re: /(^|\.)(wa\.me|whatsapp\.com)$/, platform: 'WhatsApp link', key: 'whatsapp' },
    { re: /(^|\.)(t\.me|telegram\.me)$/, platform: 'Telegram', key: 'telegram' },
    { re: /(^|\.)yelp\.[a-z.]+$/, platform: 'Yelp listing', key: 'yelp' },
    { re: /(^|\.)tripadvisor\.[a-z.]+$/, platform: 'Tripadvisor listing', key: 'tripadvisor' },
    { re: /(^|\.)(g\.page|maps\.app\.goo\.gl|business\.google\.com)$/, platform: 'Google Business Profile', key: 'google' },
    // Booking marketplaces used as the "website": a profile page, not a site of their own.
    { re: /(^|\.)fresha\.com$/, platform: 'Fresha profile', key: 'fresha', booking: 'Fresha' },
    { re: /(^|\.)booksy\.com$/, platform: 'Booksy profile', key: 'booksy', booking: 'Booksy' },
    { re: /(^|\.)vagaro\.com$/, platform: 'Vagaro profile', key: 'vagaro', booking: 'Vagaro' },
    { re: /(^|\.)styleseat\.com$/, platform: 'StyleSeat profile', key: 'styleseat', booking: 'StyleSeat' },
    { re: /(^|\.)treatwell\.[a-z.]+$/, platform: 'Treatwell profile', key: 'treatwell', booking: 'Treatwell' },
    { re: /(^|\.)planity\.com$/, platform: 'Planity profile', key: 'planity', booking: 'Planity' },
];

// Free subdomains of site builders and hosts: the business has no domain of its own.
const FREE_HOST_SUFFIXES = [
    'wixsite.com', 'wixstudio.io', 'weebly.com', 'wordpress.com', 'godaddysites.com', 'square.site',
    'site123.me', 'jimdosite.com', 'jimdofree.com', 'mystrikingly.com', 'strikingly.com', 'yolasite.com',
    'ueniweb.com', 'carrd.co', 'myshopify.com', 'bigcartel.com', 'simplesite.com', 'squarespace.com',
    'webflow.io', 'framer.website', 'framer.ai', 'netlify.app', 'vercel.app', 'github.io', 'pages.dev',
    '000webhostapp.com', 'tumblr.com', 'hubspotpagebuilder.com', 'mailchimpsites.com', 'e-monsite.com',
    'over-blog.com', 'webstarts.com',
];
const FREE_HOST_PATTERNS = [/(^|\.)blogspot\.[a-z.]+$/, /(^|\.)webnode\.[a-z.]+$/];

// Builders that no longer exist. Sites on their domains are dead or redirect elsewhere.
const DEAD_BUILDER_HOSTS = [
    { re: /(^|\.)business\.site$/, builder: 'Google Business Profile websites (shut down in 2024)' },
    { re: /(^|\.)businesscatalyst\.com$/, builder: 'Adobe Business Catalyst (shut down in 2021)' },
    { re: /(^|\.)officelive\.com$/, builder: 'Microsoft Office Live Small Business (shut down in 2012)' },
    { re: /(^|\.)googlepages\.com$/, builder: 'Google Page Creator (shut down in 2009)' },
];

// Detected from the `generator` meta tag of a page we fetched.
const DEAD_BUILDER_GENERATORS = [
    { re: /microsoft frontpage/i, builder: 'Microsoft FrontPage (discontinued in 2006)' },
    { re: /^iweb\b/i, builder: 'Apple iWeb (discontinued in 2011)' },
    { re: /adobe muse/i, builder: 'Adobe Muse (discontinued in 2020)' },
    { re: /business catalyst/i, builder: 'Adobe Business Catalyst (shut down in 2021)' },
];

// Domain marketplaces a parked or expired domain redirects to.
const MARKETPLACE_HOSTS = /(^|\.)(dan\.com|afternic\.com|sedo\.com|hugedomains\.com|buydomains\.com|undeveloped\.com|atom\.com|squadhelp\.com|domainmarket\.com|bodis\.com|parkingcrew\.net|sedoparking\.com)$/;

const hostOf = (url) => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
};

/** Profile/listing page used as a website, e.g. a Facebook page or a Fresha profile. */
export function profilePlatform(url) {
    const host = hostOf(url);
    if (!host) return null;
    const hit = PROFILE_HOSTS.find((p) => p.re.test(host));
    if (hit) return hit;
    // google.com/maps/..., maps.google.co.ke/...
    if (/(^|\.)google\.[a-z.]+$/.test(host) && /^\/maps\b/.test(new URL(url).pathname)) return { platform: 'Google Maps listing', key: 'google' };
    if (/^maps\.google\.[a-z.]+$/.test(host)) return { platform: 'Google Maps listing', key: 'google' };
    return null;
}

/** Free builder subdomain the site lives on (e.g. "wixsite.com"), or null. */
export function freeHostSuffix(url) {
    const host = hostOf(url);
    if (!host) return null;
    const hit = FREE_HOST_SUFFIXES.find((s) => host.endsWith(`.${s}`));
    if (hit) return hit;
    for (const re of FREE_HOST_PATTERNS) {
        if (re.test(host)) return getDomain(host) ?? host;
    }
    return null;
}

export function deadBuilderFromHost(url) {
    const host = hostOf(url);
    return host ? (DEAD_BUILDER_HOSTS.find((d) => d.re.test(host))?.builder ?? null) : null;
}

export function deadBuilderFromGenerator(generator) {
    return generator ? (DEAD_BUILDER_GENERATORS.find((d) => d.re.test(generator))?.builder ?? null) : null;
}

export function isDomainMarketplace(url) {
    const host = hostOf(url);
    return host ? MARKETPLACE_HOSTS.test(host) : false;
}

/** Same registrable domain ("www.x.co.uk" and "shop.x.co.uk" are the same site). */
export function sameSite(a, b) {
    const da = getDomain(hostOf(a) ?? '');
    const db = getDomain(hostOf(b) ?? '');
    return Boolean(da && da === db);
}
