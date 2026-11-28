// Charlotte lender view tab-isolation tests:
// Bridge (10% non-Dutch, 1 pt, $1,295, 12 mo, 2-mo deferred due at payoff, $0 down, LTC, draws, extensions; NO LTV/DSCR/amortization/refi table),
// Private (8%, $20k min, first-lien pooled, total funds needed, surplus at refinance; NO processing/DSCR/amortization/refi table),
// DSCR (75% LTV of $586k = $439,500 changeable to 80%, DSCR min, rate, 30-yr amort, prepayment, refi fees, pays off bridge; NO points/processing/deferred),
// percent-next-to-dollar always labels both, Owner 75%/80% LTV toggle, zero subtext, strict privacy isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, BASE_FIELDS, evaluate, money, moneyCents, operating, pct, valueSummary } from '../src/lib/dealmath.js';
import { buildLenderPackage, computePrivateReturn, LENDER_DEFAULTS, LENDER_LENSES, parseLenderProtections } from '../src/lib/lenderModel.js';
import { buildLeadGuide, monthlyPlan, overallRepairBudget, rentValue } from '../src/lib/dealplan.js';
import { defaultMarketRent, effectiveMarketRange, operatingBreakdownFor, rangeValue, whatIfViews, whatIfGrid } from '../src/lib/rangeValue.js';

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
  bridgeRepairs: 124050,
  bridgeClosing: 5500,
  bridgeProcessing: 1295,
  bridgePointsPct: 1,
  bridgeRate: 10,
  bridgeDeferredMonths: 2,
  bridgeTermMonths: 12,
  privateRate: 8,
  privateTermMonths: 12,
  privateMinParticipation: 20000,
  refiRate: 7.5,
  refiYears: 30,
  refiDscr: 1.25,
  refiLtv: 75,
  refiFeesFlat: 5000,
  refiFeesPct: 2.1,
  marketRentLow: 780,
  marketRentHigh: 1115,
};

const WHITEBOARD_PLAN = {
  sellerLoanBalance: 275000,
  contingency: 10002,
  lenderRate: 10,
  lenderPoints: 1,
  bridgeRate: 10,
  bridgePoints: 1,
  bridgeProcessing: 1295,
  bridgeClosing: 5500,
  bridgeDeferredMonths: 2,
  bridgeTermMonths: 12,
  privateRate: 8,
  privateTermMonths: 12,
  privateMinParticipation: 20000,
  units: [
    ...Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), rehab: 14256 })),
    { id: '9', rehab: 0, occupied: true },
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

test('LENDER_DEFAULTS and LENDER_LENSES reflect owner-confirmed Bridge (10%), Private (8%), and DSCR (75% LTV) terms', () => {
  assert.deepEqual(Object.keys(LENDER_LENSES), ['bridge', 'private', 'dscr']);
  assert.deepEqual(Object.values(LENDER_LENSES).map((l) => l.label), ['Bridge', 'Private', 'DSCR']);
  assert.equal(LENDER_DEFAULTS.bridgeRate, 10);
  assert.equal(LENDER_DEFAULTS.bridgePointsPct, 1);
  assert.equal(LENDER_DEFAULTS.bridgeProcessing, 1295);
  assert.equal(LENDER_DEFAULTS.bridgeDeferredMonths, 2);
  assert.equal(LENDER_DEFAULTS.bridgeTermMonths, 12);
  assert.equal(LENDER_DEFAULTS.bridgePrepayment, 'None');
  assert.equal(LENDER_DEFAULTS.bridgeExtensionCount, 1);
  assert.equal(LENDER_DEFAULTS.bridgeExtensionMonths, 3);
  assert.equal(LENDER_DEFAULTS.bridgeExtensionFeePct, 1.25);
  assert.equal(LENDER_DEFAULTS.bridgeDrawFee, 0);
  assert.equal(LENDER_DEFAULTS.privateRate, 8);
  assert.equal(LENDER_DEFAULTS.privatePointsPct, 0);
  assert.equal(LENDER_DEFAULTS.privateMinParticipation, 20000);
  assert.equal(LENDER_DEFAULTS.refiLtv, 75);
  assert.equal(LENDER_DEFAULTS.refiFeesFlat, 15000);
  assert.equal(LENDER_DEFAULTS.refiFeesPct, 0);
});

