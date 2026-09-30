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
    assert.deepEqual(r.opportunityReasons, ['Copyright still says 2018', 'No HTTPS', 'Not mobile friendly', 'Outdated WordPress (4.9.8)', 'Slow homepage (3.5s)', 'No meta description']);
    assert.equal(r.opportunityScore, 100); // 40 + 20 + 20 + 10 + 7 + 5, capped
    assert.equal(r.pitchAngle, "Joe's Plumbing's website still says © 2018 and isn't secure (no HTTPS); a refresh could bring in more customers.");
});

test('a free subdomain with no booking lands around 60; a very old copyright alone around 40', () => {
    const wix = scoreBusiness(
        { name: "Diego's Barber Shop", category: 'Barber shop' },
        { ...base, websiteStatus: 'free_subdomain', freeHost: 'wixsite.com', hasBooking: false, bookingProvider: null },
        NOW,
    );
    assert.equal(wix.opportunityScore, 62);
    assert.deepEqual(wix.opportunityReasons, ['On a free wixsite.com address, no own domain', 'No online booking']);
    const old = (year) => scoreBusiness({ name: 'CN Plumbing', category: 'Plumber' }, { ...base, lastCopyrightYear: year }, NOW).opportunityScore;
    assert.equal(old(2012), 40);
    assert.equal(old(2018), 40); // 8 years
    assert.equal(old(2019), 20); // 7 years
    assert.equal(old(2023), 10);
    assert.equal(old(2024), 0);
});

test('missing online booking only counts for appointment businesses', () => {
    const salon = scoreBusiness({ name: 'Glow', category: 'Hair salon' }, { ...base, hasBooking: false, bookingProvider: null }, NOW);
    assert.deepEqual(salon.opportunityReasons, ['No online booking']);
    const plumber = scoreBusiness({ name: 'Pipes', category: 'Plumber' }, { ...base, hasBooking: false, bookingProvider: null }, NOW);
    assert.deepEqual(plumber.opportunityReasons, []);
    assert.equal(plumber.opportunityScore, 0);
});

test('score is capped at 100; blocked sites get no score, only an explanation', () => {
    const worst = scoreBusiness(
        { name: 'X', category: 'Salon', reviewCount: 300, rating: 4.9 },
        { ...base, websiteStatus: 'free_subdomain', freeHost: 'wixsite.com', https: false, mobileFriendly: false, placeholder: true, hasBooking: false, lastCopyrightYear: 2012, responseMs: 9000 },
        NOW,
    );
    assert.equal(worst.opportunityScore, 100);
    const blocked = scoreBusiness(
        { name: 'Austin Family Dentistry', reviewCount: 300, rating: 4.9 },
        { ...base, websiteStatus: 'blocked', websiteError: 'site blocks automated checks (bot protection)', mobileFriendly: null },
        NOW,
    );
    assert.equal(blocked.opportunityScore, null);
    assert.deepEqual(blocked.opportunityReasons, ["Couldn't audit: site blocks automated checks (bot protection)"]);
    assert.equal(blocked.pitchAngle, "Couldn't audit: site blocks automated checks (bot protection). Check Austin Family Dentistry's website by hand before reaching out.");
});
