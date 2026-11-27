// Lender "Your terms" ask-card redesign tests:
// ask cards render full text, Change reveals empty input with placeholder,
// Use ours restores, untouched submit sends our ask, no Not applicable button anywhere, preview name is blank.
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
  const CardTitle = ({ children }) => React.createElement('h2', null, children);
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
    '../components/Shell.jsx': { Card, CardTitle, Button, Empty },
    '../components/Messages.jsx': { sendToOwner: async () => null },
  });
}

const GUIDE = {
  costSummary: { total: 124050 },
  refi: {
    closingInLoan: 5500,
    ltvShownPct: 75,
    renoCompare: { regularRate: 11, regularPointsPct: 2.5 },
  },
};

const BASE = {
  refiRate: 7.25,
  refiYears: 30,
  refiLtv: 75,
  refiDscr: 1.25,
  strUnits: 0,
};

test('ask cards render full unwrapped text, Change button, required asterisks, and leave no-ask fields as empty inputs', async () => {
  const lt = await loadLenderTermsModule();
  const asks = lt.wantedTerms('bridge', GUIDE, BASE);
  assert.equal(Object.keys(asks).length, 5);

  const html = renderToStaticMarkup(React.createElement(lt.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com', name: 'Jordan' },
    preview: false,
    guide: GUIDE,
    base: BASE,
  }));

  // All 5 bridge asks render in full on read-only cards with no raw text inside inputs.
  for (const key of ['purchase_advances', 'rehab_draws', 'rates_fees', 'str_income', 'legal_units_code']) {
    assert.match(html, new RegExp(`data-ask-card="${key}"`));
  }
  assert.ok(html.includes('Repairs only: $129,550 ($124,050 repair budget plus $5,500 closing). The seller finances the purchase.'));
  assert.ok(html.includes('$124,050 repair budget, drawn as the work is done'));
  assert.ok(html.includes('11% interest only, 2.5 points'));
  assert.match(html, /data-ask-card="str_income"[\s\S]*?>Not applicable<\/p>/);
  assert.match(html, /data-ask-card="legal_units_code"[\s\S]*?>10 units<\/p>/);

  assert.doesNotMatch(html, /<input[^>]*value="Repairs only:/);
  assert.doesNotMatch(html, /<input[^>]*value="\$124,050/);
  assert.doesNotMatch(html, /<input[^>]*value="11% interest only/);
  assert.doesNotMatch(html, /truncate|text-ellipsis|line-clamp/);

  // 5 ask cards -> 5 Change buttons; remaining 7 no-ask bridge fields -> 7 empty inputs, zero Not applicable buttons.
  assert.equal((html.match(/>Change<\/button>/g) || []).length, 5);
  assert.doesNotMatch(html, />Not applicable<\/button>/);
  assert.doesNotMatch(html, /aria-pressed=/);
  assert.equal((html.match(/>\*<\/span>/g) || []).length, 12);
  assert.doesNotMatch(html, />Use ours<\/button>/);

  // DSCR & Both programs resolve asks cleanly too.
  assert.equal(Object.keys(lt.wantedTerms('dscr', GUIDE, BASE)).length, 8);
  assert.equal(Object.keys(lt.wantedTerms('both', GUIDE, BASE)).length, 9);
});

test('tapping Change opens an empty input with our ask as placeholder, mic, and Use ours link (no Not applicable button); Use ours restores the ask card', async () => {
  const lt = await loadLenderTermsModule();
  const questions = lt.questionsForProgram('bridge');
  const q = questions.find((x) => x.key === 'rates_fees');
  const asks = lt.wantedTerms('bridge', GUIDE, BASE);
  const ask = asks[q.label];

  // Initial state: ask card visible, not countering.
  assert.equal(lt.isTermCountering(q, ask, {}, {}), false);

  // Tap Change -> empty input, countering true, form incomplete until filled or restored.
  const opened = lt.openTermCounter({}, {}, 'bridge', q);
  const openedValues = lt.resolveTermValues(asks, opened.drafts.bridge);
  assert.equal(lt.isTermCountering(q, ask, opened.drafts.bridge, opened.editing.bridge), true);
  assert.equal(openedValues[q.label], '');

  const editorHtml = renderToStaticMarkup(React.createElement(lt.LenderTermField, {
    question: q,
    ask,
    value: openedValues[q.label],
    countering: true,
    preview: false,
    onOpenCounter: () => {},
    onRestoreAsk: () => {},
    onChange: () => {},
  }));

  assert.doesNotMatch(editorHtml, /data-ask-card=/);
  assert.match(editorHtml, new RegExp(`id="lt-${q.key}"`));
  assert.match(editorHtml, /value=""/);
  assert.match(editorHtml, /placeholder="11% interest only, 2\.5 points"/);
  assert.match(editorHtml, /aria-label="Dictate Interest rate, origination points and fees"/);
  assert.doesNotMatch(editorHtml, />Not applicable</);
  assert.doesNotMatch(editorHtml, /aria-pressed=/);
  assert.match(editorHtml, />Use ours</);
  assert.match(editorHtml, />\*<\/span>/);

  // Tap Use ours -> clears override and returns to read-only ask card with full ask restored.
  const restored = lt.restoreTermAsk(opened.drafts, opened.editing, 'bridge', q);
  const restoredValues = lt.resolveTermValues(asks, restored.drafts.bridge);
  assert.equal(lt.isTermCountering(q, ask, restored.drafts.bridge, restored.editing.bridge), false);
  assert.equal(restoredValues[q.label], ask);

  const cardHtml = renderToStaticMarkup(React.createElement(lt.LenderTermField, {
    question: q,
    ask,
    value: restoredValues[q.label],
    countering: false,
    preview: false,
    onOpenCounter: () => {},
    onRestoreAsk: () => {},
    onChange: () => {},
  }));
  assert.match(cardHtml, /data-ask-card="rates_fees"/);
  assert.match(cardHtml, /11% interest only, 2\.5 points/);
  assert.match(cardHtml, />Change</);
  assert.doesNotMatch(cardHtml, /<input/);
});

test('untouched asks submit as our ask in the exact existing data shape, and countering requires typed input', async () => {
  const lt = await loadLenderTermsModule();
  const questions = lt.questionsForProgram('bridge');
  const asks = lt.wantedTerms('bridge', GUIDE, BASE);

  // Answer every no-ask field.
  let drafts = {};
  let editing = {};
  for (const q of questions) {
    if (!asks[q.label]) {
      ({ drafts, editing } = lt.setTermAnswer(drafts, editing, 'bridge', q.label, `Custom ${q.key}`));
    }
  }

  const values = lt.resolveTermValues(asks, drafts.bridge);
  assert.equal(lt.isTermsFormComplete({ company: 'Apex Capital', name: 'Jordan Lee', questions, values }), true);

  const sub = lt.buildTermsSubmission({
    dealId: 'd1',
    lenderUid: 'l1',
    company: 'Apex Capital',
    name: 'Jordan Lee',
    program: 'bridge',
    questions,
    values,
    existingTerms: { dscr: { 'Loan term and extension options': '30-year loan' } },
    nowIso: '2026-11-27T20:00:00.000Z',
  });

  // Untouched ask values are submitted verbatim inside terms.bridge and body.
  assert.equal(
    sub.terms.bridge['Purchase advances and LTV/LTC caps'],
    'Repairs only: $129,550 ($124,050 repair budget plus $5,500 closing). The seller finances the purchase.',
  );
  assert.equal(sub.terms.bridge['Rehab holdbacks and draw process'], '$124,050 repair budget, drawn as the work is done');
  assert.equal(sub.terms.bridge['Interest rate, origination points and fees'], '11% interest only, 2.5 points');
  assert.equal(sub.terms.bridge['Recourse and guarantor requirements'], 'Custom recourse');
  assert.equal(sub.terms._contact, 'Jordan Lee');
  assert.equal(sub.terms.dscr['Loan term and extension options'], '30-year loan');
  assert.equal(sub.upsertRow.lender_type, 'bridge');
  assert.equal(sub.upsertRow.company_name, 'Apex Capital');
  assert.match(sub.body, /^Apex Capital, Jordan Lee · Bridge \/ Hard money \/ Private\n/);

  // Countering an ask clears the field until the lender types a custom answer.
  const qRate = questions.find((x) => x.key === 'rates_fees');
  const opened = lt.openTermCounter(drafts, editing, 'bridge', qRate);
  assert.equal(lt.isTermsFormComplete({
    company: 'Apex Capital',
    name: 'Jordan Lee',
    questions,
    values: lt.resolveTermValues(asks, opened.drafts.bridge),
  }), false);

  const countered = lt.setTermAnswer(opened.drafts, opened.editing, 'bridge', qRate.label, '10.25% IO, 2 pts', qRate.key);
  const counteredValues = lt.resolveTermValues(asks, countered.drafts.bridge);
  assert.equal(lt.isTermCountering(qRate, asks[qRate.label], countered.drafts.bridge, countered.editing.bridge), true);
  assert.equal(counteredValues[qRate.label], '10.25% IO, 2 pts');

  const counterHtml = renderToStaticMarkup(React.createElement(lt.LenderTermField, {
    question: qRate,
    ask: asks[qRate.label],
    value: counteredValues[qRate.label],
    countering: true,
    preview: false,
    onOpenCounter: () => {},
    onRestoreAsk: () => {},
    onChange: () => {},
  }));
  assert.doesNotMatch(counterHtml, />Not applicable</);
  assert.match(counterHtml, /value="10\.25% IO, 2 pts"/);

  // Saved Supabase terms matching our ask stay a card; saved counter values open as an input.
  const qAdvance = questions.find((x) => x.key === 'purchase_advances');
  const savedDraft = {
    [qAdvance.label]: asks[qAdvance.label],
    [qRate.label]: '10% IO, 2 pts',
  };
  assert.equal(lt.isTermCountering(qAdvance, asks[qAdvance.label], savedDraft, {}), false);
  assert.equal(lt.isTermCountering(qRate, asks[qRate.label], savedDraft, {}), true);
});

test('owner preview leaves Your name blank instead of Preview, keeps Change clickable, and keeps inputs and submit disabled', async () => {
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

  // Your name input is blank with placeholder="Your name" and never shows "Preview".
  assert.match(html, /Your name<input[^>]*placeholder="Your name"[^>]*value=""/);
  assert.doesNotMatch(html, /value="Preview"/);

  // Ask-card Change buttons remain clickable in preview; inputs and submit stay disabled; no Not applicable button.
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Change</);
  assert.doesNotMatch(html, />Not applicable<\/button>/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);

  // Countering state in preview keeps Use ours clickable while input and mic stay disabled; no Not applicable button.
  const q = lt.questionsForProgram('bridge').find((x) => x.key === 'rates_fees');
  const previewCounterHtml = renderToStaticMarkup(React.createElement(lt.LenderTermField, {
    question: q,
    ask: '11% interest only, 2.5 points',
    value: '',
    countering: true,
    preview: true,
    onOpenCounter: () => {},
    onRestoreAsk: () => {},
    onChange: () => {},
  }));
  assert.doesNotMatch(previewCounterHtml, /<button[^>]*disabled=""[^>]*>Use ours<\/button>/);
  assert.match(previewCounterHtml, /<input[^>]*disabled=""/);
  assert.match(previewCounterHtml, /<button[^>]*aria-label="Dictate Interest rate, origination points and fees"[^>]*disabled=""/);
  assert.doesNotMatch(previewCounterHtml, />Not applicable<\/button>/);
});
