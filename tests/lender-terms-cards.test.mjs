// Lender "Your terms" Round 2 redesign tests:
// Bridge / Private / DSCR tabs, direct numeric/choice inputs (LTC/LTV, rate, points, term, deferred interest, extensions),
// optional guarantee/prepayment/lockout, plain Yes/No collateral, read-only 10 units (no legal unit count input),
// one-tap Change + Use ours with no prefilled deletable text, untouched asks submit cleanly, preview name blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

async function loadLenderTermsModule() {
  const formatMod = await import('../src/lib/format.js');
  const v63Mod = await import('../src/lib/v63.js');
  const dealmathMod = await import('../src/lib/dealmath.js');
  const DictationMod = loadJsx('src/components/Dictation.jsx', {
    '../lib/dictation.js': { MAX_RECORDING_MS: 60000 },
    '../lib/mediaCoordinator.js': { mediaCoordinator: { acquire: () => ({ ok: true }), release: () => {} } },
  });
  const Card = ({ children }) => React.createElement('section', null, children);
  const CardTitle = ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside);
  const Button = ({ children, kind: _kind, ...p }) => React.createElement('button', p, children);
  const Empty = ({ children }) => React.createElement('p', null, children);
  const noopQuery = {
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        then: () => {},
      }),
    }),
  };
  return loadJsx('src/views/LenderTerms.jsx', {
    '../components/Dictation.jsx': DictationMod,
    '../lib/supabase.js': { supabase: { from: () => noopQuery } },
    '../lib/format.js': formatMod,
    '../lib/v63.js': v63Mod,
    '../lib/dealmath.js': dealmathMod,
    '../lib/lenderModel.js': await import('../src/lib/lenderModel.js'),
    '../components/Shell.jsx': { Card, CardTitle, Button, Empty },
    '../components/Messages.jsx': { sendToOwner: async () => null },
  });
}

const GUIDE = {
  costSummary: { total: 124050 },
  bridge: {
    purchase: 275000,
    repairs: 124050,
    closing: 5500,
    processing: 1295,
    pointsPct: 1,
    ratePct: 13,
    deferredMonths: 2,
    termMonths: 12,
    minParticipation: 20000,
  },
  refi: {
    estimatedValue: 586000,
    closingInLoan: 5500,
    ltvPct: 75,
    ltvShownPct: 75,
  },
};

const BASE = {
  purchasePrice: 275000,
  rehab: 124050,
  bridgeClosing: 5500,
  bridgeProcessing: 1295,
  bridgePointsPct: 1,
  bridgeRate: 13,
  bridgeDeferredMonths: 2,
  bridgeTermMonths: 12,
  privateMinParticipation: 20000,
  value: 586000,
  refiRate: 7.25,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  strUnits: 0,
};

