import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WALK_SPACES, WALK_UNITS, spaceLabel, roomsFor, roomFits, stepSpace, canMoveMedia, uploadCounts } from '../src/lib/leaseUp.js';
import { applyMove } from '../src/lib/walkthroughStore.js';

const sql = readFileSync(new URL('../supabase/migrations/0013_v61_walkthrough_move_video.sql', import.meta.url), 'utf8');
const walk = readFileSync('src/views/Walkthrough.jsx', 'utf8');
const cam = readFileSync('src/components/WalkthroughCamera.jsx', 'utf8');

test('laundry and utility rooms join the building areas; catch-all stays last', () => {
  assert.equal(spaceLabel(17), 'Laundry room');
  assert.equal(spaceLabel(18), 'Utility room (gas & electric)');
  assert.equal(WALK_SPACES.length, 18);
  assert.equal(WALK_SPACES.at(-1), 16);
  assert.deepEqual(roomsFor(17), [['general', 'Photos & notes']]);
  assert.equal(stepSpace(15, 1), 17);
  assert.equal(stepSpace(18, 1), 16);
  assert.equal(stepSpace(16, 1), 16);
  assert.equal(stepSpace(1, -1), 1);
  assert.match(sql, /check \(unit_number between 1 and 18\)/);
});

test('a move must land in a room that belongs to the space', () => {
  assert.equal(roomFits(4, 'kitchen'), true);
  assert.equal(roomFits(4, 'general'), false);
  assert.equal(roomFits(15, 'general'), true);
  assert.equal(roomFits(15, 'kitchen'), false);
  assert.match(sql, /new\.unit_number <= 10 and new\.room = 'general'\) or \(new\.unit_number > 10 and new\.room <> 'general'\)/);
  assert.ok(WALK_UNITS === 10);
});

test('the owner moves anything; the realtor only what she took', () => {
  assert.equal(canMoveMedia('owner', { author_uid: 'r' }, 'o'), true);
  assert.equal(canMoveMedia('realtor', { author_uid: 'o' }, 'r'), false);
  assert.equal(canMoveMedia('realtor', { author_uid: 'r' }, 'r'), true);
  assert.equal(canMoveMedia('seller', { author_uid: 's' }, 's'), false);
  assert.match(sql, /r = 'owner' or \(r = 'realtor' and old\.author_uid = auth\.uid\(\)\)/);
  for (const t of ['photos', 'videos']) {
    assert.match(sql, new RegExp(`commercial_walkthrough_${t}_realtor_move[\\s\\S]*?author_uid = auth\\.uid\\(\\)[\\s\\S]*?author_uid = auth\\.uid\\(\\)\\);`));
  }
  assert.match(sql, /Walkthrough media cannot be re-attributed/);
  assert.match(sql, /create trigger commercial_walk_share_guard before update on public\.commercial_walkthrough_videos/);
});

test('a phone copy moves only when it is not mid-upload, and the upload uses the moved copy', () => {
  const item = { id: 'a', unitNumber: 10, room: 'kitchen', status: 'pending' };
  assert.deepEqual({ ...applyMove(item, 4, 'bath'), updatedAt: 0 }, { ...item, unitNumber: 4, room: 'bath', updatedAt: 0 });
  assert.equal(applyMove({ ...item, status: 'uploading' }, 4, 'bath'), null);
  assert.equal(applyMove(null, 4, 'bath'), null);
  assert.match(walk, /item = uploading;/);
});

test('videos share like photos, and the seller or lender read only what is shared', () => {
  assert.match(sql, /alter table public\.commercial_walkthrough_videos\s+add column if not exists share_seller boolean not null default false/);
  assert.match(sql, /commercial_walkthrough_videos_seller_shared[\s\S]*?share_seller and public\.commercial_member_role\(deal_id\) = 'seller'/);
  assert.match(sql, /commercial_walkthrough_videos where deal_id = d and storage_path = p_name and share_lender/);
  assert.match(walk, /toggleShare\(v, 'share_seller', 'video'\)/);
});

test('nothing on the phone is dropped or uploaded twice, and the count is exact', () => {
  assert.deepEqual(uploadCounts([{ status: 'pending' }, { status: 'uploading' }, { status: 'failed' }], [{}]), { waiting: 4, uploading: 1, failed: 1 });
  assert.deepEqual(uploadCounts([], []), { waiting: 0, uploading: 0, failed: 0 });
  assert.match(walk, /inFlightRef\.current\.has\(item\.id\)/);
  assert.match(walk, /if \(!uploading\) \{/);
  assert.match(walk, /waiting to upload/);
  assert.match(walk, /beforeunload/);
  const sync = walk.slice(walk.indexOf('const syncMediaItemOnce'), walk.indexOf('const enqueueAndMaybeSyncFiles'));
  assert.ok(sync.indexOf('await deleteMediaItem(item.id)') > sync.indexOf('const ins = await supabase.from(table).insert(row)'));
});

test('the camera switches space, room and photo/video without closing', () => {
  assert.match(cam, /onTargetChange\?\.\(Number\(e\.target\.value\), room\)/);
  assert.match(cam, /onModeChange\?\.\(k\)/);
  assert.match(cam, /VIDEO_BITRATE/); // v6.3: 480p at ~750 kbps (src/lib/videoPost.js)
  const stop = cam.slice(cam.indexOf('recorder.onstop'), cam.indexOf('recorder.start('));
  assert.doesNotMatch(stop, /onClose/);
  assert.match(walk, /onTargetChange=\{setCameraTarget\}/);
});

test('v6.1 migration touches only commercial_ objects', () => {
  for (const m of sql.matchAll(/create (?:or replace )?(?:table|function|trigger|index) (?:if not exists )?(?:public\.)?(\w+)/gi)) assert.match(m[1], /^commercial_/, m[1]);
  // %I is the format() loop over the three commercial_walkthrough_ tables listed above it.
  for (const m of sql.matchAll(/(?:alter|drop) table (?:if exists )?(\S+)/gi)) assert.match(m[1], /^public\.(commercial_|%I)/, m[1]);
  assert.match(sql, /array\['commercial_walkthrough_photos','commercial_walkthrough_notes','commercial_walkthrough_videos'\]/);
  assert.doesNotMatch(sql, /\b(truncate|drop function|site_url|delete from)\b/i);
});
