import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import * as people from '../src/lib/people.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadShell() {
  const code = transformSync(read('src/components/Shell.jsx'), {
    loader: 'jsx',
    format: 'cjs',
    jsx: 'automatic',
  }).code;
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react/jsx-runtime') return jsxRuntime;
    if (spec === 'react-dom') return { createPortal: () => null };
    if (spec === '../lib/people.js') return people;
    if (spec === '../lib/supabase.js') return { supabase: {} };
    if (spec === './Dictation.jsx') return { DictatedField: (p) => React.createElement('input', p) };
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);
  return mod.exports;
}

const DEAL = {
  slug: 'charlotte',
  title: '23-27 Charlotte St',
  address: '23-27 Charlotte St, Akron, OH 44303',
  buyer_name: "LaVante'",
  seller_name: 'Pat',
};

test('PropertyHead hides Buyer and seller info icon and names for viewer, guest, and preview-as-viewer', () => {
  const { PropertyHead, showHeaderParties } = loadShell();

  try {
    for (const role of ['viewer', 'guest']) {
      assert.equal(showHeaderParties(role), false);
      people.setDealNames(DEAL, role);
      for (const props of [{ deal: DEAL, role }, { deal: DEAL }]) {
        const html = renderToStaticMarkup(React.createElement(PropertyHead, props));
        assert.match(html, /23-27 Charlotte St/);
        assert.match(html, /Akron, OH 44303/);
        assert.doesNotMatch(html, /Buyer and seller/);
        assert.doesNotMatch(html, /<button\b/);
        assert.doesNotMatch(html, /LaVante/);
        assert.doesNotMatch(html, /Buyer/);
        assert.doesNotMatch(html, /Seller/);
        assert.doesNotMatch(html, /Pat/);
      }
    }

    // Fail closed when role is empty or unknown
    assert.equal(showHeaderParties(''), false);
    assert.equal(showHeaderParties(undefined), false);
    people.setDealNames(DEAL, '');
    const emptyHtml = renderToStaticMarkup(React.createElement(PropertyHead, { deal: DEAL }));
    assert.doesNotMatch(emptyHtml, /Buyer and seller/);
    assert.doesNotMatch(emptyHtml, /<button\b/);
  } finally {
    people.setDealNames({ buyer_name: '', seller_name: '' }, '');
  }
});

test('PropertyHead keeps Buyer and seller info icon for owner, realtor, lender, reviewer, and seller', () => {
  const { PropertyHead, showHeaderParties } = loadShell();

  try {
    for (const role of ['owner', 'realtor', 'lender', 'reviewer', 'seller']) {
      assert.equal(showHeaderParties(role), true);
      people.setDealNames(DEAL, role);
      const html = renderToStaticMarkup(React.createElement(PropertyHead, { deal: DEAL, role }));
      assert.match(html, /aria-label="Buyer and seller"/, `${role} keeps info button`);
      assert.match(html, /<button\b/, `${role} renders info trigger`);
    }

    // Verify exact tag scoping per role with InfoTip lines
    const dealNoSeller = { ...DEAL, seller_name: '' };
    people.setDealNames(dealNoSeller, 'seller');
    assert.equal(people.sellerTag(dealNoSeller), 'Seller');

    people.setDealNames(dealNoSeller, 'owner');
    assert.equal(people.buyerTag(dealNoSeller), "LaVante' · Buyer");
    assert.equal(people.sellerTag(dealNoSeller), 'Seller not named yet');

    people.setDealNames(DEAL, 'lender');
    assert.equal(people.buyerTag(DEAL), "LaVante' · Buyer");
    assert.equal(people.sellerTag(DEAL), 'Pat · Seller');
  } finally {
    people.setDealNames({ buyer_name: '', seller_name: '' }, '');
  }
});

test('DealRoom passes active role to PropertyHead for both See-as preview and signed-in views; OpenViewer has no parties info icon', () => {
  const dealRoomSrc = read('src/views/DealRoom.jsx');
  assert.match(dealRoomSrc, /<PropertyHead deal=\{state\.deal\} role=\{sub\} \/>/);
  assert.match(dealRoomSrc, /<PropertyHead deal=\{state\.deal\} role=\{state\.role\} \/>/);

  const openViewerSrc = read('src/views/OpenViewer.jsx');
  for (const forbidden of ['PropertyHead', 'InfoTip', 'buyerTag', 'sellerTag', 'Buyer and seller']) {
    assert.equal(openViewerSrc.includes(forbidden), false, `OpenViewer must not include ${forbidden}`);
  }
});
