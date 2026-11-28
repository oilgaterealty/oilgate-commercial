import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

import * as opexLib from '../src/lib/opex.js';
import {
  DEFAULT_LAUNDRY,
  computeLaundry,
  computeOpex,
  normalizeLaundry,
  normalizeOpex,
} from '../src/lib/opex.js';
import { evaluate, money, moneyCents, operating, valueSummary } from '../src/lib/dealmath.js';
import {
  buildCostSummary,
  buildLeadGuide,
  offerSellerSummary,
  overallRepairBudget,
  planLaundryItems,
  planStepBudgets,
} from '../src/lib/dealplan.js';
import {
  defaultMarketRent,
  effectiveMarketRange,
  operatingBreakdownFor,
  rangeSummary,
  rangeValue,
  whatIfGrid,
  whatIfViews,
} from '../src/lib/rangeValue.js';
import {
  LENDER_LENSES,
  buildFallbackRentValue,
  buildLenderPackage,
  computePrivateReturn,
  parseLenderProtections,
} from '../src/lib/lenderModel.js';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, pct, syncOpexOverride } from '../src/lib/dealmath.js';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadJsx(rel, mocks = {}) {
  const src = read(rel);
  const { code } = esbuild.transformSync(src, {
    loader: rel.endsWith('.jsx') ? 'jsx' : 'js',
    format: 'cjs',
    jsx: 'automatic',
    sourcefile: rel,
  });
  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', code);
  fn((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return JsxRuntime;
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    throw new Error(`Unexpected import ${id} in ${rel}`);
  }, mod, mod.exports);
  return mod.exports;
}

const CHARLOTTE_OPEX = {
  taxesAnnual: 13544,
  insuranceAnnual: 6500,
  waterSewerTrashAnnual: 12000,
  commonAreaUtilitiesAnnual: 1800,
  reservesPerUnitAnnual: 450,
  vacancyPct: 5,
  repairsMaintPct: 8,
  mgmtHelpPct: 0,
  mgmtHelpAnnual: 1200,
  wifiAnnual: 840,
  camerasAnnual: 200,
  rentalRegPerUnitAnnual: 15,
  snowLawnAnnual: 3000,
  sources: {
    taxes: '2025 county bill',
    waterSewerTrash: 'Trash is billed with water; second dumpster = $0',
    commonAreaUtilities: 'Estimate until house-meter bills are read; tenants pay their own unit heat; laundry gas/electric counted per load.',
    reserves: 'CapEx / replacement reserves ($450/unit/yr; no separate 8% CapEx)',
    vacancy: '5% of rent',
    repairsMaint: '8% of rent',
    mgmtHelp: 'Flat $100/mo ($1,200/yr) — owner assumption',
    wifi: '$70/mo for smart locks',
    cameras: 'Wyze Cam Unlimited Pro',
    rentalReg: 'City of Akron ($15/unit/yr)',
    snowLawn: 'Snow and lawn',
  },
};

const CHARLOTTE_LAUNDRY = {
  ...DEFAULT_LAUNDRY,
  enabled: true,
  sources: {
    revenue: '$4/load × 3 loads/unit/week × 52 wks (owner benchmark)',
    utilities: '$0.45/load water/gas/electric',
    fees: '4% card processing on 60% card share + $40/mo KioSoft software',
    repairs: '$250/stack/yr allowance',
  },
};

const LAUNDRY_COSTS = [
  { start: 3, end: 8, cost: 10154, group: 'laundry', label: 'Two Speed Queen stacked washer/dryer units (deliver, install, 5-yr parts/labor)', source: 'Speed Queen Commercial Laundry proposal' },
  { start: 3, end: 8, cost: 1676, group: 'laundry', label: 'KioSoft Ultra V2 card readers (2) + Ethernet hub + kiosk setup', source: 'KioSoft Commercial Laundry proposal' },
  { start: 3, end: 8, cost: 2560, group: 'laundry', label: '240V electrical drops, plumbing tie-ins, 4-inch galvanized venting', source: 'Allowance; confirm with contractor walk' },
  { start: 3, end: 8, cost: 2000, group: 'laundry', label: 'Cleanout, epoxy floor, LED light, folding table in basement laundry room', source: 'Allowance; confirm with contractor walk' },
];

