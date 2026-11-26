import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHash } from '../src/lib/useHashRoute.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/0017_commercial_access_requests.sql');

test('request access preserves both existing deal and invitation routes', () => {
  assert.deepEqual(parseHash('#/request-access'), { name: 'request-access' });
  assert.deepEqual(parseHash('#/join/invite'), { name: 'join', token: 'invite' });
  assert.deepEqual(parseHash('#/d/charlotte/overview'), { name: 'deal', slug: 'charlotte', tab: 'overview', sub: '' });
  const app = read('src/App.jsx');
  assert.match(app, /canRequestAccess=\{rules\.guestsAllowed && requestAccessAllowed\(SITE_KIND\) && route\.name !== 'join'\}/);
  assert.match(app, /!isOwner && rules\.guestsAllowed && requestAccessAllowed\(SITE_KIND\) && route\.name === 'request-access'/);
  const reqView = read('src/views/RequestAccess.jsx');
  assert.match(reqView, /p_submit: false/);
  assert.match(reqView, /p_submit: true/);
});

test('requests require verified identity, and resolving a request cannot overwrite existing memberships', () => {
  assert.match(sql, /u\.id = \(select auth\.uid\(\)\) and u\.email_confirmed_at is not null/);
  assert.match(sql, /d\.slug = 'charlotte'/);
  assert.match(sql, /unique \(deal_id, email\)/);
  assert.equal(Array.from(sql.matchAll(/on conflict \(deal_id, email\) do nothing/g)).length, 2);
  assert.match(sql, /a\.status = 'pending'[\s\S]*for update of a/);
  assert.match(sql, /not public\.commercial_is_owner\(\)/);
  assert.match(sql, /grant select on public\.commercial_access_requests to authenticated/);
  assert.match(sql, /for select to authenticated using \(\(select public\.commercial_is_owner\(\)\)\)/);
  assert.doesNotMatch(sql, /grant .* to anon/);
  assert.doesNotMatch(sql, /update public\.commercial_members/);
  assert.match(read('src/components/AccessRequests.jsx'), /disabled=\{busy \|\| !selected\[row\.id\]\}/);
});
