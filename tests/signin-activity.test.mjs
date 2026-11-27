import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { createClient } from '@supabase/supabase-js';
import {
  annotateSignins,
  formatPhoenixDate,
  formatPhoenixDateTime,
  latestSigninByEmail,
  signinActionLabel,
  signinRoleLabel,
} from '../src/lib/signinActivity.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadJsx(file, mocks, reactImpl = React) {
  const code = transformSync(read(file), {
    loader: 'jsx',
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': JSON.stringify({ VITE_SITE_KIND: '' }) },
  }).code;
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === 'react') return reactImpl;
    if (spec === 'react/jsx-runtime') return jsxRuntime;
    if (spec in mocks) return mocks[spec];
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);
  return mod.exports;
}

test('0029 migration defines owner-only commercial_signin_activity, dedupes double rows, excludes non-members/owners/test.invalid/service_role, and hardens commercial_log_view', () => {
  const sql = read('supabase/migrations/0029_owner_signin_activity.sql');
  assert.match(sql, /^[\s\S]*begin;/i);
  assert.match(sql, /notify pgrst,\s*'reload schema';/);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|net\.http_post|ntfy)\b/i);

  // commercial_signin_activity signature, security definer, empty search_path, owner-only 42501 gate
  assert.match(
    sql,
    /create or replace function public\.commercial_signin_activity\(\s*p_deal uuid,\s*p_limit int default 200\s*\)\s*returns table\s*\(\s*email text,\s*display_name text,\s*role text,\s*action text,\s*at timestamptz\s*\)[\s\S]*?security definer\s+set search_path = ''/i,
  );
  assert.match(sql, /if not public\.commercial_is_owner\(\) then\s*raise exception 'not allowed' using errcode = '42501';\s*end if;/i);

  // Grants: authenticated only, nothing to anon or public
  assert.match(sql, /revoke all on function public\.commercial_signin_activity\(uuid, int\) from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.commercial_signin_activity\(uuid, int\) to authenticated;/i);
  assert.match(sql, /revoke all on function public\.commercial_log_view\(text\) from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.commercial_log_view\(text\) to authenticated;/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*\bto\s+[^;]*\b(anon|public)\b/i);

  // Reads auth.audit_log_entries for login + user_signedup and joins members + access requests
  assert.match(sql, /from auth\.audit_log_entries e/i);
  assert.match(sql, /e\.payload ->> 'action' in \('login', 'user_signedup'\)/i);
  assert.match(sql, /left join public\.commercial_members m/i);
  assert.match(sql, /left join public\.commercial_access_requests r/i);
  assert.match(sql, /'requested ' \|\| coalesce/i);

  // Excludes owners, test.invalid, and service_role
  assert.match(sql, /not exists\s*\(\s*select 1\s+from public\.commercial_owners o\s+where o\.email = ev\.ev_email\s*\)/i);
  assert.match(sql, /not like '%@test\.invalid'/i);
  assert.match(sql, /<> 'service_role'/i);

  // Collapses double rows within 5 seconds per email + action
  assert.match(sql, /lag\(mt\.ev_at\) over\s*\(\s*partition by mt\.ev_email,\s*mt\.ev_action\s+order by mt\.ev_at desc/i);
  assert.match(sql, /interval '5 seconds'/i);

  // Hardened commercial_log_view
  assert.match(sql, /create or replace function public\.commercial_log_view\(p_slug text\)[\s\S]*security definer\s+set search_path = ''/i);
  assert.match(sql, /a\.kind = 'view'\s+and a\.created_at > now\(\) - interval '1 hour'/i);
  assert.match(sql, /perform public\.commercial_record\(v_deal_id, 'view', 'opened the deal page', 'team'\);/i);
});

