// Nov 26 phone-first cleanup tests: overallRepairBudget, billsFromRent (0/5/10 units),
// two-column comp sort, UnitSummary, InfoTip sizing, and UI role cleanup guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { STRUCTURES, money, pmt, valueSummary } from '../src/lib/dealmath.js';
import { buildLeadGuide, monthlyPlan, offerSellerSummary, overallRepairBudget, refi, unitsRentedTable } from '../src/lib/dealplan.js';
import { nextCompSort, sortComps } from '../src/lib/v63.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

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

test('overallRepairBudget sums unit rehabs + plan costs + contingency', () => {
  const plan = {
    contingency: 10000,
    units: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), rehab: 8000 })),
    costs: [
      { label: 'Roof', cost: 20000, group: 'systems' },
      { label: 'Permits', cost: 14050, group: 'permits' },
    ],
  };
  assert.equal(overallRepairBudget(plan), 124050);
  assert.equal(overallRepairBudget({}), 0);
});

const WRAP_BASE = {
  units: 10,
  rent: 1000,
  vacancyPct: 5,
  taxes: 12000,      // $1,000/mo
  insurance: 6000,   // $500/mo
  waterMo: 500,      // $500/mo  -> $2,000/mo base bills
  emptyUnitUtilMo: 100,
  reservesPerUnit: 300,
  value: 700000,
  refiRate: 7,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  refiFeesPct: 2,
  refiFeesFlat: 1000,
  refiReserve: 0,
};

const WRAP_PLAN = {
  months: 16,
  refiMonth: 12,
  leaseUpWeeks: 4,
  lenderRate: 12,
  lenderPoints: 2,
  contingency: 5000,
  costs: [{ label: 'Exterior', cost: 5000, start: 0, end: 4, group: 'systems' }],
  units: [
    { id: '1', rehab: 2000, ready: 0, occupied: true },
    { id: '2', rehab: 2000, ready: 4 },
    { id: '3', rehab: 2000, ready: 8 },
    { id: '4', rehab: 2000, ready: 12 },
    { id: '5', rehab: 2000, ready: 16 },
    { id: '6', rehab: 2000, ready: 20 },
    { id: '7', rehab: 2000, ready: 24 },
    { id: '8', rehab: 2000, ready: 28 },
    { id: '9', rehab: 2000, ready: 32 },
    { id: '10', rehab: 2000, ready: 36 },
  ],
};

