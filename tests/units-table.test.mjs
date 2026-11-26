// Round 3 unit tests: unitsRentedTable (0..10), refi() with contingency unused/used,
// shortCarry, cost summary with contingency & zero-$0 skipping, seller table, and UI rendering.
// Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { money, pmt, pv } from '../src/lib/dealmath.js';
import {
  buildCostSummary,
  buildLeadGuide,
  buildSellerSummary,
  monthlyPlan,
  nextSellerSummary,
  normalizePlan,
  refi,
  unitsRentedTable,
} from '../src/lib/dealplan.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

function loadJsx(file, mocks) {
  const src = read(file).replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
  const code = transformSync(src, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react/jsx-runtime') return jsxRuntime;
    if (spec in mocks) return mocks[spec];
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);
  return mod.exports;
}

const SAMPLE_BASE = {
  units: 10,
  tenthUnitRepair: 20000,
  rent: 1000,
  vacancyPct: 5,
  taxes: 12000,       // $1,000/mo
  insurance: 6000,    // $500/mo
  waterMo: 300,       // $300/mo
  emptyUnitUtilMo: 100, // $100/empty unit/mo
  utilities: 99999,   // legacy field — must be ignored by unitsRentedTable & refi
  admin: 88888,       // must be ignored
  turns: 77777,       // must be ignored
  mgmtPct: 12,        // must be ignored
  reservesPerUnit: 300, // $25/rented unit/mo
  value: 800000,
  refiRate: 7,
  refiYears: 30,
  refiLtv: 75,        // $600,000 max by LTV
  refiDscr: 1.25,
  refiFeesPct: 2,
  refiFeesFlat: 2000,
  refiReserve: 3000,
};

const SAMPLE_PLAN = normalizePlan({
  lenderRate: 12,
  lenderPoints: 2,
  contingency: 10000,
  sellerLoanBalance: 180000,
  sellerLoanRate: 6,
  sellerLoanYears: 30,
  units: [
    { id: '1', rehab: 5000, ready: 4 },
    { id: '2', rehab: 5000, ready: 6 },
    { id: '3', rehab: 0, ready: 0, occupied: true },
    { id: '4', rehab: 20000, ready: 16 },
    { id: '5', rehab: 5000, ready: 8 },
    { id: '6', rehab: 5000, ready: 10 },
    { id: '7', rehab: 5000, ready: 12 },
    { id: '8', rehab: 5000, ready: 14 },
    { id: '9', rehab: 5000, ready: 16 },
    { id: '10', rehab: 5000, ready: 18 },
  ],
  costs: [
    { label: 'Exterior', cost: 6000, group: 'systems' },
    { label: 'Roof check', cost: 0, group: 'systems' },
    { label: 'Permits', cost: 2000, group: 'permits' },
  ],
});

const SAMPLE_OFFER = {
  id: 'o1',
  name: 'A: Lease now, buy later',
  structure: 'master_lease',
  inputs: { exerciseClosing: 4000, shortCarry: 0 },
};

test('unitsRentedTable builds 11 rows (0..10), ignores mgmt/admin/turns/old utilities, tracks covered & contingency cases', () => {
  const table = unitsRentedTable(SAMPLE_BASE, SAMPLE_PLAN, SAMPLE_OFFER);
  assert.equal(table.rows.length, 11);
  assert.equal(table.refiTrigger.allRented, true);

  // Rehab budget = 8*5000 + 20000 (Unit 4 added) + 6000 + 2000 = 68,000
  // Contingency = 10,000; fullLoan = 78,000 / 0.98; points = fullLoan - 78,000
  const expectedRehab = 68000;
  const expectedFullLoan = (expectedRehab + 10000) / 0.98;
  const expectedPoints = expectedFullLoan - (expectedRehab + 10000);
  const expectedDrawnUnused = expectedRehab + expectedPoints;
  near(table.repairLoan.rehabBudget, expectedRehab);
  near(table.repairLoan.fullLoan, expectedFullLoan);
  near(table.repairLoan.drawnUnused, expectedDrawnUnused);
  near(table.repairLoan.drawnUsed, expectedFullLoan);

  const sellerLoanMo = pmt(6, 30, 180000);
  const interestUnused = (expectedDrawnUnused * 0.12) / 12;
  const interestUsed = (expectedFullLoan * 0.12) / 12;

  // Row 0: 0 units rented -> covered 'no', empty utilities for all 10 units, no reserves line
  const r0 = table.rows[0];
  assert.equal(r0.units, 0);
  assert.equal(r0.rentIn, 0);
  assert.equal(r0.covered, 'no');
  const expectedSeller0 = sellerLoanMo + 1000 + 500 + 300 + 10 * 100;
  near(r0.sellerCosts, expectedSeller0);
  assert.equal(r0.aboveSellerCosts, 0);
  near(r0.buyerNet, -interestUnused);
  near(r0.buyerNetContUsed, -interestUsed);
  assert.ok(!r0.buyerCostsBreakdown.some((b) => b.key === 'reserves'));

  // Row 3: 3 units -> rentIn 3000 < sellerCosts (~3579) -> 'partly'
  const r3 = table.rows[3];
  assert.equal(r3.rentIn, 3000);
  assert.equal(r3.covered, 'partly');

  // Row 4: 4 units -> rentIn 4000 >= sellerCosts (~3479) -> 'yes'
  const r4 = table.rows[4];
  assert.equal(r4.rentIn, 4000);
  assert.equal(r4.covered, 'yes');
  assert.equal(table.sellerCoveredAt, 4);

  // Row 5: 5 units -> reserves = 5 * 25 = 125, check buyerNet & buyerNetContUsed
  const r5 = table.rows[5];
  const expectedSeller5 = sellerLoanMo + 1000 + 500 + 300 + 5 * 100;
  near(r5.sellerCosts, expectedSeller5);
  near(r5.aboveSellerCosts, 5000 - expectedSeller5);
  near(r5.buyerNet, 5000 - expectedSeller5 - interestUnused - 125);
  near(r5.buyerNetContUsed, 5000 - expectedSeller5 - interestUsed - 125);
  assert.equal(table.breakEvenUnits, 5);

  // Row 10: 0 empty units -> empty-unit utilities skipped from breakdown ($0 rule)
  const r10 = table.rows[10];
  assert.ok(!r10.sellerCostsBreakdown.some((b) => b.key === 'emptyUtils'));
  assert.ok(!r10.sellerCostsOverlay.some((l) => l.includes('(estimate)')));
  assert.ok(!r10.buyerNetOverlay.some((l) => l.includes('(estimate)')));
});

