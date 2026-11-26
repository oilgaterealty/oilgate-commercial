import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REQUEST_ROLES, readRequestRole, saveRequestRole, clearRequestRole } from '../src/lib/requestRoles.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('visitors can only ask for reviewer, lender or viewer', () => {
  assert.deepEqual(REQUEST_ROLES.map(([k]) => k), ['reviewer', 'lender', 'viewer']);
  const src = read('src/views/RequestAccess.jsx') + read('src/views/SignIn.jsx') + read('src/components/RoleChoice.jsx');
  assert.doesNotMatch(src, /'seller'|'realtor'|'lead_guest'|Lead guest/);
});

test('the picked role is stored, read back and cleared', () => {
  const s = mem();
  assert.equal(readRequestRole(s), '');
  saveRequestRole('seller', s);
  assert.equal(readRequestRole(s), '');
  saveRequestRole('lender', s);
  assert.equal(readRequestRole(s), 'lender');
  clearRequestRole(s);
  assert.equal(readRequestRole(s), '');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readRequestRole(broken), '');
  saveRequestRole('lender', broken);
  clearRequestRole(broken);
});

test('request page is its own step and keeps the sign-in context line', () => {
  const signIn = read('src/views/SignIn.jsx');
  assert.match(signIn, /Request access<\/h1>/);
  assert.match(signIn, /1\. Your role/);
  assert.match(signIn, /2\. Verify your email and send/);
  assert.match(signIn, /Sign in to see the property page you were invited to\./);
  const owner = read('src/views/Owner.jsx');
  assert.match(owner, /setRole\(r, e\.target\.value\)/);
});
