// Charlotte lender view Round 2 tests:
// Bridge -> Private -> DSCR tab order, 1 point + $1,295 + 2-mo deferred interest + title/closing rolled in,
// Private pooled $20k min + total funds needed + left over at refi (no full refi check table),
// market rent 780..1115 midpoint 948 (no $1,220, no rent > 1,115), As-is 0 of 10 / $0,
// Plan 1A leading + Plan 1B secondary, LenderWhatIf (no seller-financing), zero visible subtext, strict privacy isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, BASE_FIELDS, evaluate, money, valueSummary } from '../src/lib/dealmath.js';
import { buildLenderPackage, LENDER_LENSES } from '../src/lib/lenderModel.js';
import { buildLeadGuide, rentValue } from '../src/lib/dealplan.js';
import { defaultMarketRent, effectiveMarketRange, rangeValue, whatIfViews, whatIfGrid } from '../src/lib/rangeValue.js';
import { plain } from '../src/lib/plain.js';

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

const WHITEBOARD_BASE = {
  ...BASE_DEFAULTS,
  units: 10,
  rent: 948,
  vacancyPct: 7,
  taxes: 12000,
  insurance: 6000,
  waterMo: 500,
  reservesPerUnit: 300,
  value: 586000,
  rehab: 124050,
  purchasePrice: 275000,
  bridgeRepairs: 140000,
  bridgeClosing: 5500,
  bridgeProcessing: 1295,
  bridgePointsPct: 1,
  bridgeRate: 13,
  bridgeDeferredMonths: 2,
  privateMinParticipation: 20000,
  refiLtv: 75,
  refiFeesFlat: 5000,
  refiFeesPct: 2.1,
  marketRentLow: 780,
  marketRentHigh: 1115,
};

const WHITEBOARD_PLAN = {
  sellerLoanBalance: 275000,
  contingency: 10002,
  lenderRate: 13,
  lenderPoints: 1,
  bridgeRate: 13,
  bridgePoints: 1,
  bridgeProcessing: 1295,
  bridgeClosing: 5500,
  bridgeDeferredMonths: 2,
  units: [
    ...Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), rehab: 14256 })),
    { id: '9', rehab: 0, occupied: true }, // occupied non-paying tenant -> $0 / 0 rented as-is
    { id: '10', rehab: 0 },
  ],
  costs: [],
  marketRent: { low: 780, high: 1115, source: 'Evan 2-bed comp avg' },
};

const WHITEBOARD_OFFER = {
  id: 'o1',
  name: 'B: Seller financing',
  structure: 'wrap',
  is_lead: true,
  share_lender: true,
  inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500 },
};

test('LENDER_LENSES order is Bridge, Private, DSCR', () => {
  assert.deepEqual(Object.keys(LENDER_LENSES), ['bridge', 'private', 'dscr']);
  assert.deepEqual(Object.values(LENDER_LENSES).map((l) => l.label), ['Bridge', 'Private', 'DSCR']);
});

test('buildLenderPackage derives Plan 1A bridge with 1 point, $1,295 processing, 2-mo deferred interest, and private pool', () => {
  const guide = buildLeadGuide(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  const pkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'bridge' });

  assert.equal(pkg.purchase, 275000);
  assert.equal(pkg.repairs, 124050);
  assert.equal(pkg.closing, 5500);
  assert.equal(pkg.processing, 1295);
  assert.equal(pkg.pointsPct, 1);
  assert.equal(pkg.ratePct, 13);
  assert.equal(pkg.deferredMonths, 2);
  assert.equal(pkg.minParticipation, 20000);
  assert.equal(pkg.downPayment, 0);
  assert.equal(pkg.ltcPct, 100);
  assert.equal(Math.round(pkg.points), 4191);
  assert.equal(Math.round(pkg.deferredInterest), 9081);
  assert.equal(Math.round(pkg.totalLoan), 419117);
  assert.equal(Math.round(pkg.monthlyInterest), 4540);
  assert.ok(pkg.loanAskRows.some((r) => r.key === 'deferredInterest' && r.label === '2 mo deferred interest'));
  assert.ok(pkg.loanAskRows.some((r) => r.key === 'points' && r.label === '1 point'));

  assert.equal(pkg.value, 586000);
  assert.equal(pkg.refiCheck.newLoan, 439500);
  assert.equal(Math.round(pkg.refiCheck.refiFeesTotal), 14230);
  assert.equal(Math.round(pkg.refiCheck.netAtRefi), 6153);
  assert.equal(pkg.refiCheck.isGap, false);
  assert.equal(pkg.hasSellerFinancingOption, true);

  const privPkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'private' });
  assert.equal(privPkg.totalLoan, pkg.totalLoan);
  assert.equal(privPkg.privatePoolRows[0].display, '$419,117');
  assert.equal(privPkg.privatePoolRows[1].display, '$20,000');
  assert.equal(privPkg.privatePoolRows[3].label, 'Left over at refinance');
  assert.equal(privPkg.privatePoolRows[3].display, '$6,153');

  const dscrPkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'dscr' });
  assert.equal(dscrPkg.refiCheck.newLoan, pkg.refiCheck.newLoan);
  assert.notEqual(dscrPkg.lens.title, pkg.lens.title);
});

