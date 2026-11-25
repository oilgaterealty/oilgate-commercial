// Tests for the offer-as-plan story, valuation helpers, non-scrolling overlays, and access boundaries.
// Uses made-up test buildings only; real deal numbers live only in the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, buildLeadStory, compsMedian, evaluate, money, valueSummary } from '../src/lib/dealmath.js';
import { buildOfferStory, monthlyPlan, normalizePlan, ordinal } from '../src/lib/dealplan.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadJsx(file, mocks) {
  let src = read(file);
  if (file === 'src/views/Offers.jsx') {
    src = src.replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
  }
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

const TEST_BASE = {
  units: 10,
  tenthUnitRepair: 30000,
  rent: 1100,
  vacancyPct: 5,
  taxes: 12000,
  insurance: 6000,
  utilities: 6000,
  admin: 2400,
  turns: 1200,
  mgmtPct: 10,
  reservesPerUnit: 300,
  value: 750000,
  valueBasis: 'income',
  valueCapRate: 9,
  valueSource: 'Sample valuation note',
  rehab: 0,
  refiRate: 7,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  refiFeesPct: 2,
  refiFeesFlat: 2000,
  refiReserve: 0,
};

const TEST_PLAN = normalizePlan({
  months: 18,
  refiMonth: 12,
  leaseUpWeeks: 4,
  rehabStartWeek: 0,
  lenderRate: 12,
  lenderPoints: 2,
  sellerLoanBalance: 150000,
  sellerLoanRate: 5,
  sellerLoanYears: 30,
  units: [
    { id: '9', rehab: 0, ready: 0, occupied: true },
    { id: '5', rehab: 4000, ready: 8 },
    { id: '1', rehab: 5000, ready: 10 },
    { id: '2', rehab: 5000, ready: 12 },
    { id: '3', rehab: 5000, ready: 14 },
    { id: '4', rehab: 5000, ready: 16 },
    { id: '6', rehab: 5000, ready: 18 },
    { id: '7', rehab: 5000, ready: 20 },
    { id: '8', rehab: 5000, ready: 22 },
    { id: '10', rehab: 0, ready: 24, optional: true },
  ],
  costs: [
    { label: 'Building systems', cost: 15000, start: 0, end: 8, group: 'systems' },
    { label: 'Permits and utilities', cost: 3000, start: 0, end: 4, group: 'other' },
  ],
});

const TEST_COMPS = [
  { units: 4, sale_price: 200000 }, // 50k/unit
  { units: 6, sale_price: 360000 }, // 60k/unit
  { units: 5, sale_price: 350000 }, // 70k/unit
  { units: 8, sale_price: 640000 }, // 80k/unit -> median 65k/unit
];

test('compsMedian and valueSummary compute income primary and median comps secondary with math in overlays', () => {
  const cm = compsMedian(TEST_COMPS, 10);
  assert.equal(cm.count, 4);
  assert.equal(cm.perUnit, 65000);
  assert.equal(cm.total, 650000);

  const val = valueSummary({ base: TEST_BASE, noi: 81000, units: 10, comps: TEST_COMPS });
  assert.equal(val.incomeLine, 'Value by income: $750,000 ($75,000/unit)');
  assert.equal(val.compsLine, 'By comps: $650,000 ($65,000/unit)');
  assert.ok(val.incomeOverlay.some((l) => l.includes('81,000') && l.includes('9%')));
  assert.ok(val.incomeOverlay.some((l) => l.includes('Sample valuation note')));
  assert.ok(val.compsOverlay[0].includes('$65,000 median/unit × 10 units = $650,000'));
});

test('ordinal formats 1st through 12th and 21st cleanly', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(10), '10th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(21), '21st');
});

