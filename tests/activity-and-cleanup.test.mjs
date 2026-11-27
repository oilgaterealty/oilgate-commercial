import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { buildOwnerActivityTimeline, buildRealtorSellerTimeline } from '../src/lib/activityTimeline.js';

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

test('Owner page removes Private links UI while keeping Open viewer link, invites, and access requests', () => {
  const owner = read('src/views/Owner.jsx');
  assert.doesNotMatch(owner, /Private links|RoleLinks|roleLinkUrl|commercial_role_links|commercial_create_role_link|commercial_revoke_role_link/);
  assert.match(owner, /<OpenViewerLink\b/);
  assert.match(owner, /<AccessRequests\b/);
  assert.match(owner, /Invite someone/);
});

test('buildOwnerActivityTimeline merges all sources newest-first across history, deduplicates trigger lines, and tolerates missing sources', () => {
  const deal = { id: 'd1', buyer_name: 'LaVante', seller_name: 'Pat Seller' };
  const members = [
    { email: 'alexis@example.com', display_name: 'Alexis', role: 'realtor' },
    { email: 'seller@example.com', display_name: 'Pat Seller', role: 'seller' },
    { email: 'lender@example.com', display_name: 'Jordan Lee', role: 'lender' },
  ];
  const signins = [
    { email: 'alexis@example.com', display_name: 'Alexis', role: 'realtor', action: 'login', at: '2026-11-26T18:00:00Z' },
  ];
  const openViews = [
    { id: 'ov1', link_id: 'l1', visitor: 'vis-1', viewed_at: '2026-11-25T15:30:00Z' },
  ];
  const accessRequests = [
    { id: 'ar1', email: 'newlender@example.com', requester_name: 'Sam Bank', requested_role: 'lender', source: 'open_link', status: 'pending', created_at: '2026-11-27T17:00:00Z' },
  ];
  const messages = [
    { id: 'm1', author_email: 'seller@example.com', author_role: 'seller', author_name: '', topic: 'Offer', body: 'Can we talk tomorrow?', created_at: '2026-11-27T19:00:00Z' },
  ];
  const uploads = [
    { id: 'u1', uploaded_by_email: 'lender@example.com', uploaded_by_role: 'lender', kind: 'document', file_name: 'term-sheet.pdf', created_at: '2026-11-24T12:00:00Z' },
  ];
  const activity = [
    // Duplicate trigger rows matching message m1 and upload u1 within 10s should be collapsed
    { id: 'a-dup-msg', actor_email: 'seller@example.com', actor_role: 'seller', actor_name: 'Pat Seller', kind: 'message', summary: 'wrote: Can we talk tomorrow?', created_at: '2026-11-27T19:00:01Z' },
    { id: 'a-dup-up', actor_email: 'lender@example.com', actor_role: 'lender', actor_name: 'Jordan Lee', kind: 'upload', summary: 'uploaded a document: term-sheet.pdf', created_at: '2026-11-24T12:00:02Z' },
    // Distinct historical view and interest rows stay
    { id: 'a-view', actor_email: 'alexis@example.com', actor_role: 'realtor', actor_name: 'Alexis', kind: 'view', summary: 'opened the deal page', created_at: '2026-11-26T18:05:00Z' },
    { id: 'a-int', actor_email: 'seller@example.com', actor_role: 'seller', actor_name: 'Pat Seller', kind: 'interest', summary: 'Seller marked: interested in talking', created_at: '2026-11-23T14:00:00Z' },
  ];

  const rows = buildOwnerActivityTimeline({ deal, members, signins, activity, openViews, accessRequests, messages, uploads });
  assert.equal(rows.length, 7);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['message', 'access_request', 'view', 'signin', 'open_view', 'upload', 'interest'],
  );
  assert.equal(rows[0].name, 'Pat Seller');
  assert.equal(rows[0].role, 'Seller');
  assert.match(rows[0].what, /^Wrote \(Offer\): Can we talk tomorrow\?/);
  assert.equal(rows[1].name, 'Sam Bank');
  assert.equal(rows[1].role, 'Requested Lender');
  assert.match(rows[1].what, /Requested lender access via open link/);
  assert.equal(rows[3].name, 'Alexis');
  assert.equal(rows[3].role, 'Realtor');
  assert.equal(rows[3].what, 'Signed in');
  assert.equal(rows[4].name, 'Open link visitor');
  assert.equal(rows[4].role, 'Viewer');

  // Missing RPC/sources (null/false) degrade gracefully and keep the rest
  const partial = buildOwnerActivityTimeline({ deal, members, signins: null, activity: false, openViews: null, accessRequests: null, messages, uploads: null });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].kind, 'message');
});

