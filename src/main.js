import { Actor, log } from 'apify';
import { EVENTS, SEEN_STORE, SEEN_KEY, SEEN_LIMIT } from './config.js';
import { loadBusinesses, businessKey } from './sources/index.js';
import { CATEGORIES } from './sources/categories.js';
import { emptyRunNote } from './note.js';

// The same three made-up businesses as the input form's example, used when a run gets no input at all
// (an AI agent calling with {}, or an empty API call): no website, Instagram only, and a site that loads.
const EXAMPLE_BUSINESSES = [
    { name: 'Corner Barbershop (example: no website)', category: 'Barber shop', city: 'Austin', country: 'US', phone: '(512) 555-0142' },
    { name: 'Sunrise Nails (example: Instagram only)', website: 'https://www.instagram.com/example', category: 'Nail salon', city: 'Nairobi', country: 'KE' },
    { name: 'Example Plumbing Ltd', website: 'https://example.com', category: 'Plumber', city: 'Manchester', country: 'GB' },
];
import { auditWebsite } from './audit/audit.js';
import { hasRealWebsite } from './audit/classify.js';
import { scoreBusiness } from './score.js';
import { resolveCountry, countryFromHostname, toE164 } from './phone.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const datasetId = typeof input.datasetId === 'string' ? input.datasetId.trim() : '';
let businesses = Array.isArray(input.businesses) ? input.businesses : [];

// Input that can't be used ends the run with one uncharged "error" row saying what to change, not a failed run:
// a failure reads as "the tool is broken", and Apify's Store shows each actor's share of succeeded runs.
async function stopWithError(error) {
    await Actor.pushData({ rowType: 'error', name: "Couldn't start the audit (not charged)", error, auditedAt: new Date().toISOString() });
    await Actor.setStatusMessage(`Nothing audited or charged: ${error}`, { isStatusMessageTerminal: true });
    await Actor.exit();
}

if (input.businesses !== undefined && input.businesses !== null && !Array.isArray(input.businesses)) {
    await stopWithError('Input "businesses" must be an array of objects, e.g. [{ "name": "Joe\'s Barbers", "website": "joesbarbers.com" }].');
}

// Search mode: a business type plus a place, looked up on Google Maps (Overture Maps open data if Google doesn't answer).
// Since 2026-11-05 a search can also be any typed business ("yoga studio"), and cover several places.
const MAX_SEARCH_PLACES = 25;
const searchCategory = typeof input.searchCategory === 'string' ? input.searchCategory.trim() : '';
const searchTerm = typeof input.searchTerm === 'string' ? input.searchTerm.trim().replace(/\s+/g, ' ') : '';
const searchLocation = typeof input.searchLocation === 'string' ? input.searchLocation.trim() : '';
const searchPlaces = [searchLocation, ...(Array.isArray(input.searchLocations) ? input.searchLocations : [])]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p, i, all) => p && all.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
const searchType = searchTerm || searchCategory;
if (Boolean(searchType) !== Boolean(searchPlaces.length)) {
    await stopWithError(searchType
        ? 'Add a "City or area to search" for the search, e.g. "Denver, USA".'
        : 'Pick a "Type of business" for the search, e.g. Plumbers, or type one, e.g. "yoga studio".');
}
if (searchTerm && searchTerm.length > 80) {
    await stopWithError(`"${searchTerm.slice(0, 40)}..." is too long for a business type. Use a few words, e.g. "yoga studio".`);
}
if (!searchTerm && searchCategory && !CATEGORIES[searchCategory]) {
    await stopWithError(`Unknown business type "${searchCategory}". Use one of: ${Object.keys(CATEGORIES).join(', ')}, or type any business in "Or type any business".`);
}
if (searchPlaces.length > MAX_SEARCH_PLACES) {
    await stopWithError(`${searchPlaces.length} places is more than one run searches (${MAX_SEARCH_PLACES}). Split them across runs.`);
}
// Only businesses with no real website (none, only a social or listing page, or a dead site builder): the leads a web
// designer pitches first. A search reads deeper to find them; any other business is skipped before it's audited.
const onlyNoWebsite = input.onlyNoWebsite === true;

