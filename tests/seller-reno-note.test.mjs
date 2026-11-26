// Lead offer: seller financing with a seller-funded renovation note (second seller note), paid off at the refi.
// Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRUCTURES, evaluate, buildLeadStory, applyGuideRefi } from '../src/lib/dealmath.js';
import { buildLeadGuide, deferredAtRefi, offerSellerSummary, refi, sellerNote, unitsRentedTable } from '../src/lib/dealplan.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, a + ' not within ' + tol + ' of ' + b);

const BASE = { rent: 1000, vacancyPct: 7, taxes: 12000, insurance: 6000, waterMo: 1000, emptyUnitUtilMo: 0, reservesPerUnit: 450, value: 600000, refiLtv: 75, refiDscr: 1.25, refiRate: 7.5, refiYears: 30, refiFeesPct: 2.5, refiFeesFlat: 3500, refiReserve: 15000, units: 10, strUnits: 0, rehab: 100000 };
const PLAN = { refiMonth: 12, lenderRate: 11, lenderPoints: 2.5, contingency: 20000, sellerLoanBalance: 250000, costs: [{ label: 'Roof', cost: 20000, start: 0, end: 4 }], units: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), rehab: 6000, ready: 2 + i })) };
const LEAD = { structure: 'wrap', inputs: { note: 250000, rate: 6.5, amortYears: 25, closing: 5000, billsFromRent: true, renoFromSeller: true, renoRate: 8 } };
const OUTSIDE = { structure: 'wrap', inputs: { ...LEAD.inputs, renoFromSeller: false } };
const BUDGET = 60000 + 20000 + 20000; // units + costs + contingency: one repair budget

test('wrap has an owner-editable seller repair note: off by default, 8% when on', () => {
  const keys = STRUCTURES.wrap.fields.map(([k]) => k);
  assert.ok(keys.includes('renoFromSeller') && keys.includes('renoRate'));
  assert.equal(STRUCTURES.wrap.defaults.renoFromSeller, false);
  assert.equal(STRUCTURES.wrap.defaults.renoRate, 8);
  const n = sellerNote(LEAD, PLAN);
  assert.equal(n.renoFromSeller, true);
  assert.equal(n.renoRate, 8);
});

test('renovation note = whole repair budget + closing, no points, seller rate; cheaper than the regular lender', () => {
  const r = refi(BASE, PLAN, LEAD);
  assert.equal(r.renoFromSeller, true);
  near(r.renoNotePrincipal, BUDGET + 5000);
  near(r.repairLoanPayoff, r.repairLoanPayoffContUsed);
  const c = r.renoCompare;
  assert.equal(c.sellerRate, 8);
  assert.equal(c.regularRate, 11);
  assert.equal(c.regularPointsPct, 2.5);
  near(c.sellerMo, (BUDGET + 5000) * 0.08 / 12);
  near(c.regularLoan, (BUDGET + 5000) / 0.975);
  near(c.regularPoints, (BUDGET + 5000) / 0.975 - (BUDGET + 5000));
  assert.ok(c.sellerMo < c.regularMo);
  assert.equal(r.closing, 0);
});

test('refi payoff: 75% loan, both seller notes, deferred costs, closing, what is left', () => {
  const r = refi(BASE, PLAN, LEAD);
  const d = deferredAtRefi(BASE, PLAN, LEAD);
  near(r.sellerCarriedBills, d.total);
  near(d.total, d.bills + d.purchaseNote + d.renoNote);
  assert.ok(d.renoNote > 0, 'renovation payments wait while units are empty');
  near(r.sellerNotePrincipal, 250000);
  near(r.sellerPayoff, 250000 + d.total);
  near(r.sellerTotalPayoff, 250000 + d.total + r.renoNotePrincipal);
  near(r.leftForYou, r.inHand - 250000 - d.total - r.renoNotePrincipal - r.closing);
  near(r.leftForYou, r.leftForYouContUsed);
  assert.equal(r.sellerPayoffLabel, 'Seller purchase note paid off');
  assert.equal(r.renoNoteLabel, 'Seller renovation note paid off');
  assert.equal(r.sellerCarriedBillsLabel, 'Deferred holding costs, paid at refi');
});

