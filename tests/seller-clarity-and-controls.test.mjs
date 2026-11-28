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
  buildLeadGuide,
  offerSellerSummary,
  overallRepairBudget,
  planPaperworkItems,
  planStepBudgets,
} from '../src/lib/dealplan.js';
import { BASE_DEFAULTS, evaluate } from '../src/lib/dealmath.js';
import { buildLenderPackage } from '../src/lib/lenderModel.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

function loadJsx(rel, mocks = {}, reactOverride = React) {
  const src = read(rel).replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
  const { code } = transformSync(src, { loader: rel.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs', jsx: 'automatic' });
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === 'react') return reactOverride;
    if (spec === 'react/jsx-runtime') return jsxRuntime;
    if (spec in mocks) return mocks[spec];
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);
  return mod.exports;
}

const SHELL_STUB = {
  Button: ({ children, ...p }) => React.createElement('button', p, children),
  Card: ({ children, className = '', ...p }) => React.createElement('section', { className, ...p }, children),
  CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside || null),
  Empty: ({ children }) => React.createElement('p', null, children),
  Field: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p),
  OverlayTrigger: ({ children, lines }) => React.createElement('span', { 'data-overlay': JSON.stringify(lines || []) }, children),
};

const CHARLOTTE_PLAN = {
  sellerLoanBalance: 275000,
  contingency: 20000,
  lenderRate: 10,
  lenderPoints: 1,
  privateRate: 8,
  units: [
    { id: '1', rehab: 5000, ready: 1 }, { id: '2', rehab: 5000, ready: 1 },
    { id: '3', rehab: 10000, ready: 3 }, { id: '4', rehab: 12000, ready: 4 },
    { id: '5', rehab: 3000, ready: 1 }, { id: '6', rehab: 11000, ready: 3 },
    { id: '7', rehab: 10000, ready: 3 }, { id: '8', rehab: 4000, ready: 1 },
    { id: '9', rehab: 6000, ready: 2 }, { id: '10', rehab: 8000, ready: 2, optional: true },
  ],
  costs: [
    { label: 'Diligence: title, inspections, records', cost: 4500, group: 'diligence', start: 0, end: 1 },
    { label: 'Rental registration and zoning certificate', cost: 300, group: 'permits', start: 0, end: 1 },
    { label: 'Gas check and furnace service', cost: 2000, group: 'systems', start: 0, end: 1 },
    { label: 'Unit 3 removal through court', cost: 2750, group: 'eviction', start: 1, end: 3 },
    { label: 'Lease-up and tenant screening', cost: 1000, group: 'lease-up', start: 2, end: 6 },
    { label: 'Doors, locks, cameras', cost: 4000, group: 'security', start: 0, end: 1 },
    { label: 'Plumbing, heat, electric, exterior', cost: 8000, group: 'systems', start: 2, end: 8 },
    { label: 'Wi-Fi access points, both buildings', cost: 1500, group: 'systems', start: 1, end: 2 },
    { label: 'Storage cages: repair 10', cost: 1500, group: 'systems', start: 2, end: 4 },
    { label: 'Parking: 10 signed spots (signs + paint)', cost: 500, group: 'systems', start: 2, end: 4 },
    { label: 'Two Speed Queen stacked washer/dryer units', cost: 10154, group: 'laundry', start: 3, end: 8 },
    { label: 'KioSoft Ultra V2 card readers', cost: 1676, group: 'laundry', start: 3, end: 8 },
    { label: '240V electrical drops & venting', cost: 2560, group: 'laundry', start: 3, end: 8 },
    { label: 'Cleanout & laundry room', cost: 2000, group: 'laundry', start: 3, end: 8 },
  ],
  opex: {
    taxesAnnual: 13544,
    insuranceAnnual: 6500,
    waterSewerTrashAnnual: 12000,
    commonAreaUtilitiesAnnual: 1800,
    reservesPerUnitAnnual: 450,
    vacancyPct: 5,
    repairsMaintPct: 8,
    wifiAnnual: 1140,
    wifiRentAddPerUnit: 30,
  },
};

