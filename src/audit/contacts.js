// Business contact details a site publishes: a business email, phone number and WhatsApp link.
// Nothing is guessed: every value was written on the page (as text, a mailto:/tel: link or a
// WhatsApp link). Addresses that look like a named person's own mailbox are left out on purpose.
import { getDomain } from 'tldts';
import { toE164, phonesInText } from '../phone.js';

// ---------- emails (extraction rules shared with tech-stack-lead-finder) ----------

const AT = String.raw`\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|<\s*at\s*>|\s+at\s+|@)\s*`;
const DOT = String.raw`\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|<\s*dot\s*>|\s+dot\s+|\.)\s*`;
const EMAIL_RE = new RegExp(String.raw`(?<![a-z0-9._%+-])([a-z0-9][a-z0-9._%+-]{0,63})${AT}([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:${DOT}[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)${DOT}([a-z]{2,24})(?![a-z0-9])`, 'gi');
const STRICT_EMAIL_RE = /(?<![a-z0-9._%+-])([a-z0-9][a-z0-9._%+-]{0,63})@((?:[a-z0-9-]+\.)+[a-z]{2,24})(?![a-z0-9])/gi;
const VALID_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|css|js)$/i;
const NOT_CONTACT_RE = /^(?:name|your|you|email|user|someone|example|test|john\.?doe|jane\.?doe|firstname|first\.last)@|@(?:example|domain|company|email|yourdomain|yourcompany|sentry|sentry-next|wixpress|mysite)\.(?:com|org|net|io)$|@(?:\d+x|2x|3x)\./i;
const PROSE_WORDS = new Set(['me', 'us', 'look', 'email', 'mail', 'contact', 'reach', 'available', 'based', 'work', 'join', 'here', 'out', 'more', 'found', 'located', 'office', 'visit', 'shop', 'find', 'sold', 'buy', 'order', 'orders']);