test('signinActivity helpers format Phoenix timestamps, labels, and newest-first per-person highlighting', () => {
  // 2026-11-27T18:31:00Z is 11:31 AM in America/Phoenix (UTC-7 year-round)
  assert.equal(formatPhoenixDateTime('2026-11-27T18:31:00Z'), 'Nov 27, 11:31 AM');
  assert.equal(formatPhoenixDate('2026-11-27T18:31:00Z'), 'Nov 27');
  assert.equal(formatPhoenixDateTime('2026-11-27T04:15:00Z'), 'Nov 26, 9:15 PM');
  assert.equal(formatPhoenixDate('2026-11-27T04:15:00Z'), 'Nov 26');

  assert.equal(signinActionLabel('user_signedup'), 'Signed up');
  assert.equal(signinActionLabel('login'), 'Signed in');
  assert.equal(signinRoleLabel('seller'), 'Seller');
  assert.equal(signinRoleLabel('realtor'), 'Realtor');
  assert.equal(signinRoleLabel('requested lender'), 'Requested Lender');
  assert.equal(signinRoleLabel('requested reviewer'), 'Requested Reviewer');

  const annotated = annotateSignins([
    { email: 'Seller@Example.com', display_name: 'Pat Seller', role: 'seller', action: 'user_signedup', at: '2026-11-26T16:00:00Z' },
    { email: 'realtor@example.com', display_name: 'Dana Agent', role: 'realtor', action: 'login', at: '2026-11-27T18:00:00Z' },
    { email: 'seller@example.com', display_name: 'Pat Seller', role: 'seller', action: 'login', at: '2026-11-27T19:00:00Z' },
  ]);
  assert.deepEqual(
    annotated.map((r) => [r.email, r.action, r.isLatest]),
    [
      ['seller@example.com', 'login', true],
      ['realtor@example.com', 'login', true],
      ['Seller@Example.com', 'user_signedup', false],
    ],
  );

  const byEmail = latestSigninByEmail(annotated);
  assert.equal(byEmail['seller@example.com'].action, 'login');
  assert.equal(byEmail['realtor@example.com'].display_name, 'Dana Agent');
});