test('rent range 780..1115 defaults to midpoint 948, never exceeds 1115, and As-is is 0 of 10 / $0', () => {
  const rv = rentValue(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  assert.equal(rv.marketRange.low, 780);
  assert.equal(rv.marketRange.high, 1115);
  assert.equal(defaultMarketRent(rv.marketRange), 948);

  // As-is must be 0 rented / $0 even when Unit 9 is marked occupied with $0 rent.
  const asis = rv.views.find((v) => v.key === 'asis');
  assert.equal(asis.rented, 0);
  assert.equal(asis.rentMo, 0);

  // Stale cached guide with rented: 1, rentMo: 0 also normalizes to 0 in whatIfViews.
  const staleRv = { ...rv, views: [{ ...asis, rented: 1, rentMo: 0 }, ...rv.views.slice(1)] };
  const cleanedViews = whatIfViews(staleRv, 948);
  assert.equal(cleanedViews[0].rented, 0);
  assert.equal(cleanedViews[0].rentMo, 0);

  // Neither rentValue grid nor whatIfGrid ever includes a row above 1115 or $1,220.
  assert.ok(rv.grid.every((r) => r.rent <= 1115));
  const wGrid = whatIfGrid(rv, 948);
  assert.ok(wGrid.every((r) => r.rent <= 1115));
  assert.ok(!wGrid.some((r) => r.rent === 1220));

  const lifted = effectiveMarketRange({ low: 780, high: 1020 }, { marketRentHigh: 1115 });
  assert.equal(lifted.high, 1115);
  assert.equal(defaultMarketRent(lifted), 948);
});

function buildLenderMocks(guide) {
  const Shell = {
    Card: ({ children, className = '', ...p }) => React.createElement('section', { className, ...p }, children),
    CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside),
    Button: ({ children, kind: _k, ...p }) => React.createElement('button', p, children),
    Empty: ({ children }) => React.createElement('div', null, children),
    JumpNav: () => React.createElement('nav', null),
    OverlayTrigger: ({ children, className }) => React.createElement('span', { className }, children),
    useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
  };
  const RentValueMod = loadJsx('src/components/RentValue.jsx', {
    './Shell.jsx': Shell,
    '../lib/dealmath.js': { money, moneyK: (v) => `$${Math.round(v / 1000)}K` },
    '../lib/rangeValue.js': { defaultMarketRent, rangeValue, whatIfViews, whatIfGrid },
  });
  const CostSummaryMod = loadJsx('src/components/CostSummary.jsx', { './Shell.jsx': Shell });
  const LenderWhatIfMod = loadJsx('src/components/LenderWhatIf.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { money },
    '../lib/lenderModel.js': { buildLenderPackage },
    './Messages.jsx': { sendToOwner: async () => null },
    './Shell.jsx': Shell,
  });
  return loadJsx('src/views/Lender.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/supabase.js': { supabase: { rpc: () => ({ then: () => {} }) } },
    '../lib/dealmath.js': { evaluate, money, valueSummary },
    '../lib/lenderModel.js': { buildFallbackRentValue: () => null, buildLenderPackage, LENDER_LENSES },
    '../lib/rangeValue.js': { effectiveMarketRange },
    '../lib/plain.js': { plain },
    '../lib/useDealModel.js': { useDealModel: () => ({ offers: [{ ...WHITEBOARD_OFFER, seller_summary: { guide } }], base: WHITEBOARD_BASE, error: '' }) },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], FileList: () => null },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [] },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../components/CostSummary.jsx': CostSummaryMod,
    '../components/UnitsRentedGuide.jsx': { isUnitsGuide: (g) => Boolean(g && Array.isArray(g.rows) && g.rows.length > 0 && g.refi) },
    '../components/RentValue.jsx': RentValueMod,
    '../components/LenderWhatIf.jsx': LenderWhatIfMod,
    '../components/Shell.jsx': Shell,
    '../components/Messages.jsx': { __esModule: true, default: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    './LenderTerms.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'LenderTerms' }) },
    './CityRecords.jsx': { __esModule: true, default: () => null },
  });
}

