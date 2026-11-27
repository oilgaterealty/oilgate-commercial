// Charlotte lender view redesign tests:
// Plan 1A bridge derivation, 5-part whiteboard DOM order, lender-type switch, mid-range rent slider,
// zero visible subtext, and strict privacy isolation from seller/realtor views.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, BASE_FIELDS, buildLeadStory, evaluate, money, valueSummary } from '../src/lib/dealmath.js';
import { buildLenderPackage, LENDER_LENSES } from '../src/lib/lenderModel.js';
import { buildLeadGuide, rentValue } from '../src/lib/dealplan.js';
import { defaultMarketRent, effectiveMarketRange, rangeValue, whatIfViews, whatIfGrid } from '../src/lib/rangeValue.js';
import { plain } from '../src/lib/plain.js';
import { breakEvenCount } from '../src/lib/occupancy.js';

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
  rent: 965,
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
  bridgePointsPct: 2,
  bridgeRate: 13,
  refiLtv: 75,
  refiFeesFlat: 5000,
  refiFeesPct: 2.1,
  marketRentLow: 780,
  marketRentHigh: 1150,
};

const WHITEBOARD_PLAN = {
  sellerLoanBalance: 275000,
  contingency: 10000,
  lenderRate: 13,
  lenderPoints: 2,
  bridgeRate: 13,
  bridgePoints: 2,
  bridgeProcessing: 1295,
  bridgeClosing: 5500,
  units: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), rehab: 11405 })),
  costs: [],
  marketRent: { low: 780, high: 1020, source: 'owner note' },
};

const WHITEBOARD_OFFER = {
  id: 'o1',
  name: 'B: Seller financing',
  structure: 'wrap',
  is_lead: true,
  share_lender: true,
  inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500 },
};

test('buildLenderPackage derives Plan 1A bridge and refinance check from model/offer data', () => {
  const guide = buildLeadGuide(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  const pkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'bridge' });

  assert.equal(pkg.purchase, 275000);
  assert.equal(pkg.repairs, 140000);
  assert.equal(pkg.closing, 5500);
  assert.equal(pkg.processing, 1295);
  assert.equal(pkg.pointsPct, 2);
  assert.equal(pkg.ratePct, 13);
  assert.equal(pkg.downPayment, 0);
  assert.equal(pkg.ltcPct, 100);
  assert.equal(Math.round(pkg.points), 8608);
  assert.equal(Math.round(pkg.totalLoan), 430403);
  assert.equal(Math.round(pkg.monthlyInterest), 4663);

  assert.equal(pkg.value, 586000);
  assert.equal(pkg.refiCheck.newLoan, 439500);
  assert.equal(Math.round(pkg.refiCheck.refiFeesTotal), 14230);
  assert.equal(Math.round(pkg.refiCheck.netAtRefi), -5133);
  assert.equal(pkg.refiCheck.isGap, true);
  assert.equal(pkg.hasSellerFinancingOption, true);

  // Switch lenses change framing only, never core property facts.
  const dscrPkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'dscr' });
  const privPkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'private' });
  assert.equal(dscrPkg.totalLoan, pkg.totalLoan);
  assert.equal(privPkg.refiCheck.newLoan, pkg.refiCheck.newLoan);
  assert.notEqual(dscrPkg.lens.title, pkg.lens.title);
  assert.notEqual(privPkg.lens.title, pkg.lens.title);
});

