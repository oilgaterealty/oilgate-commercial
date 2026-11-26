// Rent and value sections: unit table, three views, rent x cap grid; shown to lender, reviewer and owner only.
// Made-up numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { rentValue, buildLeadGuide } from '../src/lib/dealplan.js';

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

const BASE = {
  rent: 800, vacancyPct: 5, taxes: 6000, insurance: 3000, waterMo: 200, emptyUnitUtilMo: 40, reservesPerUnit: 300,
  valueCapRate: 10, units: 4, strUnits: 0, unitRents: { 2: { rentToday: 500, marketRent: 900 } },
};
const PLAN = {
  sellerLoanBalance: 100000, contingency: 5000, costs: [],
  units: [{ id: '1', rehab: 1000 }, { id: '2', rehab: 2000, occupied: true }, { id: '3', rehab: 3000 }, { id: '10', rehab: 4000 }],
};

test('rentValue: units sorted, gap from market rent, three views, grid flags', () => {
  const rv = rentValue(BASE, PLAN, {});
  assert.deepEqual(rv.units.map((u) => u.id), ['1', '2', '3', '10']);
  const u2 = rv.units.find((u) => u.id === '2');
  assert.equal(u2.rentToday, 500);
  assert.equal(u2.marketRent, 900);
  assert.equal(u2.gap, 100);
  assert.equal(rv.units.find((u) => u.id === '1').gap, null);
  assert.deepEqual(rv.views.map((v) => v.key), ['asis', 'after', 'market']);
  const [asis, after, market] = rv.views;
  assert.equal(asis.rented, 1);
  assert.equal(asis.rentMo, 500);
  assert.equal(asis.allIn, 100000);
  assert.equal(after.rented, 4);
  assert.equal(after.allIn, rv.buyout + rv.repairs);
  assert.ok(market.rentMo > after.rentMo);
  const stab = rv.grid.flatMap((r) => r.cells).filter((c) => c.stabilized);
  assert.equal(stab.length, 1);
  for (const row of rv.grid) for (const c of row.cells) assert.equal(c.clears, c.value >= rv.allIn);
  assert.ok(buildLeadGuide(BASE, PLAN, {}).rentValue);
});

test('rentValue: no management, admin or turnover lines', () => {
  const rv = rentValue({ ...BASE, mgmtPct: 15, admin: 5000, turns: 2000 }, PLAN, {});
  const same = rentValue(BASE, PLAN, {});
  assert.deepEqual(rv.views.map((v) => v.netYr), same.views.map((v) => v.netYr));
  assert.doesNotMatch(JSON.stringify(rv), /manag|admin|turnover/i);
});

test('RentValue renders read-only and editable, no visible subtext', () => {
  const Shell = {
    Card: ({ children }) => React.createElement('section', null, children),
    CardTitle: ({ children, aside }) => React.createElement('h2', null, children, aside),
    Button: ({ children }) => React.createElement('button', null, children),
    OverlayTrigger: ({ children }) => React.createElement('span', null, children),
  };
  const dealmath = { money: (v) => `$${Math.round(v)}`, moneyK: (v) => `$${Math.round(v / 1000)}K` };
  const mod = loadJsx('src/components/RentValue.jsx', { './Shell.jsx': Shell, '../lib/dealmath.js': dealmath });
  const rv = rentValue(BASE, PLAN, {});
  const ro = renderToStaticMarkup(React.createElement(mod.default, { data: rv }));
  assert.match(ro, /Unit by unit/);
  assert.match(ro, /As is, after repairs, full market/);
  assert.match(ro, /Value by rent and cap rate/);
  assert.doesNotMatch(ro, /<input/);
  assert.doesNotMatch(ro, /<p[ >]/);
  const ed = renderToStaticMarkup(React.createElement(mod.default, { data: rv, editable: true, onSave: async () => null }));
  assert.equal((ed.match(/<input/g) || []).length, 8);
  assert.equal(mod.isRentValue(null), false);
});

test('Gating: lender, reviewer (not viewer) and owner only', () => {
  assert.match(read('src/views/Lender.jsx'), /<RentValue /);
  assert.match(read('src/views/Reviewer.jsx'), /!viewer && role === 'reviewer' && isRentValue/);
  assert.match(read('src/views/Owner.jsx'), /<OwnerRentValue /);
  for (const f of ['src/views/Realtor.jsx', 'src/views/Seller.jsx']) {
    if (!existsSync(join(root, f))) continue;
    assert.doesNotMatch(read(f), /RentValue/);
  }
});

test('No confidential names or barred words in the new sections', () => {
  const src = read('src/components/RentValue.jsx') + read('src/components/OwnerRentValue.jsx');
  assert.doesNotMatch(src, /Ambassador|753 W|AMHA|Section 8|voucher|housing authority|group home|sublease/i);
});
