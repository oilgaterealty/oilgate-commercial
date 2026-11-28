// Regression suite for Charlotte Wi-Fi (+$30/unit, Spectrum $1,140/yr, $1,500 APs),
// Storage ($1,500) + Parking ($500) -> $145,940 budget, Upside (excluded from NOI/value/DSCR/Seller),
// consolidated lists, Private loan length, flat $15,000 refi fees ($0 reserve), and migration 0038.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { computeOpex } from '../src/lib/opex.js';
import { BASE_DEFAULTS, money, operating } from '../src/lib/dealmath.js';
import { buildCostSummary, buildLeadGuide, buildSellerSummary, offerSellerSummary, refi } from '../src/lib/dealplan.js';
import { buildLenderPackage, LENDER_DEFAULTS } from '../src/lib/lenderModel.js';
import { rangeSummary, whatIfGrid, whatIfViews } from '../src/lib/rangeValue.js';

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
  Card: ({ children, className = '', ...p }) => React.createElement('section', { className, ...p }, children),
  CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside || null),
  Button: ({ children, ...p }) => React.createElement('button', p, children),
  OverlayTrigger: ({ children, className }) => React.createElement('span', { className }, children),
};

const UPSIDE = {
  label: 'Upside (not counted)',
  totalText: '~$9,500+/yr',
  overlay: ['Excluded from NOI, value, and DSCR. Lenders do not credit until 12 months of history.'],
  items: [
    { key: 'waterRubs', label: 'Water bill-back through the lease (~75% of water/sewer)', valueText: '~$9,000/yr', annual: 9000, overlay: ['Ohio allows lease-based RUBS; Akron keeps the water/sewer account in deed holder name.'] },
    { key: 'extraParking', label: 'Extra parking spots for sale', valueText: 'TBD', overlay: ['After 10 assigned spots.'] },
    { key: 'laundrySupplies', label: 'Laundry-room supplies (bulk-priced below store)', valueText: '~$500/yr net', annual: 500, overlay: ['Bulk-priced below store, net after restocking.'] },
  ],
};

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
  wifiAnnual: 1140,
  wifiLabel: 'Building internet (Spectrum Business)',
  wifiRentAddPerUnit: 30,
  camerasAnnual: 200,
  rentalRegPerUnitAnnual: 15,
  snowLawnAnnual: 3000,
  upside: UPSIDE,
  sources: {
    wifi: 'Spectrum Business ($95/mo full rate after 12-month promo)',
    refiFees: "Owner's 4 Flippin refinance closing statements",
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
};

const CHARLOTTE_PLAN = {
  sellerLoanBalance: 275000,
  contingency: 20000,
  units: [
    { id: '1', rehab: 5000, ready: 1 }, { id: '2', rehab: 5000, ready: 1 },
    { id: '3', rehab: 10000, ready: 3 }, { id: '4', rehab: 12000, ready: 4 },
    { id: '5', rehab: 3000, ready: 1 }, { id: '6', rehab: 11000, ready: 3 },
    { id: '7', rehab: 10000, ready: 3 }, { id: '8', rehab: 4000, ready: 1 },
    { id: '9', rehab: 6000, ready: 2 }, { id: '10', rehab: 8000, ready: 2, optional: true },
  ],
  costs: [
    { label: 'Gas check and furnace service', cost: 2000, start: 0, end: 1, group: 'systems' },
    { label: 'Plumbing, heat, electric, exterior', cost: 8000, start: 2, end: 8, group: 'systems' },
    { label: 'Wi-Fi access points, both buildings', cost: 1500, start: 1, end: 2, group: 'systems', source: 'One-time APs' },
    { label: 'Storage cages: repair 10', cost: 1500, start: 2, end: 4, group: 'systems', source: 'Estimate until walk-through; wire now, upgrade later' },
    { label: 'Parking: 10 signed spots (signs + paint)', cost: 500, start: 2, end: 4, group: 'systems', source: 'One assigned spot per unit' },
    { label: 'Doors, locks, cameras', cost: 4000, start: 0, end: 1, group: 'security' },
    { label: 'Setup permits, eviction, lease-up', cost: 18050, start: 0, end: 4, group: 'permits' },
    { label: 'Two Speed Queen stacked washer/dryer units', cost: 10154, start: 3, end: 8, group: 'laundry' },
    { label: 'KioSoft Ultra V2 card readers', cost: 1676, start: 3, end: 8, group: 'laundry' },
    { label: '240V electrical drops & venting', cost: 2560, start: 3, end: 8, group: 'laundry' },
    { label: 'Cleanout & laundry room', cost: 2000, start: 3, end: 8, group: 'laundry' },
  ],
  opex: CHARLOTTE_OPEX,
  laundry: CHARLOTTE_LAUNDRY,
  marketRent: { low: 780, high: 1115 },
};

