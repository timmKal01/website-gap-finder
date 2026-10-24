import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, buildOverpassQuery, elementToItem, overpassScope } from '../src/sources/osm.js';
import { toBusinessRecord } from '../src/sources/records.js';

test('a city found as a boundary relation becomes an Overpass area', () => {
    assert.equal(overpassScope({ osm_type: 'relation', osm_id: 1411339 }), 'area(id:3601411339)->.searchArea;');
    assert.equal(overpassScope({ osm_type: 'way', osm_id: 5 }), 'area(id:2400000005)->.searchArea;');
    assert.equal(overpassScope({ osm_type: 'node', osm_id: 5 }), null);
});

test('the query covers every tag of the category and only named places', () => {
    const q = buildOverpassQuery('dentist', { osm_type: 'relation', osm_id: 1 }, 500);
    assert.match(q, /nwr\["amenity"="dentist"\]\["name"\]\(area\.searchArea\);/);
    assert.match(q, /nwr\["healthcare"="dentist"\]\["name"\]\(area\.searchArea\);/);
    assert.match(q, /out tags center 500;$/);
});

test('a place found only as a point is searched within 5 km', () => {
    const q = buildOverpassQuery('plumber', { osm_type: 'node', osm_id: 1, lat: '39.7', lon: '-104.9' }, 100);
    assert.match(q, /\(around:5000,39\.7,-104\.9\)/);
});

test('an unknown category is refused', () => {
    assert.throws(() => buildOverpassQuery('spaceships', { osm_type: 'relation', osm_id: 1 }, 10), /Unknown search category/);
});

test('every category has a title and at least one tag with a label', () => {
    for (const [key, c] of Object.entries(CATEGORIES)) {
        assert.ok(c.title, key);
        assert.ok(c.tags.length > 0, key);
        for (const tag of c.tags) assert.equal(tag.length, 3, key);
    }
});

const ctx = { categoryKey: 'hair', city: 'Denver', countryCode: 'us' };

test('a listing with a website becomes an item the records mapper understands', () => {
    const { item } = elementToItem({
        type: 'node', id: 42,
        tags: { name: 'Fade Lab', shop: 'hairdresser', website: 'https://fadelab.example;https://other.example', phone: '+1 303 555 0100', 'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'Denver' },
    }, ctx);
    assert.equal(item.website, 'https://fadelab.example');
    assert.equal(item.placeId, 'osm:node/42');
    assert.equal(item.countryCode, 'US');
    assert.equal(item.address, '12 Main St, Denver');
    const r = toBusinessRecord(item);
    assert.equal(r.name, 'Fade Lab');
    assert.equal(r.category, 'Hair salon');
    assert.equal(r.placeId, 'osm:node/42');
});

test('a barber listed as a hairdresser is labelled a barber shop', () => {
    const { item } = elementToItem({ type: 'way', id: 7, tags: { name: "Joe's Barber Shop", shop: 'hairdresser', 'contact:website': 'joesbarber.example' } }, ctx);
    assert.equal(item.category, 'Barber shop');
    assert.equal(item.website, 'joesbarber.example');
    assert.equal(item.city, 'Denver');
});

test('a Facebook page in the website field is kept, so it can be flagged as social only', () => {
    const { item } = elementToItem({ type: 'node', id: 1, tags: { name: 'Curl Up', shop: 'hairdresser', website: 'https://www.facebook.com/curlup' } }, ctx);
    assert.equal(item.website, 'https://www.facebook.com/curlup');
});

test('listings with no website, chains and unnamed places are skipped with a reason', () => {
    assert.deepEqual(elementToItem({ type: 'node', id: 1, tags: { name: 'No Site Salon', shop: 'hairdresser' } }, ctx), { skip: 'noWebsiteListed' });
    assert.deepEqual(elementToItem({ type: 'node', id: 2, tags: { name: 'Supercuts', shop: 'hairdresser', website: 'https://supercuts.com', 'brand:wikidata': 'Q7643239' } }, ctx), { skip: 'chain' });
    assert.deepEqual(elementToItem({ type: 'node', id: 3, tags: { shop: 'hairdresser', website: 'https://x.example' } }, ctx), { skip: 'unnamed' });
});
