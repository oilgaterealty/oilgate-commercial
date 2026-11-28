// Charlotte seller page "The plan" rebuild regression suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, money, operating, pct, valueSummary } from '../src/lib/dealmath.js';
import { buildCostSummary, buildLeadGuide, offerSellerSummary, overallRepairBudget, planStepBudgets } from '../src/lib/dealplan.js';
import { buildLenderPackage } from '../src/lib/lenderModel.js';

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

const ShellStub = {
  Button: ({ children, ...p }) => React.createElement('button', p, children),
  Card: ({ children }) => React.createElement('section', null, children),
  CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside || null),
  OverlayTrigger: ({ children }) => React.createElement('span', null, children),
  Field: (p) => React.createElement('input', p),
  JumpNav: () => null,
  useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
};

const CHARLOTTE_145850_PLAN = {
  sellerLoanBalance: 275000,
  contingency: 20000,
  lenderRate: 13,
  lenderPoints: 2,
  bridgeRate: 10,
  bridgePoints: 1,
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
    { label: 'Security, locks and cameras', cost: 10000, start: 0, end: 4, group: 'security' },
    { label: 'Laundry 3 sets', cost: 19800, start: 0, end: 2, group: 'laundry' },
    { label: 'Gas check + furnace', cost: 2000, start: 0, end: 2, group: 'diligence' },
    { label: 'Due diligence and tests', cost: 2500, start: 0, end: 2, group: 'diligence' },
    { label: 'City permits and registration', cost: 2050, start: 0, end: 2, group: 'permits' },
    { label: 'Unit 3 legal eviction', cost: 2500, start: 2, end: 3, group: 'eviction' },
    { label: 'Plumbing, heat, electric and exterior', cost: 11000, start: 2, end: 10, group: 'systems' },
    { label: 'Lease-up screening and turns', cost: 2000, start: 2, end: 12, group: 'lease-up' },
  ],
};

const CHARLOTTE_7_STEPS = [
  {
    key: 'week1_secure_and_start',
    week: 'Week 1',
    title: 'Secure the building first',
    budgetKey: 'week1',
    items: [
      { text: 'Doors, locks, cameras', budgetKey: 'security' },
      { text: 'Same week: start the near-ready units 5, 8, 1, 2', budgetKey: 'nearReadyUnits' },
      { text: 'Get laundry running: at least one stacked set taking coins, tap/card and bills', budgetKey: 'laundry' },
      { text: 'Paperwork runs alongside, never blocks work: gas check and furnace service, code violation, title, rental registration, $50 zoning letter', budgetKey: 'paperwork' },
    ],
  },
  {
    key: 'week2_first_tenant',
    week: 'Week 2',
    title: 'First tenant moves in',
    detail: 'Week 3 is the hard deadline. Start the bigger units.',
  },
  {
    key: 'weeks2_3_empty_units',
    week: 'Weeks 2-3',
    title: 'Units 3 and 9 empty',
    detail: 'Unit 9 moves out; Unit 3 handled the legal way after closing (we handle it, not the seller), done by week 3.',
    budgetKey: 'eviction',
  },
  {
    key: 'weeks2_onward_bigger_units',
    week: 'Weeks 2 onward',
    title: 'Bigger units, then building systems',
    budgetKey: 'week2Onward',
    items: [
      { text: 'Bigger units 7, 6, 3, 10, then 4 (full gut)', budgetKey: 'biggerUnits' },
      { text: 'Plumbing, heat, electric and exterior', budgetKey: 'building' },
    ],
  },
  {
    key: 'as_each_unit_finishes',
    week: 'As each unit finishes',
    title: 'Inspect, lease and collect rent',
    detail: 'Inspected, leased to screened long-term tenants, rent collected.',
    budgetKey: 'leaseUp',
  },
  {
    key: 'within_1_year_payoff',
    week: 'Within the 1-year renovation loan',
    title: 'Your renovation loan is paid off in full.',
  },
  {
    key: 'updates_on_this_page',
    week: 'Along the way',
    title: 'Updates on this page',
    detail: 'Rents, leases, repair photos.',
  },
];

