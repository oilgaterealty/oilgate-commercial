// Charlotte operating costs (single-source opex) + Private returns + cross-role consistency tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

import {
  BASE_DEFAULTS,
  BASE_FIELDS,
  STRUCTURES,
  evaluate,
  money,
  moneyCents,
  operating,
  pct,
  syncOpexOverride,
  valueSummary,
} from '../src/lib/dealmath.js';
import { computeOpex } from '../src/lib/opex.js';
import { buildLeadGuide, overallRepairBudget } from '../src/lib/dealplan.js';
import { defaultMarketRent, effectiveMarketRange, rangeSummary, rangeValue, whatIfGrid, whatIfViews } from '../src/lib/rangeValue.js';
import { LENDER_LENSES, buildFallbackRentValue, buildLenderPackage, computePrivateReturn, parseLenderProtections } from '../src/lib/lenderModel.js';

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

const CHARLOTTE_OPEX = {
  taxesAnnual: 13544,
  insuranceAnnual: 6500,
  waterSewerTrashAnnual: 12000,
  heatGasAnnual: 0,
  reservesPerUnitAnnual: 450,
  vacancyPct: 5,
  repairsMaintPct: 8,
  mgmtHelpPct: 0.5,
  wifiAnnual: 840,
  camerasAnnual: 200,
  rentalRegPerUnitAnnual: 15,
  snowLawnAnnual: 3000,
  capRate: 9,
  sources: {
    taxes: '2025 county bill',
    insurance: 'Estimate',
    waterSewerTrash: 'Trash is billed with water; second dumpster = $0',
    heatGas: 'Tenants pay their own',
    reserves: '$450/unit/yr (is CapEx line)',
    vacancy: '5% of gross rent',
    repairsMaint: '8% of gross rent',
    mgmtHelp: '0.5% of gross rent (no management fee)',
    wifi: '$70/mo for smart locks',
    cameras: 'Wyze Cam Unlimited Pro',
    rentalReg: '$15/unit/yr ($150/yr)',
    snowLawn: 'Annual allowance',
  },
};

const CHARLOTTE_PLAN = {
  sellerLoanBalance: 275000,
  bridgeRate: 10,
  bridgePoints: 1,
  bridgeProcessing: 1295,
  bridgeClosing: 5500,
  bridgeDeferredMonths: 2,
  bridgeTermMonths: 12,
  privateRate: 8,
  privateTermMonths: 12,
  privateMinParticipation: 20000,
  marketRent: { low: 780, high: 1115 },
  contingency: 15000,
  units: [
    { id: '1', rehab: 10000, ready: 1, rentToday: 0, marketRent: 1000 },
    { id: '2', rehab: 10000, ready: 1, rentToday: 0, marketRent: 1000 },
    { id: '3', rehab: 12000, ready: 2, rentToday: 0, marketRent: 1000 },
    { id: '4', rehab: 12000, ready: 2, rentToday: 0, marketRent: 1000 },
    { id: '5', rehab: 10000, ready: 1, rentToday: 0, marketRent: 1000 },
    { id: '6', rehab: 12000, ready: 3, rentToday: 0, marketRent: 1000 },
    { id: '7', rehab: 12000, ready: 3, rentToday: 0, marketRent: 1000 },
    { id: '8', rehab: 10000, ready: 1, rentToday: 0, marketRent: 1000 },
    { id: '9', rehab: 12850, ready: 4, rentToday: 0, marketRent: 1000 },
    { id: '10', rehab: 15000, ready: 5, rentToday: 0, marketRent: 1000, optional: true },
  ],
  costs: [
    { label: 'Smart locks & security', cost: 5000, start: 0, end: 1, group: 'security' },
    { label: 'Laundry & building', cost: 10000, start: 0, end: 2, group: 'building' },
  ],
  opex: CHARLOTTE_OPEX,
};

const CHARLOTTE_BASE = {
  ...BASE_DEFAULTS,
  units: 10,
  rent: 1000,
  askPrice: 350000,
  ourOffer: 275000,
  rehab: overallRepairBudget(CHARLOTTE_PLAN),
  value: 806000,
  vacancyPct: 5,
  taxes: 13544,
  insurance: 6500,
  waterMo: 1000,
  reservesPerUnit: 450,
  mgmtPct: 0,
  valueCapRate: 9,
  marketRentLow: 780,
  marketRentHigh: 1115,
  refiLtv: 75,
  refiRate: 7.5,
  refiYears: 30,
  refiDscr: 1.25,
  refiFeesPct: 2.5,
  refiFeesFlat: 3500,
  refiReserve: 15773,
  opex: CHARLOTTE_OPEX,
};