test('units rented: rent pays bills, then purchase note, then renovation note; the rest waits; buyer pays no repair interest', () => {
  const t = unitsRentedTable(BASE, PLAN, LEAD);
  const n = sellerNote(LEAD, PLAN).notePay;
  const reno = (BUDGET + 5000) * 0.08 / 12;
  assert.equal(t.rows.length, 11);
  assert.equal(t.oneBudget, true);
  near(t.renoPay, reno);
  const bills = 1000 + 500 + 1000;
  for (const r of t.rows) {
    const billsPaid = Math.min(r.rentIn, bills);
    const notePaid = Math.min(r.rentIn - billsPaid, n);
    const renoPaid = Math.min(r.rentIn - billsPaid - notePaid, reno);
    near(r.notePaid, notePaid);
    near(r.renoPaid, renoPaid);
    near(r.renoWaits, reno - renoPaid);
    near(r.sellerCosts, (bills - billsPaid) + (n - notePaid) + (reno - renoPaid));
    assert.ok(!r.buyerCostsBreakdown.some((i) => i.key === 'interest'));
    near(r.buyerCosts, (r.units * 450) / 12);
  }
  assert.equal(t.costsLabel, 'Paid at refi');
  assert.equal(t.rows[0].covered, 'no');
  assert.equal(t.rows[10].covered, 'yes');
  const outside = unitsRentedTable(BASE, PLAN, OUTSIDE);
  assert.ok(outside.rows[5].buyerCostsBreakdown.some((i) => i.key === 'interest'));
  assert.equal(outside.oneBudget, false);
});

test('seller page: two notes, no regular lender rate, no buyer numbers, no carry wording', () => {
  const s = offerSellerSummary({ name: 'A: Seller financing', ...LEAD }, BASE, PLAN, [], false);
  assert.equal(s.renoFromSeller, true);
  const labels = s.terms.map((x) => x.label);
  for (const l of ['Purchase note', 'Renovation note', 'Renovation note rate', 'Note payments', 'Paid back in full when']) assert.ok(labels.includes(l), l);
  assert.equal(s.terms.find((x) => x.label === 'Renovation note rate').value, '8%, no points');
  assert.ok(!labels.includes('Regular lender'));
  const seen = ['title', 'intro', 'sellerTable', 'refiLine', 'terms', 'steps'].map((k) => JSON.stringify(s[k])).join(' ');
  assert.doesNotMatch(seen, /11%|2\.5 points|regular|lender/i);
  assert.ok(!labels.includes('You can also fund the repairs'));
  assert.deepEqual(s.steps.map((x) => x.title), ['Seller financing', 'Repairs', 'Rent', 'Paid back in full']);
  assert.match(s.refiLine, /paid back in full/);
  assert.match(s.steps[1].detail, /You earn 8% every month until you are paid back in full/);
  assert.match(s.refiLine, /Purchase note \$250,000, renovation note \$105,000/);
  const visible = JSON.stringify([s.intro, s.terms, s.steps, s.refiLine, s.sellerTable]);
  assert.doesNotMatch(visible, /carr(y|ies|ied)|refi|net\b|cash flow|left for you|DSCR|reserve/i);
  const t = unitsRentedTable(BASE, PLAN, LEAD);
  s.sellerTable.forEach((row, i) => near(row.note, t.rows[i].notePaid + t.rows[i].renoPaid));
});

test('lead guide for other roles carries the renovation note and one budget', () => {
  const g = buildLeadGuide(BASE, PLAN, LEAD);
  assert.equal(g.oneBudget, true);
  assert.equal(g.renoFromSeller, true);
  assert.ok(g.refi.renoCompare);
});

