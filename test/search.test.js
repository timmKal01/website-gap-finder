import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeToItem } from '../src/sources/search.js';
import { CATEGORIES, categoryMatcher } from '../src/sources/categories.js';
import { toBusinessRecord } from '../src/sources/records.js';

// Shaped like an Overture record from the 2026-10-21.0 release, pass 1 and pass 2 merged (values made up).
const place = {
    id: '45ac34d4-0000-0000-0000-000000000000',
    names: { primary: 'Bright Smile Dental' },
    basic_category: 'dental_clinic',
    taxonomy: { primary: 'general_dentistry', hierarchy: ['health_care', 'dental_clinic', 'general_dentistry'] },
    websites: ['', 'https://brightsmile.example/'],
    phones: ['+15125550123'],
    addresses: [{ freeform: '100 Congress Ave', locality: 'Austin', region: 'TX', postcode: '78701', country: 'us' }],
    bbox: { xmin: -97.75, xmax: -97.74, ymin: 30.26, ymax: 30.27 },
};

test('an Overture place becomes an item the record mapper reads', () => {
    const item = placeToItem(place, { countryCode: 'US' });
    assert.deepEqual(item, {
        name: 'Bright Smile Dental',
        website: 'https://brightsmile.example/',
        phone: '+15125550123',
        address: '100 Congress Ave, Austin, TX, 78701',
        city: 'Austin',
        countryCode: 'US',
        category: 'General dentistry',
        placeId: 'overture:45ac34d4-0000-0000-0000-000000000000',
    });
    const r = toBusinessRecord(item);
    assert.equal(r.name, 'Bright Smile Dental');
    assert.equal(r.website, 'https://brightsmile.example/');
    assert.equal(r.placeId, 'overture:45ac34d4-0000-0000-0000-000000000000');
    assert.equal(r.city, 'Austin');
});

test('the searched country fills in when the address has none', () => {
    const item = placeToItem({ ...place, addresses: [] }, { countryCode: 'GB' });
    assert.equal(item.countryCode, 'GB');
    assert.equal(item.address, null);
});

test('the 32 business types all map to Overture categories, and match on any level', () => {
    assert.equal(Object.keys(CATEGORIES).length, 32);
    for (const c of Object.values(CATEGORIES)) assert.ok(c.overture.length >= 1);
    assert.equal(categoryMatcher('dentist')(place), true);
    assert.equal(categoryMatcher('plumber')(place), false);
    assert.equal(categoryMatcher('hair')({ basic_category: 'personal_or_beauty_service', taxonomy: { primary: 'barber' } }), true);
});
