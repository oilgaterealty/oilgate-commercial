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
  '15-day grace, then default.',
  "You're named on the insurance.",
  'Monthly updates here: rents, leases and repair photos.',
  'Extra collateral: one of my other rentals backs this loan too.',
];

const EXPECTED_PRIVATE_LENDER_BULLETS = [
  'Your money is secured by a recorded first-lien mortgage on 23 & 27 Charlotte.',
  'A neutral payment company pays you every month, and you see every payment.',
  "You're named on the insurance.",
  '15-day grace, then default.',
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
  const { normalizeProtections, SellerProtectionsCard } = loadJsx('src/components/LeadOfferCard.jsx', { './Shell.jsx': ShellStub });
  assert.equal(renderToStaticMarkup(React.createElement(SellerProtectionsCard, { content: {} })), '');
  const html = renderToStaticMarkup(React.createElement(SellerProtectionsCard, {
    content: { protections: EXPECTED_BULLETS },
  }));
  assert.match(html, /^<section><button[^>]*aria-expanded="false"[^>]*data-protections-group="seller"/);
  assert.match(html, /Your protections/);
  assert.match(html, /6 items/);
  assert.doesNotMatch(html, /<p\b|<small\b|<caption\b/);
  assert.doesNotMatch(html, /lender|points|refi|reserve|cushion|personal guarantee|guarantee/i);
  assert.deepEqual(normalizeProtections({ protections: EXPECTED_BULLETS }), EXPECTED_BULLETS);
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
    for (const bullet of [...EXPECTED_BULLETS, ...EXPECTED_PRIVATE_LENDER_BULLETS]) {
      assert.ok(!text.includes(bullet), `${file} must not hardcode Charlotte bullet: ${bullet}`);
    }
  }
});

test('migration 0031_seller_protections.sql seeds the exact 6 bullets idempotently for charlotte only', () => {
  const sql = read('supabase/migrations/0031_seller_protections.sql');
  const sqlBody = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.match(sqlBody, /update public\.commercial_deals/);
  assert.match(sqlBody, /where slug = 'charlotte'/);
  assert.match(sqlBody, /not \(coalesce\(seller_content, '\{\}'::jsonb\) \? 'protections'\)/);
  assert.doesNotMatch(sql, /service_role|sb_secret_|payment[- ]reserve|cushion|personal guarantee|lender|points|refi\b/i);
  const unescaped = sqlBody.replace(/''/g, "'");
  assert.equal(EXPECTED_BULLETS.length, 6);
  for (const bullet of EXPECTED_BULLETS) {
    assert.ok(unescaped.includes(bullet), `Migration missing exact bullet: ${bullet}`);
  }
  assert.ok(!unescaped.includes('You control the repair money'), 'Repair-money bullet must be removed');
});

test('migration 0032_lender_polish.sql cleans seller repair-money bullet and seeds 6 Private lender protections in commercial_settings', () => {
  const sql = read('supabase/migrations/0032_lender_polish.sql');
  const sqlBody = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n');
  const unescaped = sqlBody.replace(/''/g, "'");
  assert.match(sqlBody, /You control the repair money/);
  assert.match(sqlBody, /settings_lender_protections on public\.commercial_settings/);
  assert.match(sqlBody, /key like 'lender_protections:%'/);
  assert.match(sqlBody, /lender_protections:charlotte/);
  assert.equal(EXPECTED_PRIVATE_LENDER_BULLETS.length, 6);
  for (const bullet of EXPECTED_PRIVATE_LENDER_BULLETS) {
    assert.ok(unescaped.includes(bullet), `0032 missing Private lender bullet: ${bullet}`);
  }
  assert.ok(!unescaped.includes('Repair money is released only as work is finished'), 'Private lender repair-money bullet must be omitted');
});
