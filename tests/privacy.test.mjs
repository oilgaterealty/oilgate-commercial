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

test('seller page never loads offers or underwriting', () => {
  const src = readFileSync(new URL('../src/views/Seller.jsx', import.meta.url), 'utf8');
  for (const t of ['commercial_offers', 'commercial_models', 'Offers', 'dealmath', 'Switches', 'owner_notes', 'deal_private']) assert.ok(!src.includes(t), t);
});

test('realtor sees offers read-only (v3) but never owner notes, private settings or saving', () => {
  const src = readFileSync(new URL('../src/views/Realtor.jsx', import.meta.url), 'utf8');
  for (const t of ['owner_notes', 'deal_private', 'canSave', 'People', 'Settings']) assert.ok(!src.includes(t), t);
  const v3 = readFileSync(new URL('../supabase/migrations/0008_v3_roles_tasks.sql', import.meta.url), 'utf8');
  for (const m of v3.matchAll(/(?:alter table|on) (\S+)/g)) assert.match(m[1], /^public\.commercial_/, m[1]);
  assert.doesNotMatch(v3, /'seller'|'viewer'|\b(truncate|drop table|drop function)\b/i);
  assert.match(v3, /models_review[\s\S]*for select/);
});

test('offers are readable only by the owner, or a reviewer/lender it was shared with', () => {
  const v2 = readFileSync(new URL('../supabase/migrations/0003_commercial_v2.sql', import.meta.url), 'utf8');
  const pols = [...v2.matchAll(/create policy \w+ on public\.commercial_offers[\s\S]*?;/g)].map((m) => m[0]).join('\n');
  assert.doesNotMatch(pols, /'seller'|'realtor'|'viewer'/);
});

test('lender page shows the plan read-only: no saving, no editing terms or repair costs', () => {
  const src = readFileSync(new URL('../src/views/Lender.jsx', import.meta.url), 'utf8');
  for (const t of ['owner_notes', 'deal_private', 'canSave', 'setBase', 'tenthUnitRepair', 'Try different terms', '.update(', '.insert(']) assert.ok(!src.includes(t), t);
});

