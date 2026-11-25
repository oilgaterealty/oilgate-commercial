// Tests for Option E (seller_rehab): cash waterfall, fillTarget rent split, seller loan amortization,
// buyout toggle, refinance cash-out, overlays, and UI rendering. Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, buildLeadStory, evaluate, grade, money, pct, pmt, valueSummary } from '../src/lib/dealmath.js';
import { OPTION_E_OVERLAY, buildOfferStory, buildSellerSummary, derivations, monthlyPlan, normalizePlan } from '../src/lib/dealplan.js';
import { plain } from '../src/lib/plain.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadJsx(file, mocks) {
  let src = read(file);
  if (file === 'src/views/Offers.jsx') src = src.replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
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

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

const BASE = {
  units: 10,
  tenthUnitRepair: 20000,
  rent: 1200,
  vacancyPct: 5,
  taxes: 12000,
  insurance: 6000,
  utilities: 6000,
  admin: 2400,
  turns: 1200,
  mgmtPct: 10,
  reservesPerUnit: 300,
  value: 800000,
  refiRate: 7,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  refiFeesPct: 2,
  refiFeesFlat: 2000,
  refiReserve: 0,
};

const PLAN = normalizePlan({
  months: 16,
  refiMonth: 12,
  leaseUpWeeks: 4,
  lenderRate: 12,
  lenderPoints: 2,
  sellerLoanBalance: 200000,
  sellerLoanRate: 6,
  sellerLoanYears: 30,
  units: [
    { id: '1', rehab: 0, ready: 0, occupied: true },
    { id: '2', rehab: 0, ready: 0, occupied: true },
    { id: '3', rehab: 0, ready: 0, occupied: true },
    { id: '4', rehab: 0, ready: 16, optional: true },
    { id: '5', rehab: 2000, ready: 2 },
    { id: '6', rehab: 2000, ready: 4 },
    { id: '7', rehab: 2000, ready: 6 },
    { id: '8', rehab: 2000, ready: 8 },
    { id: '9', rehab: 2000, ready: 10 },
    { id: '10', rehab: 2000, ready: 12 },
  ],
  costs: [
    { label: 'Exterior', cost: 10000, start: 0, end: 4, group: 'systems' },
    { label: 'Permits', cost: 4000, start: 0, end: 2, group: 'permits' },
  ],
});

test('Option E is registered in STRUCTURES with exact label and fields', () => {
  const s = STRUCTURES.seller_rehab;
  assert.ok(s);
  assert.equal(s.label, 'Seller funds part of the rehab, buyout at refi');
  assert.deepEqual(s.fields.map(([k]) => k), [
    'sellerFund', 'fillTarget', 'buyerSplitPct', 'refiMonth', 'closing', 'buyerCash', 'addFundToBuyout',
  ]);
  assert.equal(s.defaults.fillTarget, 7);
  assert.equal(s.defaults.buyerSplitPct, 50);
  assert.equal(s.defaults.addFundToBuyout, false);
});

test('Option E gives seller all extra before fillTarget and splits after fillTarget', () => {
  const inputs = { sellerFund: 25000, fillTarget: 7, buyerSplitPct: 40, refiMonth: 12, closing: 5000, buyerCash: 0, addFundToBuyout: false };
  const res = monthlyPlan('seller_rehab', inputs, BASE, PLAN);

  const beforeTarget = res.rows.filter((r) => r.month < 12 && r.renting < 7 && (r.noi - r.reserves - r.bank - r.interest) > 0);
  assert.ok(beforeTarget.length > 0);
  for (const r of beforeTarget) {
    const extra = r.noi - r.reserves - r.bank - r.interest;
    near(r.seller, extra);
    near(r.keeps, 0);
  }

  const atOrAfterTarget = res.rows.filter((r) => r.month < 12 && r.renting >= 7 && (r.noi - r.reserves - r.bank - r.interest) > 0);
  assert.ok(atOrAfterTarget.length > 0);
  for (const r of atOrAfterTarget) {
    const extra = r.noi - r.reserves - r.bank - r.interest;
    near(r.keeps, extra * 0.4);
    near(r.seller, extra * 0.6);
  }
});

test('Option E uses buyerCash first, then sellerFund, then lender draws with points', () => {
  const noBuyerCash = monthlyPlan('seller_rehab', { sellerFund: 15000, buyerCash: 0, refiMonth: 12 }, BASE, PLAN);
  const withSellerFund = monthlyPlan('seller_rehab', { sellerFund: 15000, buyerCash: 5000, refiMonth: 12 }, BASE, PLAN);
  const noSellerFund = monthlyPlan('seller_rehab', { sellerFund: 0, buyerCash: 5000, refiMonth: 12 }, BASE, PLAN);

  assert.equal(withSellerFund.totals.sellerFundUsed, 15000);
  assert.ok(withSellerFund.totals.peakLender < noSellerFund.totals.peakLender);
  assert.ok(withSellerFund.totals.peakLender < noBuyerCash.totals.peakLender);

  // Month 1 draws cover remaining deficit with 2% points: draw = need / 0.98
  const m1 = noSellerFund.rows[0];
  if (m1.draw > 0) {
    near(m1.points, m1.draw * 0.02, 0.01);
  }
});

