// Checks on one fetched page. Pure functions of the HTML (a cheerio `$`), so they're easy to test.

/** Visible text: scripts, styles and templates removed, whitespace collapsed. */
export function visibleText($) {
    const $$ = $.root().clone();
    $$.find('script, style, noscript, template, svg').remove();
    return $$.find('body').find('*').addBack().contents()
        .filter((_, n) => n.type === 'text').map((_, n) => $(n).text()).get()
        .join(' ').replace(/\s+/g, ' ').trim();
}

/** A viewport meta tag that adapts to the screen (width=device-width) is the mobile-friendly signal. */
export function isMobileFriendly($) {
    const content = ($('meta[name="viewport" i]').attr('content') ?? '').toLowerCase();
    return /width\s*=\s*device-width/.test(content) || /initial-scale\s*=\s*1/.test(content);
}

export function seoFacts($) {
    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    const description = ($('meta[name="description" i]').attr('content') ?? '').trim();
    return { missingTitle: !title, missingMetaDescription: !description, title: title || null };
}

// "© 2019 Name", "Copyright 2015-2021", "(c) 2018", "2017 © Name", "© Joe's Plumbing 2016".
// Works across languages because it keys on the symbol/word plus a year, not on phrasing.
const YEAR = '((?:19|20)\\d{2})';
const COPYRIGHT_RES = [
    new RegExp(`(?:©|&copy;|\\(c\\)|copyright|copr\\.)[^\\d]{0,40}?${YEAR}(?:\\s*[-–/]\\s*${YEAR})?`, 'gi'),
    new RegExp(`${YEAR}(?:\\s*[-–/]\\s*${YEAR})?\\s*(?:©|&copy;|\\(c\\))`, 'gi'),
];

/**
 * Latest copyright year in the footer (falls back to the end of the page), or null when the
 * page has none, for example when the year is written by JavaScript at load time.
 */
export function lastCopyrightYear($, now = new Date()) {
    const footer = $('footer, [class*="footer"], [id*="footer"], [class*="copyright"], [id*="copyright"]')
        .map((_, el) => $(el).text()).get().join(' ');
    const text = (footer.trim() ? footer : visibleText($).slice(-3000)).replace(/\s+/g, ' ');
    const current = now.getUTCFullYear();
    let best = null;
    for (const re of COPYRIGHT_RES) {
        for (const m of text.matchAll(re)) {
            for (const y of [m[1], m[2]].filter(Boolean).map(Number)) {
                if (y >= 1995 && y <= current && (best === null || y > best)) best = y;
            }
        }
    }
    return best;
}

// Core files whose ?ver= is the WordPress version itself. Bundled libraries (jquery.min.js?ver=3.7.1)
// carry their own version, so they're not used.
const WP_CORE_ASSET_RE = /\/wp-includes\/(?:js\/wp-emoji-release\.min\.js|js\/wp-embed\.min\.js|js\/comment-reply\.min\.js|css\/dist\/block-library\/style\.min\.css)\?ver=(\d+\.\d+(?:\.\d+)?)/i;

/** WordPress version from the generator tag, or from a core asset URL. */
export function wordpressVersion(generator, html) {
    const fromGenerator = String(generator ?? '').match(/wordpress\s+(\d+\.\d+(?:\.\d+)?)/i)?.[1];
    if (fromGenerator) return fromGenerator;
    return String(html ?? '').match(WP_CORE_ASSET_RE)?.[1] ?? null;
}

const PLACEHOLDER_RE = /coming soon|under construction|under maintenance|launching soon|en construcción|en construction|próximamente|em construção|em breve|im aufbau|in costruzione|bald verfügbar|wartungsmodus|in arrivo|we'?ll be back soon|website is being built|site en maintenance/i;

/** A "coming soon" / "under construction" page instead of a real site. */
export function isPlaceholderPage($, text) {
    const heading = `${$('title').first().text()} ${$('h1').first().text()}`;
    return PLACEHOLDER_RE.test(heading) && text.length < 1500;
}

