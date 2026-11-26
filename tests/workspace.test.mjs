import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { breakEvenCount } from '../src/lib/occupancy.js';
import { evaluate } from '../src/lib/dealmath.js';
import { parseHash } from '../src/lib/useHashRoute.js';

test('break-even rounds up occupied units and discloses impossible occupancy', () => {
  const result = n => ({ breakEven: n, operating: { b: { units: 9 } } });
  assert.equal(breakEvenCount(result(0.8)), '8 of 9 units');
  assert.equal(breakEvenCount(result(1 / 3)), '3 of 9 units');
  assert.equal(breakEvenCount(result(1.12)), '11 of 9 units · exceeds capacity');
  assert.equal(breakEvenCount(result(null)), 'Count unavailable');
  assert.equal(breakEvenCount(result(0)), '0 of 9 units');
  assert.equal(breakEvenCount({ breakEven: 0.5, operating: { b: { units: 0 } } }), 'Count unavailable');
});
test('all offer structures supply a break-even unit count with real assumptions', () => {
  for (const structure of ['cash', 'wrap', 'master_lease', 'partnership']) {
    const r = evaluate(structure, {}, { units: 9, rent: 1200, taxes: 10000, insurance: 4000, value: 700000 });
    assert.match(breakEvenCount(r), /of 9 units/);
  }
});
test('reply links preserve deal tab and conversation query', () => {
  assert.deepEqual(parseHash('#/d/charlotte/messages?thread=abc'), { name: 'deal', slug: 'charlotte', tab: 'messages', sub: '' });
});
test('new workspace tables have RLS and exclude seller/viewer research', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0004_deal_workspace.sql', import.meta.url), 'utf8');
  for (const t of ['commercial_work_items', 'commercial_bia', 'commercial_seller_loans']) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  assert.match(sql, /kind in \('task','update'\) and public\.commercial_member_role/);
  assert.match(sql, /role = 'realtor' and r = 'seller'/);
  assert.match(sql, /has_lender and cardinality\(p_participants\) <> 1/);
  assert.match(sql, /new\.participants is distinct from old\.participants/);
  assert.match(sql, /new\.deal_id is distinct from old\.deal_id/);
  assert.match(sql, /commercial_loan_read[\s\S]*?in \('owner','seller'\)/);
  assert.doesNotMatch(sql, /update commercial_conversations set participants|update commercial_messages|drop table|truncate/i);
});
test('seller stays outside underwriting and shows single offer plus execution plan', () => {
  const src = readFileSync(new URL('../src/views/Seller.jsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../src/components/LeadOfferCard.jsx', import.meta.url), 'utf8');
  assert.match(src, /<LeadOfferCard/);
  assert.match(src, /<ExecutionPlanCard/);
  assert.match(src, /PhotoGrid photos/);
  assert.match(card, /6801234 and 6807893/);
  assert.doesNotMatch(src, /comparison-table|Side by side|One at a time|carry_now|with_us/);
  assert.doesNotMatch(src, /commercial_offers|commercial_models|canSave|SellerEditor/);
});
