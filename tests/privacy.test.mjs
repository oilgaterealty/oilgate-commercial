// Guards the rule that seller-visible data never carries owner numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/0001_deal_rooms.sql', import.meta.url), 'utf8');

test('default seller copy has no dollar figures', () => {
  const m = sql.match(/seller_content jsonb([\s\S]*?)\n  status /);
  assert.ok(m, 'seller_content default found');
  assert.doesNotMatch(m[1], /\$\s?\d/);
});

test('drive folder id lives only in the owner-only table', () => {
  const deals = sql.match(/create table public\.deals \(([\s\S]*?)\);/)[1];
  assert.doesNotMatch(deals, /drive/i);
  assert.match(sql, /create policy \w+ on public\.deal_private[^;]*is_owner\(\)/);
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