test('Option E amortizes seller loan, sets buyout to remaining balance, and toggles sellerFund', () => {
  // Verify exact 12-month amortization balance of $200,000 at 6% / 30 yrs
  const monthlyPmt = pmt(6, 30, 200000);
  let bal = 200000;
  for (let m = 1; m <= 12; m++) {
    const int = bal * (6 / 100 / 12);
    bal -= monthlyPmt - int;
  }

  const offRes = monthlyPlan('seller_rehab', { sellerFund: 25000, closing: 5000, refiMonth: 12, addFundToBuyout: false }, BASE, PLAN);
  const onRes = monthlyPlan('seller_rehab', { sellerFund: 25000, closing: 5000, refiMonth: 12, addFundToBuyout: true }, BASE, PLAN);

  near(offRes.exit.sellerPayoff, bal, 0.05);
  assert.ok(offRes.exit.sellerPayoff < 200000);
  near(onRes.exit.sellerPayoff - offRes.exit.sellerPayoff, 25000, 0.01);

  // Cash out = refiNet - buyout - lenderPayoff - closing
  near(offRes.exit.left, offRes.exit.net - offRes.exit.sellerPayoff - offRes.exit.lenderPayoff - 5000, 0.01);
  near(onRes.exit.left, onRes.exit.net - onRes.exit.sellerPayoff - onRes.exit.lenderPayoff - 5000, 0.01);

  // After refi month, monthly left = full.cashFlow - refiPayment (no more seller payments)
  const afterRow = offRes.rows[12]; // month 13
  assert.equal(afterRow.stage, 'after');
  near(afterRow.seller, 0);
  near(afterRow.bank, offRes.full.refiPayment);
  near(afterRow.keeps, offRes.full.cashFlow - offRes.full.refiPayment);
});

test('Option E includes explanatory overlay and renders in Card, Table, Plans, and plain()', () => {
  const res = monthlyPlan('seller_rehab', { sellerFund: 25000, fillTarget: 7, buyerSplitPct: 50, refiMonth: 12, closing: 5000 }, BASE, PLAN);
  const story = buildOfferStory(res, { base: BASE });
  const deriv = derivations(res).map((x) => x.join(' ')).join('\n');
  const leadStory = buildLeadStory('seller_rehab', evaluate('seller_rehab', { sellerFund: 25000 }, BASE), { base: BASE });
  const sellerSum = buildSellerSummary({ name: 'E: Seller funds part of the rehab, buyout at refi', structure: 'seller_rehab' }, res, { base: BASE });
  const plainSummary = plain('seller_rehab', evaluate('seller_rehab', { sellerFund: 25000, fillTarget: 7, buyerSplitPct: 50, refiMonth: 12 }, BASE));

  assert.ok(JSON.stringify(story).includes(OPTION_E_OVERLAY));
  assert.ok(deriv.includes(OPTION_E_OVERLAY));
  assert.ok(JSON.stringify(leadStory).includes(OPTION_E_OVERLAY));
  assert.ok(JSON.stringify(sellerSum).includes(OPTION_E_OVERLAY));
  assert.match(plainSummary.risk, /His rehab money is only paid back through his share of the rent/);

  const offersMod = loadJsx('src/views/Offers.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../components/Dictation.jsx': { DictatedField: (p) => React.createElement(p.as || 'input', p) },
    '../lib/supabase.js': { supabase: {} },
    '../lib/useDealModel.js': { useDealModel: () => ({}) },
    '../components/Switches.jsx': { __esModule: true, default: () => null, SendWhatIf: () => null },
    '../components/CostSummary.jsx': { __esModule: true, default: () => null },
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, buildLeadStory, evaluate, grade, money, pct, valueSummary },
    '../components/Shell.jsx': {
      Card: ({ children }) => React.createElement('section', null, children),
      Button: ({ children, ...p }) => React.createElement('button', p, children),
      Badge: ({ children }) => React.createElement('span', null, children),
      Empty: ({ children }) => React.createElement('p', null, children),
      InfoTip: () => null,
      OverlayTrigger: ({ children, className }) => React.createElement('button', { type: 'button', className }, children),
    },
    '../lib/plain.js': { plain },
    '../lib/occupancy.js': { breakEvenCount: () => '6 of 10 units' },
    '../lib/site.js': { SITE_KIND: '', canAccessDealPlan: () => true },
  });

  const offer = { id: 'oe', name: 'E: Seller funds part of the rehab, buyout at refi', structure: 'seller_rehab', is_lead: false, inputs: { sellerFund: 25000 } };
  const cardHtml = renderToStaticMarkup(React.createElement(offersMod.OptionCard, { o: offer, i: 4, story, planHref: '#/d/demo/plans/seller_rehab' }));
  const tableHtml = renderToStaticMarkup(React.createElement(offersMod.OptionTable, { offers: [offer], stories: { oe: story }, planHrefOf: () => '#/d/demo/plans/seller_rehab' }));

  assert.match(cardHtml, /Seller funds part of the rehab, buyout at refi/);
  assert.match(tableHtml, /Seller funds part of the rehab, buyout at refi/);
  assert.match(cardHtml, /\(or what he owes\)/);
});