test('Lender.jsx renders Bridge/Private/DSCR order, Round 2 numbers, zero subtext, Plan 1A leading, and LenderWhatIf', async () => {
  const guide = buildLeadGuide(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  const LenderMod = buildLenderMocks(guide);

  const html = renderToStaticMarkup(React.createElement(LenderMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com' },
    preview: false,
  }));

  // Overview section: Bridge -> Private -> DSCR tab order, zero seller financing, zero subtext.
  const overviewHtml = html.split('id="sec-terms"')[0];
  const tabOrder = ['>Bridge<', '>Private<', '>DSCR<'].map((t) => overviewHtml.indexOf(t));
  assert.ok(tabOrder[0] >= 0 && tabOrder[1] > tabOrder[0] && tabOrder[2] > tabOrder[1], 'Tab order must be Bridge, Private, DSCR');

  assert.doesNotMatch(overviewHtml, /Seller financing/i);
  assert.match(overviewHtml, /Bridge loan/);
  assert.match(overviewHtml, /\$419,117/);
  assert.match(overviewHtml, /1 point/);
  assert.match(overviewHtml, /2 mo deferred interest/);
  assert.match(overviewHtml, /\$9,081/);
  assert.match(overviewHtml, /\$5,500/);
  assert.match(overviewHtml, /\$1,295/);
  assert.match(overviewHtml, /\$4,540\/mo/);
  assert.match(overviewHtml, /\$439,500/);
  assert.match(overviewHtml, /type="range"[^>]*min="780"[^>]*max="1115"[^>]*value="948"/);
  assert.doesNotMatch(overviewHtml, /\$1,220/);
  assert.match(overviewHtml, /0 of 10/);
  assert.doesNotMatch(overviewHtml, /1 of 10/);

  const orderMarkers = ['data-wb="hero"', 'data-wb="steps"', 'data-wb="loan-ask"', 'data-wb="refi-check"', 'data-wb="rent-plan"'];
  const indices = orderMarkers.map((m) => overviewHtml.indexOf(m));
  for (let i = 0; i < indices.length; i++) {
    assert.ok(indices[i] >= 0, `Missing ${orderMarkers[i]}`);
    if (i > 0) assert.ok(indices[i] > indices[i - 1], `Out of order: ${orderMarkers[i]}`);
  }
  assert.doesNotMatch(overviewHtml, /<p\b|<small\b|<caption\b/i);

  // Plan tab: Plan 1A leads ahead of short secondary Plan 1B.
  const planHtml = html.slice(html.indexOf('id="sec-plan"'), html.indexOf('id="sec-what-if"'));
  const idx1a = planHtml.indexOf('data-plan="1a"');
  const idx1b = planHtml.indexOf('data-plan="1b"');
  assert.ok(idx1a >= 0 && idx1b > idx1a, 'Plan 1A must precede secondary Plan 1B');
  assert.match(planHtml, /Plan 1A · Bridge to refinance/);
  assert.match(planHtml, /Repairs in draws/);
  assert.match(planHtml, /2-mo deferred interest/);
  assert.match(planHtml, /Refinance pays off bridge/);
  assert.match(planHtml, /Plan 1B · Backup option/);

  // What-if tab: uses LenderWhatIf (no seller-financing what-if inputs).
  const whatIfHtml = html.slice(html.indexOf('id="sec-what-if"'), html.indexOf('id="sec-city-records"'));
  assert.match(whatIfHtml, /Loan assumptions/);
  assert.match(whatIfHtml, /Deferred interest/);
  assert.doesNotMatch(whatIfHtml, /Seller financing|sellerAdvances|optionPrice/i);
});

test('seller, realtor, and shared What-if fields never expose bridge ask or lender rate details', () => {
  for (const field of [
    'purchasePrice',
    'bridgeRepairs',
    'bridgeClosing',
    'bridgeProcessing',
    'bridgePointsPct',
    'bridgeRate',
    'bridgeDeferredMonths',
    'bridgeTermMonths',
    'privateMinParticipation',
  ]) {
    assert.equal(BASE_FIELDS.some(([k]) => k === field), false, `${field} must stay out of BASE_FIELDS`);
  }
  for (const file of ['src/views/Seller.jsx', 'src/views/Realtor.jsx', 'src/components/Switches.jsx']) {
    const src = read(file);
    assert.doesNotMatch(src, /lenderModel|LenderWhatIf|Refinance check|Pays off bridge|bridgeProcessing|bridgePointsPct|bridgeRate|bridgeDeferredMonths|privateMinParticipation/i, file);
  }
});
