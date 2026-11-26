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

test('every role with the jump bar shows one section at a time', () => {
  const shell = read('src/components/Shell.jsx');
  assert.match(shell, /\[data-section\]:not\(\[data-section="\$\{active\}"\]\)\{display:none!important\}/);
  assert.doesNotMatch(shell, /IntersectionObserver/);
  for (const f of ['src/views/Realtor.jsx', 'src/views/Lender.jsx', 'src/views/Reviewer.jsx']) assert.match(read(f), /<JumpNav /, f);
});

test('shared views show only that the seller is paid back; buyer refi result stays with the owner', async () => {
  const { sharedRefiStory } = await import('../src/lib/dealmath.js');
  const story = { headline: { moneyIn: { label: 'a' }, cashOut: { label: 'b' }, sellerTotal: { label: 'c' }, maxSellerAtRefi: { label: 'd' } },
    steps: [{ num: 6, title: 'Refinance', lines: [{ label: 'Loan', value: '$1' }, { label: 'Pays seller', value: '$418,113' }, { label: 'You bring $8,874', big: true }] }] };
  const s = sharedRefiStory(story);
  assert.equal(s.headline.cashOut, null);
  assert.equal(s.headline.maxSellerAtRefi, null);
  assert.deepEqual(s.steps[0].lines.map((l) => l.label), ['Paid back in full']);
  assert.equal(s.steps[0].title, 'Seller paid back');
  assert.match(read('src/views/Lender.jsx'), /<UnitsRentedGuide guide=\{effectiveGuide\} shared \/>/);
  assert.doesNotMatch(read('src/views/Lender.jsx'), />Left for you</);
  assert.match(read('src/components/UnitsRentedGuide.jsx'), /\{!shared && <li/);
});
