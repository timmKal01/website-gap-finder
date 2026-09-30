// Audit one business's website in 2 requests (3 with auditDepth "full"):
//   1. https://host/robots.txt   -> are we allowed, and does HTTPS work (valid certificate)?
//   2. http://host/path           -> does HTTP redirect to HTTPS, how fast is it, and the page itself
//   3. the contact page ("full")  -> more contact details and booking links
// A site on HTTP only costs one more small request (http://host/robots.txt).
import * as cheerio from 'cheerio';
import { detectTechStack } from 'tech-stack-signatures';
import { HTTP } from '../config.js';
import { getPage, isTlsError } from '../http.js';
import { parseRobots, isAllowed } from '../robots.js';
import { profilePlatform, freeHostSuffix, deadBuilderFromHost, deadBuilderFromGenerator, isDomainMarketplace } from './classify.js';
import {
    visibleText, isMobileFriendly, seoFacts, lastCopyrightYear, wordpressVersion, isPlaceholderPage,
    brokenPageReason, pageUrls, bookingInfo, socialLinks, contactPageUrl,
} from './checks.js';
import { extractEmails, pickBusinessEmail, pagePhones, whatsappNumber } from './contacts.js';

const ERROR_TEXT = {
    ENOTFOUND: "domain doesn't resolve",
    EAI_AGAIN: "domain doesn't resolve",
    ECONNREFUSED: 'connection refused',
    ECONNRESET: 'connection dropped',
    UND_ERR_SOCKET: 'connection dropped',
    EHOSTUNREACH: 'server unreachable',
    ENETUNREACH: 'server unreachable',
    UND_ERR_CONNECT_TIMEOUT: 'server not responding (timed out)',
    UND_ERR_HEADERS_TIMEOUT: 'server not responding (timed out)',
    UND_ERR_BODY_TIMEOUT: "page didn't finish loading (timed out)",
    TIMEOUT: 'server not responding (timed out)',
    ERR_INVALID_URL: 'not a valid URL',
};

function describeFailure(page) {
    if (page.category === 'network_error') {
        if (isTlsError(page.errorCode)) return `SSL error (${page.errorCode})`;
        return ERROR_TEXT[page.errorCode] ?? `network error (${page.errorCode})`;
    }
    return `HTTP ${page.status}`;
}

/** Empty audit fields, for businesses whose site isn't fetched. */
function baseResult(websiteUrl, websiteStatus, extra = {}) {
    return {
        websiteUrl, websiteStatus, websiteError: null, finalUrl: null, fetched: false,
        https: null, httpRedirectsToHttps: null, sslError: null, mobileFriendly: null, responseMs: null,
        techStack: [], generator: null, wordpressVersion: null, deadBuilder: null, freeHost: null, placeholder: false,
        lastCopyrightYear: null, missingTitle: null, missingMetaDescription: null,
        hasBooking: null, bookingProvider: null, socialLinks: {}, socialPlatform: null,
        contacts: null,
        ...extra,
    };
}

const robotsCache = new Map();

/** robots.txt rules for a host, plus whether HTTPS worked while fetching it. Cached per host. */
function robotsFor(host) {
    if (!robotsCache.has(host)) {
        robotsCache.set(host, (async () => {
            const secure = await getPage(`https://${host}/robots.txt`, { timeoutMs: HTTP.robotsTimeoutMs, maxAttempts: 2, accept: 'text/plain,*/*;q=0.5' });
            const httpsWorks = secure.category !== 'network_error'; // any HTTP answer means TLS was fine
            const tlsError = secure.category === 'network_error' && isTlsError(secure.errorCode) ? secure.errorCode : null;
            const dnsFailed = /ENOTFOUND|EAI_AGAIN/.test(secure.errorCode ?? '');
            let file = secure;
            let unreachable = null;
            if (!httpsWorks && !dnsFailed) {
                file = await getPage(`http://${host}/robots.txt`, { timeoutMs: HTTP.robotsTimeoutMs, maxAttempts: 1, accept: 'text/plain,*/*;q=0.5' });
                // Neither port answers: no point asking for the homepage as well.
                if (file.category === 'network_error' && !tlsError) unreachable = file;
            }
            const rules = file.ok && !/<html/i.test(String(file.body ?? '').slice(0, 500)) ? parseRobots(file.body, HTTP.robotsAgent) : [];
            return { rules, httpsWorks, tlsError, dnsFailed, unreachable, blocked: secure.category === 'blocked' };
        })());
    }
    return robotsCache.get(host);
}

/**
 * @param {{ website: string|null, websiteInvalid: boolean, name: string|null, category: string|null }} business
 * @param {{ auditDepth: 'basic'|'full', extractContacts: boolean, country: string|null }} options
 */
