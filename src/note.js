// A run that saves no business rows still returns one row saying why, so a person or an AI agent reading the
// dataset can tell "nothing matched" from "something broke". The row is never charged.

/**
 * @param {{ processed: number, filteredOut: number, filteredOutUnaudited: number, errors: number }} stats
 * @param {{ skippedClosed: number, skippedEmpty: number, duplicates: number, search: { place: string|null, found: number, capped?: boolean, noWebsiteListed: number, chains: number } }} counters
 * @param {{ onlyOpportunities: boolean, minScore: number }} options
 * @param {{ category: string, location: string }|null} search
 * @param {string} [categoryTitle] e.g. "Plumbers"
 * @returns {object} the row to push
 */
export function emptyRunNote(stats, counters, options, search, categoryTitle) {
    const reasons = [];
    if (search) {
        const what = (categoryTitle ?? search.category).toLowerCase();
        const where = counters.search.place ?? search.location;
        const s = counters.search;
        if (s.found === 0) {
            reasons.push(`OpenStreetMap lists no ${what} in ${where}. Try a nearby bigger city, another type of business, or a Google Maps scraper dataset.`);
        } else if (stats.processed === 0) {
            reasons.push(`OpenStreetMap lists ${s.found}${s.capped ? '+' : ''} ${what} in ${where}, but ${s.noWebsiteListed === 1 ? '1 lists' : `${s.noWebsiteListed} list`} no website`
                + `${s.chains ? ` and ${s.chains === 1 ? '1 is a chain' : `${s.chains} are chains`}` : ''}, so there was no website to audit. On OpenStreetMap a missing website`
                + ' often just means nobody added it; a Google Maps scraper dataset covers those businesses.');
        }
    }
    if (options.onlyOpportunities && stats.processed > 0 && stats.filteredOut + stats.filteredOutUnaudited >= stats.processed) {
        reasons.push(`All ${stats.processed} businesses audited scored below ${options.minScore}${stats.filteredOutUnaudited ? ' or couldn\'t be audited' : ''},`
            + ' so none were saved (filtered businesses aren\'t charged). Lower minScore or turn off onlyOpportunities to see them.');
    }
    const skipped = counters.skippedClosed + counters.skippedEmpty + counters.duplicates;
    if (!search && stats.processed === 0 && skipped > 0) {
        reasons.push(`Every input record was skipped: ${counters.skippedClosed} permanently closed, ${counters.skippedEmpty} with no name or website, ${counters.duplicates} duplicates.`);
    }
    if (stats.errors > 0 && reasons.length === 0) {
        reasons.push(`${stats.errors} businesses couldn't be processed; the run log has the details.`);
    }
    if (reasons.length === 0) reasons.push('No businesses were found in the input.');

    return {
        name: 'No businesses saved in this run (not charged)',
        websiteStatus: null,
        opportunityScore: null,
        opportunityReasons: [],
        note: reasons.join(' '),
        processed: stats.processed,
        filteredOut: stats.filteredOut + stats.filteredOutUnaudited,
        ...(search ? { search: { category: search.category, location: search.location, place: counters.search.place, found: counters.search.found, noWebsiteListed: counters.search.noWebsiteListed, chains: counters.search.chains } } : {}),
        auditedAt: new Date().toISOString(),
    };
}