test('buildOfferStory computes all 7 steps, headline metrics, rehab sum, estimates, and self-explaining wording', () => {
  // Offer with $0 buyerCash and positive cash out at refinance
  const resTakeHome = monthlyPlan('master_lease', {
    payment: 2000,
    optionPrice: 300000,
    sellerAdvances: 20000,
    creditPct: 100,
    exerciseClosing: 5000,
    buyerCash: 0,
  }, TEST_BASE, TEST_PLAN);
  const story = buildOfferStory(resTakeHome, { base: TEST_BASE, comps: TEST_COMPS });

  assert.equal(story.headline.moneyIn.value, '$0');
  assert.equal(story.headline.cashOut.positive, true);
  assert.match(story.headline.cashOut.value, /^\$/);
  assert.equal(story.headline.sellerTotal.value, money(resTakeHome.totals.sellerTotal));
  assert.equal(story.headline.maxSellerAtRefi.value, money(resTakeHome.exit.maxSellerPayoff));
  assert.equal(story.steps.length, 7);

  // Step 1: Take over shows seller payment math (scaled by 1 of 10 units renting)
  const s1 = story.steps[0];
  assert.equal(s1.title, 'Take over');
  assert.equal(s1.lines[0].value, '$200/mo');
  assert.ok(s1.lines[0].overlay.some((l) => l.includes('$2,000 full payment × 1 of 10 units renting = $200/mo')));

  // Step 2: Rehab sums unit work (incl. $30K Unit 10) + building systems + other one-time costs
  const s2 = story.steps[1];
  const expectedRehab = 39000 + 30000 + 15000 + 3000;
  assert.equal(s2.lines[0].value, money(expectedRehab));
  assert.ok(s2.lines[0].overlay.some((l) => l.includes('Unit 10 rent-ready work: $30,000')));
  assert.ok(s2.lines[0].overlay.some((l) => l.includes('Building systems: $15,000')));

  // Step 3: Holding cost marks estimates and explains negative cash flow without bare "You keep"
  const s3 = story.steps[2];
  assert.ok(s3.lines[0].overlay.some((l) => l.includes('(estimate)')));
  assert.match(s3.lines[1].label, /Short \$.* a month while fixing up \(covered by /);

  // Step 4: Lease-up has ordinals
  const s4 = story.steps[3];
  assert.match(s4.pills[0].label, /^1st Unit 9 · month 1$/);
  assert.match(s4.pills[1].label, /^2nd Unit 5 · month /);
  assert.match(s4.pills[9].label, /^10th Unit 10 · month /);

  // Step 5: Full
  const s5 = story.steps[4];
  assert.deepEqual(s5.lines.map((l) => l.label), ['Rent in', 'Running costs', 'Seller payment', 'Left over each month after every bill']);

  // Step 6: Refinance shows income + comps + You take home in big type
  const s6 = story.steps[5];
  assert.ok(s6.lines.some((l) => l.label.startsWith('Value by income:')));
  assert.ok(s6.lines.some((l) => l.label.startsWith('By comps:')));
  assert.ok(s6.lines.some((l) => l.big && l.label.startsWith('You take home ')));

  // Offer where buyer must bring cash at refinance
  const resBring = monthlyPlan('wrap', { note: 700000, rate: 5, buyerCash: 0 }, TEST_BASE, TEST_PLAN);
  const storyBring = buildOfferStory(resBring, { base: TEST_BASE, comps: TEST_COMPS });
  assert.equal(storyBring.headline.cashOut.positive, false);
  assert.match(storyBring.headline.cashOut.value, /^Bring \$/);
  assert.match(storyBring.headline.moneyIn.value, /month 12 refi/);
  assert.ok(storyBring.steps[5].lines.some((l) => l.big && l.label.startsWith('You bring ')));

  // Partnership and Cash structures also produce 7 valid steps
  for (const [st, inp] of [
    ['partnership', { buyout: 300000, sellerAdvances: 15000, stepUp: 1000, monthsToBuyout: 12, closing: 4000 }],
    ['cash', { price: 450000, downPct: 25, rate: 7, years: 30, closingPct: 2 }],
  ]) {
    const p = monthlyPlan(st, inp, TEST_BASE, TEST_PLAN);
    const s = buildOfferStory(p, { base: TEST_BASE, comps: TEST_COMPS });
    assert.equal(s.steps.length, 7);
    assert.ok(!JSON.stringify(s).includes('You keep'));
  }
});

test('Offers OptionCard and OptionTable render the 7-step monthlyPlan story with zero bare "You keep"', () => {
  const offersMod = loadJsx('src/views/Offers.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer', possessive: () => "Buyer's" },
    '../components/Dictation.jsx': { DictatedField: (p) => React.createElement(p.as || 'input', p) },
    '../lib/supabase.js': { supabase: {} },
    '../lib/useDealModel.js': { useDealModel: () => ({}) },
    '../components/Switches.jsx': { default: () => null, SendWhatIf: () => null },
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS: [], STRUCTURES: {}, buildLeadStory, evaluate, grade: () => 'none', money, pct: (v) => `${v}%`, valueSummary },
    '../components/Shell.jsx': {
      Card: ({ children }) => React.createElement('section', null, children),
      CardTitle: ({ children }) => React.createElement('h2', null, children),
      Button: ({ children, ...p }) => React.createElement('button', p, children),
      Badge: ({ children }) => React.createElement('span', null, children),
      Empty: ({ children }) => React.createElement('p', null, children),
      InfoTip: () => null,
      OverlayTrigger: ({ children, className }) => React.createElement('button', { type: 'button', className }, children),
    },
    '../lib/plain.js': { plain: () => ({ glance: '', lines: [], risk: '' }) },
    '../lib/occupancy.js': { breakEvenCount: () => '6 of 10' },
    '../lib/site.js': { SITE_KIND: '', canAccessDealPlan: () => true },
  });

  const offer = { id: 'o1', name: 'A: Lease option', structure: 'master_lease', is_lead: true, inputs: { payment: 2000, optionPrice: 300000, sellerAdvances: 20000, creditPct: 100, exerciseClosing: 5000, buyerCash: 0 } };
  const planRes = monthlyPlan(offer.structure, offer.inputs, TEST_BASE, TEST_PLAN);
  const story = buildOfferStory(planRes, { base: TEST_BASE, comps: TEST_COMPS });
  const cardHtml = renderToStaticMarkup(React.createElement(offersMod.OptionCard, { o: offer, i: 0, story, planHref: '#/d/charlotte/plans/master_lease' }));
  const tableHtml = renderToStaticMarkup(React.createElement(offersMod.OptionTable, { offers: [offer], stories: { o1: story }, planHrefOf: () => '#/d/charlotte/plans/master_lease' }));

  for (const html of [cardHtml, tableHtml]) {
    assert.match(html, /Your money in/);
    assert.match(html, /Cash out at refinance/);
    assert.match(html, /Seller gets in total/);
    assert.match(html, /Most the seller can get at refi with \$0 from you/);
    assert.match(html, /Month by month/);
    assert.match(html, /1st Unit 9 · month 1/);
    assert.match(html, /Value by income:/);
    assert.match(html, /By comps:/);
    assert.match(html, /You take home/);
    assert.doesNotMatch(html, /You keep/);
  }
});

