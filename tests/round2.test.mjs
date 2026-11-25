// Round 2 verification tests: 10-unit lock, no Airbnb, dynamic added unit, cost summary,
// seller_summary + Seller RPC fallback, wording rules, readiness badges, and CSS spinner removal.
// Made-up test numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, BASE_FIELDS, evaluate, money, moneyK, operating, sellerLoanText, valueSummary } from '../src/lib/dealmath.js';
import { addedUnitId, buildCostSummary, buildOfferStory, buildSellerSummary, monthlyPlan, nextSellerSummary, normalizePlan } from '../src/lib/dealplan.js';
import { unitCount } from '../src/lib/leaseUp.js';
import { readinessTone } from '../src/lib/readiness.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadJsx(file, mocks) {
  let src = read(file).replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
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

const SAMPLE_BASE = {
  units: 10,
  tenthUnitRepair: 28000,
  rent: 1150,
  vacancyPct: 5,
  taxes: 10000,
  insurance: 5000,
  utilities: 6000,
  admin: 2400,
  turns: 1200,
  mgmtPct: 10,
  reservesPerUnit: 300,
  value: 760000,
  refiRate: 7,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  refiFeesPct: 2,
  refiFeesFlat: 2000,
  refiReserve: 0,
};

const SAMPLE_PLAN = normalizePlan({
  months: 18,
  refiMonth: 12,
  leaseUpWeeks: 4,
  lenderRate: 12,
  lenderPoints: 2,
  sellerLoanBalance: 160000,
  sellerLoanRate: 5,
  sellerLoanYears: 30,
  units: [
    { id: '1', rehab: 2000, ready: 4 },
    { id: '2', rehab: 3000, ready: 6 },
    { id: '3', rehab: 12000, ready: 10 },
    { id: '4', rehab: 0, ready: 20, optional: true },
    { id: '5', rehab: 0, ready: 0, occupied: true },
    { id: '6', rehab: 2000, ready: 8 },
    { id: '7', rehab: 2000, ready: 10 },
    { id: '8', rehab: 2000, ready: 12 },
    { id: '9', rehab: 2000, ready: 14 },
    { id: '10', rehab: 2000, ready: 16 },
  ],
  costs: [
    { label: 'Exterior', cost: 5000, start: 0, end: 4, group: 'systems' },
    { label: 'Common areas', cost: 3000, start: 0, end: 4, group: 'systems' },
    { label: 'Electric', cost: 0, start: 0, end: 2, group: 'systems' },
    { label: 'Heat', cost: 0, start: 0, end: 2, group: 'systems' },
    { label: 'Security', cost: 2000, start: 0, end: 2, group: 'security' },
    { label: 'Eviction', cost: 1500, start: 0, end: 4, group: 'eviction' },
    { label: 'Title', cost: 1000, start: 0, end: 2, group: 'diligence' },
    { label: 'Permits', cost: 1500, start: 0, end: 2, group: 'permits' },
  ],
});

test('Task 0: always 10 units, no Airbnb anywhere, added unit follows optional:true (unit 4 or fallback 10)', () => {
  assert.equal(unitCount(9), 10);
  assert.equal(unitCount(undefined), 10);
  assert.equal(addedUnitId(SAMPLE_PLAN), '4');
  assert.equal(addedUnitId({ units: [{ id: '1' }, { id: '2' }] }), '10');

  // Legacy strUnits is ignored and added unit repair is always included once
  const o = operating({ ...SAMPLE_BASE, units: 9, strUnits: 3, strNightly: 250 });
  assert.equal(o.strUnits, 0);
  assert.equal(o.extraRepair, 28000);
  assert.equal(o.b.rehab, 28000);

  const planRes = monthlyPlan('master_lease', { payment: 2500, optionPrice: 320000 }, SAMPLE_BASE, SAMPLE_PLAN);
  const unit4Items = planRes.items.filter((i) => i.label.includes('Unit 4'));
  assert.equal(unit4Items.length, 1);
  assert.equal(unit4Items[0].cost, 28000);
  assert.equal(unit4Items[0].label, 'Unit 4 (added unit) rehab');

  // No Airbnb controls in Switches, DealPlan, Lender, or BASE_FIELDS
  assert.ok(!BASE_FIELDS.some(([k]) => /str|units/i.test(k)));
  for (const f of ['src/components/Switches.jsx', 'src/views/DealPlan.jsx', 'src/views/Lender.jsx', 'src/views/Dashboard.jsx']) {
    assert.doesNotMatch(read(f), /Airbnb|strUnits|strNightly|AirbnbSwitch/i, f);
  }
});

