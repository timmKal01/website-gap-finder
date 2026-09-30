// Plain HTTP for business websites, built on the same pattern as vehicle-recall-tracker:
// a timeout per request, retries with exponential backoff for failures that can recover, and
// results returned as data (never thrown) so one bad site can't stop the run.
//
// Politeness: an honest bot user agent, requests to the same host started at least
// HTTP.hostGapMs apart, and bot walls (Cloudflare challenge, Vercel checkpoint, DataDome...)
// reported as "blocked", never retried or worked around.
import { log } from 'apify';
import { Agent, fetch as undiciFetch } from 'undici';
import { HTTP } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A certificate chain missing its intermediate: browsers fetch the missing certificate and show
// the site, Node refuses. `lenientTls` reads such a page anyway (public HTML only, nothing sent);
// the audit still reports the certificate problem.
const lenientTlsAgent = new Agent({ connect: { rejectUnauthorized: false } });
export const isIncompleteChain = (code) => /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY/.test(String(code ?? ''));
const hostTurns = new Map();

function waitForHost(host) {
    const previous = hostTurns.get(host) ?? Promise.resolve();
    hostTurns.set(host, previous.then(() => sleep(HTTP.hostGapMs)));
    return previous;
}

const CHALLENGE_RE = /<title>\s*(just a moment\.\.\.|attention required! \| cloudflare|vercel security checkpoint|access denied|pardon our interruption|are you a robot|security check|ddos-guard)|captcha-delivery\.com|px-captcha|_incapsula_resource|cf-browser-verification|sgcaptcha/i;

function isChallenge(status, headers, body) {
    if (/challenge/i.test(headers['cf-mitigated'] ?? '')) return true;
    if (headers['x-vercel-mitigated'] === 'challenge') return true;
    return status !== 404 && CHALLENGE_RE.test(String(body ?? '').slice(0, 20_000));
}

function categorize(status) {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 401 || status === 403) return 'blocked';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server_error';
    return 'client_error';
}

/** Network error -> short code: ENOTFOUND, ECONNREFUSED, CERT_HAS_EXPIRED, TIMEOUT... */
function errorCode(err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'TIMEOUT';
    return err.cause?.code ?? err.code ?? err.cause?.name ?? err.message ?? 'NETWORK_ERROR';
}

export const isTlsError = (code) => /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|EPROTO/i.test(String(code ?? ''));
const isFinal = (code) => /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ERR_INVALID_URL/i.test(code) || isTlsError(code);

/**
 * GET a page. Never throws.
 * @returns {Promise<{ok: boolean, category: string, status: number, url: string, finalUrl?: string,
 *   headers?: Record<string,string>, body?: string, elapsedMs?: number, errorCode?: string}>}
 */
export async function getPage(url, { timeoutMs = HTTP.timeoutMs, maxAttempts = HTTP.maxAttempts, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', lenientTls = false } = {}) {
    let host;
    try {
        host = new URL(url).host;
    } catch {
        return { ok: false, category: 'network_error', status: 0, url, errorCode: 'ERR_INVALID_URL' };
    }
    let last = { ok: false, category: 'network_error', status: 0, url, errorCode: 'NETWORK_ERROR' };
    let timeouts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await waitForHost(host);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = Date.now();
        try {
            const init = {
                headers: { 'User-Agent': HTTP.userAgent, Accept: accept, 'Accept-Language': 'en;q=0.8, *;q=0.5' },
                redirect: 'follow',
                signal: controller.signal,
            };
            const res = lenientTls ? await undiciFetch(url, { ...init, dispatcher: lenientTlsAgent }) : await fetch(url, init);
            const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
            const type = headers['content-type'] ?? '';
            const readable = !type || /html|text|xml|json/i.test(type);
            const body = readable ? (await res.text()).slice(0, HTTP.maxBytes) : (await res.body?.cancel().catch(() => {}), '');
            const base = { status: res.status, url, finalUrl: res.url, headers, elapsedMs: Date.now() - started };

            if (isChallenge(res.status, headers, body)) return { ...base, ok: false, category: 'blocked', errorCode: 'BOT_PROTECTION' };
            const category = categorize(res.status);
            if (category === 'ok') return { ...base, ok: true, category, body };

            last = { ...base, ok: false, category, body };
            if (category !== 'rate_limited' && category !== 'server_error') return last;
            if (attempt < maxAttempts) {
                const retryAfter = Number(headers['retry-after']);
                const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : HTTP.baseDelayMs * 2 ** (attempt - 1);
                log.debug(`Retrying ${url} in ${delay}ms (HTTP ${res.status}, attempt ${attempt}/${maxAttempts})`);
                await sleep(delay);
            }
        } catch (err) {
            const code = errorCode(err);
            last = { ok: false, category: 'network_error', status: 0, url, errorCode: code };
            // DNS failures, refused connections and certificate errors won't fix themselves in seconds;
            // a site that timed out once gets a single retry, not three slow ones.
            if (isFinal(code)) return last;
            if (/TIMEOUT/.test(code) && ++timeouts > 1) return last; // TIMEOUT, UND_ERR_CONNECT_TIMEOUT...
            if (attempt < maxAttempts) {
                const delay = HTTP.baseDelayMs * 2 ** (attempt - 1);
                log.debug(`Retrying ${url} in ${delay}ms (${code}, attempt ${attempt}/${maxAttempts})`);
                await sleep(delay);
            }
        } finally {
            clearTimeout(timer);
        }
    }
    return last;
}
