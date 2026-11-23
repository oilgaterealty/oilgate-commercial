import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { visibleNotes, sharedPhotos, canChangeLead, suggestionDiff } from '../src/lib/leaseUp.js';
import { buyerTag, sellerTag, possessive, actorLabel, activityText } from '../src/lib/people.js';

const v6 = readFileSync(new URL('../supabase/migrations/0012_v6_names_privacy.sql', import.meta.url), 'utf8');
const policies = (table) => [...v6.matchAll(new RegExp(`create policy [^;]+ on public\\.${table}[\\s\\S]*?;`, 'gi'))].map((m) => m[0]);
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

test('no name is hardcoded in the app: buyer and seller come from the deal', () => {
  for (const f of walk('src')) {
    if (!/\.(jsx?|mjs)$/.test(f)) continue;
    assert.doesNotMatch(readFileSync(f, 'utf8'), /LaVante/, f);
  }
  assert.equal(buyerTag({ buyer_name: "LaVante'" }), "LaVante' · Buyer");
  assert.equal(sellerTag({ seller_name: '' }), 'Seller: not named yet');
  assert.equal(sellerTag({ seller_name: 'Pat' }), 'Pat · Seller');
  assert.equal(possessive("LaVante'"), "LaVante's");
  assert.match(v6, /add column if not exists buyer_name text not null default 'LaVante'''/);
});

test('activity says who did it with name and role, never a bare "owner"', () => {
  assert.match(v6, /insert into commercial_activity \(deal_id, actor_email, actor_role, actor_name/);
  assert.equal(actorLabel({ actor_role: 'owner', actor_name: '' }, { buyer_name: 'Sam' }), 'Sam · Buyer');
  assert.equal(actorLabel({ actor_role: 'seller', actor_name: 'Pat' }), 'Pat · Seller');
  assert.equal(activityText({ actor_role: 'seller', summary: 'Seller marked: interested in talking' }), 'marked: interested in talking');
  assert.equal(activityText({ actor_role: 'owner', summary: 'Owner uploaded a photo: a.jpg' }), 'uploaded a photo: a.jpg');
});

test('owner voice notes are owner-only in RLS, storage and the page', () => {
  const realtorRead = policies('commercial_walkthrough_notes').find((p) => /realtor_read/.test(p));
  assert.match(realtorRead, /author_role = 'realtor'/);
  const storage = v6.match(/create or replace function public\.commercial_v5_storage_access[\s\S]*?end \$\$;/)[0];
  assert.match(storage, /commercial_walkthrough_notes where deal_id = d and storage_path = p_name and author_role = 'realtor'/);
  assert.doesNotMatch(storage.split("r = 'seller'")[1], /walkthrough_notes|walkthrough_videos/);
  const rows = [{ id: 1, author_role: 'owner' }, { id: 2, author_role: 'realtor' }];
  assert.deepEqual(visibleNotes('realtor', rows).map((r) => r.id), [2]);
  assert.deepEqual(visibleNotes('owner', rows).map((r) => r.id), [1, 2]);
  assert.match(readFileSync('src/views/Walkthrough.jsx', 'utf8'), /setNotes\(visibleNotes\(role, n\.data\)\)/);
});

test('seller and lender see only photos the owner shares with them, and only the owner flips the switch', () => {
  assert.match(policies('commercial_walkthrough_photos').find((p) => /seller_shared/.test(p)), /share_seller and public\.commercial_member_role\(deal_id\) = 'seller'/);
  assert.match(policies('commercial_walkthrough_photos').find((p) => /lender_shared/.test(p)), /share_lender and public\.commercial_member_role\(deal_id\) = 'lender'/);
  assert.match(v6, /Only the owner can share walkthrough photos/);
  assert.match(v6, /share_seller boolean not null default false/);
  const rows = [{ id: 1, share_seller: true }, { id: 2, share_lender: true }, { id: 3 }];
  assert.deepEqual(sharedPhotos('seller', rows).map((r) => r.id), [1]);
  assert.deepEqual(sharedPhotos('lender', rows).map((r) => r.id), [2]);
});

test('realtor tenants: reads all, edits and deletes only her own, suggests changes to the owner rows', () => {
  const pols = policies('commercial_tenant_leads');
  assert.ok(!v6.includes('create policy commercial_tenant_leads_realtor_all'));
  for (const p of pols.filter((x) => /update_own|delete_own/.test(x))) assert.match(p, /author_uid = auth\.uid\(\)/);
  const sug = policies('commercial_tenant_suggestions');
  assert.ok(sug.some((p) => /realtor_insert/.test(p) && /status = 'pending'/.test(p)));
  assert.ok(!sug.some((p) => /realtor/.test(p) && /for (update|delete|all)/.test(p)));
  assert.equal(canChangeLead('realtor', { author_uid: 'a' }, 'b'), false);
  assert.equal(canChangeLead('realtor', { author_uid: 'b' }, 'b'), true);
  assert.equal(canChangeLead('owner', { author_uid: 'a' }, 'b'), true);
  assert.deepEqual(suggestionDiff({ name: 'Al', phone: '', email: '', notes: '', stage: 'new_lead' }, { name: 'Al', phone: '555', email: '', notes: '', stage: 'moved_in' }), { phone: '555' });
});

test('realtor threads with the seller and the lender, owner always in, lender never with the seller', () => {
  assert.match(v6, /create or replace function public\.commercial_open_realtor_thread/);
  assert.match(v6, /create or replace function public\.commercial_lender_route_ok/);
  const msg = readFileSync('src/components/Messages.jsx', 'utf8');
  assert.match(msg, /REALTOR_SLOTS = \['owner', 'seller', 'lender'\]/);
  assert.match(msg, /commercial_open_realtor_thread/);
});

test('v6 migration touches only commercial_ objects and storage policies', () => {
  for (const m of v6.matchAll(/create (?:or replace )?(?:table|function|trigger|unique index|index) (?:if not exists )?(?:public\.)?(\w+)/gi)) assert.match(m[1], /^commercial_/, m[1]);
  for (const m of v6.matchAll(/(?:alter|drop) table (?:if exists )?(\S+)/gi)) assert.match(m[1], /^public\.commercial_/, m[1]);
  assert.doesNotMatch(v6, /\b(truncate|drop function|site_url)\b/i);
});

test('comps carry their source', () => {
  assert.match(v6, /add column if not exists source text not null default ''/);
  assert.match(readFileSync('src/views/Comps.jsx', 'utf8'), /Source: \{r\.source\}/);
});
