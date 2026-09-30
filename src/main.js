import { Actor, log } from 'apify';
import { EVENTS } from './config.js';
import { loadBusinesses } from './sources/index.js';
import { auditWebsite } from './audit/audit.js';
import { scoreBusiness } from './score.js';
import { resolveCountry, countryFromHostname, toE164 } from './phone.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const datasetId = typeof input.datasetId === 'string' ? input.datasetId.trim() : '';
const businesses = Array.isArray(input.businesses) ? input.businesses : [];

if (input.businesses !== undefined && input.businesses !== null && !Array.isArray(input.businesses)) {
    await Actor.fail('Input "businesses" must be an array of objects, e.g. [{ "name": "Joe\'s Barbers", "website": "joesbarbers.com" }].');
}
if (!datasetId && businesses.length === 0) {
    await Actor.fail('Nothing to audit. Give either "datasetId" (the dataset of another actor, e.g. a Google Maps scraper run) or a "businesses" list with at least one business.');
}

const auditDepth = input.auditDepth === 'full' ? 'full' : 'basic';
const options = {
    auditDepth,
    extractContacts: input.extractContacts === true,
    onlyOpportunities: input.onlyOpportunities === true,
    minScore: Math.min(100, Math.max(0, Number.isFinite(input.minScore) ? input.minScore : 50)),
    maxConcurrency: Math.min(50, Math.max(1, Number.isFinite(input.maxConcurrency) ? input.maxConcurrency : 10)),
};
log.info('Starting', { datasetId: datasetId || null, businesses: businesses.length, ...options });

const counters = { skippedClosed: 0, skippedEmpty: 0, duplicates: 0 };
const stats = {
    processed: 0, pushed: 0, filteredOut: 0, filteredOutUnaudited: 0, errors: 0, scored: 0, scoreSum: 0,
    byStatus: { none: 0, ok: 0, broken: 0, social_only: 0, free_subdomain: 0, dead_builder: 0, blocked: 0 },
    billable: { [EVENTS.websiteAudited]: 0, [EVENTS.leadNoWebsite]: 0, [EVENTS.contactsExtracted]: 0 },
};

// Businesses sharing one website (chains, franchises) are audited once.
const auditCache = new Map();
function cachedAudit(business, country) {
    const key = business.website ? `${business.website}|${country ?? ''}` : null;
    if (!key) return auditWebsite(business, { ...options, country });
    if (!auditCache.has(key)) auditCache.set(key, auditWebsite(business, { ...options, country }));
    return auditCache.get(key);
}

let stopped = false;

