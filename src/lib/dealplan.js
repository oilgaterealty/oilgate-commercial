// Month-by-month deal plan. Pure functions, no network.
// One shared model: the building numbers (models.base), each offer's terms (offers) and the owner's
// plan inputs (unit schedule, one-time costs, lender terms) all flow through here, so every page that
// shows a plan updates the moment any input changes. Real deal numbers live only in the owner's private
// database row, never in this public code. Defaults below are blank templates.
import { BASE_DEFAULTS, operating, strMonthly, pmt, pv, STRUCTURES } from './dealmath.js';

export const WEEKS_PER_MONTH = 52 / 12;

export const PLAN_DEFAULTS = {
  months: 24, // how many months the table runs
  refiMonth: 12, // month the bank refinance closes (lease and wrap). Partnership uses its own buyout month.
  leaseUpWeeks: 4, // from rent-ready to a signed lease and a passed inspection
  strSetupWeeks: 2, // from rent-ready to the first Airbnb guest
  strFurnishPerUnit: 0, // one-time furnishing per Airbnb unit
  rehabStartWeek: 0, // when unit work begins
  lenderRate: 0, // short-term lender, interest only, % per year
  lenderPoints: 0, // % of each draw
  lenderSeasoningMonths: null, // months of stabilized operations required by lender, null until confirmed
  lenderEligibilityConfirmed: false, // whether a permanent lender has confirmed refinance eligibility
  sellerLoanBalance: 0, // what the seller still owes their bank (estimate)
  sellerLoanRate: 0,
  sellerLoanYears: 30,
  units: [], // { id, rehab, ready (week), occupied, rent, optional, note }
  costs: [], // { label, cost, start (week), end (week), group }
  rentOptions: [], // { key, label, rent } long-term rent levels to compare (e.g. payment standards)
};

const num = (v, d = 0) => (Number.isFinite(+v) && v !== '' && v !== null && v !== undefined ? +v : d);
export const monthOfWeek = (w) => Math.floor(Math.max(0, num(w)) / WEEKS_PER_MONTH) + 1;

// Spread a cost over weeks [start, end) and return { month: amount }.
export function spread(cost, start, end) {
  cost = num(cost); start = Math.max(0, num(start)); end = num(end, start);
  const out = {};
  if (!cost) return out;
  if (end <= start) { out[monthOfWeek(start)] = cost; return out; }
  const span = end - start;
  for (let m = monthOfWeek(start); m <= monthOfWeek(end - 1e-9); m++) {
    const a = Math.max(start, (m - 1) * WEEKS_PER_MONTH), b = Math.min(end, m * WEEKS_PER_MONTH);
    if (b > a) out[m] = (out[m] || 0) + (cost * (b - a)) / span;
  }
  return out;
}

export function normalizePlan(raw) {
  let p = raw;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
  p = p && typeof p === 'object' ? p : {};
  const out = { ...PLAN_DEFAULTS };
  for (const k of Object.keys(PLAN_DEFAULTS)) {
    if (Array.isArray(PLAN_DEFAULTS[k]) || k === 'lenderSeasoningMonths' || k === 'lenderEligibilityConfirmed') continue;
    if (p[k] !== undefined) out[k] = num(p[k], PLAN_DEFAULTS[k]);
  }
  out.lenderSeasoningMonths = p.lenderSeasoningMonths !== undefined && p.lenderSeasoningMonths !== null && p.lenderSeasoningMonths !== '' && Number.isFinite(+p.lenderSeasoningMonths) && +p.lenderSeasoningMonths >= 0
    ? +p.lenderSeasoningMonths
    : null;
  out.lenderEligibilityConfirmed = Boolean(p.lenderEligibilityConfirmed);
  out.units = (Array.isArray(p.units) ? p.units : []).map((u) => ({ id: String(u.id ?? ''), rehab: num(u.rehab), ready: num(u.ready), occupied: !!u.occupied, rent: u.rent === undefined || u.rent === null || u.rent === '' ? null : num(u.rent), optional: !!u.optional, note: u.note ? String(u.note) : '' }));
  out.costs = (Array.isArray(p.costs) ? p.costs : []).map((c) => ({ label: String(c.label ?? ''), cost: num(c.cost), start: num(c.start), end: num(c.end, num(c.start)), group: c.group ? String(c.group) : 'other' }));
  out.rentOptions = (Array.isArray(p.rentOptions) ? p.rentOptions : []).map((r) => ({ key: String(r.key ?? r.label ?? ''), label: String(r.label ?? ''), rent: num(r.rent) }));
  out.sources = p.sources && typeof p.sources === 'object' ? p.sources : {};
  return out;
}

