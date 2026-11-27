// One-page per role working tools tests:
// - Reviewer & Lender render Offers/SendWhatIf (local-only, no saves)
// - Realtor renders WorkBoard, SellerPulse, InboxSummary, SellerOffer, WhatIfNumbers
// - Owner Building numbers include rent and exclude tenthUnitRepair
// - What-ifs never call a save on commercial_models or commercial_offers
// - Phone-first 390px tap target & checkbox wrapper checks, plus forbidden wording guards
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, buildLeadStory, applyGuideRefi, sharedRefiStory, evaluate, grade, money, operating, pct, valueSummary } from '../src/lib/dealmath.js';
import { buildFallbackRentValue, buildLenderPackage, LENDER_LENSES } from '../src/lib/lenderModel.js';
import { effectiveMarketRange } from '../src/lib/rangeValue.js';
import { plain } from '../src/lib/plain.js';
import { breakEvenCount } from '../src/lib/occupancy.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadJsx(file, mocks) {
  let src = read(file).replace(/import\.meta\.env\.VITE_SITE_KIND/g, '""');
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

const SHELL_MOCK = {
  __esModule: true,
  default: ({ children }) => React.createElement('div', null, children),
  Button: ({ children, ...p }) => React.createElement('button', p, children),
  Badge: ({ children }) => React.createElement('span', null, children),
  Card: ({ children, className }) => React.createElement('section', { className }, children),
  CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside),
  Empty: ({ children }) => React.createElement('p', null, children),
  Field: (p) => React.createElement('input', p),
  InfoTip: ({ label }) => React.createElement('span', { 'aria-label': label }),
  OverlayTrigger: ({ children }) => React.createElement('span', null, children),
  JumpNav: ({ sections }) => React.createElement('nav', { 'aria-label': 'Deal sections' }, sections.map(([k, l]) => React.createElement('a', { key: k, href: `#sec-${k}` }, l))),
  useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
};

const DEAL = { id: 'deal-1', slug: 'charlotte', title: '23-27 Charlotte St', address: '23-27 Charlotte St, Akron, OH', status: 'active', seller_content: { summary: '10-unit property.' } };
const ME = { uid: 'u-1', email: 'test@example.com', name: 'Tester' };
const SAMPLE_OFFERS = [{
  id: 'off-1',
  deal_id: 'deal-1',
  name: 'B: Seller financing',
  structure: 'wrap',
  is_lead: true,
  share_reviewer: true,
  share_lender: true,
  share_realtor: true,
  inputs: { note: 360000, rate: 5, amortYears: 0, closing: 3000, buyerCash: 0 },
}];
const SAMPLE_BASE = { units: 10, rent: 950, vacancyPct: 7, taxes: 12000, insurance: 6000, waterMo: 500, reservesPerUnit: 300, value: 750000, rehab: 124050, refiRate: 7.5, refiYears: 30 };