test('Task 1 & 6: buildCostSummary formats Whole job, Units top-2, Building, Setup, Contingency, and skips $0 items', () => {
  const cs = buildCostSummary(SAMPLE_BASE, { ...SAMPLE_PLAN, contingency: 5000 });
  assert.equal(moneyK(74000), '$74K');
  assert.equal(cs.heading, 'Whole job about $74K');
  assert.equal(cs.lines[0].label, 'Units $55K');
  assert.equal(cs.lines[0].detail, 'Unit 4 $28K, Unit 3 $12K');
  assert.equal(cs.lines[1].label, 'Building $8K');
  assert.equal(cs.lines[1].detail, 'exterior $5K, common areas $3K');
  assert.equal(cs.lines[2].label, 'Setup about $6K');
  assert.equal(cs.lines[2].detail, 'security, eviction, title, permits');
  assert.equal(cs.lines[3].label, 'Contingency $5K');
  assert.ok(!cs.lines.some((l) => /\$0|to inspect/i.test(l.label)));
  assert.ok(cs.lines[0].overlay.some((l) => l.includes('Unit 4 needs its zoning certificate')));

  // CostSummary renders cleanly without <p>, <small>, or <caption>
  const { default: CostSummary } = loadJsx('src/components/CostSummary.jsx', {
    './Shell.jsx': { OverlayTrigger: ({ children, className }) => React.createElement('button', { type: 'button', className }, children) },
  });
  const html = renderToStaticMarkup(React.createElement(CostSummary, { summary: cs }));
  assert.match(html, /Whole job about \$74K/);
  assert.match(html, /Unit 4 \$28K, Unit 3 \$12K/);
  assert.match(html, /Contingency \$5K/);
  assert.doesNotMatch(html, /to inspect|\$0,|<p\b|<small\b|<caption\b/);
});

test('Task 2 & 3: buildSellerSummary produces plain seller table/terms/steps, refreshes guide when locked, and Seller.jsx renders it', () => {
  const res = monthlyPlan('master_lease', { payment: 2500, optionPrice: 320000, sellerAdvances: 10000, creditPct: 100, exerciseClosing: 4000 }, SAMPLE_BASE, SAMPLE_PLAN);
  const offer = { id: 'o1', name: 'A: Lease now, buy later', structure: 'master_lease', inputs: {} };
  const summary = buildSellerSummary(offer, res, { base: SAMPLE_BASE });

  assert.equal(summary.version, 1);
  assert.equal(summary.title, 'Lease now, buy later');
  assert.ok(!summary.title.includes('A:'));
  assert.equal(summary.sellerTable.length, 11);
  assert.ok(summary.terms.some((t) => t.label === 'Your current loan' && t.value.includes('(or what you owe)')));
  assert.deepEqual(summary.steps.map((s) => s.title), ['Take over', 'Repairs', 'Rent pays your costs first', 'Refinance']);
  assert.ok(summary.steps[1].detail.includes('Whole job about $69K'));
  // Never exposes buyer returns, option letters, or months
  assert.doesNotMatch(JSON.stringify({ title: summary.title, intro: summary.intro, refiLine: summary.refiLine, terms: summary.terms, steps: summary.steps }), /Option [A-E]|Your cash in|Cash out|DSCR|Month \d+/i);

  // Locked summary preserves locked terms/steps while refreshing guide
  const locked = { version: 1, locked: true, title: 'Custom locked title', terms: [{ label: 'Price', value: 'Custom' }], steps: [] };
  const refreshed = nextSellerSummary({ ...offer, seller_summary: locked }, res, { base: SAMPLE_BASE });
  assert.equal(refreshed.title, 'Custom locked title');
  assert.deepEqual(refreshed.terms, locked.terms);
  assert.equal(refreshed.guide.rows.length, 11);

  // Seller.jsx calls commercial_get_seller_offer and LeadOfferCard renders sellerTable + refiLine + fallback
  const sellerSrc = read('src/views/Seller.jsx');
  assert.match(sellerSrc, /commercial_get_seller_offer/);

  const { LeadOfferCard, ExecutionPlanCard } = loadJsx('src/components/LeadOfferCard.jsx', {
    './Shell.jsx': {
      Button: ({ children, ...p }) => React.createElement('button', p, children),
      Card: ({ children }) => React.createElement('section', null, children),
      CardTitle: ({ children }) => React.createElement('h2', null, children),
      OverlayTrigger: ({ children }) => React.createElement('button', { type: 'button' }, children),
    },
  });

  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(LeadOfferCard, { deal: { id: 'd1', slug: 'demo' }, content: {}, summary }),
    React.createElement(ExecutionPlanCard, { content: {}, summary })
  ));
  assert.match(html, /The offer — Lease now, buy later/);
  assert.match(html, /\(or what you owe\)/);
  assert.match(html, /Units rented/);
  assert.match(html, /Your costs covered/);
  assert.match(html, /Whole job about \$69K/);
  assert.doesNotMatch(html, /Month 12/);

  const fallbackHtml = renderToStaticMarkup(React.createElement(LeadOfferCard, {
    deal: { id: 'd1', slug: 'demo' },
    content: { lead: { price: '$350,000' } },
    summary: null,
  }));
  assert.match(fallbackHtml, /\$350,000/);
  assert.match(fallbackHtml, /6801234 and 6807893/);
});

