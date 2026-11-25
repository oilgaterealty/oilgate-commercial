import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CAP_RATES, ROOMS, STAGES, arvEstimate, compWhatIfMessage, pricePerUnit, stageMove, unitCount, v5Access, validComp } from '../src/lib/leaseUp.js';

const allRoles = ['owner', 'realtor', 'reviewer', 'lender', 'seller', 'viewer', 'guest'];
const visible = (role) => ['walkthrough', 'tenants', 'comps', 'strategy'].filter((k) => v5Access(role)[k]);

test('v5 role access matrix matches brief for every role', () => {
  assert.deepEqual(visible('owner'), ['walkthrough', 'tenants', 'comps', 'strategy']);
  assert.deepEqual(visible('realtor'), ['walkthrough', 'tenants', 'comps']);
  assert.deepEqual(visible('reviewer'), ['comps']);
  for (const role of ['lender', 'seller', 'viewer', 'guest', 'unknown']) {
    assert.deepEqual(visible(role), []);
  }
  for (const role of allRoles) {
    assert.equal(v5Access(role).strategy, role === 'owner');
    assert.equal(v5Access(role).saveComps, role === 'owner');
    assert.equal(v5Access(role).editWalkthrough, ['owner', 'realtor'].includes(role));
    assert.equal(v5Access(role).editTenants, ['owner', 'realtor'].includes(role));
  }
  assert.deepEqual(ROOMS.map(([, label]) => label), ['Kitchen', 'Bath', 'Bedroom 1', 'Bedroom 2', 'Living']);
  assert.deepEqual(CAP_RATES, [8, 8.5, 9, 9.5, 10]);
});

test('pipeline stages advance and revert without retaining an orphaned unit', () => {
  assert.deepEqual(STAGES.map(([, label]) => label), ['New lead', 'Contacted', 'Showing', 'Applied', 'Approved', 'Moved in']);
  for (const [stage] of STAGES.slice(0, -1)) {
    assert.deepEqual(stageMove(stage, 5, 9), { stage, unit_number: null });
  }
  assert.throws(() => stageMove('unknown', '', 9), /valid stage/);
});

test('moved in always allows all 10 units, atomically paired with the stage', () => {
  assert.equal(unitCount(10), 10);
  assert.equal(unitCount(9), 10);
  assert.equal(unitCount(undefined), 10);
  for (const invalid of ['', 0, 1.5, 11, undefined]) {
    assert.throws(() => stageMove('moved_in', invalid, 10), /available unit/);
  }
  assert.throws(() => stageMove('moved_in', 2, 10, [2]), /already has a tenant/);
  assert.deepEqual(stageMove('moved_in', '9', 10), { stage: 'moved_in', unit_number: 9 });
  assert.deepEqual(stageMove('moved_in', 10, 10, [2, 3, 7]), { stage: 'moved_in', unit_number: 10 });
});

test('comps compute per-unit price, average price/unit x 10 units, NOI / cap, and what-if message', () => {
  const comps = [
    { address: '100 Main St', units: 4, sale_price: '200000' },
    { address: '200 Oak Ave', units: 8, sale_price: '480000' },
  ];
  assert.equal(pricePerUnit(comps[0]), 50000);
  assert.equal(pricePerUnit(comps[1]), 60000);
  assert.deepEqual(arvEstimate(comps, 10, 48000, 8), { avg: 55000, market: 550000, income: 600000 });
  assert.deepEqual(arvEstimate(comps, 10, 48000, 10), { avg: 55000, market: 550000, income: 480000 });
  assert.deepEqual(arvEstimate([], 10, '', 9), { avg: null, market: null, income: null });
  assert.deepEqual(arvEstimate([{ address: 'Bad', units: 0, sale_price: 'Infinity' }], 10, 50000, 7), { avg: null, market: null, income: null });
  assert.equal(validComp({ address: '  ', units: 4, sale_price: 50000 }), false);

  const msg = compWhatIfMessage({ savedComps: [comps[0]], localComps: [comps[1]], units: 10, noi: 48000, cap: 8 });
  assert.match(msg, /200 Oak Ave: 8 units, \$480,000 \(\$60,000\/unit\)/);
  assert.match(msg, /Estimated value by comps: \$550,000/);
  assert.match(msg, /Estimated value by income: \$600,000/);
});

test('0009 migration enables RLS on all 6 tables, includes nullable polished column, and enforces moved-in unit uniqueness', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0009_v5_leaseup.sql', import.meta.url), 'utf8');
  for (const table of [
    'walkthrough_photos',
    'walkthrough_notes',
    'tenant_leads',
    'strategy_ideas',
    'comps',
    'comp_settings',
  ]) {
    assert.match(sql, new RegExp('alter table public\\.commercial_' + table + ' enable row level security'));
  }
  assert.match(sql, /\bpolished\s+text\b/i);
  assert.match(sql, /check \(\(stage = 'moved_in'\) = \(unit_number is not null\)\)/);
  assert.match(sql, /unique index commercial_tenant_occupied_unit_idx .*where stage = 'moved_in'/);
});

test('walkthrough has phone camera capture and zero rating/condition checklists', () => {
  const src = readFileSync(new URL('../src/views/Walkthrough.jsx', import.meta.url), 'utf8');
  assert.match(src, /capture="environment"/);
  assert.doesNotMatch(src, /good\/fix\/replace|condition score|checklist/i);
});

test('dictation excludes numbers, emails, money and passwords and inserts at cursor', () => {
  const src = readFileSync(new URL('../src/components/Dictation.jsx', import.meta.url), 'utf8');
  assert.match(src, /'number', 'email', 'password', 'tel'/);
  assert.match(src, /selectionStart/);
  assert.match(src, /Loading voice model/);
});
