import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as React from 'react';
import { transformSync } from 'esbuild';
import { seenBy } from '../src/lib/visibility.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadFilesModule(supabaseStub = { from: () => ({}), storage: { from: () => ({}) } }) {
  const src = read('src/components/Files.jsx');
  const code = transformSync(src, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const mod = { exports: {} };
  const stubs = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    './Dictation.jsx': { DictatedField: () => null },
    '../lib/supabase.js': { supabase: supabaseStub, BUCKET: 'commercial-files' },
    '../lib/format.js': { when: () => '', bytes: () => '', roleLabel: {} },
    './Shell.jsx': {
      Card: ({ children }) => React.createElement('div', null, children),
      CardTitle: ({ children }) => React.createElement('h2', null, children),
      Button: ({ children, ...p }) => React.createElement('button', p, children),
      Empty: ({ children }) => React.createElement('p', null, children),
      InfoTip: () => null,
    },
    './PhotoViewer.jsx': { default: () => null, ThumbOverlay: () => null },
    '../lib/v63.js': { seenByLabel: () => '' },
  };
  const localRequire = (spec) => {
    if (spec in stubs) return stubs[spec];
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);
  return mod.exports;
}

test('0033_realtor_file_toggle updates audience constraint without backfill and preserves 0026', () => {
  const sql = read('supabase/migrations/0033_realtor_file_toggle.sql');
  const body = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');

  assert.match(body, /alter table public\.commercial_uploads\s+drop constraint if exists commercial_uploads_audience_check;/i);
  assert.match(
    body,
    /alter table public\.commercial_uploads\s+add constraint commercial_uploads_audience_check\s+check\s*\(\s*audience\s*<@\s*array\['reviewer','lender','viewer','realtor'\]::text\[\]\s*\)/i,
  );
  assert.match(body, /drop policy if exists uploads_read on public\.commercial_uploads;/i);
  assert.match(
    body,
    /create policy uploads_read on public\.commercial_uploads for select using\s*\([\s\S]*array\['reviewer'::text,\s*'lender'::text,\s*'viewer'::text,\s*'realtor'::text\][\s\S]*public\.commercial_member_role\(deal_id\)\s*=\s*any\s*\(audience\)/i,
  );
  assert.doesNotMatch(body, /array\['owner'::text,\s*'realtor'::text,\s*'guest'::text\]/i);
  assert.doesNotMatch(body, /\bupdate\s+public\.commercial_uploads\b/i, 'must not backfill existing rows');
  assert.doesNotMatch(body, /\barray_append\b/i, 'must not backfill audience');
  assert.match(body, /pg_get_constraintdef\(c\.oid\)/i);
  assert.match(body, /position\('realtor' in v_def\) = 0/i);

  assert.ok(existsSync(join(root, 'supabase/migrations/0026_realtor_file_audience.sql')));
  const baseline = JSON.parse(read('supabase/migrations-baseline.json'));
  assert.equal(baseline.baseline, 28);
});

test('toggleAudience adds and removes realtor safely even when audience is null', () => {
  const { toggleAudience } = loadFilesModule();
  assert.deepEqual(toggleAudience({ audience: null }, 'realtor'), { audience: ['realtor'] });
  assert.deepEqual(toggleAudience({ audience: ['lender'] }, 'realtor'), { audience: ['lender', 'realtor'] });
  assert.deepEqual(toggleAudience({ audience: ['lender', 'realtor'] }, 'realtor'), { audience: ['lender'] });
});

test('setUpload writes realtor into audience and surfaces save failures via onError (no silent failure)', async () => {
  const calls = [];
  const okClient = {
    from(table) {
      return {
        update(patch) {
          return {
            async eq(col, val) {
              calls.push({ table, patch, col, val });
              return { error: null };
            },
          };
        },
      };
    },
  };

  const { setUpload, toggleAudience, uploadShareButtons } = loadFilesModule(okClient);
  const row = { id: 'file-1', visibility: 'team', audience: [] };

  let changed = 0;
  let lastError = 'stale';
  const okRes = await setUpload(
    row,
    toggleAudience(row, 'realtor'),
    () => { changed++; },
    (msg) => { lastError = msg; },
    okClient,
  );
  assert.deepEqual(okRes, { ok: true, error: '' });
  assert.equal(changed, 1);
  assert.equal(lastError, '');
  assert.deepEqual(calls, [{ table: 'commercial_uploads', patch: { audience: ['realtor'] }, col: 'id', val: 'file-1' }]);

  const failClient = {
    from() {
      return {
        update() {
          return {
            async eq() {
              return { error: { message: 'violates check constraint "commercial_uploads_audience_check"' } };
            },
          };
        },
      };
    },
  };
  let failChanged = 0;
  let failMsg = '';
  const failRes = await setUpload(
    row,
    { audience: ['realtor'] },
    () => { failChanged++; },
    (msg) => { failMsg = msg; },
    failClient,
  );
  assert.equal(failRes.ok, false);
  assert.match(failRes.error, /Could not save sharing change: violates check constraint/);
  assert.equal(failMsg, failRes.error);
  assert.equal(failChanged, 0);

  const throwClient = {
    from() {
      return {
        update() {
          return {
            async eq() {
              throw new Error('network down');
            },
          };
        },
      };
    },
  };
  let throwMsg = '';
  const throwRes = await setUpload(
    row,
    { audience: ['realtor'] },
    () => { failChanged++; },
    (msg) => { throwMsg = msg; },
    throwClient,
  );
  assert.equal(throwRes.ok, false);
  assert.match(throwMsg, /Could not save sharing change: network down/);
  assert.equal(failChanged, 0);

  const ownerButtons = uploadShareButtons(row, true, () => {}, () => {});
  assert.ok(ownerButtons.some((b) => b.key === 'realtor'));
  const nonOwnerButtons = uploadShareButtons(row, false, () => {}, () => {});
  assert.ok(!nonOwnerButtons.some((b) => b.key === 'realtor'));
});

test('Files.jsx ShareChips and Photos.jsx render role="alert" when sharing fails and seenBy respects realtor audience', () => {
  const filesSrc = read('src/components/Files.jsx');
  const photosSrc = read('src/components/Photos.jsx');
  assert.match(filesSrc, /saveError && <p role="alert"/);
  assert.match(photosSrc, /uploadShareButtons\(r, owner, load, setShareError\)/);
  assert.match(photosSrc, /shareError && <p role="alert"/);

  const rows = [
    { id: '1', visibility: 'team', uploaded_by_role: 'owner', audience: [] },
    { id: '2', visibility: 'team', uploaded_by_role: 'owner', audience: ['realtor'] },
    { id: '3', visibility: 'seller', uploaded_by_role: 'owner', audience: [] },
    { id: '4', visibility: 'team', uploaded_by_role: 'realtor', audience: [] },
  ];
  assert.deepEqual(seenBy('realtor', rows).map((r) => r.id), ['2', '3', '4']);
});