test('rent range defaults to mid-range and lifts top when base.marketRentHigh is set', () => {
  const rv = rentValue(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  assert.equal(rv.marketRange.low, 780);
  assert.equal(rv.marketRange.high, 1150);
  assert.equal(defaultMarketRent(rv.marketRange), 965);

  const lifted = effectiveMarketRange({ low: 780, high: 1020 }, { marketRentHigh: 1150 });
  assert.equal(lifted.high, 1150);
  assert.equal(defaultMarketRent(lifted), 965);
});

test('Lender.jsx renders whiteboard 5-part order, Plan 1A headline, zero subtext, and mid-range rent slider', async () => {
  const guide = buildLeadGuide(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
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
  const UnitsGuideMod = loadJsx('src/components/UnitsRentedGuide.jsx', {
    './CostSummary.jsx': { __esModule: true, default: () => null },
    './Shell.jsx': Shell,
    '../lib/dealmath.js': { money },
  });
  const LenderMod = loadJsx('src/views/Lender.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/supabase.js': { supabase: { rpc: () => ({ then: () => {} }) } },
    '../lib/dealmath.js': { buildLeadStory, evaluate, money, valueSummary },
    '../lib/lenderModel.js': { buildFallbackRentValue: () => null, buildLenderPackage, LENDER_LENSES },
    '../lib/rangeValue.js': { effectiveMarketRange },
    '../lib/plain.js': { plain },
    '../lib/occupancy.js': { breakEvenCount },
    '../lib/useDealModel.js': { useDealModel: () => ({ offers: [{ ...WHITEBOARD_OFFER, seller_summary: { guide } }], base: WHITEBOARD_BASE, error: '' }) },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], FileList: () => null },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [] },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../components/CostSummary.jsx': { __esModule: true, default: () => null },
    '../components/UnitsRentedGuide.jsx': UnitsGuideMod,
    '../components/RentValue.jsx': RentValueMod,
    '../components/Shell.jsx': Shell,
    '../components/Messages.jsx': { __esModule: true, default: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    './LenderTerms.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'LenderTerms' }) },
    './Offers.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Offers' }) },
    './CityRecords.jsx': { __esModule: true, default: () => null },
  });

  const html = renderToStaticMarkup(React.createElement(LenderMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com' },
    preview: false,
  }));

  // Overview section starts with Bridge loan (never Seller financing), and renders the 5 whiteboard blocks in order.
  const overviewHtml = html.split('id="sec-terms"')[0];
  assert.doesNotMatch(overviewHtml, /Seller financing/i);
  assert.match(overviewHtml, /Bridge loan/);
  assert.match(overviewHtml, /Purchase \+ repairs \+ fees in one loan, \$0 down/);
  assert.match(overviewHtml, /\$430,403/);
  assert.match(overviewHtml, /\$275,000/);
  assert.match(overviewHtml, /\$140,000/);
  assert.match(overviewHtml, /\$5,500/);
  assert.match(overviewHtml, /\$1,295/);
  assert.match(overviewHtml, /\$4,663\/mo/);
  assert.match(overviewHtml, /\$439,500/);
  assert.match(overviewHtml, /type="range"[^>]*min="780"[^>]*max="1150"[^>]*value="965"/);

  const orderMarkers = ['data-wb="hero"', 'data-wb="steps"', 'data-wb="loan-ask"', 'data-wb="refi-check"', 'data-wb="rent-plan"'];
  const indices = orderMarkers.map((m) => overviewHtml.indexOf(m));
  for (let i = 0; i < indices.length; i++) {
    assert.ok(indices[i] >= 0, `Missing ${orderMarkers[i]}`);
    if (i > 0) assert.ok(indices[i] > indices[i - 1], `Out of order: ${orderMarkers[i]}`);
  }

  // Zero visible subtext elements inside overview.
  assert.doesNotMatch(overviewHtml, /<p\b|<small\b|<caption\b/i);
});

test('seller, realtor, and shared What-if fields never expose bridge ask or lender rate details', () => {
  for (const field of ['purchasePrice', 'bridgeRepairs', 'bridgeClosing', 'bridgeProcessing', 'bridgePointsPct', 'bridgeRate']) {
    assert.equal(BASE_FIELDS.some(([k]) => k === field), false, `${field} must stay out of BASE_FIELDS`);
  }
  for (const file of ['src/views/Seller.jsx', 'src/views/Realtor.jsx', 'src/components/Switches.jsx']) {
    const src = read(file);
    assert.doesNotMatch(src, /lenderModel|Refinance check|Pays off bridge|bridgeProcessing|bridgePointsPct|bridgeRate/i, file);
  }
});
