import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sortComps, soldLabel, COMP_SORTS } from '../src/lib/v63.js';
import { BASE_DEFAULTS } from '../src/lib/dealmath.js';
import { setDealNames, buyerName } from '../src/lib/people.js';

const src = (p) => readFileSync(p, 'utf8');

test('seller page: short cover, no intro line, plain "Photos" title', () => {
  const s = src('src/views/Seller.jsx');
  assert.match(s, /<Cover rows=\{coverRows\} compact \/>/);
  assert.doesNotMatch(s, /c\.intro/);
  assert.doesNotMatch(s, /Photos from our visit/);
  assert.match(s, />Photos</);
  const p = src('src/components/Photos.jsx');
  assert.match(p, /compact \? 'h-36 w-full object-cover sm:h-48'/);
});

test('seller photo strip: bigger photos, one tap target, no corner button', () => {
  const p = src('src/components/Photos.jsx');
  const strip = p.slice(p.indexOf('export function PhotoStrip'), p.indexOf('export function Cover'));
  assert.doesNotMatch(strip, /ThumbOverlay/);
  assert.match(strip, /h-28 w-40[^"]*sm:h-40 sm:w-56/);
  assert.match(strip, /overflow-x-auto/); // still scroll together
  const v = src('src/components/PhotoViewer.jsx');
  assert.match(v, /data-thumb-overlay\s+className="pointer-events-none /);
  assert.match(v, /pointer-events-auto flex h-8/);
});

test('deal at a glance starts with the seller’s offer and our offer, for every role', () => {
  const d = src('src/views/Dashboard.jsx');
  assert.match(d, /OFFER_TILES = \[\['askPrice', 'Seller’s offer'\], \['ourOffer', 'Our offer'\]\]/);
  const glance = d.slice(d.indexOf('Deal at a glance'));
  assert.ok(glance.indexOf('OFFER_TILES.map') < glance.indexOf('Best cash flow'));
  // what-ifs never report offer numbers as changes
  assert.match(src('src/components/Switches.jsx'), /\['units', 'planOffer', 'askPrice', 'ourOffer'\]\.includes\(k\)/);
});

test('Switches has no Airbnb controls', () => {
  const s = src('src/components/Switches.jsx');
  assert.doesNotMatch(s, /Airbnb|strNightly|strUnits/i);
});

test('10th unit starts at $30,000', () => {
  assert.equal(BASE_DEFAULTS.tenthUnitRepair, 30000);
});

test('buyer name comes only from the deal settings', () => {
  setDealNames({ buyer_name: 'Pat' }, 'realtor');
  assert.equal(buyerName(), 'Pat');
  setDealNames({ buyer_name: 'Sam' }, 'realtor');
  assert.equal(buyerName(), 'Sam');
  for (const f of ['src/views/Dashboard.jsx', 'src/components/Switches.jsx', 'src/views/Comps.jsx', 'src/views/Seller.jsx']) {
    assert.doesNotMatch(src(f), /LaVante/, f);
  }
});

test('comps sort by every column, blanks last', () => {
  const rows = [
    { id: 'a', address: 'B St', units: 8, sale_price: 499000, sale_date: null, distance_mi: 2.67, source: 'Sheet' },
    { id: 'b', address: 'A St', units: 4, sale_price: 420000, sale_date: '2024-11-08', distance_mi: 1.66, source: 'Sheet' },
    { id: 'c', address: 'C St', units: 36, sale_price: 1006378, sale_date: '2025-01-14', distance_mi: 0.29, source_kind: 'ai' },
  ];
  assert.deepEqual(COMP_SORTS.map(([k]) => k), ['address', 'units', 'sale_price', 'per_unit', 'sale_date', 'distance_mi', 'source']);
  const ids = (k, d) => sortComps(rows, k, d).map((r) => r.id).join('');
  assert.equal(ids('address', 'asc'), 'bac');
  assert.equal(ids('units', 'desc'), 'cab');
  assert.equal(ids('sale_price', 'asc'), 'bac');
  assert.equal(ids('per_unit', 'asc'), 'cab'); // 27,955 < 62,375 < 105,000
  assert.equal(ids('sale_date', 'desc'), 'cba');
  assert.equal(ids('sale_date', 'asc'), 'bca'); // no date stays last either way
  assert.equal(ids('distance_mi', 'asc'), 'cba');
  assert.equal(ids(null), 'abc');
  assert.equal(soldLabel('2024-11-08'), 'Nov 2024');
  assert.equal(soldLabel(null), '');
  const c = src('src/views/Comps.jsx');
  assert.match(c, /shownComps = sortComps\(allComps, sort\.key, sort\.dir\)/);
  assert.match(c, /aria-sort=/);
  assert.match(c, /id="comp-sort"/);
  assert.match(c, /'Not found'/);
});
