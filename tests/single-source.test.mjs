// Single source of truth tests across role views, seller execution steps, lender bridge repairs, and cross-role parity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, money } from '../src/lib/dealmath.js';
import { buildCostSummary, buildLeadGuide, offerSellerSummary, overallRepairBudget, planStepBudgets, rentValue } from '../src/lib/dealplan.js';
import { buildLenderPackage } from '../src/lib/lenderModel.js';
import { effectiveMarketRange } from '../src/lib/rangeValue.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

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

const CHARLOTTE_PLAN = {
  sellerLoanBalance: 275000,
  contingency: 20000,
  lenderRate: 13,
  lenderPoints: 2,
  bridgeRate: 13,
  bridgePoints: 2,
  bridgeProcessing: 1295,
  bridgeClosing: 5500,
  units: [
    { id: '1', rehab: 5000, ready: 4 },
    { id: '2', rehab: 5000, ready: 6 },
    { id: '3', rehab: 0, ready: 0, occupied: true },
    { id: '4', rehab: 20000, ready: 16 },
    { id: '5', rehab: 6000, ready: 8 },
    { id: '6', rehab: 6000, ready: 10 },
    { id: '7', rehab: 6000, ready: 12 },
    { id: '8', rehab: 6000, ready: 14 },
    { id: '9', rehab: 0, ready: 0, occupied: true },
    { id: '10', rehab: 20000, ready: 18 },
  ],
  costs: [
    { label: 'Security, locks and lighting', cost: 12000, start: 0, end: 4, group: 'security' },
    { label: 'Due diligence and tests', cost: 2500, start: 0, end: 2, group: 'diligence' },
    { label: 'City permits and registration', cost: 2050, start: 0, end: 2, group: 'permits' },
    { label: 'Exterior and common systems', cost: 13500, start: 2, end: 10, group: 'systems' },
  ],
  marketRent: { low: 780, high: 1020, source: 'owner note' },
};

const CHARLOTTE_BASE = {
  ...BASE_DEFAULTS,
  units: 10,
  rent: 965,
  vacancyPct: 7,
  taxes: 12000,
  insurance: 6000,
  waterMo: 1000,
  reservesPerUnit: 300,
  value: 586000,
  rehab: 124050,
  purchasePrice: 275000,
  bridgeRepairs: 140000,
  bridgeClosing: 5500,
  bridgeProcessing: 1295,
  bridgePointsPct: 2,
  bridgeRate: 13,
  refiLtv: 75,
  refiFeesFlat: 5000,
  refiFeesPct: 2.1,
  marketRentLow: 780,
  marketRentHigh: 1150,
};

const CHARLOTTE_OFFER = {
  id: 'o1',
  name: 'B: Seller financing',
  structure: 'wrap',
  is_lead: true,
  share_lender: true,
  inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500 },
};

test('planStepBudgets derives units ($74,000), security, diligence+permits, and total ($124,050) from deal_plan', () => {
  assert.equal(overallRepairBudget(CHARLOTTE_PLAN), 124050);
  const b = planStepBudgets(CHARLOTTE_PLAN);
  assert.deepEqual(b, {
    units: 74000,
    security: 12000,
    safetyRecords: 4550,
    total: 124050,
  });
  const cs = buildCostSummary(CHARLOTTE_BASE, CHARLOTTE_PLAN);
  assert.deepEqual(cs.stepBudgets, b);
});

test('ExecutionPlanCard and normalizeExecutionSteps strip stale hardcoded dollars and read step figures from the plan without mutating content', () => {
  const Shell = {
    Button: ({ children, ...p }) => React.createElement('button', p, children),
    Card: ({ children }) => React.createElement('section', null, children),
    CardTitle: ({ children }) => React.createElement('h2', null, children),
    OverlayTrigger: ({ children }) => React.createElement('span', null, children),
  };
  const { ExecutionPlanCard, normalizeExecutionSteps, stripHardcodedDollars } = loadJsx('src/components/LeadOfferCard.jsx', {
    './Shell.jsx': Shell,
  });

  const staleContent = {
    execution_steps: [
      { title: 'Safety and records', detail: 'Diligence and permits ($3,000 to $6,000). Gas test $150-$500; zoning cert $50.', items: ['Gas pressure test ($150-$500)', 'Zoning cert $50'] },
      { title: 'Empty occupied units', detail: 'Court process only.' },
      { title: 'Secure the building', detail: 'Cameras, locks, lighting ($10,000 to $13,500).' },
      { title: 'Fix up the units', detail: 'Likely $140,000. Units 5 and 8 first.' },
    ],
  };
  const snapshotBefore = JSON.stringify(staleContent);

  // Without plan: stale $ figures are stripped cleanly and never rendered.
  const strippedSteps = normalizeExecutionSteps(staleContent);
  const strippedHtml = renderToStaticMarkup(React.createElement(ExecutionPlanCard, { content: staleContent }));
  assert.doesNotMatch(strippedHtml, /\$140,000|\$3,000|\$6,000|\$10,000|\$13,500|\$150|\$500|\$50|\$/);
  assert.match(strippedHtml, /Court process only\./);
  assert.match(strippedHtml, /Units 5 and 8 first\./);
  assert.equal(strippedSteps[0].items[0], 'Gas pressure test');
  assert.equal(strippedSteps[0].items[1], 'Zoning cert');

  // With plan: each matching step renders its plan-derived figure instead.
  const withPlanHtml = renderToStaticMarkup(React.createElement(ExecutionPlanCard, { content: staleContent, plan: CHARLOTTE_PLAN }));
  assert.doesNotMatch(withPlanHtml, /\$140,000|\$3,000|\$6,000|\$10,000|\$13,500|\$150|\$500|\$50/);
  assert.match(withPlanHtml, /\$4,550/);
  assert.match(withPlanHtml, /\$12,000/);
  assert.match(withPlanHtml, /\$74,000/);
  assert.match(withPlanHtml, /Court process only\./);

  // With summary.stepBudgets (no raw plan import needed): same numbers.
  const budgets = planStepBudgets(CHARLOTTE_PLAN);
  const withBudgetsHtml = renderToStaticMarkup(React.createElement(ExecutionPlanCard, { content: staleContent, summary: { stepBudgets: budgets } }));
  assert.match(withBudgetsHtml, /\$4,550/);
  assert.match(withBudgetsHtml, /\$12,000/);
  assert.match(withBudgetsHtml, /\$74,000/);

  // Stored content object was never mutated.
  assert.equal(JSON.stringify(staleContent), snapshotBefore);
  assert.equal(stripHardcodedDollars('Court process only.'), 'Court process only.');
});

