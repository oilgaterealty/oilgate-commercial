import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sql0018 = read('supabase/migrations/0018_v8_consolidated.sql');

function loadJsxWithMocks(file, mocks) {
  const code = transformSync(read(file), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
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

test('0018 migration is additive, idempotent, properly scoped, and free of forbidden wording', () => {
  assert.match(sql0018, /^[\s\S]*begin;/i);
  assert.match(sql0018, /notify pgrst,\s*'reload schema';/);
  assert.match(sql0018, /commit;\s*$/i);
  assert.doesNotMatch(sql0018, /\b(drop table|drop column|truncate|delete from)\b/i);
  assert.doesNotMatch(sql0018, /AMHA|Section 8|group home|sublease|\$1,810/i);

  for (const m of sql0018.matchAll(/alter table (\S+)/gi)) {
    assert.match(m[1], /^public\.commercial_/, m[1]);
  }
  for (const m of sql0018.matchAll(/create (?:or replace )?(?:function|unique index|index) (?:if not exists )?(\S+)/gi)) {
    assert.match(m[1], /^(public\.commercial_|commercial_access_private\.|commercial_)/, m[1]);
  }
  for (const m of sql0018.matchAll(/create policy (\w+) on ([\w.]+)/gi)) {
    assert.match(m[2], /^(public\.commercial_\w+|storage\.objects)$/, m[2]);
  }
});

test('0018 locks down offers to owner-only table access and exposes at most one lead offer via RPC without notes', () => {
  assert.match(sql0018, /drop policy if exists offers_shared on public\.commercial_offers;/);
  assert.match(sql0018, /create unique index if not exists commercial_offers_one_lead_idx[\s\S]*on public\.commercial_offers \(deal_id\) where is_lead;/);
  assert.match(sql0018, /add column if not exists is_lead boolean not null default false/);
  assert.match(sql0018, /add column if not exists share_lead_guest boolean not null default false/);
  assert.match(sql0018, /if r is null or r in \('seller', 'viewer', 'guest'\) then\s*return;\s*end if;/);
  assert.match(sql0018, /select o\.id, o\.deal_id, o\.name, o\.structure, o\.inputs, o\.updated_at/);
  assert.match(sql0018, /and o\.is_lead = true/);
  assert.match(sql0018, /\(r = 'lead_guest' and o\.share_lead_guest\)/);

  const getLeadBlock = sql0018.match(/create or replace function commercial_access_private\.get_lead_offer[\s\S]*?\$\$;/i)?.[0] || '';
  assert.doesNotMatch(getLeadBlock, /\bo\.note\b/);

  const useDealModel = read('src/lib/useDealModel.js');
  assert.match(useDealModel, /commercial_get_lead_offer/);
  assert.match(useDealModel, /x\.is_lead && Boolean\(x\['share_' \+ onlyShared\]\)/);
  assert.match(useDealModel, /\.map\(\(\{ note: _n, \.\.\.rest \}\) => rest\)/);

  const offersSrc = read('src/views/Offers.jsx');
  assert.match(offersSrc, /commercial_set_lead_offer/);
  assert.doesNotMatch(offersSrc, /share_lead_guest/);
  assert.match(offersSrc, /\{owner && offers\.length > 0 && view === 'table' && <OptionTable/);
  assert.match(offersSrc, /\{owner && \(\s*<div className="flex flex-wrap items-center gap-2">/);

  const lenderSrc = read('src/views/Lender.jsx');
  assert.doesNotMatch(lenderSrc, /Every option we looked at/);
});

test('0018 enforces recipient-bound, expiring, single-use, revocable links and requested_role on access requests', () => {
  for (const constraint of [
    /commercial_members_role_check[\s\S]*'lead_guest'/,
    /commercial_role_links_role_check[\s\S]*'lead_guest'/,
    /requested_role text[\s\S]*'lead_guest'/,
    /commercial_access_requests_approved_role_check[\s\S]*'lead_guest'/,
  ]) {
    assert.match(sql0018, constraint);
  }

  assert.match(sql0018, /l\.revoked_at is null[\s\S]*l\.expires_at > now\(\)[\s\S]*l\.recipient_email = m\.email/);
  assert.match(sql0018, /recipient email required/);
  assert.match(sql0018, /p_expires_days < 1 or p_expires_days > 90/);
  assert.match(sql0018, /wrong recipient/);
  assert.match(sql0018, /link expired/);
  assert.match(sql0018, /link revoked/);
  assert.match(sql0018, /link already used/);
  assert.match(sql0018, /requested role required/);

  const reqSrc = read('src/views/RequestAccess.jsx');
  assert.match(reqSrc, /<RoleChoice/);
  assert.match(reqSrc, /p_requested_role: r\b/);
  assert.doesNotMatch(reqSrc, /lead_guest/);

  const accSrc = read('src/components/AccessRequests.jsx');
  assert.match(accSrc, /row\.requested_role/);
  assert.doesNotMatch(accSrc, /'lead_guest'/);

  const joinSrc = read('src/views/Join.jsx');
  assert.match(joinSrc, /wrong recipient/);
  assert.match(joinSrc, /expired/);
  assert.match(joinSrc, /already used/);
});

test('lead_guest role is removed from UI; viewer gets photos + property facts only', async () => {
  const dealRoomSrc = read('src/views/DealRoom.jsx');
  assert.doesNotMatch(dealRoomSrc, /lead_guest|LeadGuest/);

  const reviewerSrc = read('src/views/Reviewer.jsx');
  assert.match(reviewerSrc, /The property/);
  assert.match(reviewerSrc, /<PropertyFacts\b/);
  assert.doesNotMatch(reviewerSrc, /10-unit residential property/);
  assert.doesNotMatch(reviewerSrc, /lead_guest/);
});

test('0018 scopes lender City Records to city_records prefix/folder and updates LenderTerms to Bridge/DSCR/Both 13 required questions', async () => {
  const settingsPol = sql0018.match(/create policy settings_lender_city_records[\s\S]*?;/i)?.[0] || '';
  assert.match(settingsPol, /key like 'city_records:%'/);
  assert.match(settingsPol, /public\.commercial_member_role\(d\.id\) = 'lender'/);
  assert.doesNotMatch(settingsPol, /deal_plan:|owner_ntfy_topic/);

  const storagePol = sql0018.match(/create policy commercial_v8_city_records_lender_read[\s\S]*?;/i)?.[0] || '';
  assert.match(storagePol, /bucket_id = 'commercial-files'/);
  assert.match(storagePol, /\(storage\.foldername\(name\)\)\[2\] = 'city-records'/);
  assert.match(storagePol, /= 'lender'/);

  assert.match(sql0018, /check \(lender_type is null or lender_type in \('private','hard','traditional','bridge','dscr','both'\)\)/);
  const termsReadPol = sql0018.match(/create policy commercial_lender_terms_read[\s\S]*?;/i)?.[0] || '';
  assert.match(termsReadPol, /public\.commercial_member_role\(deal_id\) = 'owner'/);
  assert.match(termsReadPol, /lender_uid = auth\.uid\(\)/);

  const lenderSrc = read('src/views/Lender.jsx');
  assert.match(lenderSrc, /\['city-records', 'City records'\]/);
  assert.match(lenderSrc, /\['documents', 'Documents'\]/);
  assert.match(lenderSrc, /<CityRecords /);

  const formatMod = await import('../src/lib/format.js');
  const v63Mod = await import('../src/lib/v63.js');
  const Card = ({ children }) => React.createElement('section', null, children);
  const CardTitle = ({ children }) => React.createElement('h2', null, children);
  const Button = ({ children, ...p }) => React.createElement('button', p, children);
  const Empty = ({ children }) => React.createElement('p', null, children);
  const ltMod = loadJsxWithMocks('src/views/LenderTerms.jsx', {
    '../components/Dictation.jsx': { DictatedField: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p) },
    '../lib/supabase.js': { supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), then: () => {} }) }) }) } },
    '../lib/format.js': formatMod,
    '../lib/v63.js': v63Mod,
    '../lib/dealmath.js': await import('../src/lib/dealmath.js'),
    '../lib/lenderModel.js': await import('../src/lib/lenderModel.js'),
    '../components/Shell.jsx': { Card, CardTitle, Button, Empty },
    '../components/Messages.jsx': { sendToOwner: async () => null },
  });

  assert.deepEqual(Object.keys(ltMod.LENDER_PROGRAMS), ['bridge', 'private', 'dscr']);
  assert.equal(ltMod.LENDER_FIELDS.length, 15);
  assert.equal(ltMod.fieldsForProgram('bridge').length, 7);
  assert.equal(ltMod.fieldsForProgram('private').length, 4);
  assert.equal(ltMod.fieldsForProgram('dscr').length, 8);

  const ltHtml = renderToStaticMarkup(React.createElement(ltMod.default, {
    deal: { id: 'd1', slug: 'charlotte' },
    me: { uid: 'l1', email: 'lender@example.com' },
    preview: true,
  }));
  assert.match(ltHtml, />Bridge</);
  assert.match(ltHtml, />Private</);
  assert.match(ltHtml, />DSCR</);
  assert.doesNotMatch(ltHtml, /legal unit count/i);
  assert.match(ltHtml, /10 units/);
  assert.doesNotMatch(ltHtml, />Not applicable<\/button>/);
});

test('0018 grants private own-row strategy ideas to both realtor and reviewer', async () => {
  assert.match(sql0018, /check \(author_role is null or author_role in \('owner','realtor','reviewer'\)\)/);
  assert.match(sql0018, /commercial_strategy_ideas_member_own_read[\s\S]*in \('realtor','reviewer'\) and author_uid = auth\.uid\(\)/);
  assert.match(sql0018, /commercial_strategy_ideas_member_own_insert[\s\S]*author_role = public\.commercial_member_role\(deal_id\)/);
  assert.match(sql0018, /commercial_strategy_ideas_member_own_delete[\s\S]*in \('realtor','reviewer'\) and author_uid = auth\.uid\(\)/);

  const { v5Access } = await import('../src/lib/leaseUp.js');
  assert.equal(v5Access('realtor').ideas, true);
  assert.equal(v5Access('reviewer').ideas, true);
  assert.equal(v5Access('lender').ideas, false);
  assert.equal(v5Access('lead_guest').ideas, false);
});
