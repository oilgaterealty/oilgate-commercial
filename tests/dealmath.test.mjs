// Checks the calculator's formulas on a made-up building. Real deal numbers live only in the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operating, evaluate, grade } from '../src/lib/dealmath.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const B = { units: 10, rent: 1000, vacancyPct: 5, taxes: 10000, insurance: 5000, utilities: 6000, admin: 3000, turns: 1000, mgmtPct: 10,
  reservesPerUnit: 300, value: 500000, rehab: 20000, refiRate: 7, refiYears: 30, refiLtv: 75, refiDscr: 1.25, refiFeesPct: 2, refiFeesFlat: 3000, refiReserve: 10000, tenthUnitRepair: 0 };

test('NOI, cash flow and refi follow the standard formulas', () => {
  const o = operating(B);
  near(o.noi, 77600, 0.01);
  near(o.cashFlow, 74600, 0.01);
  near(o.refiLoan, 375000, 0.01);
  assert.equal(o.refiLimitedBy, 'LTV');
  near(o.refiNet, 354500, 0.01);
  near(o.refiPayment, 2494.88, 0.01);
});

test('master lease: keep, DSCR and months until we can buy', () => {
  const r = evaluate('master_lease', { payment: 4000, optionPrice: 380000, sellerAdvances: 20000, exerciseClosing: 5000, creditPct: 50 }, B);
  near(r.keepMonthly, 2216.67, 0.01);
  near(r.dscr, 1.5542, 0.0001);
  near(r.extra[0][1], 50500, 0.01);
  near(r.extra[1][1], 25.25, 0.01);
  assert.equal(r.cashOnCash, null);
});

test('wrap interest-only: payment, keep, DSCR and break-even', () => {
  const r = evaluate('wrap', { note: 400000, rate: 6 }, B);
  near(r.sellerMonthly, 2000, 0.01);
  near(r.keepMonthly, 4216.67, 0.01);
  near(r.dscr, 3.1083, 0.0001);
  near(r.breakEven, 0.4815, 0.0001);
  near(evaluate('wrap', { note: 400000, rate: 6, sellerLoanPayment: 1500 }, B).sellerNet, 500, 0.01);
});

test('partnership pays step-ups before the buyout and the refi payment after', () => {
  const r = evaluate('partnership', { buyout: 300000, sellerAdvances: 30000, stepUp: 1000, closing: 10000 }, B);
  near(r.keepMonthly, 74600 / 12 - 2494.88, 0.01);
  near(r.allIn, 340000, 0.01);
  near(r.extra[1][1], 340000 - 354500, 0.01);
});

test('grades follow the standard tests', () => {
  assert.equal(grade('dscr', 1.25), 'pass');
  assert.equal(grade('dscr', 1.22), 'close');
  assert.equal(grade('allInPct', 0.9), 'fail');
  assert.equal(grade('breakEven', 0.84), 'pass');
});

test('a blank deal shows dashes instead of crashing', () => {
  const r = evaluate('wrap', {}, {});
  assert.equal(r.allInPct, null);
  assert.equal(r.breakEven, null);
});

test('editing one input changes the result live', () => {
  assert.ok(evaluate('wrap', { note: 400000, rate: 7 }, B).keepMonthly < evaluate('wrap', { note: 400000, rate: 6 }, B).keepMonthly);
});

test('bills are locked for everyone but the owner; rent is a what-if', async () => {
  const { KNOWN_BASE } = await import('../src/lib/dealmath.js');
  for (const k of ['taxes', 'insurance']) assert.ok(KNOWN_BASE.includes(k), k);
  for (const k of ['rent', 'refiRate', 'value', 'vacancyPct']) assert.ok(!KNOWN_BASE.includes(k), k);
});

test('added unit repair cost is always included once in the budget and in every offer', () => {
  const baseWithRepair = operating({ ...B, tenthUnitRepair: 12000 });
  assert.equal(baseWithRepair.b.rehab, 32000);
  near(evaluate('wrap', { note: 400000 }, { ...B, tenthUnitRepair: 12000 }).allIn, 412000, 0.01);
  near(evaluate('cash', { price: 100000, closingPct: 0 }, { ...B, tenthUnitRepair: 12000 }).allIn, 132000, 0.01);
});

test('all units run long-term even if legacy short-term fields exist on saved data', () => {
  const legacy = { strUnits: 2, strNightly: 150, strOccPct: 60, strFeesPct: 15, strCleaningPerStay: 50, strNightsPerStay: 3, strCostsMo: 200 };
  const clean = operating(B);
  const withLegacy = operating({ ...B, ...legacy });
  assert.equal(withLegacy.strUnits, 0);
  assert.equal(withLegacy.ltrUnits, 10);
  near(withLegacy.egi, clean.egi, 0.01);
  near(withLegacy.fixed, clean.fixed, 0.01);
});

test('plain-English lines use the live math', async () => {
  const { plain } = await import('../src/lib/plain.js');
  const w = plain('wrap', evaluate('wrap', { note: 400000, rate: 6 }, B));
  assert.ok(w.lines[1].includes('$2,000/mo'));
  const c = plain('cash', evaluate('cash', { price: 100000, downPct: 25, rate: 7, years: 30, closingPct: 2 }, B));
  assert.equal(c.payoff, 'At closing');
  const m = plain('master_lease', evaluate('master_lease', { payment: 4000, optionPrice: 380000, sellerAdvances: 20000, exerciseClosing: 5000, creditPct: 50 }, B));
  assert.ok(m.lines[1].includes('$400,000'));
});