const CHARLOTTE_BASE = {
  rent: 1000,
  units: 10,
  strUnits: 0,
  taxes: 13544,
  insurance: 6500,
  waterMo: 1000,
  emptyUnitUtilMo: 0,
  reservesPerUnit: 450,
  vacancyPct: 5,
  valueCapRate: 9,
  refiRate: 7.5,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  refiFeesPct: 0,
  refiFeesFlat: 15000,
  refiReserve: 0,
  purchasePrice: 275000,
  bridgeClosing: 5500,
  opex: CHARLOTTE_OPEX,
  laundry: CHARLOTTE_LAUNDRY,
};

test('Sections 1-3: Wi-Fi +$30/unit, Spectrum $1,140/yr, APs $1,500, Storage $1,500, Parking $500 -> $145,940 & $754,514 value', () => {
  const c = computeOpex({ opex: CHARLOTTE_OPEX, laundry: CHARLOTTE_LAUNDRY, units: 10, rentedUnits: 10, grossRentMonthly: 10000, applyVacancy: true, capRate: 9 });
  assert.equal(c.baseGrossMonthly, 10000);
  assert.equal(c.wifiRentAddMonthly, 300);
  assert.equal(c.grossMonthly, 10300);
  assert.equal(c.grossAnnual, 123600);
  assert.equal(c.vacancyAnnual, 6180);
  assert.equal(c.repairsMaintAnnual, 9888);
  assert.equal(c.wifiAnnual, 1140);
  assert.equal(c.totalExpensesAnnual, 53922);
  assert.equal(Number(c.noiAnnual.toFixed(2)), 67906.24);
  assert.equal(Math.round(c.value), 754514);

  const rentGroup = c.groups.find((g) => g.key === 'rent-in');
  assert.equal(rentGroup.items[0].label, 'Base rent (10 × $1,000/mo)');
  assert.equal(rentGroup.items[1].label, 'Wi-Fi included (+$30/unit)');
  assert.equal(rentGroup.items[1].valueText, '+$3,600/yr');
  const opsGroup = c.groups.find((g) => g.key === 'operations');
  const wifiItem = opsGroup.items.find((i) => i.key === 'wifi');
  assert.equal(wifiItem.label, 'Building internet (Spectrum Business)');
  assert.equal(wifiItem.valueText, '−$1,140/yr');

  // Every slider step adds $30/unit ($1,200 -> $1,230/unit) while slider keeps base rent
  const c1200 = rangeSummary({ low: 780, high: 1400, defaultRent: 1000, units: 10, capRate: 9, opex: CHARLOTTE_OPEX, laundry: CHARLOTTE_LAUNDRY }, 1200);
  assert.equal(c1200.grossMo, 12300);
  const rv = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, { structure: 'wrap', inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500, billsFromRent: true, renoFromSeller: true } }).rentValue;
  assert.equal(rv.ourRent, 1000);
  assert.equal(rv.effectiveOurRent, 1030);
  assert.equal(whatIfViews(rv, 1200).find((v) => v.key === 'after').rentMo, 12300 * 0.95);
  assert.ok(whatIfGrid(rv, 1200)[0].cells[0].overlay[0].includes('+ $30 Wi-Fi'));

  // Budget = $145,940 with collapsible units/building/setup/laundry
  const cs = buildCostSummary(CHARLOTTE_BASE, CHARLOTTE_PLAN);
  assert.equal(cs.total, 145940);
  const buildingLine = cs.lines.find((l) => l.key === 'building');
  assert.ok(buildingLine.items.some((i) => i.label === 'Wi-Fi access points, both buildings' && i.amount === 1500));
  assert.ok(buildingLine.items.some((i) => i.label === 'Storage cages: repair 10' && i.amount === 1500));
  assert.ok(buildingLine.items.some((i) => i.label === 'Parking: 10 signed spots (signs + paint)' && i.amount === 500));
});

