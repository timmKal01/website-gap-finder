// Everything worth tuning lives here: pay-per-event names, request limits and scoring weights.

/**
 * Events charged from code. The names must match the events in the Actor's monetization settings.
 * Prices are NOT set here: they live on Apify. Placeholders to fill in are in
 * .actor/pay_per_event.json (see PRICING.md).
 *
 * The flat start fee is Apify's synthetic `apify-actor-start` event. The platform charges it by
 * itself (charging it from code fails), and it covers the first 5 seconds of every run.
 */
export const EVENTS = {
    websiteAudited: 'website-audited', // a business whose site we fetched and audited
    leadNoWebsite: 'lead-no-website', // no site to fetch: none, only a social/listing page, or a dead builder's domain
    contactsExtracted: 'contacts-extracted', // extractContacts is on and the site listed an email, phone or WhatsApp
};

export const HTTP = {
    timeoutMs: 15_000,
    robotsTimeoutMs: 8_000,
    maxAttempts: 3, // for 429s, 5xx and dropped connections; timeouts get one retry, DNS/TLS/refused none
    baseDelayMs: 1000, // backoff: 1s, 2s, 4s...
    hostGapMs: 1000, // requests to the same host start at least this far apart
    maxBytes: 3_000_000,
    userAgent: 'Mozilla/5.0 (compatible; WebsiteGapFinder/0.1; +https://apify.com/m_ctim/website-gap-finder)',
    robotsAgent: 'websitegapfinder', // our token for robots.txt groups
};

/**
 * Opportunity score = sum of the points for every signal that applies, capped at 100.
 * Higher means a better prospect for a web agency.
 */
export const SCORING = {
    // Where the business stands online. Exactly one of these applies.
    status: {
        none: 80, // no website at all
        social_only: 75, // only a Facebook/Instagram/TikTok/listing page
        dead_builder: 70, // built on a discontinued site builder
        broken: 70, // doesn't load, errors, parked or suspended
        free_subdomain: 50, // e.g. salon.wixsite.com, no own domain
        ok: 0,
        // "blocked" (the site refused our automated check) gets no score at all: opportunityScore is null.
    },

    // Problems on a site that loads. These add up.
    noHttps: 20,
    brokenSsl: 20,
    noHttpsRedirect: 5,
    notMobileFriendly: 20,
    placeholderPage: 40, // "coming soon" / "under construction"
    outdatedWordPress: 10,
    outdatedWordPressBelow: 6, // WordPress versions below 6.0 count as outdated
    oldCopyright: [ // first matching rule wins; 8+ years untouched counts strongly
        { yearsOld: 8, points: 40 },
        { yearsOld: 5, points: 20 },
        { yearsOld: 3, points: 10 },
    ],
    slowResponse: [ // homepage HTML load time, first matching rule wins
        { overMs: 5000, points: 12 },
        { overMs: 3000, points: 7 },
    ],
    missingTitle: 5,
    missingMetaDescription: 5,
    noBookingForAppointments: 12, // salons, clinics, dentists... with no online booking

    // Not a website problem: an active, well-reviewed business is more likely to pay for a site.
    establishedBusiness: { minReviews: 20, minRating: 4.0, points: 10 },
};