const SHELL_STUB = {
  Card: ({ children, className = '', ...p }) => React.createElement('section', { className, ...p }, children),
  CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside || null),
  Button: ({ children, kind: _k, ...p }) => React.createElement('button', p, children),
  Badge: ({ children }) => React.createElement('span', null, children),
  Empty: ({ children }) => React.createElement('div', null, children),
  JumpNav: () => React.createElement('nav', null),
  InfoTip: () => null,
  OverlayTrigger: ({ children, lines, className }) => React.createElement(
    'span',
    { className, 'data-overlay': JSON.stringify(lines || []) },
    children,
  ),
  useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
};

test('computeOpex matches Brief 1 formula at $8,853.60/mo (~$51,166 NOI / ~$568,500 value) and $1,000/unit ($63,066 / $700,733)', () => {
  assert.equal(overallRepairBudget(CHARLOTTE_PLAN), 145850);

  // Exact check at $8,853.60/mo ($885.36/unit)
  const atBriefRent = computeOpex({ opex: CHARLOTTE_OPEX, units: 10, grossRentMonthly: 8853.60 });
  assert.equal(Math.round(atBriefRent.noiAnnual), 51166);
  assert.equal(Math.round(atBriefRent.value / 100) * 100, 568500);
  assert.equal(atBriefRent.taxesAnnual, 13544);
  assert.equal(atBriefRent.insuranceAnnual, 6500);
  assert.equal(atBriefRent.waterSewerTrashAnnual, 12000);
  assert.equal(atBriefRent.heatGasAnnual, 0);
  assert.equal(atBriefRent.reservesAnnual, 4500);
  assert.equal(atBriefRent.wifiAnnual, 840);
  assert.equal(atBriefRent.camerasAnnual, 200);
  assert.equal(atBriefRent.rentalRegAnnual, 150);
  assert.equal(atBriefRent.snowLawnAnnual, 3000);

  // Confirm NO management fee and NO separate 8% CapEx line (Reserves IS the CapEx line)
  const labels = atBriefRent.lines.map((l) => l.label);
  assert.ok(!labels.some((l) => /management fee/i.test(l)));
  assert.ok(!labels.some((l) => /^capex\b|8%.*capex/i.test(l)));
  assert.equal(labels.filter((l) => /reserves|capex/i.test(l)).length, 1);
  assert.ok(labels.some((l) => /reserves/i.test(l)));
  assert.ok(labels.some((l) => /management help/i.test(l)));

  // Check $1,000/unit ($10,000/mo)
  const at1000 = computeOpex({ opex: CHARLOTTE_OPEX, units: 10, grossRentMonthly: 10000 });
  assert.equal(Math.round(at1000.noiAnnual), 63066);
  assert.equal(Math.round(at1000.value), 700733);
  assert.equal(Math.round(at1000.totalExpensesMonthly), 4245);

  // Check RentValue midpoint $948/unit ($9,480/mo)
  const at948 = computeOpex({ opex: CHARLOTTE_OPEX, units: 10, grossRentMonthly: 9480 });
  assert.equal(Math.round(at948.noiAnnual), 57668);
  assert.equal(Math.round(at948.value), 640760);

  // Check As-is (0 rented units): fixed $36,234/yr, 0 reserves (only rented units take reserves)
  const asIs = computeOpex({ opex: CHARLOTTE_OPEX, units: 10, rentedUnits: 0, grossRentMonthly: 0, applyVacancy: false });
  assert.equal(Math.round(asIs.noiAnnual), -36234);
  assert.equal(asIs.value, 0);
});