test('buildLenderPackage computes separate Bridge (non-Dutch), Private (8%), and DSCR (75%/80% LTV) packages', () => {
  const guide = buildLeadGuide(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  const bridgePkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'bridge' });

  // Bridge: 275,000 + 124,050 + 5,500 + 1,295 = 405,845 / 0.99 = 409,944; drawn at close = 285,894; 10% IO = 2,382/mo; 2 mo deferred = 4,765
  assert.equal(bridgePkg.purchase, 275000);
  assert.equal(bridgePkg.repairs, 124050);
  assert.equal(bridgePkg.closing, 5500);
  assert.equal(bridgePkg.processing, 1295);
  assert.equal(bridgePkg.pointsPct, 1);
  assert.equal(bridgePkg.ratePct, 10);
  assert.equal(bridgePkg.deferredMonths, 2);
  assert.equal(bridgePkg.downPayment, 0);
  assert.equal(bridgePkg.ltcPct, 100);
  assert.equal(Math.round(bridgePkg.totalLoan), 409944);
  assert.equal(Math.round(bridgePkg.points), 4099);
  assert.equal(Math.round(bridgePkg.initialDrawn), 285894);
  assert.equal(Math.round(bridgePkg.initialMonthlyInterest), 2382);
  assert.equal(Math.round(bridgePkg.deferredInterest), 4765);
  assert.equal(Math.round(bridgePkg.bridgePayoff), 414709);
  assert.equal(bridgePkg.prepayment, 'None');
  assert.equal(bridgePkg.extension.display, '1 × 3 months at 1.25%');
  assert.equal(bridgePkg.drawFee, 0);
  assert.equal(bridgePkg.drawFeeDisplay, '$0 per draw');
  const rateDraws = bridgePkg.bridgeTermsRows.find((r) => r.key === 'rateAndDraws');
  assert.equal(rateDraws?.display, '10% IO · $0 draw fee');
  assert.equal(rateDraws?.items?.find((i) => i.key === 'drawFee')?.display, '$0 per draw');
  assert.equal(bridgePkg.bridgeTermsRows.find((r) => r.key === 'termAndExtension')?.items?.find((i) => i.key === 'extension')?.display, '1 × 3 months at 1.25%');
  assert.equal(bridgePkg.bridgeTermsRows.find((r) => r.key === 'prepayment')?.display, 'None');
  assert.equal(bridgePkg.bridgeTermsRows.at(-1).display, 'Paid off by refinance after lease-up');

  const customBridgePkg = buildLenderPackage({
    base: {
      ...WHITEBOARD_BASE,
      bridgePrepayment: '1%',
      bridgeExtensionCount: 2,
      bridgeExtensionMonths: 6,
      bridgeExtensionFeePct: 0.5,
      bridgeDrawFee: 150,
    },
    offer: WHITEBOARD_OFFER,
    guide,
    lens: 'bridge',
  });
  assert.equal(customBridgePkg.prepayment, '1%');
  assert.equal(customBridgePkg.extension.display, '2 × 6 months at 0.5%');
  assert.equal(customBridgePkg.drawFee, 150);
  assert.equal(customBridgePkg.drawFeeDisplay, '$150 per draw');

  // Bridge rows & steps never expose LTV-of-value, DSCR, amortization, or refi fee numbers
  const bridgeText = JSON.stringify({ steps: bridgePkg.steps, loanAskRows: bridgePkg.loanAskRows, bridgeTermsRows: bridgePkg.bridgeTermsRows });
  assert.doesNotMatch(bridgeText, /\bLTV\b|DSCR|amortiz|Refi fees/i);

  // Private: 275,000 + 124,050 + 5,500 = 404,550; 8% = 2,697/mo; no processing, no points, no prepayment, no deferral, no surplus line
  const privPkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'private' });
  assert.equal(privPkg.privatePool.ratePct, 8);
  assert.equal(privPkg.privatePool.pointsPct, 0);
  assert.equal(privPkg.privatePool.totalFunds, 404550);
  assert.equal(privPkg.privatePool.minParticipation, 20000);
  assert.equal(Math.round(privPkg.privatePool.monthlyInterest), 2697);
  assert.equal(privPkg.privatePool.minMonthlyReturn.toFixed(2), '133.33');
  assert.equal(privPkg.privatePool.minAnnualReturn, 1600);
  assert.equal(privPkg.privatePool.surplusAtRefi, undefined);
  const privText = JSON.stringify({ steps: privPkg.steps, privateFundsRows: privPkg.privateFundsRows, privatePoolRows: privPkg.privatePoolRows });
  assert.match(privText, /"display":"8% · \$20,000 min"/);
  assert.match(privText, /First-lien pooled/);
  assert.match(privText, /After month 1/);
  assert.match(privText, /12 months, one 3-month extension\. Paid off early at refinance, no prepayment penalty\./);
  assert.match(privText, /Principal back at payoff/);
  assert.doesNotMatch(privText, /points|processing|\$1,295|DSCR|amortiz|Surplus at refinance|Left over at refinance|Gap at refinance|defer/i);
  assert.doesNotMatch(privPkg.lens.lead, /points/i);

  // DSCR: 75% of 586,000 = 439,500; 80% of 586,000 = 468,800; pays off bridge 414,709; refi fees 5000 + 2.1%; no surplus/left-over/gap line
  const dscrPkg = buildLenderPackage({ base: WHITEBOARD_BASE, offer: WHITEBOARD_OFFER, guide, lens: 'dscr' });
  assert.equal(dscrPkg.value, 586000);
  assert.equal(dscrPkg.refiCheck.refiLtv, 75);
  assert.equal(dscrPkg.refiCheck.newLoan, 439500);
  assert.equal(Math.round(dscrPkg.refiCheck.refiFeesTotal), 14230);
  assert.equal(dscrPkg.refiCheck.netAtRefi, undefined);
  const dscrText = JSON.stringify({ steps: dscrPkg.steps, dscrLoanRows: dscrPkg.dscrLoanRows, refiCheckRows: dscrPkg.refiCheckRows });
  assert.doesNotMatch(dscrText, /points|processing|\$1,295|deferred|non-Dutch|\bLTC\b|Surplus at refinance|Left over at refinance|Gap at refinance/i);

  const dscr80Pkg = buildLenderPackage({ base: { ...WHITEBOARD_BASE, refiLtv: 80 }, offer: WHITEBOARD_OFFER, guide, lens: 'dscr' });
  assert.equal(dscr80Pkg.refiCheck.refiLtv, 80);
  assert.equal(dscr80Pkg.refiCheck.newLoan, 468800);
});

