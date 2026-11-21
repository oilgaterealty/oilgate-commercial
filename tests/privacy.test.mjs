// Guards the rule that seller-visible data never carries owner numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sql = readFileSync(new URL('../supabase/migrations/0001_commercial.sql', import.meta.url), 'utf8');

test('default seller copy has no dollar figures', () => {
  const m = sql.match(/seller_content jsonb([\s\S]*?)\n  status /);
  assert.ok(m, 'seller_content default found');
  assert.doesNotMatch(m[1], /\$\s?\d/);
});

test('drive folder id lives only in the owner-only table', () => {
  const deals = sql.match(/create table public\.commercial_deals \(([\s\S]*?)\);/)[1];
  assert.doesNotMatch(deals, /drive/i);
  assert.match(sql, /create policy \w+ on public\.commercial_deal_private[^;]*is_owner\(\)/);
});

test('seller page code never reads owner-only tables', () => {
  const src = readFileSync(new URL('../src/views/Seller.jsx', import.meta.url), 'utf8');
  for (const t of ['owner_notes', 'deal_private', 'private_settings']) assert.ok(!src.includes(t), t);
});

test('no Drive folder id or secrets committed in source', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const f of [...walk(`${root}src`), ...walk(`${root}supabase`)]) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,}/, f);
    assert.doesNotMatch(s, /service_role|sb_secret_/i, f);
  }
});

test('every table, function and policy target is namespaced so a shared project stays untouched', () => {
  for (const m of sql.matchAll(/create (?:table|or replace function|trigger) (?:public\.)?(\w+)/g)) assert.match(m[1], /^commercial_/, m[1]);
  for (const m of sql.matchAll(/create policy \w+ on (?:public|storage)\.(\w+)/g)) assert.match(m[1], /^(commercial_|objects$)/, m[1]);
  assert.doesNotMatch(sql, /\b(drop|truncate|alter table (?!public\.commercial_))/i);
});

test('v2 migration only creates, alters or drops commercial_ objects', () => {
  const v2 = readFileSync(new URL('../supabase/migrations/0003_commercial_v2.sql', import.meta.url), 'utf8');
  for (const m of v2.matchAll(/create (?:table|or replace function|index on|policy \w+ on) (?:public\.|storage\.)?(\w+)/g)) assert.match(m[1], /^(commercial_|objects$)/, m[1]);
  for (const m of v2.matchAll(/alter table (\S+)/g)) assert.match(m[1], /^public\.commercial_/, m[1]);
  for (const m of v2.matchAll(/drop (policy|constraint) if exists (\w+)(?: on ([\w.]+))?/g)) {
    assert.match(m[2], /^(commercial_|messages_|uploads_)/, m[2]);
    if (m[3]) assert.match(m[3], /^(public\.commercial_|storage\.objects$)/, m[3]);
  }
  assert.doesNotMatch(v2, /\b(truncate|drop table|drop function)\b/i);
});

test('seller and realtor pages never load offers or underwriting', () => {
  for (const f of ['Seller.jsx', 'Realtor.jsx']) {
    const src = readFileSync(new URL(`../src/views/${f}`, import.meta.url), 'utf8');
    for (const t of ['commercial_offers', 'commercial_models', 'Offers', 'dealmath', 'owner_notes', 'deal_private']) assert.ok(!src.includes(t), `${f}: ${t}`);
  }
});

test('offers are readable only by the owner, or a reviewer/lender it was shared with', () => {
  const v2 = readFileSync(new URL('../supabase/migrations/0003_commercial_v2.sql', import.meta.url), 'utf8');
  const pols = [...v2.matchAll(/create policy \w+ on public\.commercial_offers[\s\S]*?;/g)].map((m) => m[0]).join('\n');
  assert.doesNotMatch(pols, /'seller'|'realtor'|'viewer'/);
});
