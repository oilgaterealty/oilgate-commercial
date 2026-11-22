import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { STAGES, ROOMS, arvEstimate, leaseAccess, stageMove, unitCount, validComp } from '../src/lib/leaseUp.js';
import { spokenNumber } from '../src/lib/spokenNumber.js';

const all = ['owner', 'realtor', 'reviewer', 'lender', 'seller', 'viewer', 'guest'];
const visible = (role) => ['pipeline','leads','walkthrough','realtor','strategy','comps'].filter((k) => leaseAccess(role)[k]);
test('Charlotte lease-up shows only the intended sections in every actual and preview role', () => {
  assert.deepEqual(visible('owner'), ['pipeline','leads','walkthrough','realtor','strategy','comps']);
  assert.deepEqual(visible('realtor'), ['pipeline','leads','walkthrough','realtor','comps']);
  assert.deepEqual(visible('reviewer'), ['pipeline','leads','walkthrough','comps']);
  for (const role of ['lender','seller','viewer','guest','unknown']) assert.deepEqual(visible(role), []);
  for (const role of all) {
    assert.equal(leaseAccess(role).strategy, role === 'owner');
    assert.equal(leaseAccess(role).saveComps, role === 'owner');
    assert.equal(leaseAccess(role).editTenants, ['owner','realtor'].includes(role));
    assert.ok(Object.values(leaseAccess(role, 'another-deal')).every((x) => !x));
  }
  assert.deepEqual(ROOMS.map(([, label]) => label), ['Kitchen','Bath','Bedroom 1','Bedroom 2','Living']);
});
test('pipeline stages advance and revert without retaining an orphaned unit', () => {
  assert.deepEqual(STAGES.map(([, label]) => label), ['New lead','Contacted','Showing','Applied','Approved','Moved in']);
  for (const [stage] of STAGES.slice(0, -1)) {
    assert.deepEqual(stageMove(stage, 5, 9), { stage, unit_number: null });
  }
  assert.throws(() => stageMove('unknown', '', 9), /valid stage/);
});
test('moved in requires a free enabled unit, atomically paired with the stage', () => {
  assert.equal(unitCount(10), 10); assert.equal(unitCount(9), 9); assert.equal(unitCount(undefined), 9);
  for (const invalid of ['', 0, 1.5, 10, undefined]) assert.throws(() => stageMove('moved_in', invalid, 9), /available unit/);
  assert.throws(() => stageMove('moved_in', 2, 9, [2]), /already has a tenant/);
  assert.deepEqual(stageMove('moved_in', '9', 9), { stage: 'moved_in', unit_number: 9 });
  assert.deepEqual(stageMove('moved_in', 10, 10, [2,3,7]), { stage: 'moved_in', unit_number: 10 });
});
test('comps average distinct price-per-unit values, not total-sale weighting; income is NOI divided by cap', () => {
  const comps = [{ address: 'Fixture A', units: 4, sale_price: '200000' }, { address: 'Fixture B', units: 8, sale_price: '480000' }];
  assert.deepEqual(arvEstimate(comps, 9, 48000, 8), { avg: 55000, market: 495000, income: 600000 });
  assert.deepEqual(arvEstimate(comps, 10, 48000, 10), { avg: 55000, market: 550000, income: 480000 });
  assert.deepEqual(arvEstimate([], 10, '', 9), { avg: null, market: null, income: null });
  assert.deepEqual(arvEstimate([{ address: 'Bad', units: 0, sale_price: 'Infinity' }], 9, 50000, 7), { avg: null, market: null, income: null });
  assert.equal(validComp({ address: '  ', units: 4, sale_price: 50000 }), false);
});
test('all new tables activate RLS, private strategy policies only give owner access and writes are not seeded', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0009_charlotte_lease_up.sql', import.meta.url), 'utf8');
  for (const table of ['tenant_leads','walkthrough_voice','lease_photos','realtor_notes','strategy_ideas','comps']) {
    assert.match(sql, new RegExp('alter table public\\.commercial_' + table + ' enable row level security'));
  }
  assert.match(sql, /create policy commercial_strategy_ideas_owner_only[\s\S]*?using \(public\.commercial_charlotte_lease_role\(deal_id\) = 'owner'\) with check \(public\.commercial_charlotte_lease_role\(deal_id\) = 'owner'\);/);
  assert.equal([...sql.matchAll(/create policy [^;]+ on public\.commercial_strategy_ideas/gi)].length, 1);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.commercial_strategy_ideas/i);
  assert.match(sql, /check \(\(stage = 'moved_in'\) = \(unit_number is not null\)\)/);
  assert.match(sql, /unique index commercial_tenant_occupied_unit .*where stage = 'moved_in'/);
});
test('numeric dictation accepts whole numbers, currency and decimal phrases without making guesses', () => {
  assert.equal(spokenNumber('$120,500.50.'), '120500.50');
  assert.equal(spokenNumber('fifty thousand'), '50000');
  assert.equal(spokenNumber('eight point five'), '8.5');
  assert.equal(spokenNumber('negative ten'), '-10');
  assert.equal(spokenNumber('six or eight'), null);
});
