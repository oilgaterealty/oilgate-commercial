// Owner page: one section per tab so the Overview is short; the sticky jump bar reaches everything.
// Plans: switching offers updates the address in place (no page jump on phones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

test('owner renders only the chosen section; Overview by default', () => {
  const src = read('src/views/Owner.jsx');
  assert.match(src, /const active = SECTIONS\.some\(\(\[k\]\) => k === wanted\) \? wanted : 'overview';/);
  assert.match(src, /<JumpNav sections=\{SECTIONS\} active=\{active\}/);
  for (const k of ['overview', 'offers', 'plans', 'rent-value', 'lenders', 'walkthrough', 'tenants', 'comps', 'photos', 'messages', 'files', 'city-records', 'activity', 'settings']) {
    assert.match(src, new RegExp(`\\{show\\('${k}'\\) && `), k);
  }
  assert.doesNotMatch(src, /useSectionScroll\(/);
});

test('plans offer switch does not change the hash', () => {
  const src = read('src/views/DealPlan.jsx');
  assert.doesNotMatch(src, /window\.location\.hash\s*=/);
  assert.match(src, /history\.replaceState/);
});
test('owner Offers opens on the table; phone comps show the first few with Show all', () => {
  assert.match(read('src/views/Offers.jsx'), /useState\(owner \? 'table' : 'cards'\)/);
  const comps = read('src/views/Comps.jsx');
  assert.match(comps, /const PHONE_COMPS = 5;/);
  assert.match(comps, /phoneAll \? shownComps : shownComps\.slice\(0, PHONE_COMPS\)/);
  assert.match(comps, /Show all \$\{shownComps\.length\} comps/);
});