async function buildLenderMocks(guide) {
  const Shell = {
    Card: ({ children, className = '', ...p }) => React.createElement('section', { className, ...p }, children),
    CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside),
    Button: ({ children, kind: _k, ...p }) => React.createElement('button', p, children),
    Empty: ({ children }) => React.createElement('div', null, children),
    JumpNav: () => React.createElement('nav', null),
    OverlayTrigger: ({ children, className }) => React.createElement('span', { className }, children),
    useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
  };
  const opexLib = await import('../src/lib/opex.js');
  const OperatingBreakdownMod = loadJsx('src/components/OperatingBreakdown.jsx', {
    './Shell.jsx': Shell,
    '../lib/dealmath.js': { money },
    '../lib/opex.js': opexLib,
  });
  const RentValueMod = loadJsx('src/components/RentValue.jsx', {
    './Shell.jsx': Shell,
    './OperatingBreakdown.jsx': OperatingBreakdownMod,
    '../lib/dealmath.js': { money, moneyK: (v) => `$${Math.round(v / 1000)}K` },
    '../lib/rangeValue.js': { defaultMarketRent, operatingBreakdownFor, rangeValue, whatIfViews, whatIfGrid },
  });
  const CostSummaryMod = loadJsx('src/components/CostSummary.jsx', { './Shell.jsx': Shell });
  const LenderWhatIfMod = loadJsx('src/components/LenderWhatIf.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { money, moneyCents },
    '../lib/lenderModel.js': { buildLenderPackage, computePrivateReturn },
    './Messages.jsx': { sendToOwner: async () => null },
    './Shell.jsx': Shell,
  });
  const DictationMod = loadJsx('src/components/Dictation.jsx', {
    '../lib/dictation.js': { MAX_RECORDING_MS: 60000 },
    '../lib/mediaCoordinator.js': { mediaCoordinator: { acquire: () => ({ ok: true }), release: () => {} } },
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
  const LenderTermsMod = loadJsx('src/views/LenderTerms.jsx', {
    '../components/Dictation.jsx': DictationMod,
    '../lib/supabase.js': { supabase: { from: () => noopQuery } },
    '../lib/format.js': await import('../src/lib/format.js'),
    '../lib/v63.js': await import('../src/lib/v63.js'),
    '../lib/dealmath.js': { BASE_DEFAULTS, money },
    '../lib/lenderModel.js': { buildLenderPackage, LENDER_LENSES, parseLenderProtections },
    '../components/Shell.jsx': Shell,
    '../components/Messages.jsx': { sendToOwner: async () => null },
  });
  return loadJsx('src/views/Lender.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/supabase.js': { supabase: { from: () => noopQuery, rpc: () => ({ then: () => {} }) } },
    '../lib/dealmath.js': { evaluate, money, moneyCents, valueSummary },
    '../lib/lenderModel.js': { buildFallbackRentValue: () => null, buildLenderPackage, computePrivateReturn, LENDER_LENSES, parseLenderProtections },
    '../lib/rangeValue.js': { effectiveMarketRange },
    '../lib/useDealModel.js': { useDealModel: () => ({ offers: [{ ...WHITEBOARD_OFFER, seller_summary: { guide } }], base: WHITEBOARD_BASE, error: '' }) },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], FileList: () => null },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [] },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../components/CostSummary.jsx': CostSummaryMod,
    '../components/LeadOfferCard.jsx': { ExecutionPlanCard: () => null },
    '../components/UnitsRentedGuide.jsx': { isUnitsGuide: (g) => Boolean(g && Array.isArray(g.rows) && g.rows.length > 0 && g.refi) },
    '../components/RentValue.jsx': RentValueMod,
    '../components/LenderWhatIf.jsx': LenderWhatIfMod,
    '../components/Shell.jsx': Shell,
    '../components/Messages.jsx': { __esModule: true, default: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    './LenderTerms.jsx': LenderTermsMod,
    './CityRecords.jsx': { __esModule: true, default: () => null },
  });
}

