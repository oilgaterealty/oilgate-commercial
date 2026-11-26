import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePlan, offerSellerSummary } from '../src/lib/dealplan.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const base = { rent: 900, units: 10, taxes: 12000, insurance: 0, waterMo: 300, emptyUnitUtilMo: 50, value: 500000, valueBasis: 'income', refiLtv: 75, refiDscr: 1.25, refiRate: 7, refiYears: 30, refiFeesPct: 2, refiFeesFlat: 2000, refiReserve: 10000, reservesPerUnit: 300, vacancyPct: 5 };
const plan = normalizePlan({ lenderRate: 10, lenderPoints: 2, sellerLoanBalance: 200000, sellerLoanRate: 6, sellerLoanYears: 25, contingency: 10000, refiTrigger: { allRented: true },
  units: [{ id: '1', rehab: 5000, ready: 4 }, { id: '2', rehab: 8000, ready: 6 }], costs: [{ label: 'Roof', group: 'g', cost: 4000, start: 0, end: 2 }] });
const offer = { id: 'o1', name: 'A: Lease', structure: 'master_lease', inputs: { optionPrice: 200000, exerciseClosing: 4000 } };

test('round 4: seller summary is generated, plain and holds nothing the buyer makes', () => {
  const locked = { ...offer, seller_summary: { version: 1, locked: true, title: 'Hand typed', terms: [{ label: 'x', value: 'y' }], steps: [] } };
  const s = offerSellerSummary(locked, base, plan, [], false);
  assert.notEqual(s.title, 'Hand typed');
  assert.equal(s.terms.length, 4);
  assert.deepEqual(s.terms.map((t) => t.label), ['Buyout', 'You keep paying', 'Rent pays you first', 'I buy when']);
  assert.equal(s.steps.length, 4);
  assert.deepEqual(s.steps.map((t) => t.title), ['Master lease', 'Repairs', 'Rent', 'Refinance']);
  for (const r of s.sellerTable) assert.deepEqual(Object.keys(r).sort(), ['covered', 'rentIn', 'units']);
  const sellerText = JSON.stringify({ terms: s.terms, steps: s.steps, refiLine: s.refiLine, title: s.title });
  assert.doesNotMatch(sellerText, /buyer|\bnet\b|interest|contingency used|left for|You net|—|–/i);
  const keep = s.terms.find((t) => t.label === 'You keep paying').value;
  assert.match(keep, /Your loan/);
  assert.doesNotMatch(keep, /insurance/i, 'a $0 cost item is skipped');
  assert.doesNotMatch(s.refiLine, /or what you owe|about|estimate/i);
});

test('round 4: owner view has no seller page tab or hand-typed seller text', () => {
  const owner = read('src/views/Owner.jsx');
  assert.doesNotMatch(owner, /'seller-page'/);
  assert.doesNotMatch(owner, /SellerEditor/);
  const offers = read('src/views/Offers.jsx');
  assert.doesNotMatch(offers, /SellerSummaryEditor|Seller page text|Lock text|Reset from numbers/);
  const card = read('src/components/LeadOfferCard.jsx');
  assert.doesNotMatch(card, /Pick lead terms/);
  const seller = read('src/views/Seller.jsx');
  assert.match(seller, /sellerOnly/);
});
