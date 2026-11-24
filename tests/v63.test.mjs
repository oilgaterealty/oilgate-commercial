import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WALK_SPACES, spaceLabel, stepSpace, v5Access } from '../src/lib/leaseUp.js';
import { roleLabel } from '../src/lib/format.js';
import { setDealNames, buyerName, buyerTag, sellerTag, actorLabel, authorLabel } from '../src/lib/people.js';
import { coverOf, visibleUnitNotes, canWriteUnitNotes, canDeleteIdea, canEditIdea, perUnitOf, yearOf, compSource, milesLabel, picksByComp, lenderBoard, seenByLabel } from '../src/lib/v63.js';
import { VIDEO_480P, VIDEO_BITRATE, frameTimes, postResult, processVideo } from '../src/lib/videoPost.js';

const sql = readFileSync(new URL('../supabase/migrations/0014_v63.sql', import.meta.url), 'utf8');
const src = (p) => readFileSync(p, 'utf8');
const policy = (name) => sql.match(new RegExp(`create policy ${name} [\\s\\S]*?;`))?.[0] || '';

test('1. stairwell spaces keep their numbers; space 16 stays last; per-photo and per-video "Move this one"', () => {
  assert.equal(spaceLabel(11), 'Front stairwell (units 1-3)');
  assert.equal(spaceLabel(12), 'Front stairwell (units 4-10)');
  assert.equal(spaceLabel(13), 'Back stairwell (units 1-3)');
  assert.equal(spaceLabel(16), 'Back stairwell (units 4-10)');
  assert.equal(spaceLabel(14), 'Exterior');
  assert.equal(spaceLabel(15), 'Storage');
  assert.equal(spaceLabel(17), 'Laundry room');
  assert.equal(spaceLabel(18), 'Utility room (gas & electric)');
  assert.equal(WALK_SPACES.at(-1), 16);
  assert.equal(stepSpace(18, 1), 16);
  const walk = src('src/views/Walkthrough.jsx');
  assert.match(walk, /label: 'Move this one'/);
  assert.match(walk, /setMoveOne\(`v:\$\{v\.id\}`\)/);
  assert.match(walk, /setMoveOne\(`l:\$\{v\.id\}`\)/);
  assert.match(walk, /<MoveBar|MoveBar/); // batch "Move all selected" stays
});

test('2. per-unit Photos for every role except the seller; migration lets lender/reviewer/viewer read walkthrough', () => {
  for (const r of ['owner', 'realtor', 'reviewer', 'lender', 'viewer', 'guest']) assert.equal(v5Access(r).unitPhotos, true, r);
  assert.equal(v5Access('seller').unitPhotos, false);
  for (const t of ['photos', 'videos']) {
    const p = policy(`commercial_walkthrough_${t}_team_read`);
    assert.match(p, /for select to authenticated/);
    assert.match(p, /in \('lender','reviewer','viewer','guest'\)/);
    assert.doesNotMatch(p, /'seller'/);
  }
  const fn = sql.match(/create or replace function public\.commercial_v5_storage_access[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(fn, /r in \('lender','reviewer','viewer','guest'\) and p_mode = 'read'/);
  assert.match(fn, /r = 'seller' and p_mode = 'read'[\s\S]*?share_seller\)[\s\S]*?frame_paths \? p_name\) and share_seller/);
  for (const f of ['src/views/Lender.jsx', 'src/views/Reviewer.jsx', 'src/views/Realtor.jsx', 'src/views/Owner.jsx']) assert.match(src(f), /<UnitGallery /, f);
  assert.doesNotMatch(src('src/views/Seller.jsx'), /UnitGallery/);
});

test('2. the seller has no photo uploads and only a documents uploader', () => {
  const s = src('src/views/Seller.jsx');
  assert.match(s, /<CardTitle>Share documents<\/CardTitle>/);
  assert.match(s, /accept=\{DOCS\}/);
  assert.doesNotMatch(s.match(/const DOCS = '([^']+)'/)[1], /image/);
  assert.doesNotMatch(s, /documents and photos|photos, anything/i);
});