/** Emails from mailto: links and visible text, including "info [at] salon [dot] com" forms. */
export function extractEmails(text, mailtoHrefs = []) {
    const out = [];
    const add = (raw) => {
        const e = String(raw).trim().toLowerCase().replace(/^mailto:/, '').split('?')[0].replace(/\.+$/, '');
        if (VALID_EMAIL_RE.test(e) && !IMAGE_EXT_RE.test(e) && !NOT_CONTACT_RE.test(e) && !out.includes(e)) out.push(e);
    };
    for (const href of mailtoHrefs) {
        try {
            add(decodeURIComponent(href.replace(/^mailto:/i, '')));
        } catch {
            add(href.replace(/^mailto:/i, ''));
        }
    }
    // Plain addresses: no spaces allowed, so "pixels@agency.example. Dr. Jane" stops at ".example".
    for (const m of String(text ?? '').matchAll(STRICT_EMAIL_RE)) {
        const [, local, domain] = m;
        const labels = domain.split('.');
        // "hello@brooklinen.com.The team": a capitalised word glued on after the real TLD.
        if (labels.length > 2 && /^[A-Z]/.test(labels.at(-1)) && labels.slice(0, -1).every((l) => l === l.toLowerCase())) labels.pop();
        add(`${local}@${labels.join('.')}`);
    }
    // Spelled-out addresses: "info [at] salon [dot] com", "sales at salon dot com", "info @ salon.com".
    for (const m of String(text ?? '').matchAll(EMAIL_RE)) {
        const [whole, local, domain, tld] = m;
        if (whole.includes('@')) {
            // Plain addresses were taken by the strict pass. Left: a spaced "info @ salon.com", kept
            // only when its dots are tight, so no following sentence gets glued on.
            if (!/\s@|@\s/.test(whole) || /\s\.|\.\s/.test(whole)) continue;
        } else {
            const bracketed = /[[({<]\s*at\s*[\])}>]/i.test(whole);
            if (!bracketed && !/\bdot\b|[[({<]\s*dot/i.test(whole)) continue;
            if (PROSE_WORDS.has(local.toLowerCase())) continue;
        }
        let labels = domain.split(new RegExp(DOT, 'i'));
        let top = tld;
        if (/^[A-Z][a-z]/.test(tld) && labels.length > 1 && /^[a-z]{2,24}$/.test(labels.at(-1)) && domain === domain.toLowerCase()) {
            top = labels.at(-1);
            labels = labels.slice(0, -1);
        }
        add(`${local}@${labels.join('.')}.${top}`);
    }
    return out;
}

// ---------- business-only filter ----------

// Generic mailboxes, in the languages local businesses commonly use.
const ROLE_LOCAL_RE = /^(info|information|hello|hi|hey|contact|contacts|contacto|contato|contatto|kontakt|bonjour|hola|ciao|hallo|office|oficina|ufficio|buero|admin|administration|reception|recepcion|recepción|frontdesk|front\.desk|bookings?|booking|reservations?|reservas|reservaciones|prenotazioni|appointments?|citas|termin|enquiries|enquiry|inquiries|inquiry|sales|ventas|vendas|support|help|team|mail|email|studio|salon|clinic|clinica|practice|praxis|care|service|servicio|services|customerservice|orders|shop|store|general|accounts|billing|hr|jobs|careers|marketing|press|media)([._-]?[a-z0-9]{0,20})?$/;
const FREE_MAIL_RE = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|me|mac|aol|gmx|web|mail|yandex|proton|protonmail|zoho|orange|libero|free|laposte|qq|163|126|btinternet|sky|virginmedia|talktalk|comcast|att|verizon|safaricom)\.[a-z.]+$/;
const NAME_STOP_WORDS = new Set(['the', 'and', 'limited', 'ltd', 'llc', 'inc', 'company', 'services', 'service', 'group', 'shop', 'store', 'centre', 'center', 'studio', 'house', 'home', 'best', 'your']);

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function nameTokens(name, siteDomain) {
    const words = fold(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !NAME_STOP_WORDS.has(w));
    const compact = fold(name).replace(/[^a-z0-9]/g, '');
    const label = siteDomain ? fold(siteDomain.split('.')[0]) : '';
    return [...new Set([...words, compact.length >= 6 ? compact : null, label.length >= 4 ? label : null].filter(Boolean))];
}

/**
 * The best business email: a generic mailbox or one that carries the business's name, on the
 * site's own domain or a free mail provider. Person-looking addresses (jane.smith@...) and
 * third parties' addresses (the web designer's) are skipped.
 */
export function pickBusinessEmail(emails, { name, siteUrl }) {
    const siteDomain = siteUrl ? getDomain(new URL(siteUrl).hostname) : null;
    const tokens = nameTokens(name, siteDomain);
    const ranked = [];
    for (const email of emails) {
        const [local, domain] = email.split('@');
        const onSite = siteDomain && getDomain(domain) === siteDomain;
        const freeMail = FREE_MAIL_RE.test(domain);
        const role = ROLE_LOCAL_RE.test(local);
        const localLetters = fold(local).replace(/[^a-z0-9]/g, '');
        const carriesName = tokens.some((t) => localLetters.includes(t));
        if (onSite && role) ranked.push([0, email]);
        else if (onSite && carriesName) ranked.push([1, email]);
        else if (freeMail && carriesName) ranked.push([2, email]);
        else if (freeMail && role) ranked.push([3, email]);
        else if (carriesName) ranked.push([4, email]); // e.g. joesplumbing@btconnect.com
    }
    ranked.sort((a, b) => a[0] - b[0]);
    return ranked[0]?.[1] ?? null;
}

// ---------- phones and WhatsApp ----------

/** Phone numbers from tel: links and the page text, in E.164. */
export function pagePhones(telHrefs, text, country) {
    const out = [];
    const add = (n) => {
        if (n && !out.includes(n)) out.push(n);
    };
    for (const href of telHrefs) {
        let raw = href.replace(/^tel:/i, '');
        try {
            raw = decodeURIComponent(raw);
        } catch { /* keep raw */ }
        add(toE164(raw, country));
    }
    for (const n of phonesInText(text, country)) add(n);
    return out;
}

/** A WhatsApp chat link (wa.me/254..., api.whatsapp.com/send?phone=...) -> E.164 number. */
export function whatsappNumber(urls) {
    for (const url of urls) {
        const m = url.match(/^https?:\/\/(?:www\.)?wa\.me\/\+?(\d{7,15})/i)
            ?? url.match(/^(?:https?:\/\/(?:api|web)\.whatsapp\.com\/send\/?|whatsapp:\/\/send)\?(?:.*&)?phone=\+?(\d{7,15})/i);
        if (m) {
            const number = toE164(`+${m[1]}`);
            if (number) return number;
        }
    }
    return null;
}
