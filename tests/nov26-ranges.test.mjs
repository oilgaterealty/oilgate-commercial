// Nov 26: realtor sees building facts only; market rent range for lender and owner; value range; unknown rent counts as $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rentValue } from '../src/lib/dealplan.js';
import { rangeValue } from '../src/lib/rangeValue.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const BASE = { rent: 1000, value: 500000, taxes: 12000, insurance: 6000, waterMo: 800, vacancyPct: 7, reservesPerUnit: 450, valueCapRate: 9, emptyUnitUtilMo: 60 };
const PLAN = { units: [{ id: '1', rehab: 1000 }, { id: '2', rehab: 1000, occupied: true }, ...Array.from({ length: 8 }, (_, i) => ({ id: String(i + 3), rehab: 1000 }))], contingency: 1000, marketRent: { low: 900, high: 1100, source: 'owner note' } };

test('a rented unit with no known rent counts as $0 today', () => {
  const rv = rentValue(BASE, PLAN, {});
  assert.equal(rv.units.find((u) => u.id === '2').rentToday, 0);
  assert.doesNotMatch(JSON.stringify(rv.views[0].rentOverlay), /not entered/);
});

test('value range: floor is the locked value, top is value after repairs; market range carries no source', () => {
  const rv = rentValue(BASE, PLAN, {});
  assert.equal(rv.valueRange.low, 500000);
  assert.ok(Math.abs(rv.valueRange.high - rv.views[1].value) < 1e-6);
  assert.equal(rv.marketRange.low, 900);
  assert.equal(rv.marketRange.high, 1100);
  assert.doesNotMatch(JSON.stringify(rv), /owner note/);
  assert.equal(rentValue(BASE, { ...PLAN, marketRent: null }, {}).marketRange, null);
  const atLow = rangeValue(rv.marketRange, 900);
  assert.ok(rangeValue(rv.marketRange, 1100) > atLow && atLow > 0);
});

test('market range shows for lender and owner, not the reviewer', () => {
  assert.match(read('src/views/Lender.jsx'), /<RentValue data=\{effectiveGuide\.rentValue\} showMarket \/>/);
  assert.doesNotMatch(read('src/views/Reviewer.jsx'), /showMarket/);
  assert.match(read('src/components/OwnerRentValue.jsx'), /showMarket sourceLines=\{ctx\.plan\.marketRent\?\.source/);
  const mig = read('supabase/migrations/0024_note_waits_market_range.sql');
  assert.match(mig, /if r = 'reviewer' and g is not null then g := g #- '\{rentValue,marketRange\}'/);
  assert.match(mig, /'noteWaits', t->'noteWaits'/);
});

test('realtor overview: short phone-first overview with cover, address, units, repair budget, lead offer and next step', () => {
  const r = read('src/views/Realtor.jsx');
  assert.match(r, /<Cover rows=\{photos\} compact \/>/);
  assert.match(r, />Address</);
  assert.match(r, />Units</);
  assert.match(r, />Repair budget</);
  assert.match(r, />Lead offer</);
  assert.match(r, />Next step</);
  assert.doesNotMatch(read('src/views/Dashboard.jsx'), /sub=\{|sub="/);
});