test('wrap billsFromRent: 0, 5, and 10 units rented pay bills first then note; buyer pays $0 for note/bills; carried bills added at refi', () => {
  assert.ok(STRUCTURES.wrap.fields.some(([k, l, u]) => k === 'billsFromRent' && u === 'bool' && /Bills paid from rent/.test(l)));
  assert.equal(STRUCTURES.wrap.defaults.billsFromRent, false);

  const notePay = pmt(6, 25, 360000); // ~$2,319.49/mo
  const offerOff = { structure: 'wrap', inputs: { note: 360000, rate: 6, amortYears: 25, closing: 3000, billsFromRent: false } };
  const offerOn = { structure: 'wrap', inputs: { note: 360000, rate: 6, amortYears: 25, closing: 3000, billsFromRent: true } };

  const tOff = unitsRentedTable(WRAP_BASE, WRAP_PLAN, offerOff);
  const tOn = unitsRentedTable(WRAP_BASE, WRAP_PLAN, offerOn);
  assert.equal(tOff.billsFromRent, false);
  assert.equal(tOn.billsFromRent, true);

  // 0 units rented: rent = 0, bills = 1000 + 500 + 500 + 10*100 = 3000. Seller carries all 3000; note waits; buyerNet excludes note and bills.
  const r0 = tOn.rows[0];
  assert.equal(r0.rentIn, 0);
  near(r0.billsTotal, 3000);
  near(r0.billsPaidFromRent, 0);
  near(r0.billsSellerCarries, 3000);
  near(r0.sellerCosts, 3000);
  near(r0.notePaid, 0);
  near(r0.noteWaits, notePay);
  assert.equal(r0.covered, 'no');
  near(r0.buyerNet, -tOn.repairLoan.interestUnused);

  // 5 units rented: rent = 5000, bills = 1000 + 500 + 500 + 5*100 = 2500.
  // Bills paid first (2500), remaining 2500 covers full note (~2319.49) -> aboveSellerCosts = 5000 - 2500 - notePay.
  const r5 = tOn.rows[5];
  assert.equal(r5.rentIn, 5000);
  near(r5.billsTotal, 2500);
  near(r5.billsPaidFromRent, 2500);
  near(r5.billsSellerCarries, 0);
  near(r5.notePaid, notePay);
  near(r5.noteWaits, 0);
  assert.equal(r5.covered, 'yes');
  near(r5.buyerNet, (5000 - 2500 - notePay) - tOn.repairLoan.interestUnused - (5 * 300) / 12);

  // 3 units rented: rent = 3000, bills = 2700 -> bills paid in full (2700), note gets remaining 300, rest of note waits, buyer pays $0 for note/bills.
  const r3 = tOn.rows[3];
  near(r3.billsPaidFromRent, 2700);
  near(r3.billsSellerCarries, 0);
  near(r3.notePaid, 300);
  near(r3.noteWaits, notePay - 300);
  assert.equal(r3.covered, 'partly');
  near(r3.buyerNet, -tOn.repairLoan.interestUnused - (3 * 300) / 12);

  // 10 units rented: rent = 10000, bills = 2000, note covered in full.
  const r10 = tOn.rows[10];
  assert.equal(r10.rentIn, 10000);
  near(r10.billsTotal, 2000);
  near(r10.billsPaidFromRent, 2000);
  near(r10.billsSellerCarries, 0);
  near(r10.notePaid, notePay);
  near(r10.noteWaits, 0);
  assert.equal(r10.covered, 'yes');
  near(r10.buyerNet, (10000 - 2000 - notePay) - tOn.repairLoan.interestUnused - (10 * 300) / 12);

  // Refinance payoff adds running carried bills and UnitsRentedGuide displays "Seller's carried bills, paid at refinance"
  const refiOff = refi(WRAP_BASE, WRAP_PLAN, offerOff);
  const refiOn = refi(WRAP_BASE, WRAP_PLAN, offerOn);
  assert.equal(refiOff.sellerCarriedBills, 0);
  assert.ok(refiOn.sellerCarriedBills > 0);
  near(refiOn.sellerPayoff, 360000 + refiOn.sellerCarriedBills);
  near(refiOff.leftForYou - refiOn.leftForYou, refiOn.sellerCarriedBills);

  const planRes = monthlyPlan('wrap', offerOn.inputs, WRAP_BASE, WRAP_PLAN);
  assert.ok(planRes.exit.sellerCarriedBills > 0);

  const summary = offerSellerSummary({ name: 'B: Seller financing', ...offerOn }, WRAP_BASE, WRAP_PLAN, [], false);
  assert.equal(summary.billsFromRent, true);
  assert.match(summary.intro, /holding bills.*first, then your note/i);
  assert.match(summary.refiLine, /carried bills/);
  assert.doesNotMatch(JSON.stringify({ intro: summary.intro, terms: summary.terms, steps: summary.steps, refiLine: summary.refiLine }), /interest|reserve|DSCR|left for you/i);

  // UnitsRentedGuide renders the refi carried bills row
  const guide = buildLeadGuide(WRAP_BASE, WRAP_PLAN, offerOn);
  const shellMock = { OverlayTrigger: ({ children, className }) => React.createElement('button', { type: 'button', className }, children) };
  const CostSummary = loadJsx('src/components/CostSummary.jsx', { './Shell.jsx': shellMock }).default;
  const UnitsRentedGuide = loadJsx('src/components/UnitsRentedGuide.jsx', {
    './CostSummary.jsx': CostSummary,
    './Shell.jsx': shellMock,
    '../lib/dealmath.js': { money },
  }).default;
  const guideHtml = renderToStaticMarkup(React.createElement(UnitsRentedGuide, { guide }));
  assert.match(guideHtml, /Seller’s carried bills, paid at refinance/);
});

test('sortComps and nextCompSort support two-column sorting with nulls last', () => {
  const rows = [
    { id: '1', units: 8, sale_price: 400000, distance_mi: 1.2 },
    { id: '2', units: 8, sale_price: 500000, distance_mi: 2.5 },
    { id: '3', units: 10, sale_price: 600000, distance_mi: null },
    { id: '4', units: 8, sale_price: 400000, distance_mi: 0.5 },
  ];
  const s1 = nextCompSort({ key: null, dir: 'asc', key2: null, dir2: 'asc' }, 'units', false);
  assert.deepEqual(s1, { key: 'units', dir: 'desc', key2: null, dir2: 'asc' });
  const s2 = nextCompSort(s1, 'sale_price', true);
  assert.deepEqual(s2, { key: 'units', dir: 'desc', key2: 'sale_price', dir2: 'desc' });
  assert.deepEqual(sortComps(rows, s2.key, s2.dir, s2.key2, s2.dir2).map((r) => r.id), ['3', '2', '1', '4']);
  // Null distance stays last in secondary sort
  const byPriceThenDist = sortComps(rows, 'units', 'asc', 'distance_mi', 'asc');
  assert.deepEqual(byPriceThenDist.map((r) => r.id), ['4', '1', '2', '3']);
});