const CHARLOTTE_BASE = {
  ...BASE_DEFAULTS,
  rent: 1000,
  units: 10,
  strUnits: 0,
  taxes: 13544,
  insurance: 6500,
  waterMo: 1000,
  vacancyPct: 5,
  reservesPerUnit: 450,
  purchasePrice: 275000,
  bridgeClosing: 5500,
  rehab: 145940,
};

const CHARLOTTE_OFFER = {
  id: 'offer-lead',
  deal_id: 'deal-charlotte',
  name: 'Seller financing',
  structure: 'wrap',
  is_lead: true,
  share_realtor: true,
  share_reviewer: true,
  share_lender: true,
  inputs: {
    note: 275000,
    rate: 8.1,
    closing: 5500,
    renoRate: 8,
    amortYears: 0,
    billsFromRent: true,
    renoFromSeller: true,
    shortCarry: 0,
  },
};

test('Sections 1 & 2: 6 even offer tiles, real $/mo Building bills, no empty cell, no "Up to ", plain table headers', () => {
  const s = offerSellerSummary(CHARLOTTE_OFFER, CHARLOTTE_BASE, CHARLOTTE_PLAN, [], false);
  assert.equal(s.terms.length, 6);
  assert.deepEqual(
    s.terms.map((t) => t.label),
    ['Purchase note', 'Renovation note', 'Rate', 'Your monthly payment', 'Building bills paid first', 'Paid back in full'],
  );

  // Every tile has a real number and zero "Up to " / "All covered" / "Holding bills" / "Deferred"
  for (const t of s.terms) {
    assert.match(t.value, /\$|\d/);
  }
  const seen = JSON.stringify({ intro: s.intro, terms: s.terms, steps: s.steps, refiLine: s.refiLine });
  assert.doesNotMatch(seen, /up to |all covered|holding bills|deferred holding/i);

  // Building bills paid first shows actual $/mo (13544/12 + 6500/12 + 1000 = ~2670/mo)
  const billsTile = s.terms.find((t) => t.label === 'Building bills paid first');
  assert.match(billsTile.value, /^\$2,670\/mo$/);
  assert.ok(billsTile.overlay.some((l) => /Property tax/.test(l)));
  assert.ok(billsTile.overlay.some((l) => /Insurance/.test(l)));
  assert.ok(billsTile.overlay.some((l) => /Water/.test(l)));

  // Renovation note explains difference from full repair budget (contingency reserve only if spent)
  const renoTile = s.terms.find((t) => t.label === 'Renovation note');
  assert.ok(renoTile.overlay.some((l) => /Planned repairs & permits:/.test(l)));
  assert.ok(renoTile.overlay.some((l) => /Closing costs rolled into note: \$5,500/.test(l)));
  assert.ok(renoTile.overlay.some((l) => /Contingency \(\$20,000, bringing total repair budget to \$136,440\): only added to the renovation note if actually used/.test(l)));

  // Your monthly payment overlay includes coverage threshold
  const payTile = s.terms.find((t) => t.label === 'Your monthly payment');
  assert.match(payTile.value, /when all 10 are rented$/);
  assert.ok(payTile.overlay.some((l) => /Covers your full payment once \d+ units are rented\./.test(l)));

  // Render LeadOfferCard: 6-tile uses sm:grid-cols-3 (even 2x3/3x2), concise dark headers, Added to payoff overlay
  const { LeadOfferCard } = loadJsx('src/components/LeadOfferCard.jsx', { './Shell.jsx': SHELL_STUB });
  const html = renderToStaticMarkup(React.createElement(LeadOfferCard, {
    deal: { id: 'd1', slug: 'charlotte' },
    content: {},
    summary: s,
    sellerOnly: true,
    coveredLabel: 'Covered?',
  }));
  assert.match(html, /sm:grid-cols-3/);
  assert.match(html, />Units</);
  assert.match(html, />Rent in</);
  assert.match(html, />Paid to you</);
  assert.match(html, /Added to payoff/);
  assert.match(html, />Covered\?</);
  assert.match(html, />Partly</);
  assert.match(html, />Yes</);
  assert.match(html, />No</);
});

