// Lender "Your terms" tab isolation tests:
// Bridge (7 asks + extensions; NO LTV/DSCR/amortization), Private (4 asks, 8% no points; NO processing/points/extensions),
// DSCR (8 asks with 75%/80% LTV presets, prepayment, refi fees; NO points/processing/deferred),
// one-tap Change + Use ours with no prefilled deletable text, untouched asks submit cleanly under each tab's program key, preview name blank.
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
    ratePct: 10,
    deferredMonths: 2,
    termMonths: 12,
    privateRate: 8,
    privateTermMonths: 12,
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
  bridgeRate: 10,
  bridgeDeferredMonths: 2,
  bridgeTermMonths: 12,
  privateRate: 8,
  privateTermMonths: 12,
  privateMinParticipation: 20000,
  value: 586000,
  refiRate: 7.5,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  refiFeesFlat: 5000,
  refiFeesPct: 2.1,
  strUnits: 0,
};

test('Your terms strictly isolates Bridge, Private, and DSCR fields and asks', async () => {
  const lt = await loadLenderTermsModule();
  assert.deepEqual(Object.keys(lt.LENDER_PROGRAMS), ['bridge', 'private', 'dscr']);

  const bridgeAsks = lt.wantedTerms('bridge', GUIDE, BASE);
  assert.equal(Object.keys(bridgeAsks).length, 7);
  assert.match(bridgeAsks['LTC (% of cost)'], /100% LTC · Loan \$409,944 · \$0 down/);
  assert.match(bridgeAsks['Interest rate'], /10% IO · non-Dutch/);
  assert.match(bridgeAsks['Origination points'], /1 point · Fee \$4,099/);
  assert.equal(bridgeAsks['Processing fee'], '$1,295');
  assert.equal(bridgeAsks['Deferred interest'], '2 months (due at payoff)');
  assert.equal(bridgeAsks['Max LTV (% of value)'], undefined);

  const html = renderToStaticMarkup(React.createElement(lt.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com', name: 'Jordan' },
    preview: false,
    guide: GUIDE,
    base: BASE,
    lenderLens: 'bridge',
  }));

  const tabPos = ['>Bridge<', '>Private<', '>DSCR<'].map((t) => html.indexOf(t));
  assert.ok(tabPos[0] >= 0 && tabPos[1] > tabPos[0] && tabPos[2] > tabPos[1]);
  assert.match(html, /10 units/);
  assert.doesNotMatch(html, /legal unit count/i);

  for (const key of ['ltc', 'rate', 'points', 'processing', 'term', 'deferred_interest', 'rehab_draws']) {
    assert.match(html, new RegExp(`data-ask-card="${key}"`));
  }
  assert.equal((html.match(/>Change<\/button>/g) || []).length, 7);
  assert.doesNotMatch(html, /Max LTV|Minimum DSCR|Amortization/i);
  assert.match(html, /Number of extensions/);

  // Private tab: 4 asks, 8% no points, no processing fee, no extensions
  const privAsks = lt.wantedTerms('private', GUIDE, BASE);
  assert.equal(Object.keys(privAsks).length, 4);
  assert.equal(privAsks['Your participation'], 'Min $20,000 · Pool $404,550');
  assert.equal(privAsks['Interest rate'], '8% · no points');
  assert.equal(privAsks['Lien position'], 'First-lien pooled');
  const privHtml = renderToStaticMarkup(React.createElement(lt.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com', name: 'Jordan' },
    preview: false,
    guide: GUIDE,
    base: BASE,
    lenderLens: 'private',
    hideProgramTabs: true,
  }));
  assert.equal((privHtml.match(/>Change<\/button>/g) || []).length, 4);
  assert.doesNotMatch(privHtml, /Processing fee|Origination points|Number of extensions|Minimum DSCR|Amortization/i);

  // DSCR tab: 8 asks, 75% LTV Value $586,000 Loan $439,500, no points/processing/deferred/extensions
  const dscrAsks = lt.wantedTerms('dscr', GUIDE, BASE);
  assert.equal(Object.keys(dscrAsks).length, 8);
  assert.equal(dscrAsks['Max LTV (% of value)'], '75% LTV · Value $586,000 · Loan $439,500');
  assert.equal(dscrAsks.Amortization, '30 years');
  assert.equal(dscrAsks['Prepayment penalty'], 'None');
  assert.match(dscrAsks['Refi fees'], /\$5,000 flat \+ 2\.1% · Fee \$14,230/);
  const dscrHtml = renderToStaticMarkup(React.createElement(lt.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com', name: 'Jordan' },
    preview: false,
    guide: GUIDE,
    base: BASE,
    lenderLens: 'dscr',
    hideProgramTabs: true,
  }));
  assert.equal((dscrHtml.match(/>Change<\/button>/g) || []).length, 8);
  assert.doesNotMatch(dscrHtml, /Origination points|Processing fee|Deferred interest|Number of extensions|LTC \(% of cost\)/i);
});