function makeOfferMocks(touched = false) {
  const saves = [];
  const supabaseStub = {
    from: (table) => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: [] }), maybeSingle: async () => ({ data: null }), then: () => {} }) }),
      upsert: (payload) => { saves.push({ table, op: 'upsert', payload }); return Promise.resolve({ error: null }); },
      update: (payload) => ({ eq: () => { saves.push({ table, op: 'update', payload }); return Promise.resolve({ error: null }); } }),
      insert: (payload) => { saves.push({ table, op: 'insert', payload }); return Promise.resolve({ error: null }); },
      delete: () => ({ eq: () => { saves.push({ table, op: 'delete' }); return Promise.resolve({ error: null }); } }),
    }),
    rpc: async () => ({ data: null, error: null }),
  };
  const costSummaryMod = loadJsx('src/components/CostSummary.jsx', { './Shell.jsx': SHELL_MOCK });
  const unitsGuideMod = loadJsx('src/components/UnitsRentedGuide.jsx', {
    './CostSummary.jsx': costSummaryMod.default,
    './Shell.jsx': SHELL_MOCK,
    '../lib/dealmath.js': { money },
  });
  const switchesMod = loadJsx('src/components/Switches.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, money, operating, pct, valueSummary },
    '../lib/useDealModel.js': { useDealModel: () => ({ offers: [], base: SAMPLE_BASE, setBase: () => {}, touched, original: { list: [], base: SAMPLE_BASE }, reset: () => {} }) },
    './Messages.jsx': { sendToOwner: async () => null },
    './Shell.jsx': SHELL_MOCK,
  });
  const offersMod = loadJsx('src/views/Offers.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../components/Dictation.jsx': { DictatedField: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p) },
    '../lib/supabase.js': { supabase: supabaseStub },
    '../lib/useDealModel.js': {
      useDealModel: () => ({
        offers: SAMPLE_OFFERS,
        setOffers: () => {},
        base: SAMPLE_BASE,
        setBase: () => {},
        later: () => {},
        saved: '',
        error: '',
        reset: () => {},
        touched,
        original: { list: SAMPLE_OFFERS, base: SAMPLE_BASE },
      }),
    },
    '../components/Switches.jsx': switchesMod,
    '../components/CostSummary.jsx': costSummaryMod,
    '../components/UnitsRentedGuide.jsx': unitsGuideMod,
    '../lib/dealmath.js': { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, buildLeadStory, applyGuideRefi, sharedRefiStory, evaluate, grade, money, pct, valueSummary },
    '../components/Shell.jsx': SHELL_MOCK,
    '../lib/plain.js': { plain },
    '../lib/occupancy.js': { breakEvenCount },
    '../lib/site.js': { SITE_KIND: '', canAccessDealPlan: () => true },
  });
  return { saves, costSummaryMod, unitsGuideMod, switchesMod, offersMod, supabaseStub };
}