test('lender bridge repairs always uses plan total ($124,050) first ahead of stale bridgeRepairs ($140,000)', () => {
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, CHARLOTTE_OFFER);
  assert.equal(guide.bridge.repairs, 124050);

  const pkg = buildLenderPackage({ base: CHARLOTTE_BASE, offer: CHARLOTTE_OFFER, guide, lens: 'bridge' });
  assert.equal(pkg.repairs, 124050);
  assert.equal(pkg.loanAskRows.find((r) => r.key === 'repairs').display, '$124,050');
  assert.doesNotMatch(JSON.stringify(pkg), /140,?000/);

  // Falls back cleanly when no plan guide is present.
  const fallbackPkg = buildLenderPackage({ base: { ...CHARLOTTE_BASE, rehab: 124050 }, offer: CHARLOTTE_OFFER, guide: null });
  assert.equal(fallbackPkg.repairs, 124050);
});

test('cross-role parity: market rent range, purchase, value, closing, and refi LTV match single source', () => {
  // Rent range overrides both up and down identically between rentValue (Owner) and effectiveMarketRange (Lender).
  const lowerBase = { ...CHARLOTTE_BASE, marketRentLow: 700, marketRentHigh: 950 };
  const ownerRv = rentValue(lowerBase, CHARLOTTE_PLAN, CHARLOTTE_OFFER);
  const lenderMr = effectiveMarketRange(CHARLOTTE_PLAN.marketRent, lowerBase);
  assert.deepEqual({ low: ownerRv.marketRange.low, high: ownerRv.marketRange.high }, { low: lenderMr.low, high: lenderMr.high });
  assert.equal(ownerRv.buyout, 275000);

  // When base.purchasePrice differs from sellerLoanBalance, rentValue & buildLeadGuide & lenderModel agree on purchasePrice.
  const customPurchaseBase = { ...CHARLOTTE_BASE, purchasePrice: 260000 };
  const g2 = buildLeadGuide(customPurchaseBase, CHARLOTTE_PLAN, CHARLOTTE_OFFER);
  const rv2 = rentValue(customPurchaseBase, CHARLOTTE_PLAN, CHARLOTTE_OFFER);
  const pkg2 = buildLenderPackage({ base: customPurchaseBase, offer: CHARLOTTE_OFFER, guide: g2 });
  assert.equal(g2.bridge.purchase, 260000);
  assert.equal(rv2.buyout, 260000);
  assert.equal(pkg2.purchase, 260000);

  // Closing $5,500 falls back to base.bridgeClosing when offer.inputs.closing is 0.
  const guideClosing = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, { structure: 'wrap', inputs: { note: 275000 } });
  assert.equal(guideClosing.bridge.closing, 5500);
  assert.equal(guideClosing.refi.closingInLoan, 5500);
  assert.equal(guideClosing.refi.ltvPct, 75);
  assert.equal(guideClosing.refi.estimatedValue, 586000);

  // Privacy: LeadOfferCard never imports dealplan.
  assert.doesNotMatch(read('src/components/LeadOfferCard.jsx'), /dealplan/);
});

test('buildSellerSummary includes stepBudgets without leaking buyer or lender details', () => {
  const s = offerSellerSummary(CHARLOTTE_OFFER, CHARLOTTE_BASE, CHARLOTTE_PLAN, [], false);
  assert.deepEqual(s.stepBudgets, {
    units: 74000,
    security: 12000,
    safetyRecords: 4550,
    total: 124050,
  });
  assert.ok(s.steps.some((st) => st.detail.includes('$124,050')));
});