test('Owner People renders Sign-ins card (name/email, role, Signed up/Signed in, Phoenix time, latest highlighted, email only in overlay) and member sign-in chips including seller with zero subtext', async () => {
  const members = [
    { id: 'm1', email: 'seller@example.com', role: 'seller', display_name: 'Pat Seller', status: 'active' },
    { id: 'm2', email: 'realtor@example.com', role: 'realtor', display_name: 'Dana Agent', status: 'active' },
    { id: 'm3', email: 'lender@example.com', role: 'lender', display_name: '', status: 'active' },
  ];
  const signins = [
    { email: 'seller@example.com', display_name: 'Pat Seller', role: 'seller', action: 'login', at: '2026-11-27T18:31:00Z' },
    { email: 'seller@example.com', display_name: 'Pat Seller', role: 'seller', action: 'user_signedup', at: '2026-11-26T18:00:00Z' },
    { email: 'noname@example.com', display_name: '', role: 'requested lender', action: 'user_signedup', at: '2026-11-27T15:05:00Z' },
  ];
  const seen = { 'realtor@example.com': { last: '2026-11-26T20:00:00Z', count: 1 } };

  const reactWithState = {
    ...React,
    useState(init) {
      if (init === null) {
        // First null state in People is `rows`, second null state is `signins`
        reactWithState._nullIdx = (reactWithState._nullIdx || 0) + 1;
        return [reactWithState._nullIdx === 1 ? members : signins, () => {}];
      }
      if (init && typeof init === 'object' && !('email' in init)) {
        return [seen, () => {}];
      }
      return React.useState(init);
    },
  };

  const noop = () => null;
  const ownerMod = loadJsx(
    'src/views/Owner.jsx',
    {
      '../components/Dictation.jsx': { DictatedField: () => null },
      '../lib/people.js': { setDealNames: () => {} },
      './Walkthrough.jsx': { __esModule: true, default: noop },
      './Tenants.jsx': { __esModule: true, default: noop },
      './Comps.jsx': { __esModule: true, default: noop },
      '../components/UnitGallery.jsx': { __esModule: true, default: noop },
      './LenderTerms.jsx': { LenderBoard: noop },
      '../lib/supabase.js': { supabase: {} },
      '../lib/format.js': await import('../src/lib/format.js'),
      '../lib/signinActivity.js': await import('../src/lib/signinActivity.js'),
      '../lib/site.js': await import('../src/lib/site.js'),
      '../lib/openViewer.js': { summarizeOpenViews: () => ({ activeLink: null, totalViews: 0, uniqueVisitors: 0, lastViewed: null }) },
      '../components/Shell.jsx': {
        Card: ({ children, className }) => React.createElement('section', { className }, children),
        CardTitle: ({ children }) => React.createElement('h2', null, children),
        Button: ({ children, ...p }) => React.createElement('button', p, children),
        Field: (p) => React.createElement('input', p),
        Empty: ({ children }) => React.createElement('p', null, children),
        InfoTip: ({ label, lines }) => React.createElement('span', { 'data-infotip': label, 'data-lines': (lines || []).filter(Boolean).join(' | ') }),
        JumpNav: noop,
        OverlayTrigger: ({ children, lines, label }) => React.createElement('span', { 'data-overlay-label': label || '', 'data-overlay': (lines || []).join(' | ') }, children),
        useSectionScroll: () => ({ activeSection: 'settings', jumpTo: () => {} }),
      },
      '../components/Messages.jsx': { __esModule: true, default: noop },
      '../components/Files.jsx': { __esModule: true, default: noop },
      '../components/Photos.jsx': { __esModule: true, default: noop },
      './Offers.jsx': { __esModule: true, default: noop },
      '../components/Pulse.jsx': { AlertsCard: noop },
      './Dashboard.jsx': { __esModule: true, default: noop },
      '../components/LoanPosition.jsx': { __esModule: true, default: noop },
      '../components/OwnerRentValue.jsx': { __esModule: true, default: noop },
      '../components/AccessRequests.jsx': { __esModule: true, default: noop },
      '../components/Activity.jsx': { __esModule: true, default: noop },
      './CityRecords.jsx': { __esModule: true, default: noop },
      './DealPlan.jsx': { __esModule: true, default: noop },
    },
    reactWithState,
  );

  // Render SignInsCard standalone to check email hiding & formatting without member list interference
  const cardHtml = renderToStaticMarkup(React.createElement(ownerMod.SignInsCard, { rows: signins }));
  assert.match(cardHtml, /<h2>Sign-ins<\/h2>/);
  assert.match(cardHtml, /Pat Seller/);
  assert.match(cardHtml, /Seller/);
  assert.match(cardHtml, /Signed in/);
  assert.match(cardHtml, /Nov 27, 11:31 AM/);
  assert.match(cardHtml, /Signed up/);
  assert.match(cardHtml, /Nov 26, 11:00 AM/);
  assert.match(cardHtml, /Requested Lender/);
  assert.match(cardHtml, /noname@example\.com/);
  assert.equal((cardHtml.match(/data-latest="true"/g) || []).length, 2);
  // Named user's email appears ONLY inside data-overlay attribute, never in visible text
  const visibleCardText = cardHtml.replace(/<[^>]+>/g, ' ');
  assert.equal(visibleCardText.includes('seller@example.com'), false);
  assert.match(cardHtml, /data-overlay="seller@example\.com"/);

  // Render People to verify Sign-ins card presence + member row summary chips (seller included)
  reactWithState._nullIdx = 0;
  const peopleHtml = renderToStaticMarkup(React.createElement(ownerMod.People, { deal: { id: 'd1', slug: 'charlotte' } }));
  assert.match(peopleHtml, /<h2>Sign-ins<\/h2>/);
  assert.match(peopleHtml, /Signed in Nov 27/);
  assert.equal((peopleHtml.match(/Never signed in/g) || []).length, 2);
  // Seller row has Signed in chip; realtor & lender have Never signed in
  const sellerLi = peopleHtml.match(/<li[^>]*>[\s\S]*?Pat Seller[\s\S]*?<\/li>/)?.[0] || '';
  assert.match(sellerLi, /Signed in Nov 27/);
});

