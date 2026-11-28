import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

import * as opexLib from '../src/lib/opex.js';
import { computeOpex, groupOpexCalc } from '../src/lib/opex.js';
import {
  BASE_DEFAULTS,
  BASE_FIELDS,
  STRUCTURES,
  applyGuideRefi,
  buildLeadStory,
  evaluate,
  money,
  moneyCents,
  operating,
  pct,
  sharedRefiStory,
  syncOpexOverride,
  valueSummary,
} from '../src/lib/dealmath.js';
import { buildCostSummary, buildLeadGuide, offerSellerSummary } from '../src/lib/dealplan.js';
import { defaultMarketRent, effectiveMarketRange, operatingBreakdownFor, rangeSummary, rangeValue, whatIfGrid, whatIfViews } from '../src/lib/rangeValue.js';
import { LENDER_LENSES, buildFallbackRentValue, buildLenderPackage, computePrivateReturn, computeTermsOutcome, parseLenderProtections } from '../src/lib/lenderModel.js';
import { plain } from '../src/lib/plain.js';
import { breakEvenCount } from '../src/lib/occupancy.js';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadJsx(rel, mocks = {}) {
  const src = read(rel).replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
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
  enabled: true,
  stacks: 2,
  pricePerLoad: 4,
  loadsPerUnitPerWeek: 3,
  utilityPerLoad: 0.45,
  cardSharePct: 60,
  cardFeePct: 4,
  readerFeesAnnual: 480,
  repairsPerStackAnnual: 250,
  sources: {
    revenue: '$4/load × 3 loads/unit/week × 52 wks (owner benchmark)',
    utilities: '$0.45/load water/gas/electric',
    fees: '4% card processing on 60% card share + $40/mo KioSoft software',
    repairs: '$250/stack/yr allowance',
  },
};

