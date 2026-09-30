import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreBusiness } from '../src/score.js';

const NOW = new Date('2026-09-30T00:00:00Z');
const base = {
    websiteUrl: null, websiteStatus: 'ok', websiteError: null, fetched: true, https: true, httpRedirectsToHttps: true,
    sslError: null, mobileFriendly: true, responseMs: 800, techStack: [], wordpressVersion: null, deadBuilder: null,
    freeHost: null, placeholder: false, lastCopyrightYear: 2026, missingTitle: false, missingMetaDescription: false,
    hasBooking: true, bookingProvider: 'Fresha', socialPlatform: null,
};

test('no website scores very high, more for an established business', () => {
    const plain = scoreBusiness({ name: 'Corner Barbershop' }, { ...base, websiteStatus: 'none', fetched: false, mobileFriendly: null }, NOW);
    assert.equal(plain.opportunityScore, 80);
    assert.deepEqual(plain.opportunityReasons, ['No website']);
    const established = scoreBusiness({ name: 'Corner Barbershop', reviewCount: 120, rating: 4.7 }, { ...base, websiteStatus: 'none', fetched: false, mobileFriendly: null }, NOW);
    assert.equal(established.opportunityScore, 90);
    assert.match(established.pitchAngle, /^Corner Barbershop has no website/);
});

test('an outdated site adds up its problems, strongest first, and the pitch uses the top two', () => {
    const r = scoreBusiness(
        { name: "Joe's Plumbing", category: 'Plumber' },
        { ...base, https: false, httpRedirectsToHttps: false, mobileFriendly: false, lastCopyrightYear: 2018, responseMs: 3500, missingMetaDescription: true, wordpressVersion: '4.9.8' },
        NOW,
    );
    assert.deepEqual(r.opportunityReasons, ['No HTTPS', 'Not mobile friendly', 'Copyright still says 2018', 'Outdated WordPress (4.9.8)', 'Slow homepage (3.5s)', 'No meta description']);
    assert.equal(r.opportunityScore, 20 + 20 + 15 + 10 + 7 + 5);
    assert.equal(r.pitchAngle, "Joe's Plumbing's website isn't secure (no HTTPS) and isn't mobile friendly; a refresh could bring in more customers.");
});

test('missing online booking only counts for appointment businesses', () => {
    const salon = scoreBusiness({ name: 'Glow', category: 'Hair salon' }, { ...base, hasBooking: false, bookingProvider: null }, NOW);
    assert.deepEqual(salon.opportunityReasons, ['No online booking']);
    const plumber = scoreBusiness({ name: 'Pipes', category: 'Plumber' }, { ...base, hasBooking: false, bookingProvider: null }, NOW);
    assert.deepEqual(plumber.opportunityReasons, []);
    assert.equal(plumber.opportunityScore, 0);
});

test('score is capped at 100; blocked sites score 0 with an explanation', () => {
    const worst = scoreBusiness(
        { name: 'X', category: 'Salon', reviewCount: 300, rating: 4.9 },
        { ...base, websiteStatus: 'free_subdomain', freeHost: 'wixsite.com', https: false, mobileFriendly: false, placeholder: true, hasBooking: false, lastCopyrightYear: 2012, responseMs: 9000 },
        NOW,
    );
    assert.equal(worst.opportunityScore, 100);
    const blocked = scoreBusiness({ name: 'Y', reviewCount: 300, rating: 4.9 }, { ...base, websiteStatus: 'blocked', mobileFriendly: null }, NOW);
    assert.equal(blocked.opportunityScore, 0);
    assert.deepEqual(blocked.opportunityReasons, ["Couldn't audit: the site blocks automated checks"]);
});
