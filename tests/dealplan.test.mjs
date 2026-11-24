// Checks the month-by-month plan on a made-up building. Real deal numbers live only in the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPlan, unitSchedule, spread, monthOfWeek, normalizePlan, rentStrategy, derivations } from '../src/lib/dealplan.js';
import { operating } from '../src/lib/dealmath.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const B = { units: 4, rent: 1000, vacancyPct: 0, taxes: 12000, insurance: 0, utilities: 0, admin: 0, turns: 0, mgmtPct: 10,
  reservesPerUnit: 0, value: 400000, refiRate: 6, refiYears: 30, refiLtv: 75, refiDscr: 1.25, refiFeesPct: 0, refiFeesFlat: 0, refiReserve: 0 };
const P = {
  months: 12, refiMonth: 10, leaseUpWeeks: 4, lenderRate: 12, lenderPoints: 0,
  units: [{ id: 'A', rehab: 1000, ready: 5 }, { id: 'B', rehab: 1000, ready: 13 }, { id: 'C', rehab: 0, ready: 0, occupied: true }, { id: 'D', rehab: 2000, ready: 20, optional: true }],
  costs: [{ label: 'Locks', cost: 3000, start: 0, end: 0 }],
};

test('weeks map to months and costs spread by week', () => {
  assert.equal(monthOfWeek(0), 1);
  assert.equal(monthOfWeek(4.3), 1);
  assert.equal(monthOfWeek(5), 2);
  const s = spread(1300, 0, 13);
  near(Object.values(s).reduce((a, b) => a + b, 0), 1300, 1e-6);
  assert.deepEqual(Object.keys(s), ['1', '2', '3']);
  assert.deepEqual(spread(500, 6, 6), { 2: 500 });
});

test('optional unit only counts when the building unit count includes it; occupied units pay from month 1', () => {
  assert.equal(unitSchedule({ ...B, units: 3 }, P).length, 3);
  const u = unitSchedule(B, P);
  assert.equal(u.length, 4);
  assert.deepEqual(u.map((x) => [x.id, x.startMonth]), [['C', 1], ['A', 4], ['B', 5], ['D', 7]]);
});

test('Airbnb units are the first rent-ready vacant units and start sooner', () => {
  const u = unitSchedule({ ...B, strUnits: 1 }, { ...P, strSetupWeeks: 1 });
  const a = u.find((x) => x.id === 'A');
  assert.equal(a.mode, 'str');
  assert.equal(a.startMonth, 3);
  assert.equal(u.find((x) => x.id === 'C').mode, 'ltr');
});

test('lease option: seller payment scales with units renting, credits come off the price, refi pays everyone', () => {
  const p = monthlyPlan('master_lease', { payment: 2000, optionPrice: 100000, sellerAdvances: 2000, creditPct: 100, exerciseClosing: 1000 }, B, P);
  const r1 = p.rows[0];
  assert.equal(r1.stage, 'vacant');
  near(r1.collected, 1000, 1e-6);
  near(r1.seller, 500, 1e-6); // 1 of 4 units renting
  near(r1.noi, 1000 - 100 - 1000, 1e-6);
  near(r1.costTotal, 3000 + spread(1000, 0, 5)[1] + spread(1000, 0, 13)[1] + spread(2000, 0, 20)[1], 1e-6);
  assert.ok(r1.fromPool > 0 && r1.fromPool <= 2000);
  assert.equal(p.rows[6].stage, 'full');
  near(p.rows[6].seller, 2000, 1e-6);
  const credits = p.rows.slice(0, 10).reduce((s, r) => s + r.seller, 0);
  assert.equal(p.exit.month, 10);
  near(p.exit.sellerPayoff, 102000 - credits, 1e-6);
  near(p.exit.left, p.full.refiNet - p.exit.sellerPayoff - p.exit.lenderPayoff - 1000, 1e-6);
  near(p.exit.maxSellerPayoff, p.full.refiNet - p.exit.lenderPayoff - 1000, 1e-6);
  near(p.totals.sellerTotal, 102000, 1e-6); // with 100% credit the seller's total is the locked price plus what they fronted
  assert.equal(p.rows[10].stage, 'after');
  near(p.rows[10].bank, p.full.refiPayment, 1e-6);
  near(p.rows[10].seller, 0, 1e-6);
});

test('short-term lender covers the gap, charges interest the next month and is paid off at the refi', () => {
  const p = monthlyPlan('wrap', { note: 120000, rate: 6 }, B, P);
  const first = p.rows.find((r) => r.draw > 0);
  const next = p.rows[first.month];
  near(next.interest, (first.lender * 12) / 100 / 12, 1e-6);
  near(p.rows[0].seller, 600, 1e-6);
  near(p.exit.lenderPayoff, p.rows[8].lender, 1e-6);
  assert.equal(p.rows[9].lender, 0);
  near(p.totals.peakLender, Math.max(...p.rows.map((r) => r.lender), p.exit.lenderPayoff), 1e-6);
});

test('partnership buys out at its own month for buyout + advances', () => {
  const p = monthlyPlan('partnership', { buyout: 90000, sellerAdvances: 5000, stepUp: 800, monthsToBuyout: 8, closing: 2000 }, B, P);
  assert.equal(p.exit.month, 8);
  near(p.exit.sellerPayoff, 95000, 1e-6);
  near(p.rows[0].seller, 200, 1e-6);
  const d = derivations(p).find(([k]) => k === 'Buyout')[1];
  assert.match(d, /\$90,000 locked buyout \+ \$5,000/);
});

test('cash: bank payment from month 1, no refi, seller paid the price at closing', () => {
  const p = monthlyPlan('cash', { price: 200000, downPct: 25, rate: 6, years: 30, closingPct: 2 }, B, P);
  assert.equal(p.exit, null);
  near(p.rows[0].bank, p.bankPayment, 1e-6);
  near(p.totals.sellerTotal, 200000, 1e-6);
  assert.ok(p.totals.buyerCashTotal >= 54000);
  assert.ok(p.rows.every((r) => r.draw === 0));
});

test('full stage matches the building math when every unit rents long-term', () => {
  const p = monthlyPlan('wrap', { note: 1, rate: 0 }, B, P);
  const o = operating(B);
  near(p.full.noi * 12, o.noi, 1e-6);
  near(p.full.refiLoan, o.refiLoan, 1e-6);
});

test('bad plan data falls back to blanks; rent options compare per unit after vacancy and management', () => {
  const n = normalizePlan('not json');
  assert.deepEqual(n.units, []);
  const s = rentStrategy({ ...B, vacancyPct: 10 }, { rentOptions: [{ key: 'std', label: 'Standard', rent: 1200 }] });
  near(s.options.find((o) => o.key === 'std').net, 1200 * 0.9 * 0.9, 1e-6);
  assert.equal(s.best.key, 'std');
});