test('Section 3: SellerProtectionsCard defaults OPEN on Seller and COLLAPSED on Realtor', () => {
  const { SellerProtectionsCard } = loadJsx('src/components/LeadOfferCard.jsx', { './Shell.jsx': SHELL_STUB });
  const content = { protections: ['You hold first lien.', 'Buyer keeps hazard insurance current.'] };

  const closedHtml = renderToStaticMarkup(React.createElement(SellerProtectionsCard, { content }));
  assert.match(closedHtml, /aria-expanded="false"/);
  assert.doesNotMatch(closedHtml, /You hold first lien\./);

  const openHtml = renderToStaticMarkup(React.createElement(SellerProtectionsCard, { content, defaultOpen: true }));
  assert.match(openHtml, /aria-expanded="true"/);
  assert.match(openHtml, /You hold first lien\./);

  const sellerSrc = read('src/views/Seller.jsx');
  assert.match(sellerSrc, /<SellerProtectionsCard content=\{c\} defaultOpen \/>/);
  const sellerOfferSrc = read('src/components/SellerOffer.jsx');
  assert.match(sellerOfferSrc, /<SellerProtectionsCard content=\{c\} \/>/);
});

test('Sections 4 & 5: Paperwork $6,800 collapsed breakdown + Week 1 Unit 3 ($2,750) and Unit 10 ($0 unless needed)', () => {
  const budgets = planStepBudgets(CHARLOTTE_PLAN);
  assert.equal(overallRepairBudget(CHARLOTTE_PLAN), 136440);
  assert.equal(budgets.paperwork, 6800);
  assert.equal(budgets.eviction, 2750);
  // Week 1 includes security (4000) + nearReady (17000) + laundry (16390) + paperwork (6800) + eviction (2750) = 46940
  assert.equal(budgets.week1, 46940);
  assert.equal(budgets.week1 + budgets.week2Onward + budgets.leaseUp + budgets.contingency, budgets.total);

  const paperworkItems = planPaperworkItems(CHARLOTTE_PLAN);
  assert.equal(paperworkItems.length, 3);
  assert.equal(paperworkItems.reduce((s, x) => s + x.cost, 0), 6800);

  const s = offerSellerSummary(CHARLOTTE_OFFER, CHARLOTTE_BASE, CHARLOTTE_PLAN, [], false);
  assert.equal(s.paperworkItems.length, 3);

  const steps = [
    {
      key: 'week1_secure_and_start',
      week: 'Week 1',
      title: 'Secure, start near-ready units & launch laundry',
      budgetKey: 'week1',
      items: [
        { text: 'Doors, locks, cameras', budgetKey: 'security' },
        { text: 'Start the near-ready units 5, 8, 1, 2', budgetKey: 'nearReadyUnits' },
        { text: 'Get laundry running: 2 stacked sets taking coins, tap/card and bills', budgetKey: 'laundry' },
        { text: 'Paperwork & permits', budgetKey: 'paperwork' },
        { text: 'Unit 3: cash for keys or court removal', budgetKey: 'eviction' },
        {
          text: 'Unit 10: confirm the tenant’s status; start removal only if needed.',
          showZero: true,
          zeroText: '$0 unless needed',
          overlay: ['Verified in Week 1; $0 unless removal is needed.'],
        },
      ],
    },
    {
      key: 'weeks2_3_empty_and_first',
      week: 'Weeks 2-3',
      title: 'First tenant moves in; units 3 and 9 empty',
      detail: 'Unit 3 removal begun in Week 1 wraps up.',
    },
  ];

  // Mock Week 1 & paperwork toggles OPEN to inspect expanded DOM
  let stepBtnCount = 0;
  const openReact = {
    ...React,
    useState(init) {
      stepBtnCount += 1;
      // Call 1: openSteps, Call 2: openLaundry, Call 3: openPaperwork
      if (stepBtnCount === 1) return [{ week1_secure_and_start: true }, () => {}];
      if (stepBtnCount === 3) return [{ week1_secure_and_start: true }, () => {}];
      return [init, () => {}];
    },
  };
  const { ExecutionPlanCard: OpenPlanCard } = loadJsx('src/components/LeadOfferCard.jsx', { './Shell.jsx': SHELL_STUB }, openReact);
  const expandedHtml = renderToStaticMarkup(React.createElement(OpenPlanCard, {
    content: { execution_steps: steps },
    summary: s,
    sellerOnly: true,
  }));
  assert.match(expandedHtml, /data-plan-paperwork="week1_secure_and_start"/);
  assert.match(expandedHtml, /\$6,800/);
  assert.match(expandedHtml, /Diligence: title, inspections, records/);
  assert.match(expandedHtml, /\$4,500/);
  assert.match(expandedHtml, /Rental registration and zoning certificate/);
  assert.match(expandedHtml, /\$300/);
  assert.match(expandedHtml, /Gas check and furnace service/);
  assert.match(expandedHtml, /\$2,000/);
  assert.match(expandedHtml, /Unit 3: cash for keys or court removal/);
  assert.match(expandedHtml, /\$2,750/);
  assert.match(expandedHtml, /Unit 10: confirm the tenant’s status; start removal only if needed\./);
  assert.match(expandedHtml, /\$0 unless needed/);

  // And collapsed by default on initial load
  const { ExecutionPlanCard: DefaultPlanCard } = loadJsx('src/components/LeadOfferCard.jsx', { './Shell.jsx': SHELL_STUB });
  const collapsedHtml = renderToStaticMarkup(React.createElement(DefaultPlanCard, {
    content: { execution_steps: steps },
    summary: s,
    sellerOnly: true,
  }));
  assert.match(collapsedHtml, /\$46,940/);
  assert.doesNotMatch(collapsedHtml, /Diligence: title, inspections, records/);
});

