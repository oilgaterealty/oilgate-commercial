import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

import { canAccessCityRecords } from '../src/lib/site.js';
import { computeTermsOutcome } from '../src/lib/lenderModel.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

function loadJsx(rel, mocks = {}) {
  const src = read(rel).replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
  const { code } = transformSync(src, { loader: rel.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs', jsx: 'automatic' });
  const mod = { exports: {} };
  const localRequire = (id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id in mocks) return mocks[id];
    return require(id);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);
  return mod.exports;
}

const SHELL_MOCK = {
  Button: ({ children, ...p }) => React.createElement('button', p, children),
  Card: ({ children, className, ...p }) => React.createElement('section', { className, ...p }, children),
  CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside),
  Empty: ({ children }) => React.createElement('p', null, children),
  Field: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p),
  JumpNav: ({ sections, active }) => React.createElement(
    'nav',
    { 'aria-label': 'Jump sections', 'data-active-tab': active },
    sections.map(([k, l]) => React.createElement('a', { key: k, 'data-tab': k }, l)),
  ),
  InfoTip: ({ label }) => React.createElement('span', { 'aria-label': label }),
  OverlayTrigger: ({ children }) => React.createElement('span', null, children),
};

test('Section 1: consolidated tab lists match brief for every role and keep JumpNav highlighting Overview when InPagePanel opens', () => {
  const owner = read('src/views/Owner.jsx');
  assert.match(owner, /\['overview', 'Overview'\],\s*\['offers', 'Offers'\],\s*\['walkthrough', 'Walkthrough'\],\s*\['tenants', 'Tenants'\]/);
  assert.match(owner, /\[\.\.\.BASE_SECTIONS, \['plans', 'Plans'\]\]/);
  assert.match(owner, /const active = panel \? 'overview' :/);

  const realtor = read('src/views/Realtor.jsx');
  assert.match(realtor, /const SECTIONS = \[\s*\['overview', 'Overview'\],\s*\['offers', 'The offer'\],\s*\['walkthrough', 'Walkthrough'\],\s*\];/);
  assert.match(realtor, /const navActive = panel \? 'overview' : activeSection;/);

  const lender = read('src/views/Lender.jsx');
  assert.match(lender, /const SECTIONS = \[\s*\['overview', 'Overview'\],\s*\['terms', 'Your terms'\],\s*\['plan', 'The plan'\],\s*\];/);
  assert.doesNotMatch(lender, /\['what-if'|id="sec-what-if"|LenderWhatIf/);
  assert.match(lender, /const navActive = panel \? 'overview' : activeSection;/);

  const reviewer = read('src/views/Reviewer.jsx');
  assert.match(reviewer, /\['overview', 'Overview'\],\s*\['offers', 'The offer'\],\s*\['comps', 'Comps'\]/);
  assert.match(reviewer, /\['overview', 'Overview'\]/);
  assert.match(reviewer, /const navActive = panel \? 'overview' : activeSection;/);

  const dealRoom = read('src/views/DealRoom.jsx');
  assert.match(dealRoom, /data-settings-gear="true"/);
  assert.match(dealRoom, /aria-label="Settings"/);
  assert.match(dealRoom, /headerAction=\{ownerHeaderAction\}/);
});

test('Section 1 & 3: computeTermsOutcome scales live with shared rent, units rented, and private share across Bridge/Private/DSCR', () => {
  const base = {
    units: 10,
    rent: 1000,
    vacancyPct: 5,
    taxes: 13544,
    insurance: 6500,
    waterMo: 1000,
    mgmtPct: 8,
    purchasePrice: 275000,
    rehab: 142440,
    bridgeRepairs: 142440,
    bridgeClosing: 5500,
    bridgeProcessing: 1295,
    bridgePointsPct: 1,
    bridgeRate: 10,
    bridgeDeferredMonths: 2,
    bridgeTermMonths: 12,
    privateRate: 8,
    privateMinParticipation: 20000,
    refiRate: 7.5,
    refiYears: 30,
    refiDscr: 1.25,
    refiLtv: 75,
    refiFeesFlat: 5000,
    refiFeesPct: 2.1,
    value: 723047,
    valueCapRate: 9,
  };
  const offer = { structure: 'cash', inputs: {} };
  const bridge = computeTermsOutcome({ base, offer, lens: 'bridge', termValues: { 'Interest rate': '11' }, rent: 1000, unitsRented: 10 });
  const privateLoan = computeTermsOutcome({ base, offer, lens: 'private', termValues: { 'Interest rate': '9' }, participation: 50000, rent: 1000, unitsRented: 10 });
  const dscrLo = computeTermsOutcome({ base, offer, lens: 'dscr', termValues: { 'Max LTV (% of value)': '75', 'Term & amortization': '30 years' }, rent: 900, unitsRented: 10 });
  const dscrHi = computeTermsOutcome({ base, offer, lens: 'dscr', termValues: { 'Max LTV (% of value)': '80', 'Term & amortization': '30 years' }, rent: 1100, unitsRented: 10 });

  assert.ok(bridge.payoff > 400000);
  assert.ok(privateLoan.payment > 370 && privateLoan.payment < 380);
  assert.ok(dscrHi.rentMo > dscrLo.rentMo);
  assert.ok(dscrHi.payoff >= dscrLo.payoff);
  assert.ok(dscrHi.payment > dscrLo.payment);
});

test('Section 2, 2b & 5: OverviewActionButtons, InPagePanel, PhotoViewer Unit Gallery link, and badge counters behave accurately', () => {
  const sheetMod = loadJsx('src/components/OverlaySheet.jsx', {
    'react-dom': { createPortal: (node) => node },
  });

  const btnsHtml = renderToStaticMarkup(React.createElement(sheetMod.OverviewActionButtons, {
    showDocuments: true,
    showMessages: true,
    showCityRecords: true,
    showComps: false,
    docCount: 3,
    msgCount: 2,
    onOpenDocuments: () => {},
    onOpenMessages: () => {},
    onOpenCityRecords: () => {},
  }));
  assert.match(btnsHtml, /Documents[\s\S]*?>3</);
  assert.match(btnsHtml, /Messages[\s\S]*?>2</);
  assert.match(btnsHtml, /City records/);
  assert.doesNotMatch(btnsHtml, /Comps/);

  const sellerBtnsHtml = renderToStaticMarkup(React.createElement(sheetMod.OverviewActionButtons, {
    showDocuments: true,
    showMessages: true,
    showCityRecords: false,
    showComps: false,
    docCount: 0,
    msgCount: 0,
  }));
  assert.match(sellerBtnsHtml, /Documents/);
  assert.match(sellerBtnsHtml, /Messages/);
  assert.doesNotMatch(sellerBtnsHtml, /City records|Comps/);

  const panelClosed = renderToStaticMarkup(React.createElement(sheetMod.InPagePanel, { open: false, kind: 'documents', title: 'Documents', onClose: () => {} }, 'Body'));
  assert.equal(panelClosed, '');
  const panelOpen = renderToStaticMarkup(React.createElement(sheetMod.InPagePanel, { open: true, kind: 'documents', title: 'Documents', onClose: () => {} }, 'Body'));
  assert.match(panelOpen, /data-panel="documents"/);
  assert.match(panelOpen, /Overview/);
  assert.match(panelOpen, /Body/);

  const pvSrc = read('src/components/PhotoViewer.jsx');
  assert.match(pvSrc, /data-open-unit-gallery/);
  assert.match(pvSrc, /All photos by unit/);

  const { countUnreadMessages, countNewDocuments } = loadJsx('src/lib/sheetBadges.js', { './supabase.js': { supabase: null } });

  const lastSeen = Date.parse('2026-11-28T00:00:00Z');
  const msgCount = countUnreadMessages([
    { created_at: '2026-11-28T01:00:00Z', author_email: 'other@example.com' },
    { created_at: '2026-11-28T02:00:00Z', author_email: 'me@example.com' },
    { created_at: '2026-11-27T01:00:00Z', author_email: 'other@example.com' },
  ], 'me@example.com', lastSeen);
  assert.equal(msgCount, 1);

  const docCount = countNewDocuments([
    { kind: 'document', created_at: '2026-11-28T01:00:00Z', uploaded_by_email: 'other@example.com' },
    { kind: 'document', created_at: '2026-11-27T01:00:00Z', uploaded_by_email: 'other@example.com' },
  ], lastSeen);
  assert.equal(docCount, 1);
});

test('Section 4 & 5: WorkBoard open-first compact mode and Activity Latest 3 + See all render compactly', () => {
  const wbMocks = {
    './Dictation.jsx': { DictatedField: (p) => React.createElement(p.as || 'input', p) },
    '../lib/supabase.js': { supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ then: () => {} }) }) }) }) }) } },
    '../lib/format.js': { when: () => 'today', roleLabel: { owner: 'Buyer', realtor: 'Realtor' } },
    '../lib/people.js': { ownerLabel: () => 'Buyer' },
    '../lib/useDealActions.js': { addWorkItem: async () => ({ error: null }), toggleWorkItem: async () => {}, deleteWorkItem: async () => {} },
    './Shell.jsx': SHELL_MOCK,
  };
  const wbMod = loadJsx('src/components/DealWorkspace.jsx', wbMocks);

  const rows = [
    { id: 'done-1', body: 'Done early', done: true, author_role: 'owner', author_email: 'o@example.com', audience: [], created_at: '2026-11-28T04:00:00Z' },
    { id: 'open-1', body: 'Open A', done: false, author_role: 'owner', author_email: 'o@example.com', audience: [], created_at: '2026-11-28T01:00:00Z' },
    { id: 'open-2', body: 'Open B', done: false, author_role: 'owner', author_email: 'o@example.com', audience: [], created_at: '2026-11-28T02:00:00Z' },
    { id: 'open-3', body: 'Open C', done: false, author_role: 'owner', author_email: 'o@example.com', audience: [], created_at: '2026-11-28T03:00:00Z' },
  ];
  let stateCall = 0;
  const mockReact = {
    ...React,
    useState(init) {
      stateCall += 1;
      if (stateCall === 1) return [rows, () => {}];
      return React.useState(init);
    },
  };
  const wbCustom = (() => {
    const src = read('src/components/DealWorkspace.jsx');
    const { code } = transformSync(src, { loader: 'jsx', format: 'cjs', jsx: 'automatic' });
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', code)(mod, mod.exports, (id) => {
      if (id === 'react') return mockReact;
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id in wbMocks) return wbMocks[id];
      return require(id);
    });
    return mod.exports;
  })();

  const wbHtml = renderToStaticMarkup(React.createElement(wbCustom.WorkBoard, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { email: 'o@example.com' },
    role: 'owner',
    compactLimit: 3,
  }));
  assert.match(wbHtml, /Open A/);
  assert.match(wbHtml, /Open B/);
  assert.match(wbHtml, /Open C/);
  assert.doesNotMatch(wbHtml, /Done early/);
  assert.match(wbHtml, /See all \(4\)/);
  assert.match(wbHtml, /Add task/);
  assert.doesNotMatch(wbHtml, /aria-label="Task"/);

  const actSrc = read('src/components/Activity.jsx');
  assert.match(actSrc, /compactLimit = null/);
  assert.match(actSrc, /data-activity-see-all/);
  assert.ok(wbMod.WorkBoard);
});

test('Section 2b & 5b: 0039 grants read-only city_records access to realtor and reviewer with strict scope and zero leaks', () => {
  const sql = read('supabase/migrations/0039_city_records_realtor_reviewer.sql');
  assert.match(sql, /^[\s\S]*begin;/i);
  assert.match(sql, /notify pgrst,\s*'reload schema';/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /key like 'city_records:%'/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[2\] = 'city-records'/);
  assert.match(sql, /'realtor'/);
  assert.match(sql, /'reviewer'/);
  assert.doesNotMatch(sql, /'seller'|'viewer'|'guest'|deal_plan:|owner_ntfy_topic/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*\bto\s+[^;]*\b(anon|public)\b/i);
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from)\b/i);
  assert.doesNotMatch(sql, /pg-j6kkmlhqpl|im1iad33ebun/i);

  for (const r of ['lender', 'realtor', 'reviewer']) {
    assert.equal(canAccessCityRecords('public', r, false), true);
    assert.equal(canAccessCityRecords('owner', r, true), true);
  }
  for (const r of ['seller', 'viewer', 'guest', '']) {
    assert.equal(canAccessCityRecords('owner', r, false), false);
    assert.equal(canAccessCityRecords('public', r, false), false);
  }
});