const CHARLOTTE_PLAN = {
  units: [
    { id: '1', rehab: 2000, ready: 3, occupied: false },
    { id: '2', rehab: 2000, ready: 3, occupied: false },
    { id: '3', rehab: 12000, ready: 14, occupied: false },
    { id: '4', rehab: 30000, ready: 22, occupied: false },
    { id: '5', rehab: 1000, ready: 2, occupied: false },
    { id: '6', rehab: 3000, ready: 12, occupied: false },
    { id: '7', rehab: 5000, ready: 10, occupied: false },
    { id: '8', rehab: 2000, ready: 2, occupied: false },
    { id: '9', rehab: 5000, ready: 8, occupied: true },
    { id: '10', rehab: 12000, ready: 14, occupied: false, optional: true },
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
    { start: 3, end: 8, cost: 10154, group: 'laundry', label: 'Two Speed Queen stacked washer/dryer units (deliver, install, 5-yr parts/labor)', source: 'Speed Queen Commercial Laundry proposal' },
    { start: 3, end: 8, cost: 1676, group: 'laundry', label: 'KioSoft Ultra V2 card readers (2) + Ethernet hub + kiosk setup', source: 'KioSoft Commercial Laundry proposal' },
    { start: 3, end: 8, cost: 2560, group: 'laundry', label: '240V electrical drops, plumbing tie-ins, 4-inch galvanized venting', source: 'Allowance; confirm with contractor walk' },
    { start: 3, end: 8, cost: 2000, group: 'laundry', label: 'Cleanout, epoxy floor, LED light, folding table in basement laundry room', source: 'Allowance; confirm with contractor walk' },
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
  ...BASE_DEFAULTS,
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
  marketRentLow: 780,
  marketRentHigh: 1115,
  refiRate: 7.5,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  refiFeesPct: 2.5,
  refiFeesFlat: 3500,
  refiReserve: 15773,
  opex: CHARLOTTE_OPEX,
  laundry: CHARLOTTE_LAUNDRY,
};

const CHARLOTTE_OFFER = {
  id: 'o1',
  name: 'B: Seller financing',
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

const SHELL_STUB = {
  Card: ({ children, ...rest }) => React.createElement('section', rest, children),
  CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside),
  Button: ({ children, kind: _k, ...p }) => React.createElement('button', p, children),
  Badge: ({ children }) => React.createElement('span', null, children),
  Empty: ({ children }) => React.createElement('div', null, children),
  InfoTip: () => null,
  JumpNav: () => null,
  OverlayTrigger: ({ children, lines, className }) => React.createElement(
    'span',
    { className, 'data-overlay': JSON.stringify(lines || []) },
    children,
  ),
  useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
};

test('common-area gas & electric ($1,800/yr) removes Heat / gas, reduces NOI by exact $1,800, and groups cleanly', () => {
  const priorOpex = { ...CHARLOTTE_OPEX, commonAreaUtilitiesAnnual: 0, heatGasAnnual: 0, sources: { ...CHARLOTTE_OPEX.sources, heatGas: 'Tenants pay their own' } };
  const prior = computeOpex({ opex: priorOpex, laundry: CHARLOTTE_LAUNDRY, units: 10, grossRentMonthly: 10000, capRate: 9 });
  const next = computeOpex({ opex: CHARLOTTE_OPEX, laundry: CHARLOTTE_LAUNDRY, units: 10, grossRentMonthly: 10000, capRate: 9 });

  // Even if stale heatGasAnnual/sources.heatGas is passed in raw opex, Heat / gas never emits.
  assert.ok(!prior.lines.some((l) => /heat \/ gas/i.test(l.label)));
  assert.ok(!next.lines.some((l) => /heat \/ gas/i.test(l.label)));
  assert.doesNotMatch(JSON.stringify(next.costsOverlay), /Heat \/ gas/);

  // NOI = prior - 1,800
  assert.equal(Math.round(prior.noiAnnual), 66874);
  assert.equal(Math.round(next.noiAnnual), 65074);
  assert.equal(Math.round((prior.noiAnnual - next.noiAnnual) * 100) / 100, 1800);
  assert.equal(Math.round(next.value), 723047);

  // Groups order and subtotals
  const groups = groupOpexCalc(next);
  assert.deepEqual(groups.map((g) => g.key), ['rent-in', 'laundry', 'fixed', 'upkeep', 'operations']);
  assert.deepEqual(groups.map((g) => g.subtotalText), ['$114,000/yr', '+$4,408/yr', '−$33,844/yr', '−$14,100/yr', '−$5,390/yr']);

  const fixed = groups.find((g) => g.key === 'fixed');
  assert.deepEqual(fixed.items.map((i) => i.label), ['Property taxes', 'Insurance', 'Water, sewer and trash', 'Common-area gas & electric']);
  const commonItem = fixed.items.find((i) => i.key === 'commonAreaUtilities');
  assert.equal(commonItem.valueText, '−$1,800/yr');
  assert.match(commonItem.overlay[0], /Estimate until house-meter bills are read; tenants pay their own unit heat; laundry gas\/electric counted per load\./);

  const upkeep = groups.find((g) => g.key === 'upkeep');
  assert.deepEqual(upkeep.items.map((i) => i.label), ['Repairs & maintenance (8%)', 'Reserves ($450/unit)']);
  const ops = groups.find((g) => g.key === 'operations');
  assert.deepEqual(ops.items.map((i) => i.label), ['Management help ($100/mo)', 'Wi-Fi (smart locks)', 'Cameras', 'Rental registration ($15/unit)', 'Snow and lawn']);
});

test('every role uses grouped collapsed-by-default opex, CostSummary, and ExecutionPlanCard with cross-role value parity', () => {
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, CHARLOTTE_OFFER);
  const sellerSummary = offerSellerSummary(CHARLOTTE_OFFER, CHARLOTTE_BASE, CHARLOTTE_PLAN, [], true);

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
  const CostSummaryMod = loadJsx('src/components/CostSummary.jsx', { './Shell.jsx': SHELL_STUB });
  const LeadOfferCardMod = loadJsx('src/components/LeadOfferCard.jsx', {
    './Shell.jsx': SHELL_STUB,
    '../lib/dealmath.js': { money },
  });
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
    './OperatingBreakdown.jsx': OperatingBreakdownMod,
    './Shell.jsx': SHELL_STUB,
  });

  const noopQuery = {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        maybeSingle: async () => ({ data: null }),
        then: () => {},
      }),
    }),
  };
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
    '../lib/lenderModel.js': { buildLenderPackage, computeTermsOutcome, LENDER_LENSES, moneyCents, parseLenderProtections },
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
    '../lib/site.js': { SITE_KIND: '', canAccessCityRecords: () => true },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        offers: [{ ...CHARLOTTE_OFFER, seller_summary: { ...sellerSummary, guide } }],
        base: CHARLOTTE_BASE,
        error: '',
      }),
    },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], FileList: () => null },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [], useDealGallery: () => ({ items: [] }) },
    '../components/OverlaySheet.jsx': {
      InPagePanel: ({ open, children }) => (open ? React.createElement('div', null, children) : null),
      OverviewActionButtons: () => null,
    },
    '../lib/sheetBadges.js': { useSheetBadges: () => ({ docBadge: 0, msgBadge: 0, markDocsSeen: () => {}, markMsgsSeen: () => {} }) },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../components/CostSummary.jsx': CostSummaryMod,
    '../components/LeadOfferCard.jsx': LeadOfferCardMod,
    '../components/UnitsRentedGuide.jsx': { isUnitsGuide: (g) => Boolean(g && Array.isArray(g.rows) && g.rows.length > 0 && g.refi) },
    '../components/RentValue.jsx': RentValueMod,
    '../components/Shell.jsx': SHELL_STUB,
    '../components/Messages.jsx': { __esModule: true, default: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    './LenderTerms.jsx': LenderTermsMod,
    './CityRecords.jsx': { __esModule: true, default: () => null },
  });
  const UnitsGuideMod = loadJsx('src/components/UnitsRentedGuide.jsx', {
    './CostSummary.jsx': CostSummaryMod.default,
    './Shell.jsx': SHELL_STUB,
    '../lib/dealmath.js': { money },
  });
  const OffersMod = loadJsx('src/views/Offers.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../components/Dictation.jsx': { DictatedField: (p) => React.createElement(p.as || 'input', p) },
    '../lib/supabase.js': { supabase: { from: () => noopQuery } },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        offers: [{ ...CHARLOTTE_OFFER, seller_summary: { ...sellerSummary, guide } }],
        setOffers: () => {},
        base: CHARLOTTE_BASE,
        setBase: () => {},
        later: () => {},
        saved: '',
        error: '',
        reset: () => {},
        touched: false,
        original: { list: [CHARLOTTE_OFFER], base: CHARLOTTE_BASE },
      }),
    },
    '../components/Switches.jsx': SwitchesMod,
    '../components/OperatingBreakdown.jsx': OperatingBreakdownMod,
    '../components/CostSummary.jsx': CostSummaryMod,
    '../components/UnitsRentedGuide.jsx': UnitsGuideMod,
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, buildLeadStory, applyGuideRefi, sharedRefiStory, evaluate, grade: () => 'none', money, pct, syncOpexOverride, valueSummary },
    '../lib/plain.js': { plain },
    '../lib/occupancy.js': { breakEvenCount },
    '../components/Shell.jsx': SHELL_STUB,
    '../lib/site.js': { SITE_KIND: '', canAccessDealPlan: () => true },
  });

  const assertCollapsedOpexHtml = (html, roleLabel) => {
    for (const k of ['rent-in', 'laundry', 'fixed', 'upkeep', 'operations']) {
      assert.match(html, new RegExp(`data-opex-group="${k}"`), `${roleLabel} missing group ${k}`);
      const btnRe = new RegExp(`data-opex-group="${k}"[\\s\\S]*?aria-expanded="false"`);
      assert.match(html, btnRe, `${roleLabel} group ${k} should start collapsed`);
    }
    assert.match(html, /\$65,074\/yr/, `${roleLabel} missing NOI $65,074/yr`);
    assert.match(html, /\$723,047/, `${roleLabel} missing Value $723,047`);
    assert.match(html, /Value at 9% cap/, `${roleLabel} missing Value at 9% cap`);
    const visibleHtml = html.replace(/data-overlay="[^"]*"/g, '');
    assert.doesNotMatch(visibleHtml, /Property taxes|Common-area gas &amp; electric|Management help|Heat \/ gas/, `${roleLabel} leaked child opex items on load`);
  };

  // Owner & Reviewer via RentValue
  assertCollapsedOpexHtml(renderToStaticMarkup(React.createElement(RentValueMod.default, { data: guide.rentValue, showMarket: true })), 'Owner RentValue');
  assertCollapsedOpexHtml(renderToStaticMarkup(React.createElement(RentValueMod.default, { data: guide.rentValue, showMarket: false })), 'Reviewer RentValue');

  // Owner & Reviewer via Offers BuildingNumbers
  assertCollapsedOpexHtml(renderToStaticMarkup(React.createElement(OffersMod.default, { deal: { id: 'd1', slug: 'charlotte' }, canSave: true, role: 'owner', preview: false })), 'Owner Offers');
  assertCollapsedOpexHtml(renderToStaticMarkup(React.createElement(OffersMod.default, { deal: { id: 'd1', slug: 'charlotte' }, canSave: false, role: 'reviewer', preview: false })), 'Reviewer Offers');

  // Realtor via WhatIfNumbers
  assertCollapsedOpexHtml(renderToStaticMarkup(React.createElement(SwitchesMod.WhatIfNumbers, { deal: { id: 'd1', slug: 'charlotte' }, me: { uid: 'r1' }, role: 'realtor', preview: false, planRepairBudget: 142440 })), 'Realtor WhatIfNumbers');

  // Lender Bridge, Private, DSCR
  for (const lens of ['bridge', 'private', 'dscr']) {
    const html = renderToStaticMarkup(React.createElement(LenderMod.default, {
      deal: { id: 'd1', slug: 'charlotte', seller_content: { execution_steps: [{ key: 'week1_secure_and_start', week: 'Week 1', title: 'Secure the building first', budgetKey: 'week1', items: [{ text: 'Get laundry running: 2 stacked sets taking coins, tap/card and bills', budgetKey: 'laundry' }] }] } },
      me: { uid: 'l1', email: 'lender@example.com' },
      preview: false,
      initialLens: lens,
    }));
    assertCollapsedOpexHtml(html, `Lender ${lens}`);
    assert.match(html, /aria-expanded="false"[^>]*data-cost-group="laundry"|data-cost-group="laundry"[^>]*aria-expanded="false"/);
    assert.match(html, /aria-expanded="false"[^>]*data-plan-step="week1_secure_and_start"|data-plan-step="week1_secure_and_start"[^>]*aria-expanded="false"/);
    const noOverlay = html.replace(/data-overlay="[^"]*"/g, '');
    assert.doesNotMatch(noOverlay, /Two Speed Queen stacked washer\/dryer units/);
  }
});

test('migration 0037_charlotte_common_area_utilities.sql removes Heat / gas and adds $1,800 commonAreaUtilitiesAnnual cleanly', () => {
  const sql = read('supabase/migrations/0037_charlotte_common_area_utilities.sql');
  assert.match(sql, /commonAreaUtilitiesAnnual/);
  assert.match(sql, /1800/);
  assert.match(sql, /Common-area gas & electric/);
  assert.match(sql, /Estimate until house-meter bills are read; tenants pay their own unit heat; laundry gas\/electric counted per load\./);
  assert.match(sql, /- 'heatGasAnnual'/);
  assert.match(sql, /- 'heatGas'/);
  assert.match(sql, /apply_opex_to_guide/);
  assert.doesNotMatch(sql, /'Heat \/ gas/);
  assert.doesNotMatch(sql, /\bto anon\b/i);
  assert.doesNotMatch(sql, /pg-j6kkmlhqpl|pg-1dsfheorbs|im1iad33ebun/i);
});
