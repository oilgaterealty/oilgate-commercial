import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_SITE, memberPageUrl } from '../src/lib/site.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('memberPageUrl builds role-specific and lender-tab-specific deal page URLs', () => {
  const sellerUrl = memberPageUrl('seller', 'charlotte');
  assert.equal(sellerUrl, PUBLIC_SITE);
  assert.ok(!sellerUrl.includes('#/d/'));

  const realtorUrl = memberPageUrl('realtor', 'charlotte');
  assert.ok(realtorUrl.includes('#/d/charlotte'));
  assert.ok(realtorUrl.endsWith('#/d/charlotte/offers'));

  const lenderUrl = memberPageUrl('lender', 'charlotte');
  assert.ok(lenderUrl.includes('#/d/charlotte'));
  assert.ok(lenderUrl.endsWith('#/d/charlotte'));

  assert.ok(memberPageUrl('lender', 'charlotte', 'bridge').endsWith('#/d/charlotte?lens=bridge'));
  assert.ok(memberPageUrl('lender', 'charlotte', 'private').endsWith('#/d/charlotte?lens=private'));
  assert.ok(memberPageUrl('lender', 'charlotte', 'dscr').endsWith('#/d/charlotte?lens=dscr'));
  assert.ok(memberPageUrl('lender', 'charlotte', 'invalid').endsWith('#/d/charlotte'));
  assert.ok(memberPageUrl('reviewer', 'charlotte', 'private').endsWith('#/d/charlotte'));
});

test('Owner invite card has lender tab picker and one-tap copy; member rows show no links', () => {
  const owner = read('src/views/Owner.jsx');
  assert.ok(owner.includes('memberPageUrl(f.role, deal.slug'));
  assert.ok(owner.includes('aria-label="Lender tab"'));
  assert.ok(owner.includes('Copy their link'));
  assert.ok(owner.includes('link` : \'Copy their link\''));
  assert.ok(!owner.includes('memberPageUrl(r.role'));
  assert.ok(!owner.includes('copyMemberLink'));
  assert.ok(!owner.includes('const link = PUBLIC_SITE'));
});
