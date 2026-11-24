import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkedLabel, latestCompDate } from '../src/lib/v63.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('page carries a strict security policy', () => {
  const html = read('index.html');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  for (const rule of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", 'upgrade-insecure-requests'])
    assert.ok(html.includes(rule), rule);
  assert.doesNotMatch(html, /'unsafe-eval'/);
  assert.match(html, /name="referrer" content="strict-origin-when-cross-origin"/);
});

test('app refuses to run inside another site frame', () => {
  assert.match(read('src/main.jsx'), /window\.top !== window\.self/);
});

test('release is gated by secret scan, dependency check, tests and data lock check', () => {
  const wf = read('.github/workflows/pages.yml');
  const order = ['trufflehog', 'npm audit', 'npm test', 'live-security-check.mjs --data-only', 'npm run build'].map((s) => wf.indexOf(s));
  assert.ok(order.every((i) => i > 0), 'all gates present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'gates run before the build');
  assert.match(wf, /verify-live:[\s\S]*needs: deploy/);
  assert.match(wf, /persist-credentials: false/);
  assert.doesNotMatch(wf, /^permissions:\n\s+contents: read\n\s+pages: write/m, 'write rights only on the deploy job');
});

test('last-checked dates', () => {
  assert.equal(checkedLabel('2026-11-24'), 'Nov 24, 2026');
  assert.equal(checkedLabel('2026-11-05T12:00:00Z'), 'Nov 5, 2026');
  assert.equal(checkedLabel(''), '');
  assert.equal(latestCompDate([{ created_at: '2026-11-20T01:00:00Z' }, { created_at: '2026-11-23T01:00:00Z' }, {}]), '2026-11-23T01:00:00Z');
  assert.equal(latestCompDate(null), '');
  assert.match(read('src/components/Switches.jsx'), /owner && base\.strCheckedAt/);
  assert.match(read('src/views/Comps.jsx'), /Comp list last updated/);
});
