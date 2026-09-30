// Opportunity score (0-100), human-readable reasons, and a one-line pitch built from templates.
// All weights live in SCORING (config.js).
import { SCORING } from './config.js';
import { isAppointmentBusiness } from './audit/checks.js';

const firstRule = (rules, test) => rules.find(test) ?? null;
const withArticle = (noun) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

/**
 * @returns {{ opportunityScore: number|null, opportunityReasons: string[], pitchAngle: string }}
 *   opportunityScore is null when the site refused our check: nothing is known, so no score.
 */
export function scoreBusiness(business, audit, now = new Date()) {
    const status = audit.websiteStatus;
    if (status === 'blocked') {
        const why = audit.websiteError ?? 'the site blocks automated checks';
        return { opportunityScore: null, opportunityReasons: [`Couldn't audit: ${why}`], pitchAngle: pitchAngle(business, audit, []) };
    }

    const reasons = []; // { id, text, points, phrase? }
    const add = (id, points, text, phrase) => reasons.push({ id, points, text, phrase });
    const statusPoints = SCORING.status[status] ?? 0;

    if (status === 'none') add('none', statusPoints, 'No website');
    if (status === 'social_only') add('social_only', statusPoints, `Only ${withArticle(audit.socialPlatform ?? 'social media')} page, no website`);
    if (status === 'dead_builder') add('dead_builder', statusPoints, `Built on ${audit.deadBuilder}`);
    if (status === 'broken') add('broken', statusPoints, `Website not working: ${audit.websiteError ?? 'unknown error'}`);

    const siteLoads = audit.fetched && (status === 'ok' || status === 'free_subdomain' || status === 'dead_builder') && audit.mobileFriendly !== null;
    if (siteLoads) {
        if (status === 'free_subdomain') add('free_subdomain', statusPoints, `On a free ${audit.freeHost} address, no own domain`, `sits on a free ${audit.freeHost} address`);
        if (audit.placeholder) add('placeholder', SCORING.placeholderPage, 'Placeholder page (coming soon / under construction)', 'is still a placeholder page');
        if (audit.listedLinkBroken) add('listedLinkBroken', SCORING.listedLinkBroken, 'Listed website link leads to a missing page', 'is listed with a link to a missing page');
        if (audit.sslError === 'INCOMPLETE_CHAIN') {
            add('incompleteSsl', SCORING.incompleteSslChain, 'Incomplete SSL certificate chain (warnings in some browsers and apps)', 'shows security warnings in some browsers and apps');
        } else if (audit.sslError) add('brokenSsl', SCORING.brokenSsl, 'Broken SSL certificate', 'shows a security warning (broken SSL certificate)');
        else if (audit.https === false) add('noHttps', SCORING.noHttps, 'No HTTPS', "isn't secure (no HTTPS)");
        else if (audit.httpRedirectsToHttps === false) add('noHttpsRedirect', SCORING.noHttpsRedirect, "HTTP doesn't redirect to HTTPS", "doesn't redirect to HTTPS");
        if (audit.mobileFriendly === false) add('notMobileFriendly', SCORING.notMobileFriendly, 'Not mobile friendly', "isn't mobile friendly");
        if (audit.wordpressVersion && Number.parseInt(audit.wordpressVersion, 10) < SCORING.outdatedWordPressBelow) {
            add('outdatedWordPress', SCORING.outdatedWordPress, `Outdated WordPress (${audit.wordpressVersion})`, `runs an outdated WordPress (${audit.wordpressVersion})`);
        }
        if (audit.lastCopyrightYear) {
            const age = now.getUTCFullYear() - audit.lastCopyrightYear;
            const rule = firstRule(SCORING.oldCopyright, (r) => age >= r.yearsOld);
            if (rule) add('oldCopyright', rule.points, `Copyright still says ${audit.lastCopyrightYear}`, `still says © ${audit.lastCopyrightYear}`);
        }
        if (audit.responseMs !== null) {
            const rule = firstRule(SCORING.slowResponse, (r) => audit.responseMs > r.overMs);
            const seconds = (audit.responseMs / 1000).toFixed(1);
            if (rule) add('slow', rule.points, `Slow homepage (${seconds}s)`, `takes ${seconds}s to load`);
        }
        if (audit.missingTitle) add('missingTitle', SCORING.missingTitle, 'No page title', 'is missing basic SEO tags');
        if (audit.missingMetaDescription) add('missingMetaDescription', SCORING.missingMetaDescription, 'No meta description', audit.missingTitle ? null : 'is missing basic SEO tags');
        if (audit.hasBooking === false && isAppointmentBusiness(business.category, business.name)) {
            add('noBooking', SCORING.noBookingForAppointments, 'No online booking', 'has no online booking');
        }
    }

    const est = SCORING.establishedBusiness;
    if (business.reviewCount >= est.minReviews && business.rating >= est.minRating) {
        add('established', est.points, `Established business (${business.reviewCount} reviews, rated ${business.rating})`);
    }

    reasons.sort((a, b) => b.points - a.points);
    const opportunityScore = Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0));
    return {
        opportunityScore,
        opportunityReasons: reasons.map((r) => r.text),
        pitchAngle: pitchAngle(business, audit, reasons),
    };
}

/** One sentence an agency could open with, from the strongest reasons. No LLM involved. */
export function pitchAngle(business, audit, reasons) {
    const name = business.name ?? 'This business';
    const possessive = /s$/i.test(name) ? `${name}'` : `${name}'s`;
    switch (audit.websiteStatus) {
        case 'none':
            return `${name} has no website yet, so customers who find them on Google have nowhere to go to learn more or get in touch.`;
        case 'social_only':
            return `${name} relies on ${withArticle(audit.socialPlatform ?? 'social media')} page; a website of their own would show up in Google searches and give customers one place to contact or book them.`;
        case 'broken':
            return `${possessive} website isn't working right now (${audit.websiteError ?? 'it fails to load'}), so visitors hit a dead end.`;
        case 'blocked':
            return `Couldn't audit: ${audit.websiteError ?? 'the site blocks automated checks'}. Check ${possessive} website by hand before reaching out.`;
        case 'dead_builder':
            if (!audit.fetched || !audit.deadBuilder) break;
            return `${possessive} website is built on ${audit.deadBuilder.replace(/\s*\(.*\)$/, '')}, which has been discontinued, so it's due for a rebuild.`;
        default:
            break;
    }
    if (audit.websiteStatus === 'dead_builder' && !audit.fetched) {
        return `${possessive} website was on ${audit.deadBuilder.replace(/\s*\(.*\)$/, '')}, which has shut down, so they effectively have no website.`;
    }
    const phrases = reasons.map((r) => r.phrase).filter(Boolean).filter((p, i, all) => all.indexOf(p) === i).slice(0, 2);
    if (phrases.length === 0) return `${possessive} website is in good shape; there's little to pitch on the site itself.`;
    return `${possessive} website ${phrases.join(' and ')}; a refresh could bring in more customers.`;
}