async function processBusiness(business) {
    const websiteHost = business.website && !business.websiteInvalid ? new URL(business.website).hostname : null;
    const country = resolveCountry(business.countryRaw) ?? countryFromHostname(websiteHost);
    const audit = await cachedAudit(business, country);
    const { opportunityScore, opportunityReasons, pitchAngle } = scoreBusiness(business, audit);

    const inputPhone = business.phoneRaw ? (toE164(business.phoneRaw, country) ?? business.phoneRaw) : null;
    const sitePhone = audit.contacts?.phone ?? null;
    const row = {
        name: business.name,
        category: business.category,
        address: business.address,
        city: business.city,
        country: country ?? business.countryRaw,
        phone: inputPhone ?? sitePhone,
        phoneSource: inputPhone ? 'input' : sitePhone ? 'website' : null,
        mapsUrl: business.mapsUrl,
        placeId: business.placeId, // to join rows back to the source dataset
        rating: business.rating,
        reviewCount: business.reviewCount,
        websiteUrl: audit.websiteUrl,
        websiteStatus: audit.websiteStatus,
        websiteError: audit.websiteError,
        https: audit.https,
        httpRedirectsToHttps: audit.httpRedirectsToHttps,
        mobileFriendly: audit.mobileFriendly,
        responseMs: audit.responseMs,
        techStack: audit.techStack,
        lastCopyrightYear: audit.lastCopyrightYear,
        missingTitle: audit.missingTitle,
        missingMetaDescription: audit.missingMetaDescription,
        hasBooking: audit.hasBooking,
        bookingProvider: audit.bookingProvider,
        publicEmail: audit.contacts?.email ?? null,
        whatsapp: audit.contacts?.whatsapp ?? null,
        socialLinks: audit.socialLinks,
        opportunityScore,
        opportunityReasons,
        pitchAngle,
        auditedAt: new Date().toISOString(),
    };

    stats.processed++;
    stats.byStatus[audit.websiteStatus] = (stats.byStatus[audit.websiteStatus] ?? 0) + 1;
    if (opportunityScore !== null) {
        stats.scored++;
        stats.scoreSum += opportunityScore;
    }

    // Not delivered, so not charged. Unaudited sites (score null) aren't opportunities we can vouch for.
    if (options.onlyOpportunities && opportunityScore === null) {
        stats.filteredOutUnaudited++;
        return;
    }
    if (options.onlyOpportunities && opportunityScore < options.minScore) {
        stats.filteredOut++;
        return;
    }

    // Charge for what the row cost to produce: a fetched site, or a lead with nothing to fetch.
    // Sites that block automated checks are delivered free.
    let event = null;
    if (audit.websiteStatus !== 'blocked') event = audit.fetched ? EVENTS.websiteAudited : EVENTS.leadNoWebsite;
    const pushResult = event ? await Actor.pushData(row, event) : await Actor.pushData(row);
    stats.pushed++;
    if (event) stats.billable[event]++;
    if (pushResult?.eventChargeLimitReached) stopped = true;

    const foundContacts = options.extractContacts && Boolean(row.publicEmail || row.whatsapp || (sitePhone && row.phoneSource === 'website'));
    if (foundContacts && !stopped) {
        const chargeResult = await Actor.charge({ eventName: EVENTS.contactsExtracted });
        stats.billable[EVENTS.contactsExtracted]++;
        if (chargeResult?.eventChargeLimitReached) stopped = true;
    }
    if (stopped) log.warning('The run reached its maximum cost (set by the user); stopping after the businesses in progress.');
}

/** Run `worker` over an async iterable with at most `concurrency` in flight. */
async function runPool(iterable, concurrency, worker) {
    const iterator = iterable[Symbol.asyncIterator]();
    async function lane() {
        for (;;) {
            if (stopped) return;
            const next = await iterator.next();
            if (next.done) return;
            try {
                await worker(next.value);
            } catch (err) {
                // One bad record or site never stops the run.
                stats.errors++;
                log.warning(`Skipped "${next.value?.name ?? next.value?.website ?? 'unknown'}": ${err.message}`);
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, lane));
}

await runPool(loadBusinesses({ datasetId, businesses }, counters), options.maxConcurrency, processBusiness);

const s = stats.byStatus;
const averageScore = stats.scored ? Math.round(stats.scoreSum / stats.scored) : null; // blocked sites have no score
log.info('Summary', {
    processed: stats.processed,
    noWebsite: s.none,
    broken: s.broken,
    socialOnly: s.social_only,
    deadBuilder: s.dead_builder,
    freeSubdomain: s.free_subdomain,
    blocked: s.blocked,
    websiteOk: s.ok,
    averageScore,
    rowsPushed: stats.pushed,
    filteredOutBelowMinScore: stats.filteredOut,
    filteredOutUnaudited: stats.filteredOutUnaudited,
    skipped: { permanentlyClosed: counters.skippedClosed, empty: counters.skippedEmpty, duplicates: counters.duplicates, errors: stats.errors },
    billableEvents: stats.billable, // what was charged, once pricing is active
});
await Actor.setStatusMessage(
    `Audited ${stats.processed} businesses: ${s.none} without a website, ${s.broken} broken, ${s.social_only} social only, `
    + `${s.dead_builder} on dead builders, ${s.blocked} couldn't be audited; average score ${averageScore ?? 'n/a'}. ${stats.pushed} rows saved.`,
    { isStatusMessageTerminal: true },
);

await Actor.exit();