const PARKED_RE = /(this domain (name )?(is|may be) for sale|buy this domain|domain (is )?(parked|for sale)|is parked free|this web ?page is parked|sedoparking\.com|parkingcrew\.net|bodis\.com|hugedomains\.com|afternic\.com|dan\.com\/buy|undeveloped\.com|domain has expired|this domain has expired|the domain .{0,40} has expired)/i;
const PARKED_LANDER_RE = /(window\.)?location(\.href)?\s*=\s*["']\/lander\b/i;
const SUSPENDED_RE = /(account (has been )?suspended|this account has been suspended|website (is )?suspended|bandwidth limit exceeded|site (is )?(temporarily )?unavailable due to)/i;
const DEFAULT_PAGE_RE = /^(apache2? .*default page|welcome to nginx!?|it works!?|index of \/|default web site page|test page for the (apache|nginx)|iis windows server|welcome to centos|site not found|web server'?s default page)|future home of something quite cool/i;

/** A page that loads but isn't the business's site: parked, suspended or a server default page. */
export function brokenPageReason($, html, text) {
    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    const head = `${title} ${String(html ?? '').slice(0, 30_000)}`;
    if (text.length < 4000 && PARKED_RE.test(head)) return 'Domain parked or for sale';
    // Registrar parking pages that are only a script sending the visitor to "/lander".
    if (String(html ?? '').length < 3000 && PARKED_LANDER_RE.test(html)) return 'Domain parked or for sale';
    if (text.length < 4000 && SUSPENDED_RE.test(`${title} ${text}`)) return 'Hosting account suspended';
    if (DEFAULT_PAGE_RE.test(title) || (text.length < 600 && DEFAULT_PAGE_RE.test(text))) return 'Server default page, no site installed';
    return null;
}

// ---------- links ----------

/** Absolute URLs of links, scripts, iframes and forms on the page, plus URLs written in inline code. */
export function pageUrls($, base) {
    const out = new Set();
    const add = (raw) => {
        if (!raw || /^(mailto|tel|javascript|data):/i.test(raw)) return;
        try {
            out.add(new URL(raw, base).href);
        } catch { /* not a URL */ }
    };
    $('a[href], link[href]').each((_, el) => add($(el).attr('href')));
    $('script[src], iframe[src], img[src]').each((_, el) => add($(el).attr('src')));
    $('form[action]').each((_, el) => add($(el).attr('action')));
    $('script:not([src])').each((_, el) => {
        for (const m of ($(el).html() ?? '').matchAll(/https?:\/\/[^\s"'<>)\\]+/g)) add(m[0]);
    });
    return [...out];
}

const BOOKING_PROVIDERS = [
    { name: 'Fresha', host: /(^|\.)(fresha\.com|shedul\.com)$/ },
    { name: 'Booksy', host: /(^|\.)booksy\.com$/ },
    { name: 'Calendly', host: /(^|\.)calendly\.com$/ },
    { name: 'Square Appointments', host: /(^|\.)(squareup\.com|square\.site)$/, path: /appointment|\/book/i },
    { name: 'Vagaro', host: /(^|\.)vagaro\.com$/ },
    { name: 'SimplyBook.me', host: /(^|\.)simplybook\.(me|it|asia|net|cc)$/ },
    { name: 'Setmore', host: /(^|\.)setmore\.com$/ },
    { name: 'Acuity Scheduling', host: /(^|\.)(acuityscheduling\.com|as\.me)$/ },
    { name: 'Mindbody', host: /(^|\.)(mindbodyonline\.com|mindbody\.io)$/ },
    { name: 'Timely', host: /(^|\.)gettimely\.com$/ },
    { name: 'Treatwell', host: /(^|\.)treatwell\.[a-z.]+$/ },
    { name: 'Phorest', host: /(^|\.)phorest\.(com|me)$/ },
    { name: 'Zenoti', host: /(^|\.)zenoti\.com$/ },
    { name: 'GlossGenius', host: /(^|\.)glossgenius\.com$/ },
    { name: 'StyleSeat', host: /(^|\.)styleseat\.com$/ },
    { name: 'Schedulicity', host: /(^|\.)schedulicity\.com$/ },
    { name: 'Appointy', host: /(^|\.)appointy\.com$/ },
    { name: 'Salonized', host: /(^|\.)salonized\.com$/ },
    { name: 'Planity', host: /(^|\.)planity\.com$/ },
    { name: 'Booker', host: /(^|\.)booker\.com$/ },
    { name: 'Zocdoc', host: /(^|\.)zocdoc\.com$/ },
    { name: 'NexHealth', host: /(^|\.)nexhealth\.com$/ },
    { name: 'LocalMed', host: /(^|\.)localmed\.com$/ },
    { name: 'Doctolib', host: /(^|\.)doctolib\.[a-z.]+$/ },
    { name: 'Jane App', host: /(^|\.)janeapp\.com$/ },
    { name: 'Cliniko', host: /(^|\.)cliniko\.com$/ },
    { name: 'OpenTable', host: /(^|\.)opentable\.[a-z.]+$/ },
    { name: 'Resy', host: /(^|\.)resy\.com$/ },
    { name: 'SevenRooms', host: /(^|\.)sevenrooms\.com$/ },
    { name: 'TheFork', host: /(^|\.)(thefork\.[a-z.]+|lafourchette\.com)$/ },
    { name: 'Quandoo', host: /(^|\.)quandoo\.[a-z.]+$/ },
    { name: 'Bookeo', host: /(^|\.)bookeo\.com$/ },
    { name: 'YouCanBookMe', host: /(^|\.)youcanbook\.me$/ },
    { name: 'TidyCal', host: /(^|\.)tidycal\.com$/ },
    { name: 'Cal.com', host: /(^|\.)cal\.com$/ },
    { name: 'SuperSaaS', host: /(^|\.)supersaas\.[a-z.]+$/ },
    { name: 'Picktime', host: /(^|\.)picktime\.com$/ },
    { name: 'Setster', host: /(^|\.)setster\.com$/ },
    { name: 'HubSpot Meetings', host: /^meetings(-[a-z0-9]+)?\.hubspot\.com$/ },
    { name: 'Microsoft Bookings', host: /^(outlook\.office365\.com|outlook\.office\.com|bookings\.cloud\.microsoft)$/, path: /bookings|\/owa\/calendar\//i },
    { name: 'Google Calendar booking', host: /^(calendar\.app\.google|calendar\.google\.com)$/, path: /appointments|^\/[A-Za-z0-9]+$/ },
    { name: 'Belbo', host: /(^|\.)belbo\.com$/ },
    { name: 'Shore', host: /(^|\.)shore\.com$/, path: /book|termin|appointment/i },
    { name: 'Salonkee', host: /(^|\.)salonkee\.[a-z.]+$/ },
    { name: 'Studiobookr', host: /(^|\.)studiobookr\.com$/ },
    { name: 'TIMIFY', host: /(^|\.)timify\.com$/ },
    { name: 'Opencare', host: /(^|\.)opencare\.com$/ },
    { name: 'CareStack', host: /(^|\.)carestack\.com$/ },
    { name: 'Weave', host: /^book\.getweave\.com$/, path: /schedul|appointment|request/i },
];

// Words in a short link/button label that mean online booking, in the languages local businesses
// commonly use ("Book now", "Wunschtermin online buchen", "Reservar cita", "Prendre rendez-vous").
const BOOK_WORD_RE = /(?<!\p{L})(book|booking|bookings|reserve|reservation|reservations|reservar|reserva|réserver|réservation|schedule|appointment|appointments|termin\p{L}*|\p{L}+termin|buchen|cita|citas|rendez-vous|prenota\p{L}*|agendar|agende|miadi)(?!\p{L})/iu;
// A path segment on the site's own domain that is a booking page (/book-online, /schedule-online, /cita-previa...).
const BOOK_SEGMENT_RE = /(^|-)(book|booking|bookings|schedul\w*|appointments?|reserv\w*|citas?|termin\w*|rendez-vous|prenot\w*)(-|$)/i;

/** Online booking: a known provider's link/widget, or a "Book now" style link on the site. */
export function bookingInfo($, urls, base) {
    for (const url of urls) {
        let u;
        try {
            u = new URL(url);
        } catch {
            continue;
        }
        const hit = BOOKING_PROVIDERS.find((p) => p.host.test(u.hostname.toLowerCase()) && (!p.path || p.path.test(u.pathname + u.search)));
        if (hit) return { hasBooking: true, bookingProvider: hit.name };
    }
    const baseHost = new URL(base).hostname.replace(/^www\./, '');
    let generic = false;
    $('a[href], button').each((_, el) => {
        if (generic) return;
        const label = $(el).text().replace(/\s+/g, ' ').trim();
        if (label.length > 0 && label.length <= 50 && BOOK_WORD_RE.test(label)) {
            generic = true;
            return;
        }
        const href = $(el).attr('href');
        if (!href) return;
        try {
            const u = new URL(href, base);
            const segments = u.pathname.toLowerCase().split('/').filter(Boolean);
            if (u.hostname.replace(/^www\./, '') === baseHost && segments.some((seg) => BOOK_SEGMENT_RE.test(seg))) generic = true;
        } catch { /* not a URL */ }
    });
    return generic ? { hasBooking: true, bookingProvider: null } : { hasBooking: false, bookingProvider: null };
}

const SOCIALS = {
    facebook: /^https?:\/\/([a-z]{2,3}\.|www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|tr\?|login|profile\.php\?id=0)[^?#]+/i,
    instagram: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/)[A-Za-z0-9_.]+\/?(?:[?#].*)?$/i,
    tiktok: /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+/i,
    x: /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share|home|search|hashtag|i\/)[A-Za-z0-9_]{1,15}\/?(?:[?#].*)?$/i,
    linkedin: /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|school)\/[^/?#]+/i,
    youtube: /^https?:\/\/(www\.)?youtube\.com\/(@[\w.-]+|c\/[\w.-]+|channel\/[\w-]+|user\/[\w.-]+)/i,
    pinterest: /^https?:\/\/([a-z]{2,3}\.|www\.)?pinterest\.[a-z.]+\/(?!pin\/)[\w-]+\/?$/i,
};

/** First profile link per network. Share buttons, posts and intent links are ignored. */
export function socialLinks(urls) {
    const out = {};
    for (const url of urls) {
        for (const [network, re] of Object.entries(SOCIALS)) {
            if (!out[network] && re.test(url)) out[network] = url.replace(/[?#].*$/, '').replace(/\/$/, '');
        }
    }
    return out;
}

const CONTACT_LABEL_RE = /^(contact( us)?|contacts|get in touch|reach us|find us|kontakt(ieren)?|contacto|contáctanos|contactenos|contato|fale conosco|contatti|contattaci|nous contacter|contactez[- ]nous|iletişim|wasiliana nasi|kontak( kami)?)$/i;
const CONTACT_PATH_RE = /\/(contact(o|s|ez|-us|us|anos|-nous)?|kontakt|contatti|contato|iletisim|wasiliana[-\w]*)\/?$/i;

/** The site's own contact page, if the homepage links to one. */
export function contactPageUrl($, base) {
    const baseHost = new URL(base).hostname.replace(/^www\./, '');
    let hit = null;
    $('a[href]').each((_, el) => {
        if (hit) return;
        const label = $(el).text().replace(/\s+/g, ' ').trim();
        let u;
        try {
            u = new URL($(el).attr('href'), base);
        } catch {
            return;
        }
        if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== baseHost || u.pathname === '/') return;
        if (CONTACT_PATH_RE.test(u.pathname) || (label.length <= 30 && CONTACT_LABEL_RE.test(label))) {
            u.hash = '';
            hit = u.href;
        }
    });
    return hit;
}

// Businesses that run on appointments, so "no online booking" is a real gap. Matched on the
// category and the business name, in several languages. Stems match at the start of a word
// ("coiff" -> coiffeur, coiffure); short words must match whole ("spa", not "Spanish").
const APPOINTMENT_STEMS = [
    'salon', 'salón', 'salão', 'barber', 'barbier', 'barbería', 'barbearia', 'hair', 'coiff', 'friseur', 'peluquer',
    'parrucch', 'cabeleir', 'nail', 'uñas', 'unhas', 'beauty', 'belleza', 'beauté', 'estétic', 'esthéti', 'kosmetik',
    'massage', 'masaje', 'massagem', 'tattoo', 'tatuaje', 'piercing', 'dentist', 'dental', 'dentaire', 'zahnarzt',
    'odontolog', 'orthodont', 'clinic', 'clínica', 'clinique', 'klinik', 'praxis', 'doctor', 'médico', 'médecin', 'arzt',
    'physio', 'fisioterap', 'kiné', 'chiropract', 'osteopat', 'veterinar', 'vétérinaire', 'tierarzt', 'optician',
    'optometr', 'óptica', 'optique', 'therap', 'terapia', 'psycholog', 'counsel', 'fitness', 'yoga', 'pilates',
    'driving school', 'autoescuela', 'fahrschule', 'photograph', 'fotógraf', 'makeup', 'maquillaje', 'eyebrow',
];
const APPOINTMENT_WHOLE_WORDS = ['spa', 'spas', 'gym', 'gyms', 'wax', 'waxing', 'lash', 'lashes', 'brow', 'brows'];
const APPOINTMENT_RE = new RegExp(
    `(?<!\\p{L})(${APPOINTMENT_STEMS.join('|')}|(${APPOINTMENT_WHOLE_WORDS.join('|')})(?!\\p{L}))`,
    'iu',
);

export const isAppointmentBusiness = (category, name) => APPOINTMENT_RE.test(`${category ?? ''} ${name ?? ''}`);