test('planStepBudgets sums cleanly to $145,850 across all mutually exclusive buckets', () => {
  const b = planStepBudgets(CHARLOTTE_145850_PLAN);
  assert.equal(overallRepairBudget(CHARLOTTE_145850_PLAN), 145850);
  assert.equal(b.units, 74000);
  assert.equal(b.nearReadyUnits, 22000);
  assert.equal(b.biggerUnits, 52000);
  assert.equal(b.security, 10000);
  assert.equal(b.laundry, 19800);
  assert.equal(b.paperwork, 6550);
  assert.equal(b.eviction, 2500);
  assert.equal(b.building, 11000);
  assert.equal(b.leaseUp, 2000);
  assert.equal(b.contingency, 20000);
  assert.equal(b.week1, 10000 + 22000 + 19800 + 6550);
  assert.equal(b.week2Onward, 52000 + 11000);
  assert.equal(b.week1 + b.eviction + b.week2Onward + b.leaseUp + b.contingency, b.total);
  assert.equal(b.total, 145850);
});

test('ExecutionPlanCard prefers content.execution_steps over summary.steps on sellerOnly and renders week labels, step dollars, single contingency, and total', () => {
  const { ExecutionPlanCard, resolveStepBudgets } = loadJsx('src/components/LeadOfferCard.jsx', {
    './Shell.jsx': ShellStub,
  });

  const base = { ...BASE_DEFAULTS, units: 10, rent: 965, vacancyPct: 7, taxes: 12000, insurance: 6000, waterMo: 1000, value: 586000, rehab: 145850, purchasePrice: 275000 };
  const offer = { structure: 'wrap', inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500, billsFromRent: true, renoFromSeller: true, renoRate: 8 } };
  const summary = offerSellerSummary(offer, base, CHARLOTTE_145850_PLAN, [], false);

  assert.deepEqual(resolveStepBudgets(summary), summary.stepBudgets);
  assert.equal(summary.stepBudgets.total, 145850);

  // Even when summary.steps exists (the old bug), sellerOnly renders the 7-step owner-approved plan.
  assert.ok(Array.isArray(summary.steps) && summary.steps.length > 0);
  const html = renderToStaticMarkup(React.createElement(ExecutionPlanCard, {
    content: { execution_steps: CHARLOTTE_7_STEPS },
    summary,
    sellerOnly: true,
  }));

  // 7 steps in order with week labels
  const markers = [
    'Week 1',
    'Secure the building first',
    'Doors, locks, cameras',
    'Same week: start the near-ready units 5, 8, 1, 2',
    'Get laundry running: at least one stacked set taking coins, tap/card and bills',
    '$50 zoning letter',
    'Week 2',
    'First tenant moves in',
    'Weeks 2-3',
    'Units 3 and 9 empty',
    'Weeks 2 onward',
    'Bigger units, then building systems',
    'As each unit finishes',
    'Inspect, lease and collect rent',
    'Within the 1-year renovation loan',
    'Your renovation loan is paid off in full.',
    'Along the way',
    'Updates on this page',
  ];
  let prev = -1;
  for (const m of markers) {
    const idx = html.indexOf(m);
    assert.ok(idx > prev, `Expected "${m}" in order after index ${prev}`);
    prev = idx;
  }

  // Live step + sub-item dollar figures + single Contingency (only if used) + Total
  assert.match(html, /\$58,350/); // week1: 10000 + 22000 + 19800 + 6550 = 58350
  assert.match(html, /\$10,000/);
  assert.match(html, /\$22,000/);
  assert.match(html, /\$19,800/);
  assert.match(html, /\$6,550/);
  assert.match(html, /\$2,500/);
  assert.match(html, /\$63,000/); // week2Onward: 52000 + 11000
  assert.match(html, /\$52,000/);
  assert.match(html, /\$11,000/);
  assert.match(html, /\$2,000/);
  assert.equal((html.match(/Contingency \(only if used\)/g) || []).length, 1);
  assert.match(html, /\$20,000/);
  assert.match(html, /Total<\/dt><dd[^>]*>\$145,850/);

  // Must NOT show summary.steps titles or banned wording/subtext
  assert.doesNotMatch(html, /Paid as units are rented|Paid back in full|refinanc|\brefi\b|weeks 0|weeks 4|safety first|<small\b|<caption\b/i);
});