test('reviewer and lender render Offers and SendWhatIf on one page without saving', () => {
  const { offersMod, switchesMod, unitsGuideMod, costSummaryMod, supabaseStub } = makeOfferMocks(true);

  const reviewerMod = loadJsx('src/views/Reviewer.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    './Comps.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Comps' }) },
    './Offers.jsx': offersMod,
    '../lib/supabase.js': { supabase: supabaseStub },
    '../lib/dealmath.js': { evaluate, operating, money, pct, valueSummary },
    '../lib/useDealModel.js': { useDealModel: () => ({ offers: SAMPLE_OFFERS, base: SAMPLE_BASE }) },
    '../components/Shell.jsx': SHELL_MOCK,
    '../components/Dictation.jsx': { DictatedField: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p) },
    '../components/Messages.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Messages' }), sendToOwner: async () => null },
    '../components/Files.jsx': {
      useUploads: () => [[], () => {}],
      Uploader: () => React.createElement('div', { 'data-mock': 'Uploader' }),
      FileList: () => React.createElement('div', { 'data-mock': 'FileList' }),
    },
    '../components/Photos.jsx': { Cover: () => React.createElement('div', { 'data-mock': 'Cover' }), photosOf: () => [] },
    '../components/PropertyFacts.jsx': { __esModule: true, default: ({ slug }) => React.createElement('div', { 'data-mock': 'PropertyFacts', 'data-slug': slug }) },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'UnitGallery' }) },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    '../components/UnitsRentedGuide.jsx': unitsGuideMod,
    '../components/RentValue.jsx': { __esModule: true, default: () => null, isRentValue: () => false },
    '../lib/requestRoles.js': { VIEWER_REQUEST_ROLES: [['lender', 'Lender'], ['reviewer', 'Reviewer']] },
  });

  const revHtml = renderToStaticMarkup(React.createElement(reviewerMod.default, { deal: DEAL, me: ME, role: 'reviewer', preview: false }));
  assert.match(revHtml, /data-section="overview"/);
  assert.match(revHtml, /data-section="offers"/);
  assert.match(revHtml, /Send to Buyer/);
  assert.match(revHtml, /Quick opinion/);
  assert.match(revHtml, /Building numbers/);
  assert.match(revHtml, /Yearly profit before payments/);
  assert.match(revHtml, /Value after repairs/);
  assert.match(revHtml, /Yearly return on value/);
  assert.match(revHtml, /Repair budget/);
  assert.match(revHtml, /Refinance/);
  assert.match(revHtml, /Send us files/);
  assert.match(revHtml, /data-mock="Comps"/);
  assert.match(revHtml, /data-mock="UnitGallery"/);
  assert.match(revHtml, /data-mock="Messages"/);
  assert.doesNotMatch(revHtml, /StrategyIdeas|data-section="ideas"/);

  const viewerHtml = renderToStaticMarkup(React.createElement(reviewerMod.default, { deal: DEAL, me: ME, role: 'viewer', preview: false }));
  assert.match(viewerHtml, /data-mock="Cover"/);
  assert.match(viewerHtml, /data-mock="PropertyFacts"/);
  assert.match(viewerHtml, /data-slug="charlotte"/);
  assert.match(viewerHtml, /data-mock="UnitGallery"/);
  assert.match(viewerHtml, /Request access/);
  assert.match(viewerHtml, /Lender/);
  assert.match(viewerHtml, /Reviewer/);
  assert.doesNotMatch(viewerHtml, /The property|10-unit residential property|Building numbers|Send to Buyer|Quick opinion|data-section="offers"|data-section="messages"/);

  const viewerPreviewHtml = renderToStaticMarkup(React.createElement(reviewerMod.default, { deal: DEAL, me: ME, role: 'viewer', preview: true }));
  assert.match(viewerPreviewHtml, /Request access/);
  assert.match(viewerPreviewHtml, /<button[^>]*type="submit"[^>]*disabled=""/);

  const lenderWhatIfMod = loadJsx('src/components/LenderWhatIf.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/dealmath.js': { money },
    '../lib/lenderModel.js': { buildLenderPackage },
    './Messages.jsx': { sendToOwner: async () => null },
    './Shell.jsx': SHELL_MOCK,
  });

  const lenderMod = loadJsx('src/views/Lender.jsx', {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    '../lib/supabase.js': { supabase: supabaseStub },
    '../lib/dealmath.js': { evaluate, money, valueSummary },
    '../lib/lenderModel.js': { buildFallbackRentValue, buildLenderPackage, LENDER_LENSES },
    '../lib/rangeValue.js': { effectiveMarketRange },
    '../lib/plain.js': { plain },
    '../lib/useDealModel.js': { useDealModel: () => ({ offers: SAMPLE_OFFERS, base: SAMPLE_BASE, error: '' }) },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], FileList: () => React.createElement('div', { 'data-mock': 'FileList' }) },
    '../components/Photos.jsx': { Cover: () => React.createElement('div', { 'data-mock': 'Cover' }), photosOf: () => [] },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'UnitGallery' }) },
    '../components/CostSummary.jsx': costSummaryMod,
    '../components/UnitsRentedGuide.jsx': unitsGuideMod,
    '../components/RentValue.jsx': { __esModule: true, default: () => null, isRentValue: () => false },
    '../components/LenderWhatIf.jsx': lenderWhatIfMod,
    '../components/Shell.jsx': SHELL_MOCK,
    '../components/Messages.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Messages' }) },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    './LenderTerms.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'LenderTerms' }) },
    './CityRecords.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'CityRecords' }) },
  });

  const lenderHtml = renderToStaticMarkup(React.createElement(lenderMod.default, { deal: DEAL, me: ME, preview: false }));
  assert.match(lenderHtml, /data-section="plan"/);
  assert.match(lenderHtml, /data-section="what-if"/);
  assert.match(lenderHtml, /data-section="terms"/);
  assert.match(lenderHtml, /Bridge loan plan/);
  assert.match(lenderHtml, /Loan assumptions/);
  assert.match(lenderHtml, /data-mock="LenderTerms"/);
  assert.match(lenderHtml, /Supporting documents/);
  assert.match(lenderHtml, /data-mock="UnitGallery"/);
  assert.match(lenderHtml, /data-mock="Messages"/);
  assert.ok(switchesMod.WhatIfNumbers);
});

