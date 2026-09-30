import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBusinessRecord, normalizeWebsite } from '../src/sources/records.js';
import { resolveCountry, countryFromHostname, toE164 } from '../src/phone.js';
import { profilePlatform, freeHostSuffix, deadBuilderFromHost, deadBuilderFromGenerator } from '../src/audit/classify.js';
import { extractEmails, pickBusinessEmail, whatsappNumber } from '../src/audit/contacts.js';
import { parseRobots, isAllowed } from '../src/robots.js';

test('Google Maps scraper item: url is the Maps link, website is the site', () => {
    const r = toBusinessRecord({
        title: 'Glow Salon', categoryName: 'Beauty salon', address: 'Moi Ave, Nairobi', city: 'Nairobi', countryCode: 'KE',
        phone: '0712 345678', website: 'https://glowsalon.co.ke/?utm_source=gmb&x=1', url: 'https://www.google.com/maps/place/Glow+Salon',
        totalScore: 4.6, reviewsCount: 132, placeId: 'ChIJ123',
    });
    assert.equal(r.name, 'Glow Salon');
    assert.equal(r.website, 'https://glowsalon.co.ke/?x=1');
    assert.equal(r.mapsUrl, 'https://www.google.com/maps/place/Glow+Salon');
    assert.equal(r.rating, 4.6);
    assert.equal(r.reviewCount, 132);
    assert.equal(r.countryRaw, 'KE');
});

test('manual record: bare domain, url used as website when it is not a Maps link', () => {
    assert.equal(toBusinessRecord({ name: 'A', url: 'joesplumbing.co.uk' }).website, 'https://joesplumbing.co.uk/');
    assert.deepEqual(normalizeWebsite('N/A'), { url: null, invalid: false });
    assert.equal(normalizeWebsite('not a url at all').invalid, true);
});

test('countries by code, name and alias; country from national domains', () => {
    assert.equal(resolveCountry('ke'), 'KE');
    assert.equal(resolveCountry('Kenya'), 'KE');
    assert.equal(resolveCountry('United Kingdom'), 'GB');
    assert.equal(resolveCountry('UK'), 'GB');
    assert.equal(resolveCountry('USA'), 'US');
    assert.equal(resolveCountry('Atlantis'), null);
    assert.equal(countryFromHostname('salon.co.ke'), 'KE');
    assert.equal(countryFromHostname('plumber.co.uk'), 'GB');
    assert.equal(countryFromHostname('parrucchiere.it'), 'IT');
    assert.equal(countryFromHostname('startup.io'), null);
    assert.equal(countryFromHostname('dentist.com'), null);
});

test('phone numbers to E.164 when the country is known', () => {
    assert.equal(toE164('0712 345678', 'KE'), '+254712345678');
    assert.equal(toE164('0161 496 0000', 'GB'), '+441614960000');
    assert.equal(toE164('+44 161 496 0000'), '+441614960000');
    assert.equal(toE164('12345', 'GB'), null);
});

test('URL classification', () => {
    assert.equal(profilePlatform('https://www.facebook.com/glowsalon').platform, 'Facebook');
    assert.equal(profilePlatform('https://www.fresha.com/a/glow-salon-abc').booking, 'Fresha');
    assert.equal(profilePlatform('https://www.google.com/maps/place/x').platform, 'Google Maps listing');
    assert.equal(profilePlatform('https://glowsalon.co.ke/'), null);
    assert.equal(freeHostSuffix('https://glowsalon.wixsite.com/home'), 'wixsite.com');
    assert.equal(freeHostSuffix('https://glowsalon.blogspot.com/'), 'blogspot.com');
    assert.equal(freeHostSuffix('https://glowsalon.co.ke/'), null);
    assert.match(deadBuilderFromHost('https://glow-salon.business.site/'), /Google Business Profile/);
    assert.match(deadBuilderFromGenerator('Microsoft FrontPage 4.0'), /FrontPage/);
    assert.equal(deadBuilderFromGenerator('WordPress 6.5'), null);
});

test('business email: generic or name-carrying mailboxes only, no named staff, no third parties', () => {
    const emails = extractEmails('Web design by pixels@agency.example. Dr. Jane Smith: jane.smith@austinsmiles.com. Front desk: hello [at] austinsmiles [dot] com', []);
    assert.deepEqual(emails, ['pixels@agency.example', 'jane.smith@austinsmiles.com', 'hello@austinsmiles.com']);
    assert.equal(pickBusinessEmail(emails, { name: 'Austin Smiles Dental', siteUrl: 'https://www.austinsmiles.com/' }), 'hello@austinsmiles.com');
    assert.equal(pickBusinessEmail(['mercysbeauty@gmail.com'], { name: "Mercy's Beauty Parlour", siteUrl: 'https://mercysbeauty.co.ke/' }), 'mercysbeauty@gmail.com');
    assert.equal(pickBusinessEmail(['john.doe1985@gmail.com'], { name: 'Glow Salon', siteUrl: 'https://glow.example/' }), null);
});

test('WhatsApp links to E.164', () => {
    assert.equal(whatsappNumber(['https://wa.me/254712345678?text=Hi']), '+254712345678');
    assert.equal(whatsappNumber(['https://api.whatsapp.com/send?phone=447911123456']), '+447911123456');
    assert.equal(whatsappNumber(['https://example.com']), null);
});

test('robots.txt: our own group wins over *, longest rule wins', () => {
    const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: websitegapfinder\nAllow: /\nDisallow: /private';
    const rules = parseRobots(txt, 'websitegapfinder');
    assert.equal(isAllowed(rules, '/'), true);
    assert.equal(isAllowed(rules, '/private/x'), false);
    assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow: /', 'websitegapfinder'), '/'), false);
    assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:', 'websitegapfinder'), '/'), true);
});
