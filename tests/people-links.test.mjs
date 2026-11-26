import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_SITE, memberPageUrl } from '../src/lib/site.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('memberPageUrl builds role-specific deal page URLs', () => {
  const sellerUrl = memberPageUrl('seller', 'charlotte');
  assert.equal(sellerUrl, PUBLIC_SITE);
  assert.ok(!sellerUrl.includes('#/d/'));

  const realtorUrl = memberPageUrl('realtor', 'charlotte');
  assert.ok(realtorUrl.includes('#/d/charlotte'));
  assert.ok(realtorUrl.endsWith('#/d/charlotte/offers'));

  const lenderUrl = memberPageUrl('lender', 'charlotte');
  assert.ok(lenderUrl.includes('#/d/charlotte'));
  assert.ok(lenderUrl.endsWith('#/d/charlotte'));
});

test('Owner invite card copies the link for the chosen role; member rows show no links', () => {
  const owner = read('src/views/Owner.jsx');
  assert.ok(owner.includes('memberPageUrl(f.role, deal.slug)'));
  assert.ok(owner.includes('Copy their link'));
  assert.ok(!owner.includes('memberPageUrl(r.role'));
  assert.ok(!owner.includes('copyMemberLink'));
  assert.ok(!owner.includes('const link = PUBLIC_SITE'));
});
