import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadLeadOfferModule() {
  const raw = read('src/components/LeadOfferCard.jsx')
    .replace(/import\s+\{[^}]+\}\s+from\s+'react';/, '')
    .replace(/import\s+\{[^}]+\}\s+from\s+'\.\/Shell\.jsx';/, '');
  const code = transformSync(raw, { loader: 'jsx', format: 'cjs', jsxFactory: 'h', jsxFragment: 'Fragment' }).code;
  const mod = { exports: {} };
  const Card = ({ children }) => React.createElement('section', null, children);
  const CardTitle = ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside || null);
  const Button = ({ children, ...p }) => React.createElement('button', p, children);
  const OverlayTrigger = ({ children }) => React.createElement('span', null, children);
  const fn = new Function('module', 'exports', 'h', 'Fragment', 'useState', 'Button', 'Card', 'CardTitle', 'OverlayTrigger', code);
  fn(mod, mod.exports, React.createElement, React.Fragment, React.useState, Button, Card, CardTitle, OverlayTrigger);
  return mod.exports;
}

test('Seller page shows one plain-English offer, both parcels, lender clearance, and execution plan without placeholders', () => {
  const { LeadOfferCard, ExecutionPlanCard } = loadLeadOfferModule();
  const deal = { id: 'd1', slug: 'charlotte', title: '23-27 Charlotte St' };
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(LeadOfferCard, { deal, content: {}, preview: false }),
      React.createElement(ExecutionPlanCard, { content: {} })
    )
  );
  assert.match(html, /6801234 and 6807893/);
  assert.match(html, /Fahey loan or rent assignment/);
  assert.match(html, /How I’ll get this done/);
  assert.match(html, /Getting the property ready/);
  assert.match(html, /Leasing and collecting rent/);
  assert.match(html, /Keeping you updated/);
  assert.match(html, /Getting to closing/);
  assert.doesNotMatch(html, /Verified track record/);
  assert.doesNotMatch(html, /1,810|275,000|275K|Option A|Option B|Option C|Side by side/);

  const withProof = renderToStaticMarkup(
    React.createElement(ExecutionPlanCard, {
      content: { execution_proof: [{ title: '1801 Malasia Rd', detail: 'Completed rehab and stabilized.' }] },
    })
  );
  assert.match(withProof, /Verified track record/);
  assert.match(withProof, /1801 Malasia Rd/);
});

test('Walkthrough removes routine upload chatter and puts raw transcript behind View transcript', () => {
  const wt = read('src/views/Walkthrough.jsx');
  const cam = read('src/components/WalkthroughCamera.jsx');
  const ug = read('src/components/UnitGallery.jsx');
  assert.doesNotMatch(wt, /All uploaded ✓ Nothing is only on this phone/);
  assert.doesNotMatch(cam, /All uploaded ✓/);
  assert.doesNotMatch(wt, /Audio chunks save on your device/);
  assert.doesNotMatch(wt, /WHISPER_ENGINE_LABEL/);
  assert.doesNotMatch(wt, /Room in \{spaceLabel/);
  assert.match(wt, /View transcript/);
  assert.match(wt, /Hide transcript/);
  assert.match(wt, /openTranscripts\[n\.id\]/);
  assert.match(ug, /View transcript/);
});

test('Subtext sweep removes visible Source lines from Switches and Comps', () => {
  assert.doesNotMatch(read('src/components/Switches.jsx'), />Source:/);
  assert.doesNotMatch(read('src/views/Comps.jsx'), />Source:/);
  assert.match(read('src/views/Comps.jsx'), /<InfoTip/);
});

test('How I will get this done renders the owner-set step-by-step plan in order', () => {
  const { ExecutionPlanCard } = loadLeadOfferModule();
  const html = renderToStaticMarkup(
    React.createElement(ExecutionPlanCard, {
      content: {
        execution_steps: [
          { title: 'Check the building', items: ['Gas pressure test', 'Title and payoff letter'] },
          { title: 'Empty occupied units', detail: 'Court process only.' },
          { title: '', detail: 'dropped' },
        ],
      },
    })
  );
  assert.ok(html.indexOf('Check the building') < html.indexOf('Empty occupied units'));
  assert.match(html, /<li>Gas pressure test<\/li>/);
  assert.match(html, /Court process only\./);
  assert.doesNotMatch(html, /dropped/);
  assert.doesNotMatch(html, /Getting the property ready/);
});
