// Phone numbers in international E.164 form (+254712345678) and country resolution.
// Uses libphonenumber-js with the full metadata, so validity is checked per country numbering plan.
import { parsePhoneNumberFromString, findPhoneNumbersInText, getCountries } from 'libphonenumber-js/max';
import { getPublicSuffix } from 'tldts';

const COUNTRY_CODES = new Set(getCountries());

const ALIASES = {
    UK: 'GB',
    ENGLAND: 'GB',
    SCOTLAND: 'GB',
    WALES: 'GB',
    'NORTHERN IRELAND': 'GB',
    'GREAT BRITAIN': 'GB',
    USA: 'US',
    'U.S.': 'US',
    'U.S.A.': 'US',
    'UNITED STATES OF AMERICA': 'US',
    UAE: 'AE',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const BY_NAME = new Map([...COUNTRY_CODES].map((code) => [regionNames.of(code)?.toUpperCase(), code]));

/** "KE", "ke", "Kenya", "United Kingdom", "UK" -> ISO 3166 alpha-2 code, or null. */
export function resolveCountry(value) {
    if (!value) return null;
    const v = String(value).trim().toUpperCase();
    if (v.length === 2 && COUNTRY_CODES.has(v)) return v;
    return ALIASES[v] ?? BY_NAME.get(v) ?? null;
}

// Country-code TLDs that are mostly used as generic ones (.co, .io, .ai, .tv, .me...).
const GENERIC_CCTLDS = new Set(['co', 'io', 'ai', 'tv', 'me', 'fm', 'am', 'ly', 'to', 'cc', 'ws', 'gg', 'la', 'nu', 'sh', 'ac', 'vc', 'gl', 'im', 'ms', 'sx', 'tk', 'ml', 'ga', 'cf', 'gq', 'cx', 'so', 'bz', 'st']);

/** Country from a national domain ending: salon.co.ke -> KE, plumber.co.uk -> GB. Null for .com, .io... */
export function countryFromHostname(hostname) {
    const suffix = hostname ? getPublicSuffix(hostname) : null;
    if (!suffix) return null;
    const tld = suffix.split('.').pop();
    if (tld === 'uk') return 'GB';
    if (tld.length !== 2 || GENERIC_CCTLDS.has(tld)) return null;
    const code = tld.toUpperCase();
    return COUNTRY_CODES.has(code) ? code : null;
}

/** E.164 form of a phone number, or null when it isn't a valid number for the country. */
export function toE164(raw, country) {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    try {
        const parsed = parsePhoneNumberFromString(text, country ?? undefined);
        return parsed?.isValid() ? parsed.number : null;
    } catch {
        return null;
    }
}

/** Valid phone numbers written in a block of text. Without a country, only +international ones. */
export function phonesInText(text, country) {
    try {
        return findPhoneNumbersInText(String(text ?? ''), country ?? undefined)
            .map(({ number }) => number)
            .filter((n) => n.isValid())
            .map((n) => n.number);
    } catch {
        return [];
    }
}