test('realtor renders WorkBoard, SellerPulse, InboxSummary, SellerOffer, and WhatIfNumbers with Tenants hidden', () => {
  const { switchesMod, supabaseStub } = makeOfferMocks(false);
  const realtorMod = loadJsx('src/views/Realtor.jsx', {
    './Walkthrough.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Walkthrough' }) },
    './Tenants.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Tenants' }) },
    './Comps.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Comps' }) },
    '../components/Shell.jsx': SHELL_MOCK,
    '../components/Messages.jsx': {
      __esModule: true,
      default: () => React.createElement('div', { 'data-mock': 'Messages' }),
      InboxSummary: () => React.createElement('div', { 'data-mock': 'InboxSummary' }),
      sendToOwner: async () => null,
    },
    '../components/Files.jsx': {
      __esModule: true,
      default: () => React.createElement('div', { 'data-mock': 'Files' }),
      useUploads: () => [[], () => {}],
    },
    '../components/Photos.jsx': {
      __esModule: true,
      default: () => React.createElement('div', { 'data-mock': 'Photos' }),
      Cover: () => React.createElement('div', { 'data-mock': 'Cover' }),
      photosOf: () => [],
    },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'UnitGallery' }) },
    '../components/Activity.jsx': { __esModule: true, default: () => React.createElement('div', { 'data-mock': 'Activity' }) },
    '../components/Pulse.jsx': {
      SellerPulse: () => React.createElement('div', { 'data-mock': 'SellerPulse' }),
      AlertsCard: () => React.createElement('div', { 'data-mock': 'AlertsCard' }),
    },
    '../components/SellerOffer.jsx': {
      __esModule: true,
      default: () => React.createElement('div', { 'data-mock': 'SellerOffer' }),
      useSellerOffer: () => ({ row: null, summary: null }),
    },
    '../components/DealWorkspace.jsx': { WorkBoard: () => React.createElement('div', { 'data-mock': 'WorkBoard' }) },
    '../components/Switches.jsx': switchesMod,
    '../lib/supabase.js': { supabase: supabaseStub },
    '../lib/dealmath.js': { money },
  });

  const html = renderToStaticMarkup(React.createElement(realtorMod.default, { deal: DEAL, me: ME, preview: false }));
  assert.match(html, /data-mock="WorkBoard"/);
  assert.match(html, /data-mock="SellerPulse"/);
  assert.match(html, /data-mock="InboxSummary"/);
  assert.match(html, /data-mock="SellerOffer"/);
  assert.match(html, /What-if numbers/);
  assert.match(html, /data-mock="Walkthrough"/);
  assert.match(html, /data-mock="Comps"/);
  assert.match(html, /data-mock="Files"/);
  assert.match(html, /data-mock="Messages"/);
  assert.doesNotMatch(html, /data-mock="Tenants"/);
  assert.doesNotMatch(read('src/views/Realtor.jsx'), /<Offers\b/);
  assert.doesNotMatch(html.slice(html.indexOf('data-section="overview"'), html.indexOf('data-section="tasks"')), /data-mock="Activity"/);
});