// For scheduled runs: businesses earlier runs returned are skipped (not audited or charged), so each run brings only new
// ones. The keys live in the buyer's own named key-value store, so they survive between runs (2026-11-05).
const onlyNew = input.onlyNew === true;
// A named list per search or client (e.g. one per saved search in a lead app), so what one returned doesn't hide
// businesses from another. Empty means the one shared list.
const seenListName = typeof input.seenListName === 'string' ? input.seenListName.trim() : '';
if (seenListName && !/^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/.test(seenListName)) {
    await stopWithError(`"${seenListName}" can't be a list name. Use 3 to 63 lowercase letters, digits and hyphens, e.g. "denver-plumbers".`);
}
const seenStore = onlyNew ? await Actor.openKeyValueStore(seenListName || SEEN_STORE) : null;
const seenBefore = new Set(seenStore ? (await seenStore.getValue(SEEN_KEY)) ?? [] : []);
const isSeen = onlyNew ? (item) => seenBefore.has(businessKey(item)) : null;
const deliveredKeys = [];
const search = searchType
    ? {
        category: searchTerm ? null : searchCategory,
        term: searchTerm || null,
        location: searchPlaces.join('; '),
        locations: searchPlaces,
        maxBusinesses: Math.min(2000, Math.max(1, Number.isFinite(input.maxBusinesses) ? input.maxBusinesses : 100)),
        onlyNoWebsite,
        onlyNew,
        isSeen,
        seenCount: seenBefore.size,
    }
    : null;

// A search that falls back to Overture Maps reads its open data for the whole area (Denver's plumbers peaked at 589 MB
// locally, and bigger cities read more). actor.json gives a search 2 GB by default; a run started with less gets a row saying so
// instead of being killed for running out of memory.
const SEARCH_MEMORY_MBYTES = 2048;
const memoryMbytes = Actor.getEnv().memoryMbytes;
if (search && memoryMbytes && memoryMbytes < SEARCH_MEMORY_MBYTES) {
    await stopWithError(`A city search needs at least ${SEARCH_MEMORY_MBYTES} MB of memory, and this run had ${memoryMbytes} MB. `
        + `Run it again with Memory set to ${SEARCH_MEMORY_MBYTES} MB, which is the default for a search.`);
}