test('Supabase rpc builder is lazy (unawaited calls make 0 requests; awaited calls send POST)', async () => {
  const requests = [];
  const client = createClient('https://example.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: String(url), method: init?.method || 'GET' });
        return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  });

  // Unawaited call reproduces the original bug: zero HTTP requests fired.
  client.rpc('commercial_log_view', { p_slug: 'charlotte' });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(requests.length, 0);

  // Awaited call executes POST /rest/v1/rpc/commercial_log_view.
  await client.rpc('commercial_log_view', { p_slug: 'charlotte' });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/rest\/v1\/rpc\/commercial_log_view$/);
  assert.equal(requests[0].method, 'POST');
});

test('DealRoom awaits commercial_log_view on load for every signed-in non-owner role and skips owner', async () => {
  const runForRole = async (role) => {
    const executedRpcs = [];
    const lazyRpc = (fn, params) => {
      const promise = Promise.resolve({ data: fn === 'commercial_my_role' ? role : null, error: null });
      return {
        then(onFulfilled, onRejected) {
          executedRpcs.push({ fn, params });
          return promise.then(onFulfilled, onRejected);
        },
      };
    };

    const effects = [];
    const mockReact = {
      ...React,
      lazy: () => () => null,
      Suspense: ({ children }) => children,
      useEffect(fn) { effects.push(fn); },
      useState(init) { return [init, () => {}]; },
    };

    const dealQuery = {
      select() { return this; },
      eq() { return this; },
      maybeSingle() {
        return Promise.resolve({
          data: fnData(role),
          error: null,
        });
      },
    };
    function fnData() {
      return { id: 'deal-1', slug: 'charlotte', title: 'Charlotte', address: '23-27 Charlotte St, Akron, OH' };
    }

    const dealRoomMod = loadJsx(
      'src/views/DealRoom.jsx',
      {
        '../lib/supabase.js': {
          supabase: {
            rpc: lazyRpc,
            from: () => dealQuery,
          },
        },
        '../lib/format.js': await import('../src/lib/format.js'),
        '../lib/people.js': { setDealNames: () => {}, buyerName: () => 'Buyer' },
        '../components/Shell.jsx': Object.assign(
          ({ children }) => React.createElement('div', null, children),
          {
            Card: ({ children }) => React.createElement('section', null, children),
            Empty: ({ children }) => React.createElement('p', null, children),
            PropertyHead: () => null,
          },
        ),
        '../lib/site.js': { PUBLIC_SITE: 'https://example.invalid/', SITE_KIND: '', roleAllowedHere: () => true },
      },
      mockReact,
    );

    renderToStaticMarkup(
      React.createElement(dealRoomMod.default, {
        slug: 'charlotte',
        tab: '',
        sub: '',
        session: { user: { id: 'u1', email: `${role}@example.com` } },
      }),
    );

    assert.equal(effects.length, 1);
    effects[0]();
    await new Promise((r) => setTimeout(r, 15));
    return executedRpcs.filter((c) => c.fn === 'commercial_log_view');
  };

  for (const role of ['realtor', 'seller', 'lender', 'reviewer', 'viewer', 'guest']) {
    const calls = await runForRole(role);
    assert.deepEqual(calls, [{ fn: 'commercial_log_view', params: { p_slug: 'charlotte' } }], `expected commercial_log_view for ${role}`);
  }

  const ownerCalls = await runForRole('owner');
  assert.deepEqual(ownerCalls, []);
});
