// Seller financing (structure 'wrap'): note paid first, shortfall is the owner's, seller view has no buyer numbers.
// Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pmt } from '../src/lib/dealmath.js';
import { offerSellerSummary, refi, sellerNote, unitsRentedTable } from '../src/lib/dealplan.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const BASE = { rent: 900, vacancyPct: 5, taxes: 6000, insurance: 3000, waterMo: 200, emptyUnitUtilMo: 40, reservesPerUnit: 300, value: 500000, refiLtv: 75, refiFeesPct: 2, refiFeesFlat: 1000, refiReserve: 5000, units: 10, strUnits: 0 };
const PLAN = { sellerLoanBalance: 200000, sellerLoanRate: 6, sellerLoanYears: 25, contingency: 10000, lenderRate: 10, lenderPoints: 2, costs: [], units: [{ id: '1', rehab: 5000 }, { id: '2', rehab: 5000 }] };
const NOTE = { structure: 'wrap', inputs: { note: 180000, rate: 5, amortYears: 25, closing: 3000 } };
const LEASE = { structure: 'master_lease', inputs: { payment: 1000, optionPrice: 200000, exerciseClosing: 3000 } };

test('note payment comes from the note terms', () => {
  const n = sellerNote(NOTE, PLAN);
  assert.equal(n.isNote, true);
  assert.ok(Math.abs(n.notePay - pmt(5, 25, 180000)) < 1e-6);
  assert.equal(sellerNote(LEASE, PLAN).isNote, false);
});

test('seller financing: shortfall below the note and bills is the owner’s; master lease keeps it the seller’s', () => {
  const note = unitsRentedTable(BASE, PLAN, NOTE);
  const lease = unitsRentedTable(BASE, PLAN, LEASE);
  assert.equal(note.costsLabel, 'Note and bills');
  assert.equal(lease.costsLabel, 'Seller’s costs');
  const n0 = note.rows[0];
  assert.ok(Math.abs(n0.buyerNet - (0 - n0.sellerCosts - n0.buyerCosts)) < 1e-6);
  assert.equal(lease.rows[0].aboveSellerCosts, 0);
  assert.ok(note.noteCoveredAt <= note.sellerCoveredAt);
});

test('refi pays off the note; closing is rolled into the repair loan', () => {
  const r = refi(BASE, PLAN, NOTE);
  assert.equal(r.sellerNotePrincipal, 180000);
  assert.ok(Math.abs(r.sellerPayoff - (180000 + r.sellerCarriedBills)) < 1e-6);
  assert.equal(r.sellerPayoffLabel, 'Seller purchase note paid off');
  assert.equal(r.closing, 0);
  assert.equal(r.closingInLoan, 3000);
  assert.ok(r.repairLoanOverlay.some((l) => /Closing costs: \$3,000 in the repair loan/.test(l)));
  assert.ok(Math.abs(r.leftForYou - (r.inHand - r.sellerPayoff - r.repairLoanPayoff)) < 1e-6);
  const noClose = refi(BASE, PLAN, { ...NOTE, inputs: { ...NOTE.inputs, closing: 0 } });
  assert.ok(r.repairLoanPayoff > noClose.repairLoanPayoff + 3000 - 1e-6);
});

test('rent pays the note first; any shortfall waits until the refinance', () => {
  const t = unitsRentedTable(BASE, PLAN, NOTE);
  const n = sellerNote(NOTE, PLAN).notePay;
  assert.equal(t.rows[0].notePaid, 0);
  assert.ok(Math.abs(t.rows[0].noteWaits - n) < 1e-6);
  for (const r of t.rows) {
    assert.ok(Math.abs(r.notePaid - Math.min(r.rentIn, n)) < 1e-6);
    assert.ok(Math.abs(r.notePaid + r.noteWaits - n) < 1e-6);
  }
});

test('seller summary: seller financing steps, no buyer numbers', () => {
  const s = offerSellerSummary(NOTE, BASE, PLAN, [], false);
  assert.equal(s.title, 'Seller financing');
  assert.deepEqual(s.steps.map((x) => x.title), ['Seller financing', 'Repairs', 'Rent', 'Your choice: fund the repairs', 'Refinance']);
  assert.match(s.steps[3].detail, /You can also be my repair lender: \$[\d,]+ as a second note, paid off at the refinance/);
  assert.ok(s.terms.some((t) => t.label === 'You can also fund the repairs'));
  assert.match(s.steps[2].detail, /added to your payoff/);
  const visible = JSON.stringify({ intro: s.intro, terms: s.terms, steps: s.steps, refiLine: s.refiLine, sellerTable: s.sellerTable });
  assert.doesNotMatch(visible, /net|cash flow|left for you|DSCR|interest|reserve|lease/i);
  assert.match(s.refiLine, /pay off your note/);
  assert.ok(s.sellerTable.every((r) => ['bills,billsLines,covered,note,rentIn,units', 'bills,billsLines,covered,note,noteWaits,rentIn,units'].includes(Object.keys(r).sort().join())));
  const n = sellerNote(NOTE, PLAN).notePay;
  assert.ok(s.sellerTable.every((r) => Math.abs(r.note + (r.noteWaits || 0) - n) < 1e-6 && r.note <= r.rentIn + 1e-6));
  // Bills: taxes, insurance, water and empty-unit utilities; fewer empty units, smaller bills.
  assert.ok(Math.abs(s.sellerTable[10].bills - (6000 / 12 + 3000 / 12 + 200)) < 1e-6);
  assert.ok(s.sellerTable[0].bills > s.sellerTable[10].bills);
  assert.doesNotMatch(JSON.stringify(s.sellerTable.flatMap((r) => r.billsLines)), /interest|reserve|net/i);
});

test('realtor sees the seller’s one offer, not the buyer’s offers page', () => {
  const src = read('src/views/Realtor.jsx');
  assert.match(src, /<SellerOffer /);
  assert.doesNotMatch(src, /<Offers /);
  const mig = read('supabase/migrations/0020_seller_offer_for_realtor.sql');
  assert.match(mig, /not in \('seller', 'realtor', 'owner'\)/);
});