export async function auditWebsite(business, { auditDepth, extractContacts, country }) {
    const url = business.website;
    if (!url) return baseResult(null, 'none');
    if (business.websiteInvalid) return baseResult(url, 'broken', { websiteError: 'not a valid URL' });

    // Decided from the URL alone, nothing to fetch.
    const profile = profilePlatform(url);
    if (profile) {
        return baseResult(url, 'social_only', {
            socialPlatform: profile.platform,
            socialLinks: { [profile.key]: url },
            hasBooking: profile.booking ? true : null,
            bookingProvider: profile.booking ?? null,
        });
    }
    const deadHost = deadBuilderFromHost(url);
    if (deadHost) return baseResult(url, 'dead_builder', { deadBuilder: deadHost });

    const target = new URL(url);
    const pathAndQuery = `${target.pathname}${target.search}`;
    const result = baseResult(url, 'ok', { fetched: true, freeHost: freeHostSuffix(url) });

    // 1. robots.txt, which also tells us whether HTTPS works.
    const robots = await robotsFor(target.host);
    if (robots.dnsFailed) return { ...result, websiteStatus: 'broken', websiteError: "domain doesn't resolve" };
    if (robots.unreachable) return { ...result, websiteStatus: 'broken', https: false, websiteError: describeFailure(robots.unreachable) };
    if (robots.blocked) return { ...result, websiteStatus: 'blocked', websiteError: 'site blocks automated checks (bot protection)' };
    if (!isAllowed(robots.rules, target.pathname)) return { ...result, websiteStatus: 'blocked', websiteError: 'robots.txt disallows automated checks' };
    result.https = robots.httpsWorks;
    result.sslError = robots.tlsError;

    // 2. The page over plain HTTP, to see whether it's sent on to HTTPS.
    let page = await getPage(`http://${target.host}${pathAndQuery}`);
    if (page.category === 'network_error' && robots.httpsWorks) {
        // Nothing listening on port 80: fine for visitors, browsers go straight to HTTPS.
        page = await getPage(`https://${target.host}${pathAndQuery}`);
    } else if (page.ok) {
        result.httpRedirectsToHttps = page.finalUrl?.startsWith('https:') ?? false;
    }

    if (!page.ok) {
        if (page.category === 'blocked') {
            const why = page.errorCode === 'BOT_PROTECTION' ? 'bot protection' : `HTTP ${page.status}`;
            return { ...result, websiteStatus: 'blocked', websiteError: `site blocks automated checks (${why})` };
        }
        return { ...result, websiteStatus: 'broken', websiteError: describeFailure(page), finalUrl: page.finalUrl ?? null };
    }

    result.finalUrl = page.finalUrl;
    result.responseMs = page.elapsedMs;
    if (page.finalUrl?.startsWith('https:')) result.https = true;

    // Redirected off the site: to a social profile, or to a domain marketplace.
    const redirectedProfile = profilePlatform(page.finalUrl);
    if (redirectedProfile) {
        return { ...result, websiteStatus: 'social_only', socialPlatform: redirectedProfile.platform, socialLinks: { [redirectedProfile.key]: page.finalUrl } };
    }
    if (isDomainMarketplace(page.finalUrl)) return { ...result, websiteStatus: 'broken', websiteError: 'domain parked or for sale' };

    const $ = cheerio.load(page.body);
    const text = visibleText($);
    const brokenReason = brokenPageReason($, page.body, text);
    if (brokenReason) return { ...result, websiteStatus: 'broken', websiteError: brokenReason.toLowerCase() };

    const tech = detectTechStack({ headers: page.headers, html: page.body, $ });
    result.techStack = Object.values(tech.detected).flat();
    result.generator = tech.generator;
    result.wordpressVersion = result.techStack.includes('WordPress') ? wordpressVersion(tech.generator, page.body) : null;
    result.deadBuilder = deadBuilderFromGenerator(tech.generator);
    result.freeHost = freeHostSuffix(page.finalUrl) ?? result.freeHost;
    result.mobileFriendly = isMobileFriendly($);
    Object.assign(result, seoFacts($));
    delete result.title;
    result.lastCopyrightYear = lastCopyrightYear($);
    result.placeholder = isPlaceholderPage($, text);

    let urls = pageUrls($, page.finalUrl);
    let booking = bookingInfo($, urls, page.finalUrl);
    let socials = socialLinks(urls);
    let contactText = text;
    const mailtos = $('a[href^="mailto:" i]').map((_, el) => $(el).attr('href')).get();
    const tels = $('a[href^="tel:" i]').map((_, el) => $(el).attr('href')).get();

    // 3. The contact page, when asked for and linked from the homepage.
    if (auditDepth === 'full') {
        const contactUrl = contactPageUrl($, page.finalUrl);
        if (contactUrl && isAllowed(robots.rules, new URL(contactUrl).pathname)) {
            const contactPage = await getPage(contactUrl);
            if (contactPage.ok) {
                const $c = cheerio.load(contactPage.body);
                const contactUrls = pageUrls($c, contactPage.finalUrl);
                urls = [...urls, ...contactUrls];
                if (!booking.hasBooking) booking = bookingInfo($c, contactUrls, contactPage.finalUrl);
                socials = { ...socialLinks(contactUrls), ...socials };
                contactText = `${text} ${visibleText($c)}`;
                mailtos.push(...$c('a[href^="mailto:" i]').map((_, el) => $c(el).attr('href')).get());
                tels.push(...$c('a[href^="tel:" i]').map((_, el) => $c(el).attr('href')).get());
            }
        }
    }

    result.hasBooking = booking.hasBooking;
    result.bookingProvider = booking.bookingProvider;
    result.socialLinks = socials;
    if (result.deadBuilder) result.websiteStatus = 'dead_builder';
    else if (result.freeHost) result.websiteStatus = 'free_subdomain';

    if (extractContacts) {
        result.contacts = {
            email: pickBusinessEmail(extractEmails(contactText, mailtos), { name: business.name, siteUrl: page.finalUrl }),
            phone: pagePhones(tels, contactText, country)[0] ?? null,
            whatsapp: whatsappNumber(urls),
        };
    }
    return result;
}