test('Section 6: Seller renders 2 tabs (The offer, Your loan) without Photos tab and LoanPosition open on Tab 2', () => {
  const sellerSrc = read('src/views/Seller.jsx');
  assert.match(sellerSrc, /\[\s*\['offer', 'The offer'\],\s*\['loan', 'Your loan'\],?\s*\]/);
  assert.match(sellerSrc, /collapsedByDefault=\{false\}/);
  assert.doesNotMatch(sellerSrc, /dealplan|commercial_offers|commercial_models|deal_private|Upside/i);
});

test('Section 7: Shared dealStore propagates owner rent changes across Owner, Lender, Reviewer, Realtor & Seller liveSummary', async () => {
  const writes = [];
  const deal = { id: 'deal-c', slug: 'charlotte', title: 'Charlotte' };
  const fakeSupabase = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [CHARLOTTE_OFFER], error: null }),
          maybeSingle: async () => ({
            data: table === 'commercial_models'
              ? { base: CHARLOTTE_BASE }
              : { value: CHARLOTTE_PLAN },
            error: null,
          }),
          then: (cb) => Promise.resolve({ data: [], error: null }).then(cb),
        }),
      }),
      upsert: (payload) => { writes.push({ table, op: 'upsert', payload }); return Promise.resolve({ error: null }); },
      update: (payload) => ({ eq: () => { writes.push({ table, op: 'update', payload }); return Promise.resolve({ error: null }); } }),
    }),
    rpc: async () => ({ data: [CHARLOTTE_OFFER], error: null }),
  };

  const storeSrc = read('src/lib/dealStore.js')
    .replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""')
    .replace('./dealplan.js', '../src/lib/dealplan.js');
  const storeCode = transformSync(storeSrc, { loader: 'js', format: 'cjs' }).code;
  const dealplanMod = await import('../src/lib/dealplan.js');
  const storeMod = { exports: {} };
  new Function('module', 'exports', 'require', storeCode)(storeMod, storeMod.exports, (spec) => {
    if (spec === './supabase.js') return { supabase: fakeSupabase };
    if (spec === './dealplan.js') return dealplanMod;
    return require(spec);
  });

  storeMod.exports.resetDealStore();
  await storeMod.exports.loadDealStore(deal, { owner: true, client: fakeSupabase });

  // Owner updates rent to 1100
  const nextSnap = storeMod.exports.updateDealBase(
    deal,
    { ...storeMod.exports.getDealSnapshot(deal.id).base, rent: 1100 },
    { owner: true, persist: true, client: fakeSupabase, delayMs: 0 },
  );
  // Wait a tick for dynamic import + async persistence
  await new Promise((r) => setTimeout(r, 25));

  assert.equal(nextSnap.base.rent, 1100);
  const liveSummary = storeMod.exports.getLiveSellerSummary(deal.id);
  const liveGuide = storeMod.exports.getLiveLeadGuide(deal.id);
  assert.ok(liveSummary && liveGuide);
  assert.equal(liveGuide.rent, 1100);
  assert.equal(liveGuide.rentValue.ourRent, 1100);
  // Seller table reflects $1,130 effective per unit (1100 + 30 wifi) = $11,300 at 10 units
  assert.equal(liveSummary.sellerTable[10].rentIn, 11300);

  // Lender package immediately scales with shared rent (NOI / DSCR loan increases)
  const lenderPkgBefore = buildLenderPackage({ base: CHARLOTTE_BASE, offer: CHARLOTTE_OFFER, guide: buildLeadGuide(CHARLOTTE_BASE, CHARLOTTE_PLAN, CHARLOTTE_OFFER) });
  const lenderPkg = buildLenderPackage({ base: { ...nextSnap.base, rent: 1100 }, offer: nextSnap.offers[0], guide: liveGuide });
  assert.ok(lenderPkg.refiCheck.dscrNoiAnnual > lenderPkgBefore.refiCheck.dscrNoiAnnual);

  // Persisted to both commercial_models and commercial_offers
  assert.ok(writes.some((w) => w.table === 'commercial_models' && w.payload.base.rent === 1100));
  assert.ok(writes.some((w) => w.table === 'commercial_offers' && w.payload.seller_summary));

  // Verify Owner Numbers entry point + 6 collapsed groups + reduced scattered duplicates
  assert.match(read('src/views/Dashboard.jsx'), /data-open-numbers="true"/);
  assert.match(read('src/views/Owner.jsx'), /<OwnerNumbersPanel deal=\{deal\} \/>/);
  assert.match(read('src/components/OwnerNumbersPanel.jsx'), /useState\(\{\}\)/);
  assert.match(read('src/components/OwnerNumbersPanel.jsx'), /'rent-units'/);
  assert.match(read('src/components/OwnerNumbersPanel.jsx'), /'operating-costs'/);
  assert.match(read('src/components/OwnerNumbersPanel.jsx'), /'laundry-extras'/);
  assert.match(read('src/components/OwnerNumbersPanel.jsx'), /'repair-plan'/);
  assert.match(read('src/components/OwnerNumbersPanel.jsx'), /'seller-note'/);
  assert.match(read('src/components/OwnerNumbersPanel.jsx'), /'lender-refi'/);
  assert.match(read('src/components/OwnerRentValue.jsx'), /hideSlider=\{Boolean\(onOpenNumbers\)\}/);
  assert.match(read('src/views/DealPlan.jsx'), /Change in Numbers/);
  assert.match(read('src/views/Offers.jsx'), /Change in Numbers/);
});

test('Migration 0040 updates week1 StepBudget, paperworkItems RPC, Week 1 Units 3 & 10, and 6 even offer tiles', () => {
  const sql = read('supabase/migrations/0040_charlotte_seller_clarity.sql');
  assert.match(sql, /v_week1 := v_security \+ v_near_ready \+ v_laundry \+ v_paperwork \+ v_eviction;/);
  assert.match(sql, /create or replace function commercial_access_private\.plan_paperwork_items/i);
  assert.match(sql, /'paperworkItems'/);
  assert.match(sql, /Unit 3: cash for keys or court removal/);
  assert.match(sql, /Unit 10: confirm the tenant’s status; start removal only if needed\./);
  assert.match(sql, /\$0 unless needed/);
  assert.match(sql, /Building bills paid first/);
  assert.doesNotMatch(sql, /Up to \$/);
});
