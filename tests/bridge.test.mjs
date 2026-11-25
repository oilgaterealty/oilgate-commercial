import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../supabase/migrations/0019_bridge.sql', import.meta.url), 'utf8');
test('bridge is additive, pins search_path, and exposes only the read RPC to anon', () => {
  assert.match(sql, /security definer set search_path = ''/i);
  assert.match(sql, /scope = 'superlab_owner'/);
  assert.match(sql, /t\.active/);
  assert.match(sql, /d\.slug = p_slug/);
  assert.match(sql, /grant execute on function public\.commercial_bridge_snapshot\(text, text\) to anon/);
  assert.doesNotMatch(sql, /commercial_bridge_act|erwin_writer|drop\s|truncate\s|delete\s|alter policy/i);
});
test('upload metadata excludes file paths, signed URLs, and credentials', () => {
  const uploads = sql.slice(sql.indexOf("'uploads'"), sql.indexOf("'interest'"));
  assert.match(uploads, /file_name, mime, size_bytes/);
  assert.doesNotMatch(uploads, /storage_path|drive_file_id|signed|token/i);
});