// Which units are in the plan, in lease-up order, and when each starts paying.
export function unitSchedule(baseIn, planIn) {
  const o = operating(baseIn);
  const plan = normalizePlan(planIn);
  const required = plan.units.filter((u) => !u.optional);
  const optional = plan.units.filter((u) => u.optional);
  const extra = Math.max(0, o.b.units - required.length);
  const hasEditableTenth = baseIn && baseIn.tenthUnitRepair !== undefined && baseIn.tenthUnitRepair !== null && baseIn.tenthUnitRepair !== '';
  const pickedOptional = optional.slice(0, extra).map((u) => {
    const rehab = hasEditableTenth ? num(baseIn.tenthUnitRepair, BASE_DEFAULTS.tenthUnitRepair) : (u.rehab > 0 ? u.rehab : BASE_DEFAULTS.tenthUnitRepair);
    return { ...u, rehab };
  });
  const chosen = [...required, ...pickedOptional];
  if (o.b.units >= 10 && plan.units.length > 0 && chosen.length === 9 && optional.length === 0) {
    const maxReady = chosen.reduce((m, u) => Math.max(m, u.ready), 0);
    chosen.push({
      id: '10',
      rehab: hasEditableTenth ? num(baseIn.tenthUnitRepair, BASE_DEFAULTS.tenthUnitRepair) : BASE_DEFAULTS.tenthUnitRepair,
      ready: maxReady || 16,
      occupied: false,
      rent: null,
      optional: true,
      note: 'Unit 10 rehab (subject to approvals)',
    });
  }
  const strCount = o.strUnits;
  const byReady = [...chosen].sort((a, b) => (a.occupied - b.occupied) || (a.ready - b.ready));
  const strIds = new Set(byReady.filter((u) => !u.occupied).slice(0, strCount).map((u) => u.id));
  return chosen.map((u) => {
    const str = strIds.has(u.id);
    const startMonth = u.occupied ? 1 : monthOfWeek(u.ready + (str ? plan.strSetupWeeks : plan.leaseUpWeeks)) + 1;
    return { ...u, mode: str ? 'str' : 'ltr', rent: u.rent ?? o.b.rent, startMonth };
  }).sort((a, b) => a.startMonth - b.startMonth || a.ready - b.ready);
}

// Monthly money from one renting unit, after vacancy and platform fees (before management).
const unitCollected = (u, b, str) => (u.mode === 'str' ? str.collected : u.rent * (1 - b.vacancyPct / 100));

function sellerPayoff(structure, x, credits) {
  if (structure === 'master_lease') return Math.max(0, x.optionPrice + x.sellerAdvances - credits);
  if (structure === 'wrap') return x.note;
  if (structure === 'partnership') return x.buyout + x.sellerAdvances;
  return 0;
}