test('snapshot story (non-owner) pays both seller notes at refi', () => {
  const ev = evaluate('wrap', LEAD.inputs, BASE);
  const st = buildLeadStory('wrap', ev, { base: BASE });
  const refiStep = st.steps.find((s) => s.title === 'Refinance');
  const pays = refiStep.lines.find((l) => l.label === 'Pays seller');
  assert.equal(pays.value, '$355,000');
});

test('no "carry" wording left in shipped source text', () => {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const hits = [];
  for (const f of walk(join(root, 'src')).filter((f) => /\.(js|jsx)$/.test(f))) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const text = (line.match(/'[^']*'|"[^"]*"|`[^`]*`|\/\/.*$/g) || []).join(' ');
      if (/\b(you carry|seller carries|carried|carry|carries)\b/i.test(text)) hits.push(f + ':' + (i + 1));
    });
  }
  assert.deepEqual(hits, []);
});


test('seller page function passes the on/off switches the offer card needs', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/0025_seller_offer_flags.sql'), 'utf8');
  assert.match(sql, /'billsFromRent'/);
  assert.match(sql, /'renoFromSeller'/);
});

test('non-owner snapshot uses the guide refi payoff (both notes + deferred costs)', () => {
  const ev = evaluate('wrap', LEAD.inputs, BASE);
  const g = buildLeadGuide(BASE, PLAN, LEAD);
  const st = applyGuideRefi(buildLeadStory('wrap', ev, { base: BASE }), g.refi, g);
  const left = g.refi.leftForYou;
  assert.equal(st.headline.cashOut.value, left >= 0 ? '$' + Math.round(left).toLocaleString('en-US') : 'Bring $' + Math.round(-left).toLocaleString('en-US'));
  assert.equal(st.headline.sellerTotal.value, '$' + Math.round(g.refi.sellerTotalPayoff).toLocaleString('en-US'));
  const pays = st.steps.find((s) => s.title === 'Refinance').lines.find((l) => l.label === 'Pays seller');
  assert.equal(pays.value, st.headline.sellerTotal.value);
});

test('shared offer story adds up: purchase note, repairs by seller note or a repair loan, lease-up, payoff breakdown', async () => {
  const { sharedRefiStory } = await import('../src/lib/dealmath.js');
  const ev = evaluate('wrap', LEAD.inputs, BASE);
  const g = buildLeadGuide(BASE, PLAN, LEAD);
  const st = sharedRefiStory(applyGuideRefi(buildLeadStory('wrap', ev, { base: BASE }), g.refi, g), { loanOption: true });
  const other = sharedRefiStory(applyGuideRefi(buildLeadStory('wrap', ev, { base: BASE }), g.refi, g));
  assert.ok(!JSON.stringify(other).includes('Or a repair loan'));
  assert.doesNotMatch(JSON.stringify(other.steps.find((s) => s.title === 'Rehab')), /11%|points upfront/);
  const titles = st.steps.map((s) => s.title);
  assert.deepEqual(titles, ['Take over', 'Rehab', 'Lease-up', 'Full', 'Seller paid back', 'After']);
  const rehab = st.steps.find((s) => s.title === 'Rehab').lines.map((l) => l.label);
  assert.ok(rehab.includes('Seller renovation note') && rehab.includes('Or a repair loan'));
  const pay = st.steps.find((s) => s.title === 'Seller paid back').lines;
  const n = (v) => +String(v).replace(/[^0-9.]/g, '');
  const parts = pay.filter((l) => l.label !== 'Paid back in full').reduce((s, l) => s + n(l.value), 0);
  assert.ok(Math.abs(parts - n(pay.find((l) => l.label === 'Paid back in full').value)) <= 2);
  assert.ok(!pay.some((l) => l.big));
  const full = st.steps.find((s) => s.title === 'Full').lines.find((l) => l.label === 'Both note payments');
  assert.ok(full);
});