function sliceSections(html) {
  return {
    overview: html.slice(html.indexOf('id="sec-overview"'), html.indexOf('id="sec-terms"')),
    terms: html.slice(html.indexOf('id="sec-terms"'), html.indexOf('id="sec-plan"')),
    plan: html.slice(html.indexOf('id="sec-plan"'), html.indexOf('id="sec-what-if"')),
    whatIf: html.slice(html.indexOf('id="sec-what-if"'), html.indexOf('id="sec-city-records"')),
  };
}

test('Lender.jsx strictly isolates Bridge, Private, and DSCR across Overview, Your terms, The plan, and What-if', async () => {
  const guide = buildLeadGuide(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  const LenderMod = await buildLenderMocks(guide);

  // 1. BRIDGE TAB
  const bridgeHtml = renderToStaticMarkup(React.createElement(LenderMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com' },
    preview: false,
    initialLens: 'bridge',
  }));
  const tabOrder = ['>Bridge<', '>Private<', '>DSCR<'].map((t) => bridgeHtml.indexOf(t));
  assert.ok(tabOrder[0] >= 0 && tabOrder[1] > tabOrder[0] && tabOrder[2] > tabOrder[1]);

  const bSec = sliceSections(bridgeHtml);
  const bAll = bSec.overview + bSec.terms + bSec.plan + bSec.whatIf;
  assert.doesNotMatch(bSec.overview, /<p\b|<small\b|<caption\b/i);
  assert.doesNotMatch(bAll, /Seller financing/i);
  assert.match(bSec.overview, /Bridge loan/);
  assert.match(bSec.overview, /10% IO/);
  assert.match(bSec.overview, /non-Dutch/);
  assert.match(bSec.overview, /\$409,944/);
  assert.match(bSec.overview, /data-ledger-group="feesRolledIn"[\s\S]*aria-expanded="false"/);
  assert.match(bSec.overview, /Fees rolled into loan/);
  assert.match(bSec.overview, /\$0 draw fee/);
  assert.match(bSec.overview, /1 × 3 months at 1\.25%/);
  assert.match(bSec.overview, /Prepayment penalty/);
  assert.match(bSec.overview, /Paid off by refinance after lease-up/);
  assert.doesNotMatch(bSec.overview, /data-wb="private-protections"/);
  assert.match(bSec.terms, /Bridge terms/);
  assert.match(bSec.terms, /LTC \(% of cost\)/);
  assert.match(bSec.terms, /Extension options/);
  assert.match(bSec.terms, /Rehab draws/);
  assert.match(bSec.terms, /Draw fee/);
  assert.match(bSec.terms, /Prepayment penalty/);
  assert.match(bSec.plan, /Bridge loan plan/);
  assert.match(bSec.whatIf, /Loan assumptions/);
  assert.match(bSec.whatIf, /Deferred interest/);
  assert.doesNotMatch(bAll, /\bLTV\b|DSCR|amortiz|Refinance check|Refi fees|Takeout loan/i);
  assert.doesNotMatch(bAll, /\d+%\s*LTV\s*\(\$/i);

  // 2. PRIVATE TAB
  const privProtections = [
    'Your money is secured by a recorded first-lien mortgage on 23 & 27 Charlotte.',
    'A neutral payment company pays you every month, and you see every payment.',
    "You're named on the insurance.",
    '15-day grace, then default.',
    'Monthly updates here: rents, leases and repair photos.',
    'Extra collateral: one of my other rentals backs this loan too.',
  ];
  const privHtml = renderToStaticMarkup(React.createElement(LenderMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com' },
    preview: false,
    initialLens: 'private',
    privateProtections: privProtections,
  }));
  const pSec = sliceSections(privHtml);
  const pAll = pSec.overview + pSec.terms + pSec.plan + pSec.whatIf;
  assert.doesNotMatch(pSec.overview, /<p\b|<small\b|<caption\b/i);
  assert.match(pSec.overview, /data-wb="private-protections"/);
  assert.match(pSec.overview, /aria-expanded="false"[^>]*data-protections-group="private"/);
  assert.match(pSec.overview, /Your protections/);
  assert.match(pSec.overview, /Private pooled loan/);
  assert.match(pSec.overview, /\$404,550/);
  assert.match(pSec.overview, /\$20,000/);
  assert.match(pSec.overview, />8%</);
  assert.match(pSec.overview, /First-lien pooled/);
  assert.match(pSec.overview, /Your return/);
  assert.match(pSec.overview, /\$133\.33\/mo/);
  assert.match(pSec.overview, /Per year at 8%/);
  assert.match(pSec.overview, /First payment after month 1/);
  assert.match(pSec.overview, /12 months, one 3-month extension\. Paid off early at refinance, no prepayment penalty\./);
  assert.match(pSec.overview, /Principal back at payoff/);
  assert.match(pSec.terms, /Private terms/);
  assert.match(pSec.terms, /Your participation/);
  assert.match(pSec.terms, />8%</);
  assert.match(pSec.plan, /Private pool plan/);
  assert.match(pSec.whatIf, /Your share/);
  assert.doesNotMatch(pAll, /points|processing|\$1,295|DSCR|amortiz|Refinance check|Refi fees|Number of extensions|Surplus at refinance|Left over at refinance|Gap at refinance|deferred|deferral|month 3/i);

  // 3. DSCR TAB
  const dscrHtml = renderToStaticMarkup(React.createElement(LenderMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com' },
    preview: false,
    initialLens: 'dscr',
    privateProtections: privProtections,
  }));
  const dSec = sliceSections(dscrHtml);
  const dAll = dSec.overview + dSec.terms + dSec.plan + dSec.whatIf;
  assert.doesNotMatch(dSec.overview, /<p\b|<small\b|<caption\b/i);
  assert.doesNotMatch(dSec.overview, /data-wb="private-protections"/);
  assert.match(dSec.overview, /Commercial DSCR refinance/);
  assert.match(dSec.overview, /75% LTV/);
  assert.match(dSec.overview, /\$586,000/);
  assert.match(dSec.overview, /\$439,500/);
  assert.match(dSec.overview, /1\.25x/);
  assert.match(dSec.overview, /7\.5% · 30 yrs/);
  assert.match(dSec.overview, /Pays off bridge/);
  assert.match(dSec.terms, /DSCR terms/);
  assert.match(dSec.terms, /75% LTV · Value \$586,000 · Loan \$439,500/);
  assert.match(dSec.terms, /Term &amp; amortization/);
  assert.match(dSec.terms, /Prepayment penalty/);
  assert.match(dSec.terms, /Refi fees/);
  assert.match(dSec.plan, /DSCR refinance plan/);
  assert.match(dSec.whatIf, /75%/);
  assert.match(dSec.whatIf, /80%/);
  assert.doesNotMatch(dAll, /points|processing|\$1,295|deferred|non-Dutch|\bLTC\b|Number of extensions|Surplus at refinance|Left over at refinance|Gap at refinance/i);
  assert.doesNotMatch(bAll, /Surplus at refinance|Left over at refinance|Gap at refinance/i);
  assert.doesNotMatch(dAll, /\d+%\s*LTV\s*\(\$/i);
});