const CHARLOTTE_PLAN = {
  units: [
    { id: '1', rehab: 2000, ready: 3, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '2', rehab: 2000, ready: 3, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '3', rehab: 12000, ready: 14, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '4', rehab: 30000, ready: 22, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '5', rehab: 1000, ready: 2, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '6', rehab: 3000, ready: 12, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '7', rehab: 5000, ready: 10, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '8', rehab: 2000, ready: 2, occupied: false, rent: null, rentToday: null, marketRent: null },
    { id: '9', rehab: 5000, ready: 8, occupied: true, rent: null, rentToday: 0, marketRent: null },
    { id: '10', rehab: 12000, ready: 14, occupied: false, rent: null, rentToday: null, marketRent: null, optional: true },
  ],
  costs: [
    { start: 0, end: 3, cost: 4500, group: 'diligence', label: 'Diligence: title, inspections, records' },
    { start: 3, end: 8, cost: 13500, group: 'security', label: 'Security: locks, cameras, doors' },
    { start: 3, end: 3, cost: 300, group: 'permits', label: 'Rental registration and zoning certificate' },
    { start: 3, end: 9, cost: 2750, group: 'eviction', label: 'Unit 3 removal through court' },
    { start: 4, end: 8, cost: 3000, group: 'systems', label: 'Common areas' },
    { start: 12, end: 16, cost: 5000, group: 'systems', label: 'Exterior' },
    { start: 0, end: 1, cost: 2000, group: 'systems', label: 'Gas check and furnace service' },
    { start: 6, end: 26, cost: 1000, group: 'leaseup', label: 'Lease-up: listings, showings, inspections' },
    ...LAUNDRY_COSTS,
  ],
  contingency: 20000,
  sellerLoanBalance: 275000,
  sellerLoanRate: 6.5,
  sellerLoanYears: 25,
  lenderRate: 11,
  lenderPoints: 2.5,
  marketRent: { low: 780, high: 1115 },
  opex: CHARLOTTE_OPEX,
  laundry: CHARLOTTE_LAUNDRY,
};

const CHARLOTTE_BASE = {
  units: 10,
  rent: 1000,
  rehab: 142440,
  ourOffer: 275000,
  askPrice: 600000,
  vacancyPct: 5,
  taxes: 13544,
  insurance: 6500,
  waterMo: 1000,
  utilities: 12000,
  reservesPerUnit: 450,
  mgmtPct: 0,
  valueCapRate: 9,
  valueBasis: 'income',
  marketRentLow: 780,
  marketRentHigh: 1115,
  refiRate: 7.5,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.15,
  refiFeesPct: 2.5,
  refiFeesFlat: 3500,
  refiReserve: 15773,
  opex: CHARLOTTE_OPEX,
  laundry: CHARLOTTE_LAUNDRY,
};

const CHARLOTTE_OFFER = {
  id: 'o1',
  structure: 'wrap',
  is_lead: true,
  share_reviewer: true,
  share_lender: true,
  share_realtor: true,
  inputs: {
    note: 275000,
    rate: 6.5,
    closing: 5500,
    renoRate: 8,
    buyerCash: 0,
    amortYears: 25,
    shortCarry: 0,
    billsFromRent: true,
    renoFromSeller: true,
    sellerLoanPayment: 0,
  },
};

