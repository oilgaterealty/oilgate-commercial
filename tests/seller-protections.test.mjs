// Seller protections section ("Your protections"): deal-content driven, seller + realtor offer views,
// owner-editable in Settings, never hardcoded in src, and zero lender rates/points/refi/reserve/personal guarantee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const EXPECTED_BULLETS = [
  'Your bank gets paid first. A neutral payment company pays your mortgage every month, and you see every payment.',
  'The building comes back to you if payments stop. A signed deed waits at the title company.',
  "You control the repair money. It's released only as work is finished.",
  '15-day grace, then default.',
  "You're named on the insurance.",
  'Monthly updates here: rents, leases and repair photos.',
  'Extra collateral: one of my other rentals backs this loan too.',
];

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
  Button: ({ children, ...p }) => React.createElement('button', p, children),
  Card: ({ children, className }) => React.createElement('section', { className }, children),
  CardTitle: ({ children }) => React.createElement('h2', null, children),
  Field: (p) => React.createElement('input', p),
  OverlayTrigger: ({ children }) => React.createElement('span', null, children),
};

test('normalizeProtections reads deal content only with no hardcoded fallback', () => {
  const { normalizeProtections } = loadJsx('src/components/LeadOfferCard.jsx', { './Shell.jsx': ShellStub });
  assert.deepEqual(normalizeProtections(), []);
  assert.deepEqual(normalizeProtections({}), []);
  assert.deepEqual(normalizeProtections({ protections: null }), []);
  assert.deepEqual(normalizeProtections({ protections: 'not-an-array' }), []);
  assert.deepEqual(normalizeProtections({ protections: ['  First  ', '', null, 'Second'] }), ['First', 'Second']);
});

test('SellerProtectionsCard renders standalone section with exact bullets and no subtext or restricted terms', () => {
  const { SellerProtectionsCard } = loadJsx('src/components/LeadOfferCard.jsx', { './Shell.jsx': ShellStub });
  assert.equal(renderToStaticMarkup(React.createElement(SellerProtectionsCard, { content: {} })), '');
  const html = renderToStaticMarkup(React.createElement(SellerProtectionsCard, {
    content: { protections: EXPECTED_BULLETS },
  }));
  assert.match(html, /^<section><h2>Your protections<\/h2><ul/);
  assert.doesNotMatch(html, /<p\b|<small\b|<caption\b/);
  for (const bullet of EXPECTED_BULLETS) {
    assert.ok(html.includes(bullet.replace(/'/g, '&#x27;')) || html.includes(bullet), `Missing bullet: ${bullet}`);
  }
  assert.doesNotMatch(html, /lender|points|refi|reserve|cushion|personal guarantee|guarantee/i);
});

test('Seller.jsx and SellerOffer.jsx place Your protections right after LeadOfferCard and before ExecutionPlanCard', () => {
  for (const file of ['src/views/Seller.jsx', 'src/components/SellerOffer.jsx']) {
    const src = read(file);
    const offerIdx = src.indexOf('<LeadOfferCard');
    const protIdx = src.indexOf('<SellerProtectionsCard', offerIdx);
    const planIdx = src.indexOf('<ExecutionPlanCard', protIdx);
    assert.ok(offerIdx !== -1, `${file} has LeadOfferCard`);
    assert.ok(protIdx > offerIdx, `${file} renders SellerProtectionsCard after LeadOfferCard`);
    assert.ok(planIdx > protIdx, `${file} renders ExecutionPlanCard after SellerProtectionsCard`);
  }
});

test('Owner.jsx wires ProtectionsEditor in Settings without SellerEditor or hardcoded bullets in src', () => {
  const ownerSrc = read('src/views/Owner.jsx');
  assert.match(ownerSrc, /<ProtectionsEditor\s+deal=\{deal\}\s+onSaved=\{setDeal\}\s*\/>/);
  assert.doesNotMatch(ownerSrc, /SellerEditor|'seller-page'/);

  const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
  for (const file of walk('src')) {
    const text = read(file);
    for (const bullet of EXPECTED_BULLETS) {
      assert.ok(!text.includes(bullet), `${file} must not hardcode Charlotte bullet: ${bullet}`);
    }
  }
});

test('migration 0031_seller_protections.sql seeds the exact 7 bullets idempotently for charlotte only', () => {
  const sql = read('supabase/migrations/0031_seller_protections.sql');
  const sqlBody = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.match(sqlBody, /update public\.commercial_deals/);
  assert.match(sqlBody, /where slug = 'charlotte'/);
  assert.match(sqlBody, /not \(coalesce\(seller_content, '\{\}'::jsonb\) \? 'protections'\)/);
  assert.doesNotMatch(sql, /service_role|sb_secret_|payment[- ]reserve|cushion|personal guarantee|lender|points|refi\b/i);
  const unescaped = sqlBody.replace(/''/g, "'");
  for (const bullet of EXPECTED_BULLETS) {
    assert.ok(unescaped.includes(bullet), `Migration missing exact bullet: ${bullet}`);
  }
});