test('Task 4: wording rules for seller loans and Estimated value labels', () => {
  assert.equal(sellerLoanText(150000, false), '$150,000 (or what he owes)');
  assert.equal(sellerLoanText(150000, true), '$150,000 (or what you owe)');
  const val = valueSummary({ base: SAMPLE_BASE, noi: 80000, units: 10, comps: [{ units: 5, sale_price: 350000 }] });
  assert.match(val.incomeLine, /^Estimated value by income:/);
  assert.match(val.compsLine, /^Estimated value by comps:/);
  assert.match(read('src/components/LoanPosition.jsx'), /\(or what you owe\)/);
  for (const f of ['src/views/Dashboard.jsx', 'src/views/Reviewer.jsx', 'src/lib/dealmath.js']) {
    assert.doesNotMatch(read(f), /(?<!Estimated )Value after repairs/i, f);
  }
});

test('Task 7: readiness badge colors and owner-only gating', () => {
  assert.match(readinessTone('Move-in ready'), /emerald/);
  assert.match(readinessTone('Move-in ready (occupied)'), /emerald/);
  assert.match(readinessTone('Near ready'), /lime/);
  assert.match(readinessTone('Medium'), /amber/);
  assert.match(readinessTone('Needs a lot'), /orange/);
  assert.match(readinessTone('Full gut'), /red/);
  assert.match(readinessTone('Not entered'), /stone/);
  assert.match(readinessTone('Not assessed'), /stone/);

  const { default: ReadinessBadge } = loadJsx('src/components/ReadinessBadge.jsx', {
    '../lib/readiness.js': { READINESS_PRESETS: ['Move-in ready', 'Full gut'], readinessTone },
    'react-dom': { createPortal: (node) => node },
  });
  const html = renderToStaticMarkup(React.createElement(ReadinessBadge, { unitNumber: 4, label: 'Near ready', editable: true }));
  assert.match(html, /Near ready/);
  assert.match(html, /bg-lime-100/);

  // Non-owner views never query readiness
  for (const v of ['Seller.jsx', 'Lender.jsx', 'Reviewer.jsx', 'LeadGuest.jsx', 'Realtor.jsx']) {
    assert.doesNotMatch(read(`src/views/${v}`), /readiness/i, v);
  }
  assert.match(read('src/views/Walkthrough.jsx'), /import\.meta\.env\.VITE_SITE_KIND === 'public'/);
  assert.match(read('src/components/UnitGallery.jsx'), /import\.meta\.env\.VITE_SITE_KIND === 'public'/);
});

test('CSS hides number input spinners and codebase has zero forbidden words', () => {
  const css = read('src/index.css');
  assert.match(css, /-webkit-inner-spin-button/);
  assert.match(css, /appearance:\s*textfield/);

  const banned = new RegExp(['QU1IQQ==', 'U2VjdGlvbiA4', 'Z3JvdXAgaG9tZQ==', 'c3VibGVhc2U='].map((b) => Buffer.from(b, 'base64').toString('utf8')).join('|'), 'i');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const file of [...walk(join(root, 'src')), join(root, 'tests/round2.test.mjs'), join(root, 'tests/offer-e.test.mjs')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), banned, file);
  }
});
