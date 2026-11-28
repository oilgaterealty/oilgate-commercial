import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LENDER_LENS_LABELS,
  LENDER_LENS_OPTIONS,
  appendLensToHash,
  clearStoredLenderLens,
  normalizeLenderLens,
  readLensFromLocation,
  readStoredLenderLens,
  saveStoredLenderLens,
} from '../src/lib/lenderLens.js';
import { parseLenderProtections } from '../src/lib/lenderModel.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const mem = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

test('lenderLens helpers normalize, read from hash/search, append to hashes, and persist safely', () => {
  assert.deepEqual(LENDER_LENS_OPTIONS, [['bridge', 'Bridge'], ['private', 'Private'], ['dscr', 'DSCR']]);
  assert.equal(LENDER_LENS_LABELS.private, 'Private');

  assert.equal(normalizeLenderLens(' PRIVATE '), 'private');
  assert.equal(normalizeLenderLens('bridge'), 'bridge');
  assert.equal(normalizeLenderLens('DSCR'), 'dscr');
  assert.equal(normalizeLenderLens('seller'), '');

  assert.equal(readLensFromLocation('#/d/charlotte?lens=private', ''), 'private');
  assert.equal(readLensFromLocation('#/request-access?lens=dscr', '?lens=bridge'), 'dscr');
  assert.equal(readLensFromLocation('#/', '?lens=private'), 'private');
  assert.equal(readLensFromLocation('#/d/charlotte', '?lens=unknown'), '');

  assert.equal(appendLensToHash('#/request-access', 'private'), '#/request-access?lens=private');
  assert.equal(appendLensToHash('#/d/charlotte?lens=bridge', 'private'), '#/d/charlotte?lens=bridge');
  assert.equal(appendLensToHash('#/d/charlotte', ''), '#/d/charlotte');

  const store = mem();
  assert.equal(readStoredLenderLens(store), '');
  saveStoredLenderLens('invalid', store);
  assert.equal(readStoredLenderLens(store), '');
  saveStoredLenderLens('Private', store);
  assert.equal(readStoredLenderLens(store), 'private');
  clearStoredLenderLens(store);
  assert.equal(readStoredLenderLens(store), '');

  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(readStoredLenderLens(broken), '');
  saveStoredLenderLens('dscr', broken);
  clearStoredLenderLens(broken);
});

test('parseLenderProtections parses JSON arrays safely with no hardcoded fallback', () => {
  assert.deepEqual(parseLenderProtections(null), []);
  assert.deepEqual(parseLenderProtections(''), []);
  assert.deepEqual(parseLenderProtections('{bad json'), []);
  assert.deepEqual(parseLenderProtections('"not an array"'), []);
  assert.deepEqual(parseLenderProtections('["  One  ", "", "Two"]'), ['One', 'Two']);
  assert.deepEqual(parseLenderProtections(['  Alpha ', null, 'Beta']), ['Alpha', 'Beta']);
});

test('lens parameter carries through SignIn, RequestAccess, AccessRequests, DealRoom, and ProtectionsEditor', () => {
  const signIn = read('src/views/SignIn.jsx');
  assert.match(signIn, /params\.set\('lens', cleanLens\)/);
  assert.match(signIn, /appendLensToHash\('#\/request-access', activeLens\)/);

  const req = read('src/views/RequestAccess.jsx');
  assert.match(req, /p_requested_lens:\s*r === 'lender' \? \(activeLens \|\| null\) : null/);
  assert.match(req, /p_requester_name:/);

  const acc = read('src/components/AccessRequests.jsx');
  assert.match(acc, /requested_lens/);
  assert.match(acc, /aria-label=\{`Lender tab for \$\{row\.email\}`\}/);
  assert.match(acc, /p_lens:\s*lens/);

  const dr = read('src/views/DealRoom.jsx');
  assert.match(dr, /select\('display_name,company,default_lens,ntfy_topic,role'\)/);
  assert.match(dr, /company:\s*state\.member\?\.company \|\| ''/);
  assert.match(dr, /cleanUrlLens \|\| normalizeLenderLens\(state\.member\?\.default_lens\) \|\| 'bridge'/);

  const pe = read('src/components/ProtectionsEditor.jsx');
  assert.match(pe, /Private lender protections/);
  assert.match(pe, /lender_protections:\$\{deal\.slug\}/);
});

test('0032_lender_polish.sql preserves strict RLS, drops prior RPC overloads, and never grants anon', () => {
  const sql = read('supabase/migrations/0032_lender_polish.sql');
  assert.match(sql, /^[\s\S]*begin;/i);
  assert.match(sql, /notify pgrst,\s*'reload schema';/);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|service_role|sb_secret_)\b/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*\bto\s+[^;]*\banon\b/i);
  assert.match(sql, /drop function if exists public\.commercial_request_charlotte_access\(boolean, text\);/);
  assert.match(sql, /drop function if exists public\.commercial_decide_access_request\(uuid, boolean, text\);/);
  assert.match(sql, /add column if not exists company text not null default ''/);
  assert.match(sql, /add column if not exists default_lens text check \(default_lens is null or default_lens in \('bridge', 'private', 'dscr'\)\)/);
  assert.match(sql, /add column if not exists requested_lens text check \(requested_lens is null or requested_lens in \('bridge', 'private', 'dscr'\)\)/);
});
