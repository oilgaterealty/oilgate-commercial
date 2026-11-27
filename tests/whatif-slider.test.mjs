// What-if slider drives the views table, cap-rate grid, and after-vacancy Rent in /mo display.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { rentValue } from '../src/lib/dealplan.js';
import { rangeValue, whatIfViews, whatIfGrid } from '../src/lib/rangeValue.js';
import { money, moneyK } from '../src/lib/dealmath.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

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

const BASE = {
  rent: 1000,
  vacancyPct: 7,
  taxes: 12000,
  insurance: 6000,
  waterMo: 500,
  emptyUnitUtilMo: 60,
  reservesPerUnit: 300,
  valueCapRate: 9,
  value: 500000,
  units: 10,
  strUnits: 0,
  unitRents: { 1: { rentToday: 650, marketRent: 1050 } },
};

const PLAN = {
  sellerLoanBalance: 360000,
  contingency: 5000,
  costs: [],
  units: [
    { id: '1', rehab: 2000, occupied: true },
    ...Array.from({ length: 9 }, (_, i) => ({ id: String(i + 2), rehab: 4000 })),
  ],
  marketRent: { low: 780, high: 1020, source: 'fixture note' },
};

test('whatIfViews at rent 813 recomputes after & market, leaves asis unchanged', () => {
  const rv = rentValue(BASE, PLAN, {});
  const views = whatIfViews(rv, 813);
  assert.equal(views.length, 3);
  const [asis, after, market] = views;
  assert.deepEqual(asis, rv.views[0]);

  const expectedRentMo = 10 * 813 * (1 - BASE.vacancyPct / 100);
  const expectedVal = rangeValue(rv.marketRange, 813);
  for (const [idx, view] of [[1, after], [2, market]]) {
    const orig = rv.views[idx];
    near(view.rentMo, expectedRentMo);
    assert.equal(view.costsMo, orig.costsMo);
    near(view.netYr, (expectedRentMo - orig.costsMo) * 12);
    near(view.value, expectedVal);
    assert.equal(view.allIn, orig.allIn);
    assert.match(view.rentOverlay.join(' | '), /10 × \$813\/mo = \$8,130\/mo/);
    assert.match(view.rentOverlay.join(' | '), /Less 7% vacancy:/);
    assert.match(view.netOverlay[0], /× 12 = /);
    assert.match(view.valueOverlay[0], /÷ 9% cap rate = /);
  }
});

test('whatIfGrid centers on slider rent with stabilized cell at base cap and drops <= 0 rows', () => {
  const rv = rentValue(BASE, PLAN, {});
  const grid = whatIfGrid(rv, 813);
  assert.deepEqual(grid.map((r) => r.rent), [613, 713, 813, 913, 1013]);
  assert.deepEqual(grid[0].cells.map((c) => c.cap), rv.caps);

  const stabilized = grid.flatMap((r) => r.cells.map((c) => ({ rent: r.rent, ...c }))).filter((c) => c.stabilized);
  assert.equal(stabilized.length, 1);
  assert.equal(stabilized[0].rent, 813);
  assert.equal(stabilized[0].cap, rv.capRate);
  near(stabilized[0].value, rangeValue(rv.marketRange, 813));

  for (const row of grid) {
    for (const cell of row.cells) {
      assert.equal(cell.clears, cell.value >= rv.allIn);
      assert.equal(cell.overlay.length, 4);
      assert.match(cell.overlay[0], /10 units × /);
    }
  }

  const lowGrid = whatIfGrid(rv, 150);
  assert.deepEqual(lowGrid.map((r) => r.rent), [50, 150, 250, 350]);
});

test('whatIfViews and whatIfGrid return saved views and grid when marketRange is absent', () => {
  const rv = rentValue(BASE, PLAN, {});
  const noMr = { ...rv, marketRange: null };
  assert.equal(whatIfViews(noMr, 813), noMr.views);
  assert.equal(whatIfGrid(noMr, 813), noMr.grid);
});

test('RentValue renders after-vacancy Rent in /mo with gross+vacancy overlay, fits 2-col table on phone, and leaves non-slider mode intact', () => {
  const overlays = [];
  const Shell = {
    Card: ({ children }) => React.createElement('section', null, children),
    CardTitle: ({ children, aside }) => React.createElement('h2', null, children, aside),
    Button: ({ children }) => React.createElement('button', null, children),
    OverlayTrigger: ({ children, lines, className }) => {
      if (lines) overlays.push({ text: String(children), lines });
      return React.createElement('span', { className }, children);
    },
  };
  const mod = loadJsx('src/components/RentValue.jsx', {
    './Shell.jsx': Shell,
    '../lib/dealmath.js': { money, moneyK },
    '../lib/rangeValue.js': { rangeValue, whatIfViews, whatIfGrid },
  });
  assert.equal(mod.whatIfViews, whatIfViews);
  assert.equal(mod.whatIfGrid, whatIfGrid);

  const rv = rentValue(BASE, PLAN, {});
  const { mergeViews } = mod;
  assert.equal(mergeViews(whatIfViews(rv, 780)).length, 2);

  // With slider (showMarket + marketRange): defaults to midpoint of mr.low..mr.high = 900
  const withSlider = renderToStaticMarkup(React.createElement(mod.default, { data: rv, showMarket: true, hideUnits: true }));
  const expectedAfterVac = money(10 * 900 * (1 - 7 / 100)); // $8,370
  assert.match(withSlider, new RegExp(`Rent in /mo</dt><dd[^>]*><span>${expectedAfterVac.replace('$', '\\$')}</span>`));
  assert.doesNotMatch(withSlider, /Rent in \/mo<\/dt><dd[^>]*>(?:<span>)?\$9,000/);
  const rentInOverlay = overlays.find((o) => o.text === expectedAfterVac && o.lines.some((l) => /10 × \$900\/mo = \$9,000\/mo/.test(l)));
  assert.ok(rentInOverlay, 'Rent in /mo trigger has gross and vacancy overlay');
  assert.ok(rentInOverlay.lines.some((l) => /Less 7% vacancy: \$8,370\/mo/.test(l)));
  assert.doesNotMatch(withSlider, /min-w-\[480px\]/);
  assert.match(withSlider, /\$700<\/th>/);
  assert.match(withSlider, /\$900<\/th>/);
  assert.match(withSlider, /\$1,100<\/th>/);
  assert.doesNotMatch(withSlider, /<p[ >]/);

  // Without slider (reviewer): keeps saved views/grid and applies min-w-[480px] when 3+ view columns exist
  const noSlider = renderToStaticMarkup(React.createElement(mod.default, { data: rv, showMarket: false }));
  assert.doesNotMatch(noSlider, /type="range"/);
  assert.match(noSlider, /min-w-\[480px\]/);
  assert.match(noSlider, /\$600<\/th>/);
  assert.match(noSlider, /\$1,100<\/th>/);
});