test('3 + 4. one starred cover photo, no slideshow anywhere', () => {
  const cover = { id: 'c', kind: 'photo', url: 'u2', featured: true };
  assert.equal(coverOf([{ id: 'a', kind: 'photo', url: 'u1' }, cover]), cover);
  assert.equal(coverOf([cover]), cover); // only the cover left after old listing photos are deleted
  assert.equal(coverOf([{ id: 'd', kind: 'document', url: 'x', featured: true }]), null);
  assert.equal(coverOf([]), null);
  assert.equal(coverOf(null), null);
  assert.equal(coverOf([{ id: 'a', kind: 'photo', url: 'u1' }]).id, 'a');
  for (const f of ['src/views/Lender.jsx', 'src/views/Reviewer.jsx', 'src/views/Seller.jsx', 'src/components/Photos.jsx']) {
    assert.doesNotMatch(src(f), /\bHero\b/, f);
  }
  assert.doesNotMatch(src('src/components/Photos.jsx'), /Next photo|Previous photo/);
});

test('5. owner shows as Buyer; the seller never sees the buyer name; "not named yet" only for the owner', () => {
  assert.equal(roleLabel.owner, 'Buyer');
  const deal = { buyer_name: 'Sam', seller_name: '' };
  setDealNames(deal, 'realtor');
  assert.equal(buyerTag(), 'Sam · Buyer');
  assert.equal(sellerTag(), 'Seller');
  assert.equal(actorLabel({ actor_role: 'owner', actor_name: 'Sam' }), 'Sam · Buyer');
  setDealNames(deal, 'seller');
  assert.equal(buyerName(), 'the buyer');
  assert.equal(buyerTag(), 'Buyer');
  assert.equal(actorLabel({ actor_role: 'owner', actor_name: 'Sam' }), 'Buyer');
  assert.equal(authorLabel({ author_role: 'owner', author_name: 'Sam' }), 'Buyer');
  setDealNames(deal, 'owner');
  assert.equal(sellerTag(), 'Seller not named yet');
  setDealNames(deal, '');
  for (const f of ['src/views/LenderTerms.jsx', 'src/views/Seller.jsx', 'src/views/Tenants.jsx']) {
    assert.doesNotMatch(src(f), /Sent privately to the owner|Send terms to owner|Sent to the owner|to the owner\./, f);
  }
  assert.match(src('src/views/DealRoom.jsx'), /setDealNames\(state\.deal, viewing && state\.role === 'owner' && PREVIEWABLE\.includes\(sub\) \? sub : state\.role\)/);
});

test('6. reviewer/viewer documents are read only; realtor activity shows the buyer side too', () => {
  const r = src('src/views/Reviewer.jsx');
  assert.match(r, /<FileList rows=\{docs\} canShare=\{false\} owner=\{false\} \/>/);
  const re = src('src/views/Realtor.jsx');
  assert.match(re, /actors=\{\['seller'\]\}/);
  assert.match(re, /actors=\{\['owner'\]\}/);
  assert.match(src('src/components/Activity.jsx'), /q\.in\('actor_role', actors\)/);
});

test('7. realtor adds her own tenant leads', () => {
  const p = policy('commercial_tenant_leads_realtor_insert');
  assert.match(p, /for insert to authenticated/);
  assert.match(p, /author_role = 'realtor' and author_uid = auth\.uid\(\)/);
});