export function monthlyPlan(structure, inputsIn = {}, baseIn = {}, planIn = {}) {
  const o = operating(baseIn);
  const b = o.b;
  const plan = normalizePlan(planIn);
  const str = strMonthly(b);
  const def = STRUCTURES[structure]?.defaults || {};
  const x = { ...def, ...Object.fromEntries(Object.entries(inputsIn || {}).map(([k, v]) => [k, num(v, def[k])])) };
  const units = unitSchedule(baseIn, plan);
  const total = units.length;
  const fixedMo = (b.taxes + b.insurance + b.utilities + b.admin + b.turns) / 12;

  // One-time costs by month: every listed cost, each unit's rent-ready work, Airbnb furnishing.
  const oneTime = {};
  const items = [];
  const add = (label, group, cost, start, end) => {
    if (!num(cost)) return;
    items.push({ label, group, cost: num(cost), start, end });
    for (const [m, v] of Object.entries(spread(cost, start, end))) (oneTime[m] ||= []).push({ label, group, amount: v });
  };
  for (const c of plan.costs) add(c.label, c.group, c.cost, c.start, c.end);
  for (const u of units) {
    add(`Unit ${u.id} rent-ready work`, 'units', u.rehab, Math.min(plan.rehabStartWeek, u.ready), u.ready);
    if (u.mode === 'str') add(`Unit ${u.id} Airbnb furnishing`, 'units', plan.strFurnishPerUnit, u.ready, u.ready);
  }
  if (structure === 'cash') items.unshift({ label: 'Down payment and closing', group: 'closing', cost: x.price * (x.downPct / 100 + x.closingPct / 100), start: 0, end: 0 });

  // Stabilized: every unit renting. Sizes the bank refinance and the "full" stage.
  const fullCollected = units.reduce((s, u) => s + unitCollected(u, b, str), 0);
  const fullStrCosts = units.filter((u) => u.mode === 'str').length * b.strCostsMo;
  const fullNoi = fullCollected * (1 - b.mgmtPct / 100) - fixedMo - fullStrCosts;
  const fullReserves = (total * b.reservesPerUnit) / 12;
  const fullCashFlow = fullNoi - fullReserves;
  const refiLoan = Math.min(Math.max(0, pv(b.refiRate, b.refiYears, fullCashFlow / b.refiDscr)), (b.refiLtv / 100) * b.value);
  const refiNet = refiLoan - (refiLoan * b.refiFeesPct) / 100 - b.refiFeesFlat - b.refiReserve;
  const refiPayment = pmt(b.refiRate, b.refiYears, refiLoan);

  const bankLoan = structure === 'cash' ? x.price * (1 - x.downPct / 100) : 0;
  const bankPayment = structure === 'cash' ? pmt(x.rate, x.years, bankLoan) : 0;
  const exitMonth = structure === 'cash' ? null : structure === 'partnership' ? Math.max(1, Math.round(x.monthsToBuyout)) : Math.max(1, Math.round(plan.refiMonth));
  const exitClosing = structure === 'master_lease' ? x.exerciseClosing : structure === 'partnership' ? x.closing : 0;
  const sellerLoanPayment = plan.sellerLoanBalance > 0 && plan.sellerLoanRate > 0 ? pmt(plan.sellerLoanRate, plan.sellerLoanYears, plan.sellerLoanBalance) : 0;

  const advancesStart = structure === 'master_lease' || structure === 'partnership' ? x.sellerAdvances : 0;
  const startingBuyerCash = structure === 'cash' ? items[0].cost : num(x.buyerCash);
  let sellerPool = advancesStart;
  let buyerPool = structure === 'cash' ? 0 : num(x.buyerCash);
  let lender = 0, credits = 0, refied = false;
  let peakLender = 0, interestTotal = 0, pointsTotal = 0, sellerTotal = structure === 'cash' ? x.price : 0, buyerKeepsTotal = 0, buyerCashTotal = startingBuyerCash, oneTimeTotal = 0;
  const rows = [];
  let exit = null;

  for (let m = 1; m <= plan.months; m++) {
    const renting = units.filter((u) => u.startMonth <= m);
    const collected = renting.reduce((s, u) => s + unitCollected(u, b, str), 0);
    const mgmt = collected * (b.mgmtPct / 100);
    const strCosts = renting.filter((u) => u.mode === 'str').length * b.strCostsMo;
    const operatingCosts = fixedMo + strCosts + mgmt;
    const noi = collected - operatingCosts;
    const reserves = (renting.length * b.reservesPerUnit) / 12;
    const share = total ? renting.length / total : 0;

    let seller = 0, bank = 0;
    if (refied) bank = refiPayment;
    else if (structure === 'master_lease') seller = x.payment * share;
    else if (structure === 'partnership') seller = x.stepUp * share;
    else if (structure === 'wrap') seller = x.amortYears > 0 ? pmt(x.rate, x.amortYears, x.note) : (x.note * x.rate) / 100 / 12;
    if (structure === 'cash') bank = bankPayment;
    if (structure === 'master_lease' && !refied) credits += (seller * x.creditPct) / 100;

    const interest = (lender * plan.lenderRate) / 100 / 12;
    const costs = oneTime[m] || [];
    const costTotal = costs.reduce((s, c) => s + c.amount, 0);
    let net = noi - reserves - seller - bank - interest - costTotal;

    let fromPool = 0, draw = 0, points = 0, keeps = 0, refi = null;
    if (net < 0) {
      const fromSellerPool = Math.min(sellerPool, -net); sellerPool -= fromSellerPool; net += fromSellerPool;
      const fromBuyerPool = Math.min(buyerPool, -net); buyerPool -= fromBuyerPool; net += fromBuyerPool;
      fromPool = fromSellerPool + fromBuyerPool;
      if (net < 0) {
        if (structure === 'cash') { buyerCashTotal += -net; } else {
          const f = 1 - plan.lenderPoints / 100;
          draw = f > 0 ? -net / f : -net; points = draw - -net; lender += draw;
        }
        net = 0;
      }
    } else keeps = net;

    // Measure peak bridge balance before the refinance payoff clears it to zero.
    const lenderBeforePayoff = lender;
    peakLender = Math.max(peakLender, lenderBeforePayoff);

    if (exitMonth === m && !refied) {
      const payoff = sellerPayoff(structure, x, credits);
      const due = payoff + lenderBeforePayoff + exitClosing;
      refi = { loan: refiLoan, net: refiNet, sellerPayoff: payoff, lenderPayoff: lenderBeforePayoff, closing: exitClosing, left: refiNet - due, maxSellerPayoff: refiNet - lenderBeforePayoff - exitClosing };
      sellerTotal += payoff; lender = 0; refied = true;
      if (refi.left >= 0) keeps += refi.left; else buyerCashTotal += -refi.left;
      exit = { month: m, ...refi, credits };
    }

    interestTotal += interest; pointsTotal += points; sellerTotal += seller; oneTimeTotal += costTotal;
    buyerKeepsTotal += refi && refi.left > 0 ? keeps - refi.left : keeps;
    const exitCash = exit && !refi && exit.left > 0 ? exit.left : 0;
    const stage = refied ? 'after' : renting.length >= total ? 'full' : renting.length > units.filter((u) => u.occupied).length ? 'partial' : 'vacant';
    rows.push({
      month: m, stage, renting: renting.length, total, rentingIds: renting.map((u) => u.id), newIds: renting.filter((u) => u.startMonth === m).map((u) => u.id),
      collected, mgmt, fixed: fixedMo, strCosts, noi, reserves, seller, bank, interest, costs, costTotal,
      fromPool, draw, points, lender, lenderBeforePayoff, keeps, refi, cumulative: buyerKeepsTotal + (refi && refi.left > 0 ? refi.left : 0) + exitCash - buyerCashTotal, sellerGap: sellerLoanPayment ? seller - sellerLoanPayment : null,
    });
  }

  const stabilizedMonth = units.length ? Math.max(...units.map((u) => u.startMonth)) : null;
  const readyBeforeExpected = stabilizedMonth !== null && exitMonth !== null && stabilizedMonth <= exitMonth;
  const monthsStabilizedAtRefi = stabilizedMonth !== null && exitMonth !== null ? Math.max(0, exitMonth - stabilizedMonth + 1) : 0;
  const seasoningRequired = plan.lenderSeasoningMonths;
  const seasoningMet = seasoningRequired === null ? null : monthsStabilizedAtRefi >= seasoningRequired;
  const lenderConfirmed = Boolean(plan.lenderEligibilityConfirmed);
  const eligibilityStatus = !exitMonth ? 'none'
    : !readyBeforeExpected ? 'not_stabilized'
    : !lenderConfirmed ? 'unconfirmed'
    : seasoningMet === false ? 'seasoning_short'
    : 'eligible';
  const eligibility = {
    expectedRefiMonth: exitMonth,
    stabilizedMonth,
    readyBeforeExpected,
    monthsStabilizedAtRefi,
    seasoningRequired,
    seasoningMet,
    lenderConfirmed,
    status: eligibilityStatus,
    arvCase: total >= 10 ? 'stabilized_10_subject_to_approvals' : 'as_is_9',
  };

  const stages = ['vacant', 'partial', 'full', 'after'].map((key) => {
    const rs = rows.filter((r) => r.stage === key && !r.refi);
    if (!rs.length) return { key, from: null, to: null };
    const last = rs[rs.length - 1];
    return { key, from: rs[0].month, to: last.month, renting: last.renting, collected: last.collected, noi: last.noi, seller: last.seller, bank: last.bank, interest: last.interest, keeps: last.noi - last.reserves - last.seller - last.bank - last.interest, sellerGap: last.sellerGap };
  });

  return {
    structure, inputs: x, operating: o, plan, units, items, rows, stages, exit, eligibility,
    full: { collected: fullCollected, noi: fullNoi, reserves: fullReserves, cashFlow: fullCashFlow, refiLoan, refiNet, refiPayment, refiLimitedBy: pv(b.refiRate, b.refiYears, fullCashFlow / b.refiDscr) < (b.refiLtv / 100) * b.value ? 'DSCR' : 'LTV' },
    totals: { sellerTotal, sellerNet: plan.sellerLoanBalance ? sellerTotal - plan.sellerLoanBalance : null, buyerKeepsTotal, refiCashOut: exit && exit.left > 0 ? exit.left : 0, startingBuyerCash, unusedBuyerPool: buyerPool, buyerCashTotal, peakLender, interestTotal, pointsTotal, oneTimeTotal, advancesUsed: advancesStart - sellerPool, cashPrice: structure === 'cash' ? x.price : null },
    sellerLoanPayment, bankLoan, bankPayment,
  };
}