test('Realtor and Switches read live plan total ($145,850) over stale base.rehab and hide refi* fields', () => {
  const { WhatIfNumbers } = loadJsx('src/components/Switches.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, money, operating, pct, valueSummary },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        offers: [],
        base: { units: 10, rent: 965, rehab: 124050, value: 586000 },
        setBase: () => {},
        reset: () => {},
        touched: false,
        original: { list: [], base: { units: 10, rent: 965, rehab: 124050, value: 586000 } },
      }),
    },
    './Messages.jsx': { sendToOwner: async () => null },
    './Shell.jsx': ShellStub,
  });

  const html = renderToStaticMarkup(React.createElement(WhatIfNumbers, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { email: 'realtor@example.com' },
    role: 'realtor',
    preview: false,
    planRepairBudget: 145850,
  }));
  assert.match(html, /\$145,850/);
  assert.doesNotMatch(html, /\$124,050/);

  const switchesSrc = read('src/components/Switches.jsx');
  assert.match(switchesSrc, /!String\(k\)\.startsWith\('refi'\)/);

  const realtorSrc = read('src/views/Realtor.jsx');
  assert.match(realtorSrc, /planRepairBudget=\{planRepairBudget\}/);
  assert.match(realtorSrc, /planTotal > 0 \? money\(planTotal\)/);
});

test('Lender and Owner read $145,850 from the single source', () => {
  const base = { ...BASE_DEFAULTS, units: 10, rent: 965, rehab: 124050, bridgeRepairs: 140000, value: 586000, purchasePrice: 275000 };
  const offer = { structure: 'wrap', inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500 } };
  const guide = buildLeadGuide(base, CHARLOTTE_145850_PLAN, offer);
  const pkg = buildLenderPackage({ base, offer, guide, lens: 'bridge' });
  const cs = buildCostSummary(base, CHARLOTTE_145850_PLAN);
  assert.equal(overallRepairBudget(CHARLOTTE_145850_PLAN), 145850);
  assert.equal(cs.total, 145850);
  assert.equal(guide.costSummary.total, 145850);
  assert.equal(guide.bridge.repairs, 145850);
  assert.equal(guide.rentValue.repairs, 145850);
  assert.equal(pkg.repairs, 145850);
});

test('migration 0034_seller_plan_rebuild.sql wires plan_step_budgets, RPCs, 7-step plan, and syncs models/offers safely', () => {
  const sql = read('supabase/migrations/0034_seller_plan_rebuild.sql');
  assert.match(sql, /create or replace function commercial_access_private\.plan_step_budgets/);
  assert.match(sql, /create or replace function commercial_access_private\.get_seller_offer/);
  assert.match(sql, /'stepBudgets'/);
  assert.match(sql, /create or replace function commercial_access_private\.get_lead_guide/);
  assert.match(sql, /Secure the building first/);
  assert.match(sql, /First tenant moves in/);
  assert.match(sql, /Units 3 and 9 empty/);
  assert.match(sql, /Bigger units, then building systems/);
  assert.match(sql, /Inspect, lease and collect rent/);
  assert.match(sql, /Your renovation loan is paid off in full\./);
  assert.match(sql, /Updates on this page/);
  assert.match(sql, /\$50 zoning letter/);
  assert.match(sql, /update public\.commercial_models/);
  assert.match(sql, /update public\.commercial_offers/);
  assert.doesNotMatch(sql, /service_role|sb_secret_/i);
});