test('Plans removes as-is switch, defaults Unit 10 to $30K, uses plain pending wording, and overlays never scroll inside', () => {
  assert.equal(BASE_DEFAULTS.tenthUnitRepair, 30000);

  const dealPlanSrc = read('src/views/DealPlan.jsx');
  const shellSrc = read('src/components/Shell.jsx');
  const citySrc = read('src/components/CityRecordsView.jsx');
  const leadGuestSrc = read('src/views/LeadGuest.jsx');
  const offersSrc = read('src/views/Offers.jsx');

  assert.doesNotMatch(dealPlanSrc, /as-is|Pending lender underwriting|Stabilized 10 units \(pending approvals\)/i);
  assert.doesNotMatch(leadGuestSrc, /as-is/i);
  assert.match(dealPlanSrc, /No lender has confirmed yet/);
  assert.match(dealPlanSrc, /Unit 10 rehab/);
  assert.match(dealPlanSrc, /Left over each month after every bill/);

  // No max-h-* or overflow-y-auto in any overlay/tooltip
  assert.doesNotMatch(shellSrc, /max-h-|overflow-y-auto/);
  assert.doesNotMatch(dealPlanSrc, /max-h-|overflow-y-auto/);
  assert.doesNotMatch(citySrc.slice(citySrc.indexOf('function SourceOverlay')), /max-h-|overflow-y-auto/);

  // Access gating: seller/public builds never load dealplan; guest views never import dealplan
  assert.match(offersSrc, /import\.meta\.env\.VITE_SITE_KIND === 'public' \|\| import\.meta\.env\.VITE_SITE_KIND === 'seller'\s*\?\s*null/);
  assert.match(offersSrc, /canAccessDealPlan\(SITE_KIND, role, preview\)/);
  assert.match(offersSrc, /monthlyPlan\(/);
  for (const view of ['Seller.jsx', 'Lender.jsx', 'Realtor.jsx', 'Reviewer.jsx', 'LeadGuest.jsx']) {
    assert.doesNotMatch(read(`src/views/${view}`), /dealplan|DealPlan|deal_plan/i, view);
  }
});

test('no forbidden wording anywhere in src or new test', () => {
  const banned = new RegExp(['QU1IQQ==', 'U2VjdGlvbiA4', 'Z3JvdXAgaG9tZQ==', 'c3VibGVhc2U='].map((b) => Buffer.from(b, 'base64').toString('utf8')).join('|'), 'i');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of [...walk(join(root, 'src')), join(root, 'tests/offer-plan-story.test.mjs')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), banned, file);
  }
});