test('all dealmath / dealplan / rangeValue / lenderModel derivations read from single opex block and remove stale whiteboard values', () => {
  const op = operating(CHARLOTTE_BASE);
  assert.equal(Math.round(op.noi), 63066);
  assert.equal(Math.round(op.opexCalc.totalExpensesMonthly), 4245);
  assert.equal(Math.round(op.reserves), 4500);

  const val = valueSummary({ base: CHARLOTTE_BASE, noi: op.noi, units: 10 });
  assert.equal(Math.round(val.income), 700733);

  // buildLeadGuide computes refi, rentValue views, and range midpoint from single opex block
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, { structure: 'cash', inputs: { price: 275000 } });
  assert.equal(Math.round(guide.refi.dscrNoiAnnual), 63066);
  assert.equal(Math.round(guide.refi.estimatedValue), 700733);

  const asIsView = guide.rentValue.views.find((v) => v.key === 'asis');
  const afterView = guide.rentValue.views.find((v) => v.key === 'after');
  assert.equal(asIsView.allIn, 275000);
  assert.equal(Math.round(asIsView.netYr), -36234);
  assert.equal(afterView.allIn, 420850);
  assert.equal(Math.round(afterView.netYr), 63066);
  assert.equal(Math.round(afterView.value), 700733);

  const midSummary = rangeSummary(guide.rentValue.marketRange, 948);
  assert.equal(Math.round(midSummary.netYr), 57668);
  assert.equal(Math.round(midSummary.value), 640760);
  assert.equal(guide.rentValue.allIn, 420850);

  // Stale whiteboard figures must NEVER appear anywhere
  const serialized = JSON.stringify(guide);
  for (const stale of ['774436', '774,436', '399050', '399,050', '69699', '69,699', '3045', '3,045']) {
    assert.ok(!serialized.includes(stale), `Found stale figure ${stale} in lead guide`);
  }

  // Fallback rentValue for lenderModel must match buildLeadGuide rentValue
  const fb = buildFallbackRentValue(CHARLOTTE_BASE, { purchase: 275000, repairs: 145850 });
  assert.equal(fb.allIn, 420850);
  const fbMid = rangeSummary(fb.marketRange, 948);
  assert.equal(Math.round(fbMid.netYr), 57668);
  assert.equal(Math.round(fbMid.value), 640760);

  // DSCR Lender package uses opex NOI and opex value
  const dscrPkg = buildLenderPackage({
    base: CHARLOTTE_BASE,
    offer: { structure: 'cash', inputs: {}, seller_summary: { guide } },
    guide,
    lens: 'dscr',
  });
  assert.equal(Math.round(dscrPkg.value), 700733);
  assert.equal(Math.round(dscrPkg.refiCheck.dscrNoiAnnual), 63066);
  assert.equal(Math.round(dscrPkg.refiCheck.newLoan), Math.round(700733 * 0.75));
});

test('RentValue component uses opex math, All in $420,850, zero subtext, and puts sources inside overlays only', () => {
  const RentValueMod = loadJsx('src/components/RentValue.jsx', {
    './Shell.jsx': SHELL_STUB,
    '../lib/dealmath.js': { money, moneyK: (v) => `$${Math.round(v / 1000)}K` },
    '../lib/rangeValue.js': { defaultMarketRent, rangeSummary, rangeValue, whatIfViews, whatIfGrid },
  });
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, { structure: 'cash', inputs: { price: 275000 } });
  const html = renderToStaticMarkup(React.createElement(RentValueMod.default, { data: guide.rentValue, showMarket: true }));

  assert.doesNotMatch(html, /<p\b|<small\b|<caption\b/i);
  assert.doesNotMatch(html, /\$774,436|\$399,050|\$3,045|\$69,699/);
  assert.match(html, /\$420,850/);
  assert.match(html, /\$640,760/);
  assert.match(html, /\$57,668/);

  // Sources live ONLY inside data-overlay attributes, never outside tags as visible text
  const strippedOverlays = html.replace(/data-overlay="[^"]*"/g, '');
  assert.doesNotMatch(strippedOverlays, /2025 county bill|Wyze Cam Unlimited Pro|second dumpster/i);
  assert.match(html, /2025 county bill/);
  assert.match(html, /Wyze Cam Unlimited Pro/);
});