test('owner Building numbers include editable rent and exclude tenthUnitRepair; Owner keeps Activity lower', () => {
  assert.ok(BASE_FIELDS.some(([k, l, u]) => k === 'rent' && /Rent per unit/.test(l) && u === '$'));
  assert.ok(!BASE_FIELDS.some(([k]) => k === 'tenthUnitRepair'));

  const offersSrc = read('src/views/Offers.jsx');
  assert.match(offersSrc, /BASE_FIELDS\.map\(/);
  assert.match(offersSrc, /const \[open, setOpen\] = useState\(false\)/);
  assert.doesNotMatch(offersSrc, /BASE_FIELDS\.filter\(/);

  const ownerSrc = read('src/views/Owner.jsx');
  assert.match(ownerSrc, /<OwnerRentValue deal=\{deal\} \/>/);
  assert.match(ownerSrc, /id="sec-activity"[\s\S]*?<Activity deal=\{deal\} title="Recent activity" \/>/);
  assert.ok(ownerSrc.indexOf('sec-overview') < ownerSrc.indexOf('sec-activity'));
  assert.doesNotMatch(read('src/views/Dashboard.jsx'), /<Activity/);
  assert.match(read('src/views/Dashboard.jsx'), /<WorkBoard/);
});

test('what-ifs never call a save on commercial_models or commercial_offers', async () => {
  const saves = [];
  const supabaseStub = {
    from: (table) => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: SAMPLE_OFFERS }), maybeSingle: async () => ({ data: { base: SAMPLE_BASE } }) }) }),
      upsert: (payload) => { saves.push({ table, op: 'upsert', payload }); return Promise.resolve({ error: null }); },
      update: (payload) => ({ eq: () => { saves.push({ table, op: 'update', payload }); return Promise.resolve({ error: null }); } }),
      insert: (payload) => { saves.push({ table, op: 'insert', payload }); return Promise.resolve({ error: null }); },
      delete: () => ({ eq: () => { saves.push({ table, op: 'delete' }); return Promise.resolve({ error: null }); } }),
    }),
    rpc: async () => ({ data: SAMPLE_OFFERS, error: null }),
  };

  let capturedHook = null;
  let capturedSetState = null;
  const reactMock = {
    useState: (init) => {
      const val = typeof init === 'function' ? init() : init;
      capturedSetState = () => {};
      return [val, capturedSetState];
    },
    useRef: (init) => ({ current: init }),
    useEffect: (fn) => { fn(); },
  };
  const code = transformSync(read('src/lib/useDealModel.js'), { loader: 'js', format: 'cjs' }).code;
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === 'react') return reactMock;
    if (spec === './supabase.js') return { supabase: supabaseStub };
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);

  capturedHook = mod.exports.useDealModel(DEAL, { owner: false, onlyShared: 'reviewer' });
  capturedHook.setBase({ ...SAMPLE_BASE, rent: 1100, rehab: 124050 });
  capturedHook.later('off-1', () => supabaseStub.from('commercial_offers').update({ inputs: { note: 350000 } }).eq('id', 'off-1'));

  await new Promise((r) => setTimeout(r, 700));
  assert.equal(saves.length, 0, 'non-owner useDealModel must never write to commercial_models or commercial_offers');
});

test('phone-first 390px tap targets and forbidden wording guards pass across updated files', () => {
  assert.match(read('src/components/Shell.jsx'), /min-h-\[40px\][\s\S]*aria-current=\{active === k \? 'location' : undefined\}/);
  assert.match(read('src/components/DealWorkspace.jsx'), /<label className="inline-flex min-h-\[40px\] min-w-\[40px\][^"]*">[\s\S]*type="checkbox"/);
  assert.match(read('src/views/Offers.jsx'), /h-10 w-10/);
  assert.match(read('src/views/Offers.jsx'), /min-h-\[40px\][^"]*items-center gap-2"><input type="checkbox"/);
  assert.match(read('src/views/Comps.jsx'), /min-h-\[40px\] min-w-\[40px\][^"]*items-center justify-center/);
  assert.match(read('src/views/Tenants.jsx'), /min-h-\[40px\][^\n]*onClick=\{\(\) => setEditingId/);
  assert.match(read('src/views/Walkthrough.jsx'), /className="inline-flex min-h-\[40px\] items-center px-1\.5 underline hover:text-ink"\s*>\s*Edit/);

  const files = [
    'src/components/Shell.jsx',
    'src/components/Messages.jsx',
    'src/components/Switches.jsx',
    'src/components/LenderWhatIf.jsx',
    'src/components/DealWorkspace.jsx',
    'src/components/Files.jsx',
    'src/components/UnitGallery.jsx',
    'src/views/Owner.jsx',
    'src/views/Dashboard.jsx',
    'src/views/Offers.jsx',
    'src/views/Reviewer.jsx',
    'src/views/Lender.jsx',
    'src/views/LenderTerms.jsx',
    'src/views/Realtor.jsx',
    'src/views/Comps.jsx',
    'src/views/Tenants.jsx',
    'src/views/Walkthrough.jsx',
  ];
  const banned = /AMHA|Section 8|group home|sublease|voucher|housing authority|fully drawn|Added unit rehab|tenthUnitRepair|lead_guest/i;
  for (const f of files) {
    assert.doesNotMatch(read(f), banned, f);
  }
});