const EXECUTION_STEPS = [
  {
    key: 'week1_secure_and_start',
    week: 'Week 1',
    title: 'Secure the building first',
    budgetKey: 'week1',
    items: [
      { text: 'Doors, locks, cameras', budgetKey: 'security' },
      { text: 'Same week: start the near-ready units 5, 8, 1, 2', budgetKey: 'nearReadyUnits' },
      { text: 'Get laundry running: 2 stacked sets taking coins, tap/card and bills', budgetKey: 'laundry' },
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

const SHELL_STUB = {
  Card: ({ children, ...rest }) => React.createElement('div', rest, children),
  CardTitle: ({ children, aside }) => React.createElement('h3', null, children, aside),
  Button: ({ children, ...props }) => React.createElement('button', props, children),
  Empty: ({ children }) => React.createElement('div', null, children),
  Eyebrow: ({ children }) => React.createElement('div', null, children),
  Stat: ({ label, value }) => React.createElement('div', null, label, ': ', value),
  OverlayTrigger: ({ children, lines }) => React.createElement('span', { 'data-overlay': JSON.stringify(lines || []) }, children),
  RoleHeader: () => null,
  DealTabs: () => null,
  JumpNav: () => null,
  PrintBar: () => null,
  useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
};

test('Part A: 2-stack Speed Queen budget totals $142,440 with 4 laundry items and 1 gas line', () => {
  assert.equal(overallRepairBudget(CHARLOTTE_PLAN), 142440);
  const budgets = planStepBudgets(CHARLOTTE_PLAN);
  assert.equal(budgets.laundry, 16390);
  assert.equal(budgets.total, 142440);
  assert.equal(budgets.contingency, 20000);
  assert.equal(budgets.week1, 43690);

  const laundryItems = planLaundryItems(CHARLOTTE_PLAN);
  assert.equal(laundryItems.length, 4);
  assert.deepEqual(
    laundryItems.map((i) => i.cost),
    [10154, 1676, 2560, 2000]
  );

  const gasLines = CHARLOTTE_PLAN.costs.filter((c) => /gas check/i.test(c.label));
  assert.equal(gasLines.length, 1);
  assert.equal(gasLines[0].cost, 2000);

  const cs = buildCostSummary(CHARLOTTE_BASE, CHARLOTTE_PLAN);
  assert.equal(cs.total, 142440);
  assert.equal(cs.rehabTotal, 122440);
  assert.equal(cs.lines.filter((l) => /^laundry-/.test(l.key)).length, 4);
  assert.ok(cs.lines.every((l) => l.key !== 'laundry'));
});

test('Part B & Part G: laundry math ($4,408/yr net) and flat $1,200/yr mgmt help flow into NOI and 9% cap value', () => {
  const calc = computeLaundry(CHARLOTTE_LAUNDRY, 10);
  assert.equal(calc.loads, 1560);
  assert.equal(calc.grossAnnual, 6240);
  assert.equal(calc.utilityAnnual, 702);
  assert.equal(Math.round(calc.cardFeeAnnual * 100) / 100, 149.76);
  assert.equal(calc.readerFeesAnnual, 480);
  assert.equal(calc.repairsAnnual, 500);
  assert.equal(Math.round(calc.costsAnnual * 100) / 100, 1831.76);
  assert.equal(Math.round(calc.netAnnual * 100) / 100, 4408.24);
  assert.equal(Math.round(calc.netAnnual), 4408);

  // Disabled or half occupancy behavior
  assert.equal(computeLaundry({ ...CHARLOTTE_LAUNDRY, enabled: false }, 10).netAnnual, 0);
  const half = computeLaundry(CHARLOTTE_LAUNDRY, 5);
  assert.equal(half.loads, 780);
  assert.ok(half.netAnnual < calc.netAnnual);

  // Opex without vs with laundry: exact NOI lift = laundryNetAnnual and value lift = laundryNetAnnual / 0.09
  const noLaundryOpex = computeOpex({ opex: CHARLOTTE_OPEX, units: 10, rentedUnits: 10, grossRentMonthly: 10000, applyVacancy: true, capRate: 9 });
  const withLaundryOpex = computeOpex({ opex: CHARLOTTE_OPEX, laundry: CHARLOTTE_LAUNDRY, units: 10, rentedUnits: 10, grossRentMonthly: 10000, applyVacancy: true, capRate: 9 });
  assert.equal(Math.round((withLaundryOpex.noiAnnual - noLaundryOpex.noiAnnual) * 100) / 100, 4408.24);
  assert.equal(Math.round((withLaundryOpex.value - noLaundryOpex.value) * 100) / 100, Math.round((4408.24 / 0.09) * 100) / 100);
  assert.equal(Math.round(withLaundryOpex.noiAnnual), 65074);
  assert.equal(Math.round(withLaundryOpex.value), 723047);
  assert.equal(withLaundryOpex.commonAreaUtilitiesAnnual, 1800);
  assert.ok(!withLaundryOpex.lines.some((l) => /heat \/ gas/i.test(l.label)));
  assert.ok(withLaundryOpex.lines.some((l) => l.label === 'Common-area gas & electric' && l.annual === 1800));

  // Laundry utilities stay in laundry block (water line untouched) and mgmtHelp stays flat $1,200/yr at any rent
  assert.equal(withLaundryOpex.waterSewerTrashAnnual, 12000);
  assert.equal(withLaundryOpex.mgmtHelpAnnual, 1200);
  const at780 = computeOpex({ opex: CHARLOTTE_OPEX, laundry: CHARLOTTE_LAUNDRY, units: 10, rentedUnits: 10, grossRentMonthly: 7800, applyVacancy: true, capRate: 9 });
  const at1115 = computeOpex({ opex: CHARLOTTE_OPEX, laundry: CHARLOTTE_LAUNDRY, units: 10, rentedUnits: 10, grossRentMonthly: 11150, applyVacancy: true, capRate: 9 });
  assert.equal(at780.mgmtHelpAnnual, 1200);
  assert.equal(at1115.mgmtHelpAnnual, 1200);
  assert.deepEqual(normalizeLaundry({ ...CHARLOTTE_LAUNDRY }), normalizeLaundry(CHARLOTTE_LAUNDRY));
  assert.equal(normalizeOpex(CHARLOTTE_OPEX).mgmtHelpAnnual, 1200);
});

test('Part E & G: unified $1,000/unit rent aligns DSCR, RentValue, Owner, Reviewer, and Realtor values exactly', () => {
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, CHARLOTTE_OFFER);
  const rv = rangeValue(CHARLOTTE_BASE, CHARLOTTE_PLAN, {});
  const mr = effectiveMarketRange(guide.rentValue.marketRange, CHARLOTTE_BASE);
  assert.equal(defaultMarketRent(mr, guide.rentValue), 1000);

  const rsAt1000 = rangeSummary(mr, 1000);
  const opAt1000 = operating(CHARLOTTE_BASE);
  const vsAt1000 = valueSummary({ base: CHARLOTTE_BASE, noi: opAt1000.noi, units: 10 });
  const dscrPkg1000 = buildLenderPackage({ base: CHARLOTTE_BASE, guide, offer: CHARLOTTE_OFFER, lens: 'dscr' });
  const dscrPkg80 = buildLenderPackage({ base: { ...CHARLOTTE_BASE, refiLtv: 80 }, guide, offer: CHARLOTTE_OFFER, lens: 'dscr' });
  const bridgePkg1000 = buildLenderPackage({ base: CHARLOTTE_BASE, guide, offer: CHARLOTTE_OFFER, lens: 'bridge' });

  assert.equal(Math.round(rsAt1000.value), 723047);
  assert.equal(Math.round(opAt1000.opexCalc.value), 723047);
  assert.equal(Math.round(vsAt1000.income), 723047);
  assert.equal(Math.round(dscrPkg1000.value), 723047);
  assert.equal(Math.round(bridgePkg1000.value), 723047);
  assert.equal(Math.round(dscrPkg1000.refiCheck.dscrNoiAnnual), 65074);
  assert.equal(Math.round(dscrPkg1000.refiCheck.newLoan), 542285);
  assert.equal(Number(dscrPkg1000.refiCheck.actualDscr.toFixed(2)), 1.43);
  assert.equal(Math.round(dscrPkg80.refiCheck.newLoan), 578438);
  assert.equal(Number(dscrPkg80.refiCheck.actualDscr.toFixed(2)), 1.34);

  // Moving shared rent moves RentValue & DSCR together in lockstep
  const rsAt948 = rangeSummary(mr, 948);
  const dscrPkg948 = buildLenderPackage({ base: { ...CHARLOTTE_BASE, rent: 948 }, guide, offer: CHARLOTTE_OFFER, lens: 'dscr' });
  assert.equal(Math.round(dscrPkg948.value), Math.round(rsAt948.value));
  assert.equal(Math.round(dscrPkg948.refiCheck.dscrNoiAnnual), Math.round(rsAt948.netYr));
  assert.ok(dscrPkg948.refiCheck.newLoan < dscrPkg1000.refiCheck.newLoan);
});

test('Part C & F: Lender, Reviewer, Realtor, and Seller render line items, shared plan, clean terms, and seller isolation', () => {
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, CHARLOTTE_OFFER);
  const sellerSummary = offerSellerSummary(CHARLOTTE_OFFER, CHARLOTTE_BASE, CHARLOTTE_PLAN, [], true);
  assert.equal(sellerSummary.stepBudgets.total, 142440);
  assert.equal(sellerSummary.laundryItems.length, 4);

  const noopQuery = {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        maybeSingle: async () => ({ data: null }),
        then: () => {},
      }),
    }),
  };

  const CostSummaryMod = loadJsx('src/components/CostSummary.jsx', { './Shell.jsx': SHELL_STUB });
  const LeadOfferCardMod = loadJsx('src/components/LeadOfferCard.jsx', {
    './Shell.jsx': SHELL_STUB,
    '../lib/dealmath.js': { money },
  });
  const OperatingBreakdownMod = loadJsx('src/components/OperatingBreakdown.jsx', {
    './Shell.jsx': SHELL_STUB,
    '../lib/dealmath.js': { money },
    '../lib/opex.js': opexLib,
  });
  const RentValueMod = loadJsx('src/components/RentValue.jsx', {
    './Shell.jsx': SHELL_STUB,
    './OperatingBreakdown.jsx': OperatingBreakdownMod,
    '../lib/dealmath.js': { money, moneyK: (v) => `$${Math.round(v / 1000)}K` },
    '../lib/rangeValue.js': { defaultMarketRent, operatingBreakdownFor, rangeSummary, rangeValue, whatIfViews, whatIfGrid },
  });
  const LenderWhatIfMod = loadJsx('src/components/LenderWhatIf.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { money, moneyCents },
    '../lib/lenderModel.js': { buildLenderPackage, computePrivateReturn },
    './Messages.jsx': { sendToOwner: async () => null },
    './Shell.jsx': SHELL_STUB,
  });
  const DictationMod = loadJsx('src/components/Dictation.jsx', {
    '../lib/dictation.js': { MAX_RECORDING_MS: 60000 },
    '../lib/mediaCoordinator.js': { mediaCoordinator: { acquire: () => ({ ok: true }), release: () => {} } },
  });
  const LenderTermsMod = loadJsx('src/views/LenderTerms.jsx', {
    '../components/Dictation.jsx': DictationMod,
    '../lib/supabase.js': { supabase: { from: () => noopQuery } },
    '../lib/format.js': { when: () => '' },
    '../lib/v63.js': { lenderBoard: () => [] },
    '../lib/dealmath.js': { BASE_DEFAULTS, money },
    '../lib/lenderModel.js': { buildLenderPackage, LENDER_LENSES, parseLenderProtections },
    './Shell.jsx': SHELL_STUB,
    '../components/Shell.jsx': SHELL_STUB,
    '../components/Messages.jsx': { sendToOwner: async () => null },
  });
  const LenderMod = loadJsx('src/views/Lender.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/supabase.js': { supabase: { from: () => noopQuery, rpc: () => ({ then: () => {} }) } },
    '../lib/dealmath.js': { evaluate, money, moneyCents, valueSummary },
    '../lib/lenderModel.js': { buildFallbackRentValue, buildLenderPackage, computePrivateReturn, LENDER_LENSES, parseLenderProtections },
    '../lib/rangeValue.js': { effectiveMarketRange },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        offers: [{ ...CHARLOTTE_OFFER, seller_summary: { ...sellerSummary, guide } }],
        base: CHARLOTTE_BASE,
        error: '',
      }),
    },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], FileList: () => null },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [] },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../components/CostSummary.jsx': CostSummaryMod,
    '../components/LeadOfferCard.jsx': LeadOfferCardMod,
    '../components/UnitsRentedGuide.jsx': { isUnitsGuide: (g) => Boolean(g && Array.isArray(g.rows) && g.rows.length > 0 && g.refi) },
    '../components/RentValue.jsx': RentValueMod,
    '../components/LenderWhatIf.jsx': LenderWhatIfMod,
    '../components/Shell.jsx': SHELL_STUB,
    '../components/Messages.jsx': { __esModule: true, default: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    './LenderTerms.jsx': LenderTermsMod,
    './CityRecords.jsx': { __esModule: true, default: () => null },
  });

  for (const lens of ['bridge', 'private', 'dscr']) {
    const html = renderToStaticMarkup(React.createElement(LenderMod.default, {
      deal: { id: 'd1', slug: 'charlotte', seller_content: { execution_steps: EXECUTION_STEPS } },
      me: { uid: 'l1', email: 'lender@example.com' },
      preview: false,
      initialLens: lens,
    }));
    // Grouped collapsed-by-default opex, CostSummary Laundry ($16,390), ExecutionPlanCard ($142,440), and $723,047 across every lender tab
    assert.match(html, /aria-expanded="false"[^>]*data-cost-group="laundry"|data-cost-group="laundry"[^>]*aria-expanded="false"/);
    assert.match(html, />Laundry<[\s\S]*?>\$16,390</);
    assert.match(html, /\$142,440/);
    assert.match(html, /\$723,047/);
    assert.match(html, /data-wb="opex-breakdown"/);
    assert.match(html, /data-wb="laundry-income"/);
    assert.match(html, /Rent in \(after 5% vacancy\)/);
    assert.match(html, /Laundry income \(net\)/);
    assert.match(html, /Fixed costs/);
    assert.match(html, /Upkeep/);
    assert.match(html, /Operations/);
    assert.match(html, /\$4,408\/yr/);
    assert.match(html, /\$65,074\/yr/);
    assert.match(html, /Paid off in full by refinance\./);
    assert.doesNotMatch(html, /l-terms-row--total/);
    assert.doesNotMatch(html, /Your renovation loan is paid off in full\./);
    assert.doesNotMatch(html, /<p\b|<small\b|<caption\b/i);

    const noOverlay = html.replace(/data-overlay="[^"]*"/g, '');
    assert.doesNotMatch(noOverlay, /Two Speed Queen stacked washer\/dryer units|Property taxes|Common-area gas &amp; electric|Management help|Heat \/ gas/);
    assert.doesNotMatch(noOverlay, /Speed Queen Commercial Laundry proposal|2025 county bill|Estimate until house-meter/i);
  }

  // Seller plan isolation: step totals & $142,440 visible, step items collapsed on load, ZERO income/opex/lender/refi
  const sellerPlanHtml = renderToStaticMarkup(React.createElement(LeadOfferCardMod.ExecutionPlanCard, {
    content: { execution_steps: EXECUTION_STEPS },
    summary: sellerSummary,
    sellerOnly: true,
  }));
  assert.match(sellerPlanHtml, /aria-expanded="false"[^>]*data-plan-step="week1_secure_and_start"|data-plan-step="week1_secure_and_start"[^>]*aria-expanded="false"/);
  assert.match(sellerPlanHtml, /\$43,690/);
  assert.doesNotMatch(sellerPlanHtml, /Two Speed Queen stacked washer\/dryer units/);
  assert.match(sellerPlanHtml, /\$142,440/);
  assert.match(sellerPlanHtml, /Your renovation loan is paid off in full\./);
  assert.doesNotMatch(sellerPlanHtml, /\$6,240|\$4,408|1,560 loads|NOI|723,047|743,047|DSCR|refinance/i);

  // Realtor WhatIfNumbers shows $723,047 & $65,074 & grouped collapsed opex/laundry breakdown
  const SwitchesMod = loadJsx('src/components/Switches.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, money, operating, pct, syncOpexOverride, valueSummary },
    '../lib/rangeValue.js': { operatingBreakdownFor },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        base: CHARLOTTE_BASE,
        original: { base: CHARLOTTE_BASE },
        setBase: () => {},
        touched: false,
      }),
    },
    './Messages.jsx': { sendToOwner: async () => null },
    './OperatingBreakdown.jsx': OperatingBreakdownMod,
    './Shell.jsx': SHELL_STUB,
  });
  const realtorHtml = renderToStaticMarkup(React.createElement(SwitchesMod.WhatIfNumbers, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'r1', role: 'realtor' },
    role: 'realtor',
    preview: false,
    planRepairBudget: 142440,
  }));
  assert.match(realtorHtml, /\$723,047/);
  assert.match(realtorHtml, /\$65,074/);
  assert.match(realtorHtml, /data-wb="opex-breakdown"/);
  assert.match(realtorHtml, /data-wb="laundry-income"/);
  assert.match(realtorHtml, /Fixed costs/);
  assert.doesNotMatch(realtorHtml, /Property taxes|Heat \/ gas/);
});

test('migration 0036_charlotte_laundry_unified_rent.sql has Part A/B/C/G updates and zero leaks', () => {
  const sql = read('supabase/migrations/0036_charlotte_laundry_unified_rent.sql');
  for (const req of [
    'plan_laundry_items',
    'plan_laundry',
    'compute_opex_view',
    'mgmtHelpAnnual',
    '1200',
    '10154',
    '1676',
    '2560',
    '2000',
    '142440',
    'apply_opex_to_guide',
    'Two Speed Queen stacked washer/dryer units',
  ]) {
    assert.ok(sql.includes(req), `Migration 0036 missing ${req}`);
  }
  assert.doesNotMatch(sql, /\bto anon\b/i);
  assert.doesNotMatch(sql, /pg-j6kkmlhqpl|im1iad33ebun/i);
});