test('tapping Change opens an empty direct input (plus 75%/80% presets on DSCR LTV) and Use ours restores the ask card', async () => {
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

  // DSCR LTV Change view exposes 75% and 80% one-tap presets
  const fLtv = lt.fieldsForProgram('dscr').find((x) => x.key === 'ltv');
  const dscrAsks = lt.wantedTerms('dscr', GUIDE, BASE);
  const ltvHtml = renderToStaticMarkup(React.createElement(lt.LenderTermField, {
    field: fLtv,
    program: 'dscr',
    ask: dscrAsks[fLtv.label],
    value: '',
    countering: true,
    preview: false,
    onOpenCounter: () => {},
    onRestoreAsk: () => {},
    onChange: () => {},
  }));
  assert.match(ltvHtml, />75%</);
  assert.match(ltvHtml, />80%</);

  // Choice field (deferred_interest) renders one-tap choice buttons, no free-text box.
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

  const restored = lt.restoreTermAsk(opened.drafts, opened.editing, 'bridge', fRate);
  assert.equal(lt.isTermCountering(fRate, asks[fRate.label], restored.drafts.bridge, restored.editing.bridge), false);
  assert.equal(lt.resolveTermValues(asks, restored.drafts.bridge)[fRate.label], asks[fRate.label]);
});

test('each tab saves under its own program key without overwriting sibling programs', async () => {
  const lt = await loadLenderTermsModule();
  const bridgeFields = lt.fieldsForProgram('bridge');
  const bridgeAsks = lt.wantedTerms('bridge', GUIDE, BASE);
  const dscrFields = lt.fieldsForProgram('dscr');
  const dscrAsks = lt.wantedTerms('dscr', GUIDE, BASE);
  const privFields = lt.fieldsForProgram('private');
  const privAsks = lt.wantedTerms('private', GUIDE, BASE);

  assert.equal(lt.isTermsFormComplete({ company: 'Apex Capital', name: 'Jordan Lee', fields: bridgeFields, values: lt.resolveTermValues(bridgeAsks, {}) }), true);

  const fRate = bridgeFields.find((x) => x.key === 'rate');
  const opened = lt.openTermCounter({}, {}, 'bridge', fRate);
  assert.equal(lt.isTermsFormComplete({
    company: 'Apex Capital',
    name: 'Jordan Lee',
    fields: bridgeFields,
    values: lt.resolveTermValues(bridgeAsks, opened.drafts.bridge),
  }), false);

  const countered = lt.setTermAnswer(opened.drafts, opened.editing, 'bridge', fRate.label, '10.5', fRate.key);
  const subBridge = lt.buildTermsSubmission({
    dealId: 'd1',
    lenderUid: 'l1',
    company: 'Apex Capital',
    name: 'Jordan Lee',
    program: 'bridge',
    fields: bridgeFields,
    values: lt.resolveTermValues(bridgeAsks, countered.drafts.bridge),
    extensions: { count: '2', months: '3 mo', fee: '0.5%' },
    existingTerms: { dscr: { 'Loan term': '30 years' } },
    nowIso: '2026-11-27T21:00:00.000Z',
  });
  assert.equal(subBridge.terms.bridge['Interest rate'], '10.5%');
  assert.equal(subBridge.terms.bridge.Extensions, '2 × 3 mo at 0.5%');
  assert.equal(subBridge.terms.dscr['Loan term'], '30 years');

  // Countering DSCR LTV to 80% saves under terms.dscr while preserving terms.bridge
  const fLtv = dscrFields.find((x) => x.key === 'ltv');
  const dscrCounter = lt.setTermAnswer({}, {}, 'dscr', fLtv.label, '80', fLtv.key);
  const subDscr = lt.buildTermsSubmission({
    dealId: 'd1',
    lenderUid: 'l1',
    company: 'Apex Capital',
    name: 'Jordan Lee',
    program: 'dscr',
    fields: dscrFields,
    values: lt.resolveTermValues(dscrAsks, dscrCounter.drafts.dscr),
    extensions: { count: '2', months: '3 mo', fee: '0.5%' },
    existingTerms: subBridge.terms,
    nowIso: '2026-11-27T21:05:00.000Z',
  });
  assert.equal(subDscr.terms.dscr['Max LTV (% of value)'], '80%');
  assert.equal(subDscr.terms.dscr.Extensions, undefined);
  assert.equal(subDscr.terms.bridge['Interest rate'], '10.5%');

  const subPriv = lt.buildTermsSubmission({
    dealId: 'd1',
    lenderUid: 'l1',
    company: 'Apex Capital',
    name: 'Jordan Lee',
    program: 'private',
    fields: privFields,
    values: lt.resolveTermValues(privAsks, {}),
    extensions: { count: '2', months: '3 mo', fee: '0.5%' },
    existingTerms: subDscr.terms,
    nowIso: '2026-11-27T21:10:00.000Z',
  });
  assert.equal(subPriv.terms.private['Interest rate'], '8% · no points');
  assert.equal(subPriv.terms.private.Extensions, undefined);
  assert.equal(subPriv.terms.dscr['Max LTV (% of value)'], '80%');
  assert.equal(subPriv.terms.bridge['Interest rate'], '10.5%');
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
