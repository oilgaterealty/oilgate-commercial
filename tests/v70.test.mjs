import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { canAccessDealPlan } from '../src/lib/site.js';
import { monthlyPlan, normalizePlan, derivations, overallRepairBudget, buildLeadGuide, OPTION_E_OVERLAY } from '../src/lib/dealplan.js';
import { money, sellerLoanText, valueSummary } from '../src/lib/dealmath.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('Plans is owner-only, blocked in previews, and lazy-loaded outside public builds', () => {
  for (const kind of ['', 'owner', 'public']) for (const role of ['owner', 'lender', 'realtor', 'reviewer', 'seller', 'viewer']) {
    for (const preview of [true, false]) assert.equal(canAccessDealPlan(kind, role, preview), kind !== 'public' && role === 'owner' && !preview);
  }
  const owner = read('src/views/Owner.jsx');
  assert.match(owner, /const DealPlan = import\.meta\.env\.VITE_SITE_KIND === 'public' \|\| import\.meta\.env\.VITE_SITE_KIND === 'seller' \? null : lazy\(\(\) => import\('\.\/DealPlan\.jsx'\)\)/);
  assert.match(owner, /BASE_SECTIONS\.slice\(0, 2\), \['plans', 'Plans'\]/);
  assert.match(owner, /DealPlan && canAccessDealPlan/);
  const view = read('src/views/DealPlan.jsx');
  assert.match(view, /if \(!canAccessDealPlan\(SITE_KIND, role, preview\)\) return null/);
  assert.match(view, /from\('commercial_settings'\)\.select\('value'\)\.eq\('key', `deal_plan:\$\{deal\.slug\}`\)\.maybeSingle\(\)/);
  assert.match(view, /normalizePlan\(row\.value\)/);
  assert.match(view, /monthlyPlan\(selected\.structure, selected\.inputs, planBase, state\.plan\)/);
  assert.match(view, /derivations\(result\)/);
  assert.match(view, /useDealModel\(deal, \{ owner: true \}\)/);
  assert.match(view, /route\.sub \|\| 'master_lease'/);
  assert.match(view, /<Empty>No plan yet<\/Empty>/);
});

test('guest views never reference plan code; option links require the owner access guard', () => {
  for (const role of ['Lender', 'Realtor', 'Reviewer', 'Seller']) assert.doesNotMatch(read(`src/views/${role}.jsx`), /dealplan|DealPlan/);
  const offers = read('src/views/Offers.jsx');
  assert.match(offers, /role === 'owner' && !onlyShared && canAccessDealPlan\(SITE_KIND, role, preview\)/);
  assert.match(offers, /#\/d\/\$\{deal\.slug\}\/plans\/\$\{x\.structure\}/);
  assert.match(offers, />Plans</);
});

test('every src file satisfies the wording rule', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  for (const file of walk(join(root, 'src'))) assert.doesNotMatch(readFileSync(file, 'utf8'), /AMHA|Section 8|group home|sublease/i, file);
});