test('8. video at 480p with a low bitrate; frames + transcript stored on the row', async () => {
  assert.equal(VIDEO_480P.height.ideal, 480);
  assert.ok(VIDEO_BITRATE.videoBitsPerSecond >= 600_000 && VIDEO_BITRATE.videoBitsPerSecond <= 900_000);
  assert.match(src('src/components/WalkthroughCamera.jsx'), /\.\.\.VIDEO_480P/);
  assert.match(src('src/components/WalkthroughCamera.jsx'), /\.\.\.VIDEO_BITRATE/);
  const t = frameTimes(10);
  assert.equal(t.length, 3);
  assert.ok(t[0] < t[1] && t[1] < t[2] && t[2] < 10);
  assert.deepEqual(frameTimes(Infinity), [0]);
  assert.deepEqual(postResult({ text: ' hi ', framePaths: ['a', null, 'b'] }), { transcript: 'hi', transcript_status: 'ready', frame_paths: ['a', 'b'] });
  assert.equal(postResult({ text: '', transcriptError: true, framePaths: [] }).transcript_status, 'failed');
  assert.equal(postResult({ text: '', framePaths: [] }).transcript_status, 'none');
  // processVideo survives frame capture failing (no DOM here) and still saves the transcript.
  let saved = null;
  const r = await processVideo({}, { uploadFrame: async () => 'x', transcribe: async () => 'said things', save: async (x) => { saved = x; } });
  assert.deepEqual(saved, { transcript: 'said things', transcript_status: 'ready', frame_paths: [] });
  assert.equal(r.transcript, 'said things');
  assert.match(sql, /add column if not exists transcript text/);
  assert.match(sql, /add column if not exists transcript_status text/);
  assert.match(sql, /add column if not exists frame_paths jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /create trigger commercial_walk_frames_guard before insert or update of frame_paths on public\.commercial_walkthrough_videos/);
  // the v6.1 guard is untouched by this migration (still blocks re-attribution and non-owner share changes)
  assert.doesNotMatch(sql, /function public\.commercial_walk_share_guard/);
  const walk = src('src/views/Walkthrough.jsx');
  assert.match(walk, /void afterVideoSaved\(ins\.data\.id, savedBlob\)/);
  assert.match(walk, /transcribeAudio\(b\)/);
  assert.match(walk, /<VideoExtras video=\{v\} \/>/);
});

test('9. comps: easy numbers, sources, picks with tight RLS', () => {
  assert.equal(perUnitOf('520000', '8'), 65000);
  assert.equal(perUnitOf('', '8'), null);
  assert.equal(perUnitOf('100', '0'), null);
  assert.equal(yearOf('2025-06-30'), 2025);
  assert.equal(yearOf(''), null);
  assert.equal(compSource({ source_kind: 'ai', source: 'x' }), 'Found by AI (Claude)');
  assert.equal(compSource({ source_kind: 'broker', source: 'Erin Thomas, KW Commercial: data as of Nov 5, 2026' }), 'Erin Thomas, KW Commercial: data as of Nov 5, 2026');
  assert.equal(milesLabel(0.84), '0.8 mi away');
  assert.equal(milesLabel(''), '');
  assert.deepEqual(picksByComp([{ comp_id: 'c', picker_name: 'Dana', picker_role: 'realtor' }], (r) => roleLabel[r]), { c: ['Dana (Realtor)'] });
  for (const col of ['city text', 'submarket text', 'bldg_sf integer', 'asking numeric', 'acres numeric', 'pct_leased numeric', 'distance_mi numeric', 'source_kind text', 'added_by_role text']) {
    assert.match(sql, new RegExp(`add column if not exists ${col}`), col);
  }
  assert.match(sql, /create table if not exists public\.commercial_comp_picks/);
  assert.match(sql, /unique \(comp_id, picker_uid\)/);
  assert.match(sql, /comp_id uuid not null references public\.commercial_comps\(id\) on delete cascade/);
  assert.match(policy('commercial_comp_picks_own_select'), /picker_uid = auth\.uid\(\) or public\.commercial_member_role\(deal_id\) = 'owner'/);
  assert.match(policy('commercial_comp_picks_own_insert'), /picker_uid = auth\.uid\(\)/);
  assert.match(policy('commercial_comp_picks_own_delete'), /using \(picker_uid = auth\.uid\(\)\)/);
  const c = src('src/views/Comps.jsx');
  assert.match(c, /inputMode="numeric"/);
  assert.match(c, /inputMode="decimal"/);
  assert.match(c, /autoComplete="street-address"/);
});