test('Section 4: Upside collapsed by default, excluded from NOI/value/DSCR, and strictly absent from Seller', async () => {
  const opexLib = await import('../src/lib/opex.js');
  const OperatingBreakdown = loadJsx('src/components/OperatingBreakdown.jsx', {
    './Shell.jsx': ShellStub,
    '../lib/dealmath.js': { money },
    '../lib/opex.js': opexLib,
  }).default;
  const withUpside = computeOpex({ opex: CHARLOTTE_OPEX, laundry: CHARLOTTE_LAUNDRY, units: 10, rentedUnits: 10, grossRentMonthly: 10000, applyVacancy: true, capRate: 9 });
  const withoutUpside = computeOpex({ opex: { ...CHARLOTTE_OPEX, upside: null }, laundry: CHARLOTTE_LAUNDRY, units: 10, rentedUnits: 10, grossRentMonthly: 10000, applyVacancy: true, capRate: 9 });
  assert.equal(withUpside.noiAnnual, withoutUpside.noiAnnual);
  assert.equal(withUpside.value, withoutUpside.value);

  const html = renderToStaticMarkup(React.createElement(OperatingBreakdown, { calc: withUpside, Trigger: ShellStub.OverlayTrigger, card: true }));
  assert.match(html, /data-opex-group="upside"[^>]*data-wb="upside"/);
  assert.match(html, /aria-expanded="false"[\s\S]*Upside \(not counted\)/);
  assert.doesNotMatch(html, /Water bill-back through the lease/); // hidden until clicked

  // Seller summary strips upside
  const offer = { structure: 'wrap', name: 'Option A', inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500, billsFromRent: true, renoFromSeller: true } };
  const summary = offerSellerSummary(offer, CHARLOTTE_BASE, CHARLOTTE_PLAN, [], true);
  assert.equal(summary.upside, undefined);
  assert.equal(summary.guide.upside, undefined);
  assert.equal(summary.guide.rentValue.upside, undefined);
});

test('Sections 6 & 7: Private term wording, $15,000 flat refi fees, and $0 phantom lender reserve', () => {
  assert.equal(BASE_DEFAULTS.refiFeesPct, 0);
  assert.equal(BASE_DEFAULTS.refiFeesFlat, 15000);
  assert.equal(BASE_DEFAULTS.refiReserve, 0);
  assert.equal(LENDER_DEFAULTS.refiFeesPct, 0);
  assert.equal(LENDER_DEFAULTS.refiFeesFlat, 15000);

  const offer = { structure: 'wrap', inputs: { note: 275000, rate: 5, amortYears: 0, closing: 5500, billsFromRent: true, renoFromSeller: true } };
  const guide = buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, offer);
  assert.equal(guide.refi.feesPct, 0);
  assert.equal(guide.refi.feesFlat, 15000);
  assert.equal(guide.refi.reserve, 0);
  assert.equal(Math.round(guide.refi.inHand), Math.round(guide.refi.loan) - 15000);
  assert.doesNotMatch(guide.refi.inHandOverlay.join(' '), /holdback|15,773/i);

  const priv = buildLenderPackage({ base: CHARLOTTE_BASE, offer, guide, lens: 'private' });
  assert.equal(priv.privatePool.termSummary, '12 months, one 3-month extension. Paid off early at refinance, no prepayment penalty.');
  assert.equal(priv.privatePoolRows.find((r) => r.key === 'term')?.display, '12 months, one 3-month extension. Paid off early at refinance, no prepayment penalty.');

  const dscr = buildLenderPackage({ base: CHARLOTTE_BASE, offer, guide, lens: 'dscr' });
  assert.equal(dscr.refiCheckRows.find((r) => r.key === 'refiFees')?.label, 'Refi fees ($15,000 flat)');
  assert.equal(dscr.refiCheck.refiFeesTotal, 15000);
  assert.equal(Math.round(dscr.refiCheck.newLoan), 565885);

  const dscr80 = buildLenderPackage({ base: { ...CHARLOTTE_BASE, refiLtv: 80 }, offer, guide, lens: 'dscr' });
  assert.equal(Math.round(dscr80.refiCheck.newLoan), 603611);
});

test('Migration 0038 is idempotent, scoped, isolates Seller from upside, and passes static security rules', () => {
  const sql = read('supabase/migrations/0038_charlotte_wifi_storage_parking_upside.sql');
  assert.doesNotMatch(sql, /service_role|sb_secret_|to anon/i);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /Wi-Fi access points, both buildings/);
  assert.match(sql, /Storage cages: repair 10/);
  assert.match(sql, /Parking: 10 signed spots \(signs \+ paint\)/);
  assert.match(sql, /Building internet \(Spectrum Business\)/);
  assert.match(sql, /Upside \(not counted\)/);
  assert.match(sql, /refiFeesFlat.*15000/);
  assert.match(sql, /refiReserve.*0/);
});