test('Lender, Realtor WhatIfNumbers, and Owner Dashboard render consistent opex values and zero surplus/gap lines', () => {
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, { structure: 'cash', inputs: { price: 275000 } });
  const noopQuery = {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        maybeSingle: async () => ({ data: null }),
        then: () => {},
      }),
    }),
  };

  const RentValueMod = loadJsx('src/components/RentValue.jsx', {
    './Shell.jsx': SHELL_STUB,
    '../lib/dealmath.js': { money, moneyK: (v) => `$${Math.round(v / 1000)}K` },
    '../lib/rangeValue.js': { defaultMarketRent, rangeSummary, rangeValue, whatIfViews, whatIfGrid },
  });
  const CostSummaryMod = loadJsx('src/components/CostSummary.jsx', { './Shell.jsx': SHELL_STUB });
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
        offers: [{ id: 'o1', structure: 'cash', inputs: {}, is_lead: true, seller_summary: { guide } }],
        base: CHARLOTTE_BASE,
        error: '',
      }),
    },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], FileList: () => null },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [] },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../components/CostSummary.jsx': CostSummaryMod,
    '../components/UnitsRentedGuide.jsx': { isUnitsGuide: (g) => Boolean(g && Array.isArray(g.rows) && g.rows.length > 0 && g.refi) },
    '../components/RentValue.jsx': RentValueMod,
    '../components/LenderWhatIf.jsx': LenderWhatIfMod,
    '../components/Shell.jsx': SHELL_STUB,
    '../components/Messages.jsx': { __esModule: true, default: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    './LenderTerms.jsx': LenderTermsMod,
    './CityRecords.jsx': { __esModule: true, default: () => null },
  });

  // Render all 3 lender lenses and verify opex alignment & zero surplus/gap lines
  for (const lens of ['bridge', 'private', 'dscr']) {
    const html = renderToStaticMarkup(React.createElement(LenderMod.default, {
      deal: { id: 'd1', slug: 'charlotte' },
      me: { uid: 'l1', email: 'lender@example.com' },
      preview: false,
      initialLens: lens,
    }));
    assert.doesNotMatch(html, /Surplus at refinance|Left over at refinance|Gap at refinance/i, `Found surplus/gap in ${lens}`);
    assert.doesNotMatch(html, /\$774,436|\$399,050|\$3,045|\$69,699/, `Found stale opex figure in ${lens}`);
    if (lens === 'dscr') {
      assert.match(html, /\$700,733/);
      assert.match(html, /Pays off bridge/);
    }
    if (lens === 'private') {
      assert.match(html, /Your return/);
      assert.match(html, /type="range"[^>]*min="20000"[^>]*step="5000"/);
      assert.match(html, /\$133\.33\/mo/);
      assert.match(html, /Per year at 8%/);
      assert.match(html, /\$1,600\/yr/);
      assert.match(html, /First payment after month 1/);
      assert.match(html, /No prepayment penalty/);
      assert.match(html, /Principal back at payoff/);
      assert.doesNotMatch(html, /defer|month 3|points/i);
    }
  }

  // Check Realtor WhatIfNumbers renders opex NOI ($63,066) and opex Value ($700,733)
  const SwitchesMod = loadJsx('src/components/Switches.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, money, operating, pct, syncOpexOverride, valueSummary },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        base: CHARLOTTE_BASE,
        original: { base: CHARLOTTE_BASE },
        setBase: () => {},
        touched: false,
      }),
    },
    './Messages.jsx': { sendToOwner: async () => null },
    './Shell.jsx': SHELL_STUB,
  });
  const realtorHtml = renderToStaticMarkup(React.createElement(SwitchesMod.WhatIfNumbers, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'r1', role: 'realtor' },
    role: 'realtor',
    preview: false,
    planRepairBudget: 145850,
  }));
  assert.match(realtorHtml, /\$63,066/);
  assert.match(realtorHtml, /\$700,733/);
  assert.doesNotMatch(realtorHtml, /\$806,000|\$75,056|\$69,699/);

  // Check Owner Dashboard renders opex Value ($700,733), NOT stale $806,000
  const DashboardMod = loadJsx('src/views/Dashboard.jsx', {
    '../lib/dealmath.js': { evaluate, money, valueSummary },
    '../lib/supabase.js': { supabase: { from: () => noopQuery } },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        offers: [{ id: 'o1', structure: 'cash', inputs: {}, is_lead: true }],
        base: CHARLOTTE_BASE,
        setBase: () => {},
        error: '',
      }),
    },
    '../components/Shell.jsx': SHELL_STUB,
    '../components/Files.jsx': { useUploads: () => [[], () => {}] },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [] },
    '../components/DealWorkspace.jsx': { WorkBoard: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    '../components/Pulse.jsx': { SellerPulse: () => null },
  });
  const ownerHtml = renderToStaticMarkup(React.createElement(DashboardMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'o1', role: 'owner' },
    role: 'owner',
    preview: false,
  }));
  assert.match(ownerHtml, /\$700,733/);
  assert.doesNotMatch(ownerHtml, /\$806,000/);
});

test('computePrivateReturn scales dynamically with custom rate and minParticipation', () => {
  assert.equal(computePrivateReturn(20000, 8).monthly.toFixed(2), '133.33');
  assert.equal(computePrivateReturn(20000, 8).perYearAtRate, 1600);
  assert.equal(computePrivateReturn(25000, 9).monthly, 187.5);
  assert.equal(computePrivateReturn(25000, 9).perYearAtRate, 2250);
  const customPkg = buildLenderPackage({
    base: { ...CHARLOTTE_BASE, privateMinParticipation: 25000, privateRate: 9 },
    offer: { structure: 'cash', inputs: {} },
    lens: 'private',
  });
  assert.equal(customPkg.minParticipation, 25000);
  assert.equal(customPkg.privatePool.ratePct, 9);
  assert.equal(customPkg.privatePool.minMonthlyReturn, 187.5);
});

test('migration 0035_charlotte_opex.sql and Seller isolation constraints hold', () => {
  const sql = read('supabase/migrations/0035_charlotte_opex.sql');
  for (const req of ['taxesAnnual', '13544', '6500', '12000', '450', '840', '200', '15', '3000', 'compute_opex_view']) {
    assert.ok(sql.includes(req), `Migration missing ${req}`);
  }
  const sellerSrc = read('src/views/Seller.jsx');
  assert.doesNotMatch(sellerSrc, /opex|privatePool|surplusAtRefi|Your return/i);
  assert.doesNotMatch(sql + sellerSrc, /pg-j6kkmlhqpl|im1iad33ebun/i);
});