// Render the actual view with real math and React; network-loading code is excluded.
function loadView() {
  const costSrc = read('src/components/CostSummary.jsx')
    .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/Shell\.jsx';/, '');
  const costCode = transformSync(costSrc, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' }).code;
  const costMod = { exports: {} };
  const OverlayStub = ({ children, className }) => React.createElement('button', { type: 'button', className }, children);
  new Function('module', 'exports', 'h', 'Fragment', 'OverlayTrigger', costCode)(costMod, costMod.exports, React.createElement, React.Fragment, OverlayStub);
  const CostSummary = costMod.exports.default;

  const ugSrc = read('src/components/UnitsRentedGuide.jsx')
    .replace(/import\s+CostSummary\s+from\s+'\.\/CostSummary\.jsx';/, '')
    .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/Shell\.jsx';/, '')
    .replace(/import\s+\{[^}]+\}\s+from\s+'\.\.\/lib\/dealmath\.js';/, '');
  const ugCode = transformSync(ugSrc, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' }).code;
  const ugMod = { exports: {} };
  new Function('module', 'exports', 'h', 'Fragment', 'CostSummary', 'OverlayTrigger', 'money', ugCode)(
    ugMod, ugMod.exports, React.createElement, React.Fragment, CostSummary, OverlayStub, money
  );
  const UnitsRentedGuide = ugMod.exports.default;

  const source = read('src/views/DealPlan.jsx').split('// Portals')[1].split('function LoadedDealPlan')[0];
  const code = transformSync(`// Portals${source}`, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' }).code;
  const mod = { exports: {} };
  const Card = ({ children }) => React.createElement('section', null, children);
  const CardTitle = ({ children }) => React.createElement('h2', null, children);
  const ReadinessBadge = () => null;
  const ordinal = (n) => `${n}th`;
  const fn = new Function('module', 'exports', 'h', 'Fragment', 'useEffect', 'useId', 'useRef', 'useState', 'createPortal', 'money', 'sellerLoanText', 'buildLeadGuide', 'derivations', 'normalizePlan', 'overallRepairBudget', 'OPTION_E_OVERLAY', 'Card', 'CardTitle', 'UnitsRentedGuide', 'ReadinessBadge', 'ordinal', 'valueSummary', code);
  fn(mod, mod.exports, React.createElement, React.Fragment, React.useEffect, React.useId, React.useRef, React.useState,
    () => { throw new Error('An unopened overlay must not mount'); }, money, sellerLoanText, buildLeadGuide, derivations, normalizePlan, overallRepairBudget, OPTION_E_OVERLAY, Card, CardTitle, UnitsRentedGuide, ReadinessBadge, ordinal, valueSummary);
  return mod.exports.DealPlanView;
}

test('actual Plans markup renders units-rented table, collapses month-by-month, and hides sources and explanations', () => {
  const DealPlanView = loadView();
  const base = { units: 10, rent: 1500, taxes: 1200, taxesSource: 'PRIVATE_TAX_SOURCE', strNightly: 200, strOccPct: 75, strUnits: 0 };
  const plan = normalizePlan({ months: 18, refiMonth: 12, units: [{ id: '5', ready: 0 }, { id: '8', ready: 8 }],
    sources: { schedule: 'PRIVATE_SCHEDULE_SOURCE' }, costs: [{ label: 'PRIVATE_COST_DETAIL', cost: 2500, start: 0, end: 0 }],
    rentOptions: [{ key: 'other', label: 'Database rent option', rent: 1700 }] });
  const offers = [{ id: 'one', name: 'First option', structure: 'master_lease', inputs: { payment: 1000 } }, { id: 'two', name: 'Second option', structure: 'cash', inputs: {} }];
  for (const selected of offers) {
    const result = monthlyPlan(selected.structure, selected.inputs, base, plan);
    const html = renderToStaticMarkup(React.createElement(DealPlanView, { result, base, offers, selected, setBase() {}, onSelect() {} }));
    assert.match(html, /Units rented table/);
    assert.match(html, /Refinance/);
    assert.match(html, /Left for you/);
    assert.doesNotMatch(html, /Added unit \(Unit 10\) rehab/);
    assert.match(html, /Short months paid by the repair loan/);
    assert.match(html, /Step by step/);
    assert.doesNotMatch(html, /example pace/);
    // Collapsed by default: step-by-step table and rentOptions are not shown
    assert.doesNotMatch(html, /Step-by-step cash flow|Month-by-month cash flow|Database rent option/);
    assert.doesNotMatch(html, /as-is|Pending lender underwriting|Stabilized 10 units \(pending approvals\)/i);
    for (const secret of ['PRIVATE_TAX_SOURCE', 'PRIVATE_SCHEDULE_SOURCE', 'PRIVATE_COST_DETAIL']) assert.ok(!html.includes(secret), secret);
    assert.doesNotMatch(html, /role="tooltip"|<p\b|<small\b|<caption\b/);
  }
});