test('refi() computes DSCR without mgmt/admin/turns, handles LTV vs DSCR cap, both contingency cases, and shortCarry', () => {
  const res = refi(SAMPLE_BASE, SAMPLE_PLAN, SAMPLE_OFFER);
  // Full occupancy NOI = 10000*(1-0.05) - 1000 - 500 - 300 - 250 = 9500 - 2050 = 7450/mo
  near(res.dscrNoiMo, 7450);
  const expectedDscrLoan = pv(7, 30, 7450 / 1.25);
  const expectedLtvLoan = 600000;
  assert.equal(res.limitedBy, 'LTV');
  near(res.loan, Math.min(expectedDscrLoan, expectedLtvLoan));
  assert.equal(res.ltvShownPct, 75);
  const feesPctAmt = res.loan * 0.02;
  const expectedInHand = res.loan - feesPctAmt - 2000 - 3000;
  near(res.inHand, expectedInHand);
  assert.equal(res.sellerPayoff, 180000);
  assert.equal(res.sellerPayoffText, '$180,000');
  near(res.repairLoanPayoffContUsed - res.repairLoanPayoff, 10000);
  near(res.leftForYou, res.inHand - res.sellerPayoff - res.repairLoanPayoff - 4000);
  near(res.leftForYouContUsed, res.inHand - res.sellerPayoff - res.repairLoanPayoffContUsed - 4000);
  near(res.leftForYou - res.leftForYouContUsed, 10000);

  // shortCarry adds to repair loan payoff and reduces leftForYou dollar-for-dollar
  const withCarry = refi(SAMPLE_BASE, SAMPLE_PLAN, { inputs: { exerciseClosing: 4000, shortCarry: 5000 } });
  near(withCarry.repairLoanPayoff - res.repairLoanPayoff, 5000);
  near(withCarry.repairLoanPayoffContUsed - res.repairLoanPayoffContUsed, 5000);
  near(res.leftForYou - withCarry.leftForYou, 5000);
  near(res.leftForYouContUsed - withCarry.leftForYouContUsed, 5000);

  // DSCR-limited case when value is very high
  const dscrCapped = refi({ ...SAMPLE_BASE, value: 2000000 }, SAMPLE_PLAN, SAMPLE_OFFER);
  assert.equal(dscrCapped.limitedBy, 'DSCR');
  near(dscrCapped.loan, expectedDscrLoan);
});

test('buildCostSummary shows Contingency line and total with it, and never emits $0 lines', () => {
  const cs = buildCostSummary(SAMPLE_BASE, SAMPLE_PLAN);
  assert.equal(cs.rehabTotal, 68000);
  assert.equal(cs.contingency, 10000);
  assert.equal(cs.total, 78000);
  assert.equal(cs.heading, 'Repair budget $78,000');
  assert.ok(cs.lines.some((l) => l.key === 'contingency' && l.label === 'Contingency $10,000'));
  assert.ok(!cs.lines.some((l) => /\$0|to inspect/i.test(l.label)));
  assert.ok(cs.headingOverlay.some((l) => l.includes('Total with contingency: $78,000')));
});