test('10. strategy ideas under Tenants: realtor adds and deletes her own; owner controls all', () => {
  assert.equal(v5Access('realtor').ideas, true);
  assert.equal(v5Access('reviewer').ideas, false);
  assert.equal(canDeleteIdea('owner', { author_uid: 'r' }, 'o'), true);
  assert.equal(canDeleteIdea('realtor', { author_uid: 'r' }, 'r'), true);
  assert.equal(canDeleteIdea('realtor', { author_uid: 'o' }, 'r'), false);
  assert.equal(canEditIdea('realtor'), false);
  assert.match(src('src/views/Tenants.jsx'), /<StrategyIdeas /);
  assert.doesNotMatch(src('src/views/Owner.jsx'), /\['strategy', 'Strategy ideas'\]/);
  assert.match(sql, /alter table public\.commercial_strategy_ideas\s+add column if not exists author_uid uuid default auth\.uid\(\)/);
  assert.match(policy('commercial_strategy_ideas_realtor_read'), /= 'realtor'/);
  assert.match(policy('commercial_strategy_ideas_realtor_insert'), /author_role = 'realtor' and author_uid = auth\.uid\(\)/);
  assert.match(policy('commercial_strategy_ideas_realtor_delete'), /for delete[\s\S]*author_uid = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /commercial_strategy_ideas[^;]*'(lender|reviewer|seller|viewer)'/);
});