test('0030 migration enforces realtor-only access, seller-only history, empty search_path, and strict grants', () => {
  const sql = read('supabase/migrations/0030_realtor_seller_activity.sql');
  assert.match(sql, /^[\s\S]*begin;/i);
  assert.match(sql, /notify pgrst,\s*'reload schema';/);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|net\.http_post|ntfy)\b/i);

  assert.match(
    sql,
    /create or replace function public\.commercial_realtor_seller_activity\(\s*p_deal uuid,\s*p_limit int default 100\s*\)\s*returns table\s*\(\s*kind text,\s*display_name text,\s*summary text,\s*at timestamptz\s*\)[\s\S]*?security definer\s+set search_path = ''/i,
  );
  assert.match(
    sql,
    /create or replace function public\.commercial_realtor_has_seller\(\s*p_deal uuid\s*\)\s*returns boolean[\s\S]*?security definer\s+set search_path = ''/i,
  );
  assert.match(sql, /public\.commercial_member_role\(p_deal\) is distinct from 'realtor'/i);
  assert.match(sql, /m\.role = 'seller'/i);
  assert.match(sql, /from auth\.audit_log_entries e/i);
  assert.match(sql, /a\.actor_role = 'seller'/i);
  assert.match(sql, /msg\.author_role = 'seller'/i);
  assert.match(sql, /revoke all on function public\.commercial_realtor_seller_activity\(uuid, int\) from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.commercial_realtor_seller_activity\(uuid, int\) to authenticated;/i);
  assert.match(sql, /revoke all on function public\.commercial_realtor_has_seller\(uuid\) from public, anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.commercial_realtor_has_seller\(uuid\) to authenticated;/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*\bto\s+[^;]*\b(anon|public)\b/i);
});

test('Realtor Recent activity shows only seller activity and shows invite action when seller has no account yet', async () => {
  const realtorSrc = read('src/views/Realtor.jsx');
  assert.match(realtorSrc, /mode="realtor-seller"/);
  assert.doesNotMatch(realtorSrc, /What the buyer has done|actors=\{\['owner'\]\}/);

  // Fallback timeline strictly excludes owner/realtor/lender rows
  const sellerOnly = buildRealtorSellerTimeline({
    deal: { id: 'd1', seller_name: 'Pat Seller' },
    fallbackSignins: [
      { email: 'owner@example.com', display_name: 'Buyer', role: 'owner', action: 'login', at: '2026-11-27T18:00:00Z' },
      { email: 'seller@example.com', display_name: 'Pat Seller', role: 'seller', action: 'login', at: '2026-11-27T17:00:00Z' },
    ],
    fallbackActivity: [
      { id: 'a1', actor_role: 'owner', actor_name: 'Buyer', kind: 'view', summary: 'opened the deal page', created_at: '2026-11-27T18:10:00Z' },
      { id: 'a2', actor_role: 'seller', actor_name: 'Pat Seller', kind: 'view', summary: 'opened the deal page', created_at: '2026-11-27T17:10:00Z' },
    ],
    fallbackMessages: [
      { id: 'm1', author_role: 'realtor', author_name: 'Alexis', body: 'Checking in', created_at: '2026-11-27T18:20:00Z' },
      { id: 'm2', author_role: 'seller', author_name: 'Pat Seller', topic: 'Terms', body: 'Looks good', created_at: '2026-11-27T17:20:00Z' },
    ],
  });
  assert.equal(sellerOnly.length, 3);
  assert.ok(sellerOnly.every((r) => r.role === 'Seller'));
  assert.deepEqual(sellerOnly.map((r) => r.kind), ['message', 'view', 'signin']);

  // Render ActivityTimelineList to verify Phoenix timestamps and zero subtext
  const signinMod = await import('../src/lib/signinActivity.js');
  const ShellMock = {
    Card: ({ children }) => React.createElement('section', null, children),
    CardTitle: ({ children }) => React.createElement('h2', null, children),
    Empty: ({ children }) => React.createElement('p', null, children),
    Button: ({ children, kind: _k, ...p }) => React.createElement('button', p, children),
    Field: (p) => React.createElement('input', p),
  };
  const InviteStub = ({ deal, inline }) => React.createElement('div', { 'data-invite-seller': inline ? 'inline' : 'card', 'data-deal': deal.id }, 'Invite the seller');

  // Render Activity when seller is not invited yet (rows = [], hasSeller = false)
  let stateCall = 0;
  const mockReactNoSeller = {
    ...React,
    useState(init) {
      stateCall += 1;
      if (stateCall === 1) return [[], () => {}]; // rows = []
      if (stateCall === 2) return [false, () => {}]; // hasSeller = false
      return React.useState(init);
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
  };

  const activityMod = loadJsx(
    'src/components/Activity.jsx',
    {
      '../lib/supabase.js': { supabase: {} },
      '../lib/signinActivity.js': signinMod,
      '../lib/activityTimeline.js': { buildOwnerActivityTimeline, buildRealtorSellerTimeline },
      './SellerOffer.jsx': { InviteSeller: InviteStub },
      './Shell.jsx': ShellMock,
    },
    mockReactNoSeller,
  );

  const noSellerHtml = renderToStaticMarkup(React.createElement(activityMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    title: 'Recent activity',
    mode: 'realtor-seller',
  }));
  assert.match(noSellerHtml, /The seller hasn’t been invited yet\./);
  assert.match(noSellerHtml, /data-invite-seller="inline"/);

  const listHtml = renderToStaticMarkup(React.createElement(activityMod.ActivityTimelineList, { rows: sellerOnly }));
  assert.match(listHtml, /Pat Seller/);
  assert.match(listHtml, /Seller/);
  assert.match(listHtml, /Wrote \(Terms\): Looks good/);
  assert.match(listHtml, /Nov 27, 10:20 AM/);
});