test('buildSellerSummary writes plain sellerTable + refiLine without months/buyer numbers, and regenerates even when locked', () => {
  const planRes = monthlyPlan('master_lease', SAMPLE_OFFER.inputs, SAMPLE_BASE, SAMPLE_PLAN);
  const summary = buildSellerSummary(SAMPLE_OFFER, planRes, { base: SAMPLE_BASE });

  assert.equal(summary.sellerTable.length, 11);
  assert.equal(summary.sellerTable[0].covered, 'no');
  assert.equal(summary.sellerTable[4].covered, 'yes');
  assert.equal(summary.refiLine, 'Once all 10 are rented, I refinance and pay you $180,000, and your loan is paid off.');
  assert.match(summary.intro, /I take over the leasing and the repairs/);
  assert.doesNotMatch(JSON.stringify({ intro: summary.intro, refiLine: summary.refiLine, terms: summary.terms, steps: summary.steps }), /Month \d+|You net|repair loan payoff|Left for you/i);

  const locked = {
    version: 1,
    locked: true,
    title: 'Custom locked',
    terms: [{ label: 'Custom', value: 'Locked value' }],
    steps: [{ title: 'Locked step', when: '', detail: 'Kept' }],
    guide: null,
  };
  const next = nextSellerSummary({ ...SAMPLE_OFFER, seller_summary: locked }, planRes, { base: SAMPLE_BASE });
  assert.notEqual(next.title, 'Custom locked');
  assert.notDeepEqual(next.terms, locked.terms);
  assert.equal(next.steps.length, 4);
  assert.equal(next.guide.rows.length, 11);
  assert.ok(next.guide.refi);
});

test('UnitsRentedGuide and LeadOfferCard render cleanly without subtext, estimates outside overlays, or months', () => {
  const guide = buildLeadGuide(SAMPLE_BASE, SAMPLE_PLAN, SAMPLE_OFFER);
  const CostSummary = loadJsx('src/components/CostSummary.jsx', {
    './Shell.jsx': { OverlayTrigger: ({ children, className }) => React.createElement('button', { type: 'button', className }, children) },
  }).default;
  const UnitsRentedGuide = loadJsx('src/components/UnitsRentedGuide.jsx', {
    './CostSummary.jsx': CostSummary,
    './Shell.jsx': { OverlayTrigger: ({ children, className }) => React.createElement('button', { type: 'button', className }, children) },
    '../lib/dealmath.js': { money },
  }).default;

  const html = renderToStaticMarkup(React.createElement(UnitsRentedGuide, { guide }));
  assert.match(html, /Units rented table/);
  assert.match(html, /You net, contingency used/);
  assert.match(html, /Value/);
  assert.match(html, /Loan at 75%/);
  assert.match(html, /In hand after fees and reserve/);
  assert.match(html, /Seller paid off/);
  assert.match(html, /Repair loan paid off/);
  assert.match(html, /Left for you/);
  assert.match(html, /\$180,000/);
  assert.doesNotMatch(html, /or what he owes/);
  assert.doesNotMatch(html, /\(estimate\)|<p\b|<small\b|<caption\b|Month \d+/i);

  // Seller LeadOfferCard renders 3-column table and refi line with zero buyer numbers
  const planRes = monthlyPlan('master_lease', SAMPLE_OFFER.inputs, SAMPLE_BASE, SAMPLE_PLAN);
  const summary = buildSellerSummary(SAMPLE_OFFER, planRes, { base: SAMPLE_BASE });
  const { LeadOfferCard } = loadJsx('src/components/LeadOfferCard.jsx', {
    './Shell.jsx': {
      Button: ({ children, ...p }) => React.createElement('button', p, children),
      Card: ({ children }) => React.createElement('section', null, children),
      CardTitle: ({ children }) => React.createElement('h2', null, children),
      OverlayTrigger: ({ children }) => React.createElement('button', { type: 'button' }, children),
    },
  });
  const sellerHtml = renderToStaticMarkup(React.createElement(LeadOfferCard, { deal: { id: 'd1', slug: 'demo' }, content: {}, summary }));
  assert.match(sellerHtml, /Units rented/);
  assert.match(sellerHtml, /Your costs covered/);
  assert.match(sellerHtml, /Once all 10 are rented, I refinance and pay you \$180,000, and your loan is paid off\./);
  assert.doesNotMatch(sellerHtml, /You net|Left for you|Repair loan|contingency/i);
});

test('Lender and Reviewer read commercial_get_lead_guide without importing dealplan; no forbidden words in src or test', () => {
  for (const v of ['src/views/Lender.jsx', 'src/views/Reviewer.jsx', 'src/views/Offers.jsx']) {
    assert.match(read(v), /commercial_get_lead_guide/, v);
  }
  for (const v of ['src/views/Lender.jsx', 'src/views/Reviewer.jsx', 'src/views/Seller.jsx', 'src/components/UnitsRentedGuide.jsx']) {
    assert.doesNotMatch(read(v), /dealplan|monthlyPlan|buildOfferStory|deal_plan:/i, v);
  }
  const banned = new RegExp(
    [
      'QU1IQQ==',
      'U2VjdGlvbiA4',
      'Z3JvdXAgaG9tZQ==',
      'c3VibGVhc2U=',
      'dm91Y2hlcg==',
      'aG91c2luZyBhdXRob3JpdHk=',
      'ZnVsbHkgZHJhd24=',
      'cmVudCBndWlkZQ==',
    ].map((b) => Buffer.from(b, 'base64').toString('utf8')).join('|'),
    'i'
  );
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of [...walk(join(root, 'src')), join(root, 'tests/units-table.test.mjs')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), banned, file);
  }
});
