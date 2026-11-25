// Opt-in isolated PostgreSQL test. Never connects to production.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create publication supabase_realtime;
create schema auth; create schema extensions; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to anon, authenticated;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create function storage.foldername(text) returns text[] language sql stable as $$select string_to_array($1,'/')$$;
`);
const migrations = new URL('../supabase/migrations/', import.meta.url);
for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(new URL(file, migrations), 'utf8').replace(/^\uFEFF/, '')
    .replace('create extension if not exists pg_net with schema extensions;', '');
  try { await db.exec(sql); } catch(e) { throw new Error(`Migration ${file}: ${e.message}`); }
}
const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const roles = ['seller', 'lender', 'realtor', 'reviewer', 'viewer'];
const v = async (sql, params) => (await db.query(sql, params)).rows[0]?.v;
const did = await v("select id v from public.commercial_deals where slug='charlotte'");
await db.query("insert into public.commercial_owners values ('owner@test.invalid')");
await db.query("insert into public.commercial_erwin_facts(deal_id,key,value,source,as_of,version,author) values($1,'test','42','isolated test',current_date,1,'test')", [did]);
const token = 'a'.repeat(64); // Deliberately non-production fixture.
await db.query("insert into public.commercial_bridge_tokens(deal_id,label,scope,token_hash) values($1,'test','superlab_owner',$2)", [did, createHash('sha256').update(token).digest('hex')]);
let checks = 0;
for (const [i, role] of roles.entries()) {
  await db.exec('reset role');
  await db.query('insert into auth.users values($1,$2,now())', [id(i+1), `${role}@test.invalid`]);
  await db.query('insert into public.commercial_members(deal_id,email,role) values($1,$2,$3)', [did, `${role}@test.invalid`, role]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:id(i+1),email:`${role}@test.invalid`})]);
  await db.exec('set role authenticated');
  assert.equal(await v('select count(*)::int v from public.commercial_erwin_facts'), 0); checks++;
  await assert.rejects(db.query('select * from public.commercial_bridge_tokens'), {code:'42501'}); checks++;
  await assert.rejects(db.query('select public.commercial_bridge_snapshot($1,$2)',[token,'charlotte']), {code:'42501'}); checks++;
}
await db.exec('reset role');
await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:'owner@test.invalid'})]);
await db.exec('set role authenticated');
assert.equal(await v('select count(*)::int v from public.commercial_erwin_facts'), 1); checks++;
await db.exec('set role anon');
await assert.rejects(db.query('select * from public.commercial_bridge_tokens'), {code:'42501'}); checks++;
await assert.rejects(db.query('select * from public.commercial_erwin_facts'), {code:'42501'}); checks++;
assert.equal(await v('select public.commercial_bridge_snapshot($1,$2) v',['b'.repeat(64),'charlotte']), null); checks++;
assert.equal(await v('select public.commercial_bridge_snapshot($1,$2) v',[token,'other']), null); checks++;
const snapshot = await v('select public.commercial_bridge_snapshot($1,$2) v',[token,'charlotte']);
assert.equal(snapshot.deal.id, did); assert.equal(snapshot.erwin_facts.length,1); checks+=2;
assert.equal((await v('select public.commercial_bridge_snapshot($1,$2) v',[token,'charlotte'])).deal.id,did); checks++;
await db.exec('reset role');
assert.equal(await v('select calls::int v from public.commercial_bridge_tokens'),2); checks++;
await db.exec('update public.commercial_bridge_tokens set window_calls=60');
await db.exec('set role anon');
assert.equal(await v('select public.commercial_bridge_snapshot($1,$2) v',[token,'charlotte']),null); checks++;
await db.exec('reset role');
await db.exec("update public.commercial_bridge_tokens set window_started_at=now()-interval '2 minutes'");
await db.exec('set role anon');
assert.equal((await v('select public.commercial_bridge_snapshot($1,$2) v',[token,'charlotte'])).deal.id,did); checks++;
await db.exec('reset role');
await db.exec('update public.commercial_bridge_tokens set active=false');
await db.exec('set role anon');
assert.equal(await v('select public.commercial_bridge_snapshot($1,$2) v',[token,'charlotte']),null); checks++;
await db.close();
console.log(`${checks} bridge PostgreSQL permission, snapshot and revocation assertions passed.`);