// Compare long-term rent levels and Airbnb for one unit, per month, after vacancy, fees and management.
export function rentStrategy(baseIn = {}, planIn = {}) {
  const o = operating(baseIn);
  const b = o.b, s = strMonthly(b), plan = normalizePlan(planIn);
  const keep = (collected, extra = 0) => collected * (1 - b.mgmtPct / 100) - extra;
  const longTerm = [{ key: 'market', label: 'Market rent', rent: b.rent }, ...plan.rentOptions].filter((r) => r.rent > 0).map((r) => ({ ...r, mode: 'ltr', collected: r.rent * (1 - b.vacancyPct / 100), net: keep(r.rent * (1 - b.vacancyPct / 100)) }));
  const airbnb = b.strNightly > 0 ? [{ key: 'str', label: 'Airbnb', mode: 'str', rent: s.gross, collected: s.collected, net: keep(s.collected, b.strCostsMo), nights: s.nights }] : [];
  const best = [...longTerm, ...airbnb].sort((a, z) => z.net - a.net)[0] || null;
  return { options: [...longTerm, ...airbnb], best, furnish: plan.strFurnishPerUnit };
}

// Plain lines that show how each headline number is built. Shown only in tap/hover overlays.
export function derivations(p) {
  const x = p.inputs, $ = (v) => (Number.isFinite(v) ? (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US') : '—');
  const L = [];
  const full = p.full;
  L.push(['Rent once full', `${p.units.length} units collect ${$(full.collected)}/mo after vacancy and fees. Less management, taxes, insurance, utilities, admin and turns leaves ${$(full.noi)}/mo. Less reserves leaves ${$(full.cashFlow)}/mo before any payment.`]);
  if (p.structure === 'master_lease') {
    L.push(['Seller payment', `${$(x.payment)}/mo is the payment once all ${p.units.length} units rent. Each month the seller gets that times the share of units renting, so it grows as units fill. ${x.creditPct}% of every payment comes off the price.`]);
    if (p.exit) L.push(['Buy price', `${$(x.optionPrice)} locked price + ${$(x.sellerAdvances)} the seller fronted − ${$(p.exit.credits)} already credited = ${$(p.exit.sellerPayoff)} due in month ${p.exit.month}.`]);
  }
  if (p.structure === 'partnership') {
    L.push(['Seller payment', `${$(x.stepUp)}/mo once all ${p.units.length} units rent, scaled by the share renting until then.`]);
    L.push(['Buyout', `${$(x.buyout)} locked buyout + ${$(x.sellerAdvances)} paid back for what the seller fronted = ${$(x.buyout + x.sellerAdvances)}, paid in month ${Math.round(x.monthsToBuyout)} from the refinance.`]);
  }
  if (p.structure === 'wrap') L.push(['Seller payment', `${$(x.note)} owed × ${x.rate}% ÷ 12 = ${$((x.note * x.rate) / 1200)}/mo from month 1${x.amortYears > 0 ? `, paid down over ${x.amortYears} years` : ', interest only'}. The balance is paid in full at the refinance.`]);
  if (p.structure === 'cash') L.push(['Bank payment', `${$(p.bankLoan)} loan at ${x.rate}% over ${x.years} years = ${$(p.bankPayment)}/mo from month 1.`]);
  if (p.totals.startingBuyerCash > 0 || p.totals.buyerCashTotal > 0) {
    L.push(['Buyer cash', `${$(p.totals.startingBuyerCash)} starting buyer-funded cash${p.exit && p.exit.left < 0 ? ` + ${$(-p.exit.left)} needed at refinance` : ''} = ${$(p.totals.buyerCashTotal)} total buyer cash in.`]);
  }
  if (p.exit) {
    L.push(['Refinance', `${$(full.refiLoan)} loan (limited by ${full.refiLimitedBy === 'LTV' ? 'value' : 'rent coverage'}) − fees and holdback = ${$(full.refiNet)}. Pays the seller ${$(p.exit.sellerPayoff)}, the short-term lender ${$(p.exit.lenderPayoff)}${p.exit.closing ? ` and ${$(p.exit.closing)} closing` : ''}. ${p.exit.left >= 0 ? `${$(p.exit.left)} left over to you.` : `${$(-p.exit.left)} short, which you would cover.`}`]);
  }
  if (p.eligibility && p.eligibility.expectedRefiMonth) {
    const el = p.eligibility;
    const msg = el.status === 'not_stabilized'
      ? `Expected refinance is month ${el.expectedRefiMonth}, but all ${p.units.length} units do not start collecting until month ${el.stabilizedMonth}.`
      : el.status === 'seasoning_short'
        ? `Expected refinance is month ${el.expectedRefiMonth} (${el.monthsStabilizedAtRefi} months stabilized), below the ${el.seasoningRequired}-month lender seasoning requirement.`
        : el.status === 'eligible'
          ? `Stabilizes month ${el.stabilizedMonth}; lender terms confirmed for month ${el.expectedRefiMonth}.`
          : `Expected refinance is month ${el.expectedRefiMonth} (all ${p.units.length} units paying by month ${el.stabilizedMonth}); actual refinance eligibility depends on confirmed lender underwriting, seasoning, and legal unit approvals.`;
    L.push(['Lender eligibility', msg]);
  }
  if (p.units.length >= 10) {
    L.push(['10-unit ARV case', 'Stabilized 10-unit case uses the editable Unit 10 rehab estimate once and remains subject to legal unit approvals and permanent financing.']);
  }
  if (p.totals.peakLender > 0) L.push(['Short-term lender', `Covers what rent and upfront funds don’t, peaking at ${$(p.totals.peakLender)} before refinance payoff. Interest ${$(p.totals.interestTotal)} + points ${$(p.totals.pointsTotal)} through the refinance.`]);
  if (p.sellerLoanPayment) L.push(['Seller’s own loan', `About ${$(p.sellerLoanPayment)}/mo on ${$(p.plan.sellerLoanBalance)} at ${p.plan.sellerLoanRate}% (estimate). Months where the seller gets less than that, they cover the difference.`]);
  return L;
}