// The input form comes pre-filled with three made-up example businesses. When someone runs a search or a dataset,
// they almost certainly didn't mean to audit (and pay for) those too.
const isFormExample = (b) => /\(example\b/i.test(b?.name ?? '') || /^https?:\/\/(www\.)?(example\.com|instagram\.com\/example)\/?$/i.test(b?.website ?? '');
if ((search || datasetId) && businesses.some(isFormExample)) {
    const before = businesses.length;
    businesses = businesses.filter((b) => !isFormExample(b));
    log.info(`Left out ${before - businesses.length} example business(es) from the input form's pre-filled list`);
}

if (!datasetId && businesses.length === 0 && !search) {
    businesses = EXAMPLE_BUSINESSES;
    log.info('No search, dataset or businesses given, so auditing the three example businesses. Pick a type of business and a city, '
        + 'or give "datasetId" (e.g. a Google Maps scraper run) or a "businesses" list, to audit real ones.');
}

const auditDepth = input.auditDepth === 'full' ? 'full' : 'basic';
const options = {
    auditDepth,
    extractContacts: input.extractContacts === true,
    onlyOpportunities: input.onlyOpportunities === true,
    minScore: Math.min(100, Math.max(0, Number.isFinite(input.minScore) ? input.minScore : 50)),
    maxConcurrency: Math.min(50, Math.max(1, Number.isFinite(input.maxConcurrency) ? input.maxConcurrency : 10)),
};
log.info('Starting', { search: search && { ...search, isSeen: undefined }, datasetId: datasetId || null, businesses: businesses.length, onlyNew, ...options });
if (onlyNew) log.info(`Only new businesses: ${seenBefore.size} returned by earlier runs will be skipped`);

const counters = { skippedClosed: 0, skippedEmpty: 0, duplicates: 0, search: { found: 0, capped: false, chains: 0, noWebsiteListed: 0, overLimit: 0, place: null } };
const stats = {
    processed: 0, pushed: 0, filteredOut: 0, filteredOutUnaudited: 0, skippedHasWebsite: 0, skippedSeen: 0, errors: 0, scored: 0, scoreSum: 0,
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
    // Not audited, saved or charged.
    if (onlyNoWebsite && !business.websiteInvalid && hasRealWebsite(business.website)) {
        stats.skippedHasWebsite++;
        return;
    }
    // Searches skip these before they're counted; a dataset or list is checked here.
    if (isSeen?.(business)) {
        stats.skippedSeen++;
        return;
    }
    const websiteHost = business.website && !business.websiteInvalid ? new URL(business.website).hostname : null;
    const country = resolveCountry(business.countryRaw) ?? countryFromHostname(websiteHost);
    const audit = await cachedAudit(business, country);
    const { opportunityScore, opportunityReasons, pitchAngle } = scoreBusiness(business, audit);

    const inputPhone = business.phoneRaw ? (toE164(business.phoneRaw, country) ?? business.phoneRaw) : null;
    const sitePhone = audit.contacts?.phone ?? null;
    const row = {
        rowType: 'business',
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
    if (onlyNew) deliveredKeys.push(businessKey(business));
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

// The run's time limit (set by whoever started it). New audits stop this long before it, so the run finishes with
// what it has instead of being cut off as "timed out".
const DEADLINE_MARGIN_MS = 60_000;
const timeoutAt = Actor.getEnv().timeoutAt;
let timeRanOut = false;
const nearDeadline = () => {
    if (timeoutAt && Date.now() > new Date(timeoutAt).getTime() - DEADLINE_MARGIN_MS) timeRanOut = true;
    return timeRanOut;
};

/** Run `worker` over an async iterable with at most `concurrency` in flight. */
async function runPool(iterable, concurrency, worker) {
    const iterator = iterable[Symbol.asyncIterator]();
    async function lane() {
        for (;;) {
            if (stopped || nearDeadline()) return;
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

// One very slow site can keep an audit going for minutes after new audits stop (one took 110 s on 2026-10-29), and a
// search's map data can take a while too. So shortly before the time limit the run stops waiting for whatever is still
// in progress and finishes with what it has, rather than being cut off as "timed out".
const HARD_STOP_MS = 20_000;
const hardStop = timeoutAt
    ? new Promise((resolve) => setTimeout(resolve, Math.max(0, new Date(timeoutAt).getTime() - HARD_STOP_MS - Date.now())).unref())
    : new Promise(() => {});

let sourceProblem = null;
try {
    await Promise.race([
        runPool(loadBusinesses({ datasetId, businesses, search }, counters), options.maxConcurrency, processBusiness),
        hardStop.then(() => {
            timeRanOut = true;
        }),
    ]);
} catch (err) {
    // A source that can't be read (Overture's files or the place search not answering, an unknown or too-large place,
    // an unreadable dataset) becomes one uncharged row with the plain reason. Businesses already audited are kept.
    sourceProblem = err;
    log.warning(err.message);
    await Actor.pushData(err.sourceDown
        ? { rowType: 'note', name: "Couldn't read the business data (not charged)", note: `${err.message}. Nothing more was charged; try again in a few minutes.`, auditedAt: new Date().toISOString() }
        : { rowType: 'error', name: "Couldn't read the businesses (not charged)", error: err.message, auditedAt: new Date().toISOString() });
}
if (timeRanOut) log.warning(`Stopped starting new audits ${DEADLINE_MARGIN_MS / 1000} s before the run's time limit, so the run ends with the businesses already audited.`);

if (seenStore && deliveredKeys.length) {
    await seenStore.setValue(SEEN_KEY, [...seenBefore, ...deliveredKeys].slice(-SEEN_LIMIT));
}

// Never end with an empty dataset: say why nothing was saved, in one uncharged row.
if (stats.pushed === 0 && !sourceProblem) {
    const note = emptyRunNote(stats, counters, options, search, search ? (search.term ?? CATEGORIES[search.category].title) : undefined);
    if (timeRanOut) note.note = "The run's time limit was reached before any business was audited. Run again with a longer time limit.";
    await Actor.pushData(note);
    log.info(`No businesses saved: ${note.note}`);
}

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
    skipped: { permanentlyClosed: counters.skippedClosed, empty: counters.skippedEmpty, duplicates: counters.duplicates, hasWebsite: stats.skippedHasWebsite, returnedBefore: stats.skippedSeen + (counters.search.seen ?? 0), errors: stats.errors },
    ...(search ? { search: { source: counters.search.source === 'google_maps' ? 'Google Maps' : 'Overture Maps', fellBackFromGoogle: counters.search.fellBack ?? null, place: counters.search.place, found: counters.search.found, noWebsiteListed: counters.search.noWebsiteListed, chains: counters.search.chains, overMaxBusinesses: counters.search.overLimit } } : {}),
    stoppedBeforeTimeLimit: timeRanOut,
    billableEvents: stats.billable, // what was charged, once pricing is active
});
// No source means no place could be searched at all; the error row already says why.
const searchNote = search && counters.search.source
    ? (counters.search.source === 'google_maps'
        ? `Search: ${counters.search.found} found on Google Maps, ${counters.search.noWebsiteListed} with no website listed. `
        : `Search: ${counters.search.found} found in Overture Maps${counters.search.fellBack ? " (Google Maps didn't answer)" : ''}, ${counters.search.noWebsiteListed} list no website, ${counters.search.chains} chains skipped. `)
    : '';
await Actor.setStatusMessage(
    `${searchNote}Audited ${stats.processed} businesses: ${s.none} without a website, ${s.broken} broken, ${s.social_only} social only, `
    + `${s.dead_builder} on dead builders, ${s.blocked} couldn't be audited; average score ${averageScore ?? 'n/a'}. ${stats.pushed} rows saved.`
    + `${onlyNew && (stats.skippedSeen + (counters.search.seen ?? 0)) ? ` ${stats.skippedSeen + (counters.search.seen ?? 0)} returned by earlier runs were skipped.` : ''}`
    + `${timeRanOut ? " Stopped early to finish within the run's time limit; run again with the same input or a longer limit for the rest." : ''}`,
    { isStatusMessageTerminal: true },
);

await Actor.exit();
