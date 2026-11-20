// Guards the rule that seller-visible data never carries owner numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
  const root = new URL('..', import.meta.url).pathname;
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