test('UnitSummary renders unit name, repair budget, occupancy, and note; InfoTip has 32px target and 14px icon', () => {
  const { UnitSummary } = loadJsx('src/components/UnitGallery.jsx', {
    '../lib/supabase.js': { supabase: {}, BUCKET: 'b' },
    '../lib/dealmath.js': { money },
    '../lib/leaseUp.js': { WALK_SPACES: [], WALK_UNITS: 10, spaceLabel: () => '', ROOMS: [], AREA_ROOMS: [] },
    '../lib/format.js': { when: () => '' },
    '../lib/people.js': { authorLabel: () => '' },
    '../lib/v63.js': { visibleUnitNotes: () => [], canWriteUnitNotes: () => false },
    '../lib/site.js': { SITE_KIND: '', canAccessDealPlan: () => false },
    './Shell.jsx': { Button: () => null, Card: () => null, Empty: () => null, InfoTip: () => null },
    './PhotoViewer.jsx': { __esModule: true, default: () => null, ThumbOverlay: () => null },
    './Dictation.jsx': { DictatedField: () => null },
    '../lib/walkShare.js': { WALK_SHARES: [], saveWalkShare: async () => null, walkShareButtons: () => [] },
  });
  const html = renderToStaticMarkup(React.createElement(UnitSummary, {
    unit: 4,
    summary: { id: '4', repairs: 12000, occupied: true, note: 'New bath tile' },
  }));
  assert.match(html, /Unit 4 · Repair budget: \$12,000 · Rented/);
  assert.match(html, /New bath tile/);

  const shellSrc = read('src/components/Shell.jsx');
  assert.match(shellSrc, /h-8 w-8/);
  assert.match(shellSrc, /h-3\.5 w-3\.5/);
});

test('Phone-first cleanup structural guards across all 15 items', () => {
  // 1 & 2: Dashboard has no Activity and no Switches; Owner & Realtor have Recent activity tab
  assert.doesNotMatch(read('src/views/Dashboard.jsx'), /<Activity|Switches/);
  assert.match(read('src/views/Owner.jsx'), /\['activity', 'Recent activity'\]/);
  assert.match(read('src/views/Realtor.jsx'), /\['activity', 'Recent activity'\]/);

  // 3: LeadGuest deleted and removed from UI
  assert.equal(existsSync(join(root, 'src/views/LeadGuest.jsx')), false);
  for (const f of ['src/views/Owner.jsx', 'src/views/DealRoom.jsx', 'src/components/AccessRequests.jsx', 'src/lib/format.js', 'src/views/Offers.jsx']) {
    assert.doesNotMatch(read(f), /lead_guest|LeadGuest|Lead guest/, f);
  }

  // 5 & 6: Repair budget everywhere, no tenthUnitRepair/Rent-ready budget, Switches empty
  for (const f of ['src/lib/dealmath.js', 'src/lib/dealplan.js', 'src/views/DealPlan.jsx', 'src/components/Switches.jsx', 'src/views/Reviewer.jsx']) {
    assert.doesNotMatch(read(f), /tenthUnitRepair|Rent-ready budget/, f);
  }

  // 7: BuildingNumbers closed by default behind "Assumptions"
  const offersSrc = read('src/views/Offers.jsx');
  assert.match(offersSrc, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(offersSrc, /Assumptions/);
  assert.match(offersSrc, /hideUnitsTable=\{role === 'reviewer'\}/);

  // 8 & 10: Reviewer has no Ideas tab and no UnitsRentedGuide
  const revSrc = read('src/views/Reviewer.jsx');
  assert.doesNotMatch(revSrc, /StrategyIdeas|<UnitsRentedGuide/);
  assert.match(revSrc, /QuickOpinion/);

  // 11: Comps has Select all / Clear and Then by picker
  const compsSrc = read('src/views/Comps.jsx');
  assert.match(compsSrc, /Select all/);
  assert.match(compsSrc, /id="comp-sort-2"/);

  // 13: Realtor hides Tenants tab (code kept) and Messages hides "(Buyer sees it)" for realtor
  const realtorSrc = read('src/views/Realtor.jsx');
  assert.match(realtorSrc, /active === 'tenants' && <Tenants/);
  assert.doesNotMatch(realtorSrc.slice(realtorSrc.indexOf('const TABS ='), realtorSrc.indexOf('];', realtorSrc.indexOf('const TABS ='))), /tenants/);
  const msgSrc = read('src/components/Messages.jsx');
  assert.doesNotMatch(msgSrc.slice(msgSrc.indexOf('function slotLabel'), msgSrc.indexOf("if (k === 'realtor' && role === 'lender')")), /sees it/);

  // 15: No "How I'll get this done" anywhere in src
  assert.doesNotMatch(read('src/components/LeadOfferCard.jsx'), /How I[’']ll get this done/);
  assert.match(read('src/components/LeadOfferCard.jsx'), /<CardTitle>The plan<\/CardTitle>/);
});