test('redesigned Your terms renders Bridge/Private/DSCR tabs, read-only 10 units, no legal unit count input, and ask cards', async () => {
  const lt = await loadLenderTermsModule();
  assert.deepEqual(Object.keys(lt.LENDER_PROGRAMS), ['bridge', 'private', 'dscr']);

  const asks = lt.wantedTerms('bridge', GUIDE, BASE);
  assert.equal(Object.keys(asks).length, 8);
  assert.match(asks['Origination points'], /^1 point \(/);
  assert.match(asks['Deferred interest'], /^2 months \(/);

  const html = renderToStaticMarkup(React.createElement(lt.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com', name: 'Jordan' },
    preview: false,
    guide: GUIDE,
    base: BASE,
  }));

  // Tab order: Bridge, Private, DSCR.
  const tabPos = ['>Bridge<', '>Private<', '>DSCR<'].map((t) => html.indexOf(t));
  assert.ok(tabPos[0] >= 0 && tabPos[1] > tabPos[0] && tabPos[2] > tabPos[1]);

  // Read-only 10 units fact; NO legal unit count input anywhere.
  assert.match(html, /10 units/);
  assert.doesNotMatch(html, /legal unit count/i);

  // All 8 bridge asks render as read-only ask cards with Change buttons; zero prefilled text inputs.
  for (const key of ['ltc', 'ltv', 'rate', 'points', 'processing', 'term', 'deferred_interest', 'rehab_draws']) {
    assert.match(html, new RegExp(`data-ask-card="${key}"`));
  }
  assert.equal((html.match(/>Change<\/button>/g) || []).length, 8);
  assert.doesNotMatch(html, /truncate|text-ellipsis|line-clamp/);
  assert.doesNotMatch(html, />Not applicable<\/button>/);

  // Plain collateral question (Yes/No), extension options, and optional guarantee/prepayment/lockout choices.
  assert.match(html, /Do you need both parcels, 23 and 27 Charlotte, as collateral\?/);
  assert.match(html, /Number of extensions/);
  assert.match(html, /Guarantee requirements/);
  assert.match(html, /Prepayment penalty/);
  assert.match(html, /Lockout/);

  // Private & DSCR asks build cleanly too.
  const privAsks = lt.wantedTerms('private', GUIDE, BASE);
  assert.equal(Object.keys(privAsks).length, 5);
  assert.match(privAsks['Your participation'], /\$20,000 min/);
  const dscrAsks = lt.wantedTerms('dscr', GUIDE, BASE);
  assert.equal(Object.keys(dscrAsks).length, 6);
  assert.match(dscrAsks['Max LTV (% of value)'], /75% LTV/);
});

test('tapping Change opens an empty direct input (no prefilled deletable text) and Use ours restores the ask card', async () => {
  const lt = await loadLenderTermsModule();
  const fields = lt.fieldsForProgram('bridge');
  const fRate = fields.find((x) => x.key === 'rate');
  const fDef = fields.find((x) => x.key === 'deferred_interest');
  const asks = lt.wantedTerms('bridge', GUIDE, BASE);

  const opened = lt.openTermCounter({}, {}, 'bridge', fRate);
  const openedValues = lt.resolveTermValues(asks, opened.drafts.bridge);
  assert.equal(lt.isTermCountering(fRate, asks[fRate.label], opened.drafts.bridge, opened.editing.bridge), true);
  assert.equal(openedValues[fRate.label], '');

  const rateHtml = renderToStaticMarkup(React.createElement(lt.LenderTermField, {
    field: fRate,
    program: 'bridge',
    ask: asks[fRate.label],
    value: openedValues[fRate.label],
    countering: true,
    preview: false,
    onOpenCounter: () => {},
    onRestoreAsk: () => {},
    onChange: () => {},
  }));
  assert.match(rateHtml, /type="number"/);
  assert.match(rateHtml, /value=""/);
  assert.match(rateHtml, />Use ours</);

  // Choice field (deferred_interest) renders one-tap choice buttons, no free-text box.
  const openedDef = lt.openTermCounter({}, {}, 'bridge', fDef);
  const defHtml = renderToStaticMarkup(React.createElement(lt.LenderTermField, {
    field: fDef,
    program: 'bridge',
    ask: asks[fDef.label],
    value: '',
    countering: true,
    preview: false,
    onOpenCounter: () => {},
    onRestoreAsk: () => {},
    onChange: () => {},
  }));
  assert.doesNotMatch(defHtml, /<input/);
  assert.match(defHtml, />2 months</);
  assert.match(defHtml, />Use ours</);
  void openedDef;

  const restored = lt.restoreTermAsk(opened.drafts, opened.editing, 'bridge', fRate);
  assert.equal(lt.isTermCountering(fRate, asks[fRate.label], restored.drafts.bridge, restored.editing.bridge), false);
  assert.equal(lt.resolveTermValues(asks, restored.drafts.bridge)[fRate.label], asks[fRate.label]);
});

test('untouched asks submit verbatim and optional extensions/collateral/prepay/lockout never block submit', async () => {
  const lt = await loadLenderTermsModule();
  const fields = lt.fieldsForProgram('bridge');
  const asks = lt.wantedTerms('bridge', GUIDE, BASE);
  const values = lt.resolveTermValues(asks, {});

  assert.equal(lt.isTermsFormComplete({ company: 'Apex Capital', name: 'Jordan Lee', fields, values }), true);

  // Countering rate leaves form incomplete until entered.
  const fRate = fields.find((x) => x.key === 'rate');
  const opened = lt.openTermCounter({}, {}, 'bridge', fRate);
  assert.equal(lt.isTermsFormComplete({
    company: 'Apex Capital',
    name: 'Jordan Lee',
    fields,
    values: lt.resolveTermValues(asks, opened.drafts.bridge),
  }), false);

  const countered = lt.setTermAnswer(opened.drafts, opened.editing, 'bridge', fRate.label, '11.5', fRate.key);
  const withOpt = lt.setTermAnswer(countered.drafts, countered.editing, 'bridge', lt.COLLATERAL_QUESTION.label, 'Yes');
  const sub = lt.buildTermsSubmission({
    dealId: 'd1',
    lenderUid: 'l1',
    company: 'Apex Capital',
    name: 'Jordan Lee',
    program: 'bridge',
    fields,
    values: lt.resolveTermValues(asks, withOpt.drafts.bridge),
    extensions: { count: '2', months: '3 mo', fee: '0.5%' },
    existingTerms: { dscr: { 'Loan term': '30 years' } },
    nowIso: '2026-11-27T21:00:00.000Z',
  });

  assert.equal(sub.terms.bridge['Interest rate'], '11.5%');
  assert.equal(sub.terms.bridge['Origination points'], asks['Origination points']);
  assert.equal(sub.terms.bridge.Extensions, '2 × 3 mo at 0.5%');
  assert.equal(sub.terms.bridge['Both parcels (23 & 27 Charlotte)'], 'Yes');
  assert.equal(sub.terms._contact, 'Jordan Lee');
  assert.equal(sub.terms.dscr['Loan term'], '30 years');
  assert.match(sub.body, /^Apex Capital, Jordan Lee · Bridge\n/);
});

test('owner preview leaves Your name blank instead of Preview and keeps Change clickable while inputs stay disabled', async () => {
  const lt = await loadLenderTermsModule();
  assert.equal(lt.initialLenderName({ email: '__preview__', name: 'Preview' }, true), '');
  assert.equal(lt.initialLenderName({ email: 'lender@bank.com', name: 'Alex Morgan' }, false), 'Alex Morgan');

  const html = renderToStaticMarkup(React.createElement(lt.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { email: '__preview__', name: 'Preview' },
    preview: true,
    guide: GUIDE,
    base: BASE,
  }));

  assert.match(html, /Your name[\s\S]*?<input[^>]*placeholder="Your name"[^>]*value=""/);
  assert.doesNotMatch(html, /value="Preview"/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Change</);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);
});