test('messages are fixed by role: nobody picks people by hand, and research boards are gone', () => {
  const msg = readFileSync(new URL('../src/components/Messages.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(msg, /Who is this conversation with|setPicking/);
  for (const f of ['views/Dashboard.jsx', 'views/Realtor.jsx', 'views/Reviewer.jsx']) {
    const s = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /kind="research"|kind="update"|'research'/, f);
  }
});

test('v5 strategy was owner-only in 0009 (isolated realtor/reviewer ideas added later) and never leaked to lender/seller/guest', () => {
  const v5 = readFileSync(new URL('../supabase/migrations/0009_v5_leaseup.sql', import.meta.url), 'utf8');
  const pols = [...v5.matchAll(/create policy [^;]+ on public\.commercial_strategy_ideas[\s\S]*?;/gi)].map((m) => m[0]);
  assert.equal(pols.length, 1);
  assert.match(pols[0], /commercial_member_role\(deal_id\) = 'owner'/);
  assert.doesNotMatch(pols[0], /'realtor'|'reviewer'|'lender'|'seller'|'viewer'/);
  assert.doesNotMatch(v5, /insert\s+into\s+public\.commercial_strategy_ideas/i);
  for (const f of ['views/Lender.jsx', 'views/Seller.jsx', 'views/LeadGuest.jsx']) {
    const s = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /StrategyIdeas|commercial_strategy_ideas|'strategy'/, f);
  }
  // Strategy content must live only as DB rows, never hardcoded in the public repo.
  const stratView = readFileSync(new URL('../src/views/StrategyIdeas.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(stratView, /DEFAULT_IDEAS|SEED_IDEAS|STARTER_CARDS/i);
});

test('v5 tenant leads and walkthrough are readable by owner and realtor only', () => {
  const v5 = readFileSync(new URL('../supabase/migrations/0009_v5_leaseup.sql', import.meta.url), 'utf8');
  for (const table of ['commercial_tenant_leads', 'commercial_walkthrough_photos', 'commercial_walkthrough_notes']) {
    const pols = [...v5.matchAll(new RegExp(`create policy [^;]+ on public\\.${table}[\\s\\S]*?;`, 'gi'))].map((m) => m[0]).join('\n');
    assert.match(pols, /'owner'/, table);
    assert.match(pols, /'realtor'/, table);
    assert.doesNotMatch(pols, /'seller'|'reviewer'|'lender'|'viewer'/, table);
  }
  const storageFn = v5.match(/create or replace function public\.commercial_v5_storage_access[\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(storageFn, /when 'owner'/);
  assert.match(storageFn, /when 'realtor'/);
  assert.doesNotMatch(storageFn, /'seller'|'reviewer'|'lender'|'viewer'/);
  for (const f of ['views/Reviewer.jsx', 'views/Lender.jsx', 'views/Seller.jsx']) {
    const s = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /Walkthrough|Tenants|commercial_tenant_leads|commercial_walkthrough_/, f);
  }
});

test('v5 comps tab and tables are hidden from lender, seller and viewer', () => {
  const v5 = readFileSync(new URL('../supabase/migrations/0009_v5_leaseup.sql', import.meta.url), 'utf8');
  for (const table of ['commercial_comps', 'commercial_comp_settings']) {
    const pols = [...v5.matchAll(new RegExp(`create policy [^;]+ on public\\.${table}[\\s\\S]*?;`, 'gi'))].map((m) => m[0]).join('\n');
    assert.match(pols, /'owner'/, table);
    assert.match(pols, /'realtor'/, table);
    assert.match(pols, /'reviewer'/, table);
    assert.doesNotMatch(pols, /'lender'|'seller'|'viewer'/, table);
  }
  for (const f of ['views/Lender.jsx', 'views/Seller.jsx']) {
    const s = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /Comps|commercial_comps|commercial_comp_settings/, f);
  }
  const rev = readFileSync(new URL('../src/views/Reviewer.jsx', import.meta.url), 'utf8');
  // v6.3+: reviewer gets Overview, Photos, Comps, private Ideas, Messages; viewer gets Overview + Photos.
  assert.match(rev, /const tabs = viewer \? \[\['overview', 'Overview'\], \['photos', 'Photos'\]\] : \[\['overview', 'Overview'\], \['photos', 'Photos'\], \['comps', 'Comps'\], \['ideas', 'Ideas'\], \['messages', 'Messages'\]\]/);
  assert.match(rev, /!viewer && active === 'comps'/);
  assert.match(rev, /!viewer && active === 'ideas'/);
});

test('v5 migration only creates commercial_ objects and storage.objects policies', () => {
  const v5 = readFileSync(new URL('../supabase/migrations/0009_v5_leaseup.sql', import.meta.url), 'utf8');
  for (const m of v5.matchAll(/create (?:or replace )?(?:table|function|trigger|unique index|index) (?:public\.)?(\w+)/gi)) {
    assert.match(m[1], /^commercial_/, m[1]);
  }
  for (const m of v5.matchAll(/create policy (\w+) on (?:public|storage)\.(\w+)/gi)) {
    assert.match(m[1], /^commercial_/, m[1]);
    assert.match(m[2], /^(commercial_|objects$)/, m[2]);
  }
  assert.doesNotMatch(v5, /\b(drop table|drop function|truncate|alter table (?!public\.commercial_))\b/i);
});

test('0010 migration scopes walkthrough videos to owner/realtor and touches only commercial_ + commercial-files', () => {
  const v5m = readFileSync(new URL('../supabase/migrations/0010_v5_walkthrough_media.sql', import.meta.url), 'utf8');
  for (const m of v5m.matchAll(/create (?:or replace )?(?:table|function|trigger|unique index|index) (?:if not exists )?(?:public\.)?(\w+)/gi)) {
    assert.match(m[1], /^commercial_/, m[1]);
  }
  for (const m of v5m.matchAll(/create policy (\w+) on (?:public|storage)\.(\w+)/gi)) {
    assert.match(m[1], /^commercial_/, m[1]);
    assert.match(m[2], /^(commercial_|objects$)/, m[2]);
  }
  assert.match(v5m, /alter table public\.commercial_walkthrough_videos enable row level security/);
  const vidPols = [...v5m.matchAll(/create policy [^;]+ on public\.commercial_walkthrough_videos[\s\S]*?;/gi)].map((m) => m[0]).join('\n');
  assert.match(vidPols, /'owner'/);
  assert.match(vidPols, /'realtor'/);
  assert.doesNotMatch(vidPols, /'seller'|'reviewer'|'lender'|'viewer'/);
  assert.match(v5m, /update storage\.buckets[\s\S]*where id = 'commercial-files'/i);
  assert.doesNotMatch(v5m, /\b(drop table|drop function|truncate|alter table (?!public\.commercial_))\b/i);
});

test('walkthrough and dictation use local Transformers.js Whisper with no OpenAI hosted API', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const f of walk(`${root}src`)) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /api\.openai\.com|openai\/v1\/audio/i, f);
  }
  const workerSrc = readFileSync(new URL('../src/lib/dictation-worker.js', import.meta.url), 'utf8');
  assert.match(workerSrc, /@huggingface\/transformers/);
  assert.match(workerSrc, /whisper-tiny\.en/);
});