test('11. unit notes: own notes, owner sees all, lenders only the overview line', () => {
  const rows = [
    { id: 1, kind: 'note', author_uid: 'r' },
    { id: 2, kind: 'note', author_uid: 'v' },
    { id: 3, kind: 'lender_overview', author_uid: 'o' },
  ];
  assert.deepEqual(visibleUnitNotes('owner', 'o', rows).map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(visibleUnitNotes('realtor', 'r', rows).map((x) => x.id), [1]);
  assert.deepEqual(visibleUnitNotes('reviewer', 'v', rows).map((x) => x.id), [2]);
  assert.deepEqual(visibleUnitNotes('lender', 'l', rows).map((x) => x.id), [3]);
  assert.deepEqual(visibleUnitNotes('seller', 's', rows), []);
  assert.deepEqual(visibleUnitNotes('realtor', '', rows), []);
  assert.equal(canWriteUnitNotes('lender'), false);
  assert.match(sql, /create table if not exists public\.commercial_unit_notes/);
  assert.match(sql, /unit_number smallint not null check \(unit_number between 1 and 18\)/);
  assert.match(sql, /kind text not null default 'note' check \(kind in \('note','lender_overview'\)\)/);
  assert.match(policy('commercial_unit_notes_author_select'), /author_uid = auth\.uid\(\) and kind = 'note'/);
  assert.match(policy('commercial_unit_notes_lender_overview'), /= 'lender' and kind = 'lender_overview' and author_role = 'owner'/);
  assert.doesNotMatch(sql.match(/on public\.commercial_unit_notes[\s\S]*?(?=-- 8\.)/)?.[0] || '', /'seller'|'viewer'/);
});

test('12. lender terms board: every lender reads all, writes only their own', () => {
  const rows = [
    { id: 1, lender_uid: 'a', company_name: 'Acme', updated_at: '2026-01-01' },
    { id: 2, lender_uid: 'a', company_name: 'Acme', updated_at: '2026-02-01' },
    { id: 3, lender_uid: 'b', company_name: 'Bolt', updated_at: '2026-01-15' },
    { id: 4, lender_uid: 'c', company_name: ' ', updated_at: '2026-03-01' },
  ];
  assert.deepEqual(lenderBoard(rows).map((r) => r.id), [2, 3]);
  assert.match(sql, /company_name text not null/);
  assert.match(sql, /unique \(deal_id, lender_uid\)/);
  assert.match(policy('commercial_lender_terms_read'), /in \('owner','lender'\)/);
  assert.match(policy('commercial_lender_terms_own_insert'), /lender_uid = auth\.uid\(\)/);
  assert.match(policy('commercial_lender_terms_own_update'), /using \(public\.commercial_member_role\(deal_id\) = 'lender' and lender_uid = auth\.uid\(\)\)/);
  const lt = src('src/views/LenderTerms.jsx');
  assert.match(lt, /sendToOwner\(deal, me, 'lender'/); // the private message still goes to the buyer
  assert.match(lt, /onConflict: 'deal_id,lender_uid'/);
  assert.match(lt, /const \{ Questions: _private, \.\.\.shared \} = filled;/); // questions stay private
});

test('13. files say who can see them', () => {
  assert.equal(seenByLabel({ visibility: 'team', audience: [] }), 'Seen by buyer and realtor');
  assert.equal(seenByLabel({ visibility: 'seller', audience: ['lender'], kind: 'document' }), 'Seen by buyer, realtor, seller and lender');
  assert.equal(seenByLabel({ visibility: 'team', audience: ['viewer'], kind: 'document' }), 'Seen by buyer and realtor');
});

test('14 + 15. readable realtor and seller pages; respectful seller wording', () => {
  assert.match(src('src/index.css'), /\.readable \.text-sm \{ font-size: 1rem/);
  assert.match(src('src/views/Realtor.jsx'), /className="readable"/);
  const s = src('src/views/Seller.jsx');
  assert.match(s, /readable space-y-8/);
  for (const old of ['Three ways we could do this', 'What you carry now', 'What we’d ask of you', 'Worth knowing', 'This one looks good', 'Where are you at?']) {
    assert.ok(!s.includes(old), old);
  }
});

test('migration 0014 is additive, idempotent and namespaced', () => {
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|update public\.)/i);
  for (const m of sql.matchAll(/create policy (\w+) on public\.(\w+)/g)) {
    assert.match(m[1], /^commercial_/);
    assert.match(m[2], /^commercial_/);
    assert.match(sql, new RegExp(`drop policy if exists ${m[1]} on public\\.${m[2]};`), m[1]);
  }
  for (const m of sql.matchAll(/create table (if not exists )?public\.(\w+)/g)) assert.ok(m[1], m[2]);
  for (const m of sql.matchAll(/alter table (\S+)/g)) assert.match(m[1], /^public\.commercial_/);
  assert.doesNotMatch(sql, /AMHA|group home|sublease/i);
});

test('v6.3 picks switch: each person gets their own comp set, mine first', async () => {
  const { pickers, compsForView } = await import('../src/lib/v63.js');
  const picks = [
    { comp_id: 'a', picker_uid: 'me', picker_role: 'owner', picker_name: '' },
    { comp_id: 'b', picker_uid: 'r1', picker_role: 'realtor', picker_name: 'Erin' },
    { comp_id: 'c', picker_uid: 'r1', picker_role: 'realtor', picker_name: 'Erin' },
    { comp_id: 'c', picker_uid: 'v1', picker_role: 'reviewer', picker_name: '' },
  ];
  const ppl = pickers(picks, 'me', (r) => ({ reviewer: 'Reviewer' })[r] || r);
  assert.deepEqual(ppl.map((p) => p.label), ['My picks', 'Erin', 'Reviewer']);
  const comps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(compsForView(comps, picks, 'all').map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(compsForView(comps, picks, 'r1').map((c) => c.id), ['b', 'c']);
  assert.deepEqual(compsForView(comps, picks, 'me').map((c) => c.id), ['a']);
  assert.deepEqual(compsForView(comps, picks, 'nobody'), []);
});

test('v6.3 picks switch is view-only and Files deletes storage before the row', () => {
  const comps = readFileSync(new URL('../src/views/Comps.jsx', import.meta.url), 'utf8');
  assert.match(comps, /arvEstimate\(viewComps/);
  assert.match(comps, /never changes saved numbers/);
  assert.doesNotMatch(comps, /setView\([^)]*\)[^;]*supabase/);
  const files = readFileSync(new URL('../src/components/Files.jsx', import.meta.url), 'utf8');
  assert.ok(files.indexOf('storage.from(BUCKET).remove') < files.indexOf("from('commercial_uploads').delete()"));
});
