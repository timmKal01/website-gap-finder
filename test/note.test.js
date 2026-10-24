import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRunNote } from '../src/note.js';

const stats = (o = {}) => ({ processed: 0, filteredOut: 0, filteredOutUnaudited: 0, errors: 0, ...o });
const counters = (search = {}) => ({ skippedClosed: 0, skippedEmpty: 0, duplicates: 0, search: { place: 'Denver, Colorado, United States', found: 0, capped: false, noWebsiteListed: 0, chains: 0, ...search } });
const opts = (o = {}) => ({ onlyOpportunities: false, minScore: 50, ...o });
const search = { category: 'plumber', location: 'Denver, USA' };

test('a search that found nothing says so and suggests what to try', () => {
    const n = emptyRunNote(stats(), counters(), opts(), search, 'Plumbers');
    assert.match(n.note, /OpenStreetMap lists no plumbers in Denver, Colorado/);
    assert.equal(n.name, 'No businesses saved in this run (not charged)');
    assert.equal(n.search.found, 0);
});

test('a search whose listings have no websites explains why nothing was audited', () => {
    const n = emptyRunNote(stats(), counters({ found: 7, noWebsiteListed: 6, chains: 1 }), opts(), search, 'Plumbers');
    assert.match(n.note, /lists 7 plumbers in Denver, Colorado, United States, but 6 list no website and 1 is a chain/);
    assert.match(n.note, /Google Maps scraper dataset/);
});

test('everything filtered out by onlyOpportunities says how to see it', () => {
    const n = emptyRunNote(stats({ processed: 12, filteredOut: 11, filteredOutUnaudited: 1 }), counters({ found: 200 }), opts({ onlyOpportunities: true, minScore: 70 }), search, 'Plumbers');
    assert.match(n.note, /All 12 businesses audited scored below 70 or couldn't be audited/);
    assert.match(n.note, /Lower minScore or turn off onlyOpportunities/);
    assert.equal(n.filteredOut, 12);
});

test('a dataset whose records were all skipped lists the reasons', () => {
    const c = counters(); c.skippedClosed = 2; c.duplicates = 3;
    const n = emptyRunNote(stats(), c, opts(), null);
    assert.match(n.note, /2 permanently closed, 0 with no name or website, 3 duplicates/);
    assert.equal(n.search, undefined);
});

test('the note row is never empty', () => {
    assert.ok(emptyRunNote(stats(), counters(), opts(), null).note.length > 0);
});