test('Owner BuildingNumbers and DealPlanView include 75% and 80% LTV quick toggles', () => {
  const offersSrc = read('src/views/Offers.jsx');
  assert.match(offersSrc, /aria-label="Refinance LTV"/);
  assert.match(offersSrc, /\[75, 80\]\.map/);
  assert.match(offersSrc, /refiLtv: ltv/);

  const dealPlanSrc = read('src/views/DealPlan.jsx');
  assert.match(dealPlanSrc, /aria-label="Refinance LTV"/);
  assert.match(dealPlanSrc, /\[75, 80\]\.map/);
  assert.match(dealPlanSrc, /refiLtv: ltv/);
});

test('rent range 780..1115 defaults to midpoint 948, never exceeds 1115, and As-is is 0 of 10 / $0', () => {
  const rv = rentValue(WHITEBOARD_BASE, WHITEBOARD_PLAN, WHITEBOARD_OFFER);
  assert.equal(rv.marketRange.low, 780);
  assert.equal(rv.marketRange.high, 1115);
  assert.equal(defaultMarketRent(rv.marketRange), 948);

  const asis = rv.views.find((v) => v.key === 'asis');
  assert.equal(asis.rented, 0);
  assert.equal(asis.rentMo, 0);

  const staleRv = { ...rv, views: [{ ...asis, rented: 1, rentMo: 0 }, ...rv.views.slice(1)] };
  const cleanedViews = whatIfViews(staleRv, 948);
  assert.equal(cleanedViews[0].rented, 0);
  assert.equal(cleanedViews[0].rentMo, 0);

  assert.ok(rv.grid.every((r) => r.rent <= 1115));
  const wGrid = whatIfGrid(rv, 948);
  assert.ok(wGrid.every((r) => r.rent <= 1115));
  assert.ok(!wGrid.some((r) => r.rent === 1220));

  const lifted = effectiveMarketRange({ low: 780, high: 1020 }, { marketRentHigh: 1115 });
  assert.equal(lifted.high, 1115);
  assert.equal(defaultMarketRent(lifted), 948);
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
    'bridgePrepayment',
    'bridgeExtensionCount',
    'bridgeExtensionMonths',
    'bridgeExtensionFeePct',
    'bridgeDrawFee',
    'privateRate',
    'privateTermMonths',
    'privateMinParticipation',
  ]) {
    assert.equal(BASE_FIELDS.some(([k]) => k === field), false, `${field} must stay out of BASE_FIELDS`);
  }
  for (const file of ['src/views/Seller.jsx', 'src/views/Realtor.jsx', 'src/components/Switches.jsx']) {
    const src = read(file);
    assert.doesNotMatch(src, /lenderModel|LenderWhatIf|Refinance check|Pays off bridge|bridgeProcessing|bridgePointsPct|bridgeRate|bridgeDeferredMonths|bridgePrepayment|bridgeExtensionCount|bridgeExtensionMonths|bridgeExtensionFeePct|bridgeDrawFee|privateMinParticipation|non-Dutch/i, file);
  }
});
