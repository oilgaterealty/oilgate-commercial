// Month-by-month deal plan. Pure functions, no network.
// One shared model: the building numbers (models.base), each offer's terms (offers) and the owner's
// plan inputs (unit schedule, one-time costs, lender terms) all flow through here, so every page that
// shows a plan updates the moment any input changes. Real deal numbers live only in the owner's private
// database row, never in this public code. Defaults below are blank templates.
import { BASE_DEFAULTS, operating, strMonthly, pmt, pv, STRUCTURES, money, valueSummary } from './dealmath.js';

export const WEEKS_PER_MONTH = 52 / 12;

export function ordinal(n) {
  const k = Math.abs(Math.round(n));
  const v = k % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[k % 10] || 'th');
  return `${k}${suffix}`;
}

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

// Owner-only helper so Offers never embeds the deal_plan settings key in public/seller builds.
export async function loadDealPlan(supabase, slug) {
  const { data: row, error } = await supabase.from('commercial_settings').select('value').eq('key', `deal_plan:${slug}`).maybeSingle();
  if (error) return null;
  return row ? normalizePlan(row.value) : null;
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
    arvCase: total >= 10 ? 'stabilized_10_subject_to_approvals' : 'nine_units',
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
          : `No lender has confirmed yet. Expected refinance is month ${el.expectedRefiMonth} (all ${p.units.length} units renting by month ${el.stabilizedMonth}). A lender still has to confirm terms and Unit 10 needs its zoning certificate; the math still runs on today’s numbers.`;
    L.push(['Lender eligibility', msg]);
  }
  if (p.units.length >= 10) {
    L.push(['10-unit value', '10-unit plan uses the editable Unit 10 rehab estimate once. A lender still has to confirm terms and Unit 10 needs its zoning certificate; the math still runs on today’s numbers.']);
  }
  if (p.totals.peakLender > 0) L.push(['Short-term lender', `Covers what rent and upfront funds don’t, peaking at ${$(p.totals.peakLender)} before refinance payoff. Interest ${$(p.totals.interestTotal)} + points ${$(p.totals.pointsTotal)} through the refinance.`]);
  if (p.sellerLoanPayment) L.push(['Seller’s own loan', `About ${$(p.sellerLoanPayment)}/mo on ${$(p.plan.sellerLoanBalance)} at ${p.plan.sellerLoanRate}% (estimate). Months where the seller gets less than that, they cover the difference.`]);
  return L;
}

// Build the full 7-step story and headline row for an offer from its monthlyPlan() result.
export function buildOfferStory(result, { base = {}, comps = [] } = {}) {
  const x = result.inputs;
  const b = result.operating.b;
  const o = result.operating;
  const plan = result.plan;
  const full = result.full;
  const exit = result.exit;
  const totals = result.totals;
  const rows = result.rows;
  const val = valueSummary({ base: { ...b, ...base }, noi: full.noi * 12, units: result.units.length || b.units, comps });
  const row1 = rows[0] || {
    renting: 0, total: result.units.length, seller: 0, bank: 0, interest: 0,
    noi: 0, reserves: 0, collected: 0, mgmt: 0, fixed: 0, strCosts: 0, fromPool: 0,
  };
  const advancesStart = result.structure === 'master_lease' || result.structure === 'partnership' ? x.sellerAdvances : 0;

  const usedSellerPool = advancesStart > 0 && rows.some((r) => r.fromPool > 0);
  const usedLender = totals.peakLender > 0;
  const coverParts = [];
  if (usedSellerPool) coverParts.push('the seller’s upfront money');
  if (usedLender) coverParts.push('the rehab loan');
  const coveredBy = coverParts.length ? coverParts.join(' and ') : 'your cash';

  // Headline: Your money in
  let moneyInValue = '$0';
  if (totals.buyerCashTotal > 0) {
    if (result.structure === 'cash') {
      moneyInValue = `${money(totals.buyerCashTotal)} (at closing)`;
    } else if (totals.startingBuyerCash <= 0 && exit && exit.left < 0) {
      moneyInValue = `${money(totals.buyerCashTotal)} (month ${exit.month} refi)`;
    } else if (totals.startingBuyerCash > 0 && exit && exit.left < 0) {
      moneyInValue = `${money(totals.buyerCashTotal)} (day 1 + month ${exit.month})`;
    } else {
      moneyInValue = `${money(totals.buyerCashTotal)} (month 1)`;
    }
  }
  const moneyInOverlay = totals.buyerCashTotal <= 0
    ? ['$0 upfront and $0 needed at refinance.']
    : [
        totals.startingBuyerCash > 0 ? `Upfront cash: ${money(totals.startingBuyerCash)}` : null,
        exit && exit.left < 0 ? `Needed at month ${exit.month} refinance: ${money(-exit.left)}` : null,
        result.structure === 'cash' && totals.buyerCashTotal > totals.startingBuyerCash
          ? `Added during lease-up: ${money(totals.buyerCashTotal - totals.startingBuyerCash)}`
          : null,
        `Total your money in: ${money(totals.buyerCashTotal)}.`,
      ].filter(Boolean);

  // Headline: Cash out at refinance
  const cashOutValue = !exit ? 'No refinance' : (exit.left >= 0 ? money(exit.left) : `Bring ${money(-exit.left)}`);
  const cashOutOverlay = !exit
    ? ['Straight bank loan from closing; no refinance planned.']
    : [`${money(exit.net)} net loan − ${money(exit.sellerPayoff)} seller − ${money(exit.lenderPayoff)} rehab lender${exit.closing ? ` − ${money(exit.closing)} closing` : ''} = ${money(exit.left)}.`];

  // Headline: Seller gets in total
  const monthlySellerSum = rows.reduce((s, r) => s + r.seller, 0);
  const payoffAtExit = exit ? exit.sellerPayoff : (result.structure === 'cash' ? x.price : 0);
  const sellerTotalOverlay = [
    `${money(monthlySellerSum)} in monthly payments + ${money(payoffAtExit)} at ${exit ? `month ${exit.month} refi` : 'closing'} = ${money(totals.sellerTotal)}.`,
    plan.sellerLoanBalance > 0 ? `Seller’s own loan is estimated at ${money(plan.sellerLoanBalance)} (${money(result.sellerLoanPayment)}/mo estimate).` : null,
  ].filter(Boolean);

  // Headline: Most seller can get at refi with $0 from you
  const maxSellerAtRefi = exit ? money(exit.maxSellerPayoff) : '—';
  const maxSellerOverlay = exit
    ? [`${money(exit.net)} net loan − ${money(exit.lenderPayoff)} rehab lender${exit.closing ? ` − ${money(exit.closing)} closing` : ''} = ${money(exit.maxSellerPayoff)}.`]
    : [];

  // Step 1: Take over (Month 1)
  const sellerFormula = result.structure === 'master_lease'
    ? `${money(x.payment)} full payment × ${row1.renting} of ${row1.total} units renting = ${money(row1.seller)}/mo (${x.creditPct}% credited toward ${money(x.optionPrice)} locked price).`
    : result.structure === 'partnership'
      ? `${money(x.stepUp)} full payment × ${row1.renting} of ${row1.total} units renting = ${money(row1.seller)}/mo.`
      : result.structure === 'wrap'
        ? `${money(x.note)} owed × ${x.rate}% ÷ 12 = ${money(row1.seller)}/mo from month 1${x.amortYears > 0 ? ` (${x.amortYears}-yr amort)` : ' (interest only)'} (seller loan terms are estimates).`
        : `${money(x.price)} paid to seller at closing; bank payment ${money(result.bankPayment)}/mo (${money(result.bankLoan)} at ${x.rate}% / ${x.years} yrs).`;

  const takeOverLines = [
    {
      label: 'Seller gets',
      value: result.structure === 'cash' ? `Paid ${money(x.price)} at closing` : `${money(row1.seller)}/mo`,
      overlay: [
        sellerFormula,
        result.sellerLoanPayment > 0 ? `Seller’s own loan: ${money(result.sellerLoanPayment)}/mo on ${money(plan.sellerLoanBalance)} at ${plan.sellerLoanRate}% (estimate).` : null,
      ].filter(Boolean),
    },
    {
      label: 'Seller fronts',
      value: money(advancesStart),
      overlay: [advancesStart > 0 ? `${money(advancesStart)} fronted up front for rehab and holding, paid back at the refinance.` : 'No upfront advance from the seller.'],
    },
  ];

  // Step 2: Rehab
  const rehabItems = result.items.filter((item) => item.group !== 'closing');
  const rehabTotal = rehabItems.reduce((s, item) => s + item.cost, 0);
  const rehabLines = [
    {
      label: 'Total rehab',
      value: money(rehabTotal),
      overlay: [
        ...rehabItems.map((item) => `${item.label}: ${money(item.cost)}`),
        `Total rehab: ${money(rehabTotal)}.`,
      ],
    },
  ];

  // Step 3: Holding cost per month while fixing up
  const holdingRows = rows.filter((r) => r.stage === 'vacant' || r.stage === 'partial');
  const hRows = holdingRows.length ? holdingRows : [row1];
  const avg = (fn) => hRows.reduce((s, r) => s + fn(r), 0) / hRows.length;
  const avgSeller = avg((r) => r.seller);
  const avgInterest = avg((r) => r.interest);
  const peakInterest = (totals.peakLender * plan.lenderRate) / 100 / 12;
  const taxesMo = b.taxes / 12;
  const insMo = b.insurance / 12;
  const utilMo = b.utilities / 12;
  const adminMo = b.admin / 12;
  const turnsMo = b.turns / 12;
  const holdingTotal = row1.seller + row1.bank + avgInterest + taxesMo + insMo + utilMo + adminMo + turnsMo;
  const fixupRow = rows.find((r) => r.stage === 'vacant') || row1;
  const fixupNet = fixupRow.noi - fixupRow.reserves - fixupRow.seller - fixupRow.bank - fixupRow.interest;

  const holdingOverlay = [
    `Seller payment (month 1): ${money(row1.seller)}/mo${Math.abs(avgSeller - row1.seller) >= 1 ? ` (avg ${money(avgSeller)}/mo while filling up)` : ''}${result.structure === 'wrap' ? ' (estimate)' : ''}`,
    row1.bank > 0 ? `Bank payment: ${money(row1.bank)}/mo` : null,
    `Short-term (rehab) loan interest: avg ${money(avgInterest)}/mo, up to ${money(peakInterest)}/mo at ${plan.lenderRate}% (estimate)`,
    result.sellerLoanPayment > 0 ? `Seller’s own loan: ${money(result.sellerLoanPayment)}/mo (estimate)` : null,
    `Taxes: ${money(taxesMo)}/mo`,
    `Insurance: ${money(insMo)}/mo`,
    `Utilities: ${money(utilMo)}/mo`,
    `Admin: ${money(adminMo)}/mo`,
    turnsMo > 0 ? `Turns: ${money(turnsMo)}/mo` : null,
    `Total holding cost per month: ${money(holdingTotal)}/mo.`,
  ].filter(Boolean);

  const holdingLines = [
    { label: 'Holding cost / mo', value: `${money(holdingTotal)}/mo`, overlay: holdingOverlay },
    {
      label: fixupNet < 0 ? `Short ${money(-fixupNet)} a month while fixing up (covered by ${coveredBy})` : 'Left over each month after every bill',
      value: fixupNet < 0 ? '' : `${money(fixupNet)}/mo`,
      tone: fixupNet < 0 ? 'fail' : 'pass',
      overlay: [`${money(fixupRow.collected)} rent − ${money(fixupRow.mgmt + fixupRow.fixed + fixupRow.strCosts + fixupRow.reserves)} running costs − ${money(fixupRow.seller + fixupRow.bank + fixupRow.interest)} payments & interest = ${money(fixupNet)}/mo.`],
    },
  ];

  // Step 4: Lease-up
  const leaseUpPills = result.units.map((u, idx) => ({
    label: `${ordinal(idx + 1)} Unit ${u.id} · month ${u.startMonth}${u.mode === 'str' ? ' · Airbnb' : ''}`,
    overlay: [`${money(u.rent)}/mo rent, ready week ${u.ready}, rent-ready work ${money(u.rehab)}`, u.note || null].filter(Boolean),
  }));

  // Step 5: Full
  const fullRunning = full.collected - full.noi + full.reserves;
  const fullSellerPay = result.structure === 'master_lease' ? x.payment : result.structure === 'partnership' ? x.stepUp : row1.seller;
  const fullPayment = exit ? fullSellerPay : result.bankPayment;
  const fullLeft = full.cashFlow - fullPayment;
  const fullSellerOverlay = result.structure === 'master_lease'
    ? [`${money(x.payment)} full payment × ${result.units.length} of ${result.units.length} units renting = ${money(fullPayment)}/mo.`]
    : result.structure === 'partnership'
      ? [`${money(x.stepUp)} full payment × ${result.units.length} of ${result.units.length} units renting = ${money(fullPayment)}/mo.`]
      : [sellerFormula];

  const fullLines = [
    { label: 'Rent in', value: `${money(full.collected)}/mo`, overlay: [`${result.units.length} units after ${b.vacancyPct}% vacancy${o.strUnits ? ` (${o.strUnits} Airbnb)` : ''} = ${money(full.collected)}/mo.`] },
    { label: 'Running costs', value: `${money(fullRunning)}/mo`, overlay: [`Management ${money(full.collected * (b.mgmtPct / 100))}/mo + fixed bills ${money((b.taxes + b.insurance + b.utilities + b.admin + b.turns) / 12)}/mo + reserves ${money(full.reserves)}/mo = ${money(fullRunning)}/mo.`] },
    { label: result.structure === 'cash' ? 'Bank payment' : 'Seller payment', value: `${money(fullPayment)}/mo`, overlay: fullSellerOverlay },
    {
      label: fullLeft >= 0 ? 'Left over each month after every bill' : `Short ${money(-fullLeft)} a month (covered by ${coveredBy})`,
      value: fullLeft >= 0 ? `${money(fullLeft)}/mo` : '',
      tone: fullLeft >= 0 ? 'pass' : 'fail',
      overlay: [`${money(full.collected)} rent − ${money(fullRunning)} running costs − ${money(fullPayment)} payment = ${money(fullLeft)}/mo.`],
    },
  ];

  // Step 6: Refinance
  const refiLines = !exit
    ? [
        { label: val.incomeLine, value: '', overlay: val.incomeOverlay },
        ...(val.compsLine ? [{ label: val.compsLine, value: '', overlay: val.compsOverlay }] : []),
        { label: 'No refinance', value: `${money(result.bankLoan)} loan at closing`, overlay: ['Straight bank loan from day 1; no refinance planned.'] },
      ]
    : [
        {
          label: val.incomeLine,
          value: '',
          overlay: [
            ...val.incomeOverlay,
            !result.eligibility?.lenderConfirmed ? 'No lender has confirmed yet. A lender still has to confirm terms and Unit 10 needs its zoning certificate; the math still runs on today’s numbers.' : null,
          ].filter(Boolean),
        },
        ...(val.compsLine ? [{ label: val.compsLine, value: '', overlay: val.compsOverlay }] : []),
        { label: 'Loan', value: money(exit.loan), overlay: [`${money(exit.loan)} (${full.refiLimitedBy === 'LTV' ? `${b.refiLtv}% of value` : `${b.refiDscr}x rent coverage`}) − fees & holdback = ${money(exit.net)} net.`] },
        {
          label: 'Pays seller',
          value: money(exit.sellerPayoff),
          overlay: [
            result.structure === 'master_lease'
              ? `${money(x.optionPrice)} locked price + ${money(x.sellerAdvances)} fronted − ${money(exit.credits)} credited = ${money(exit.sellerPayoff)}.`
              : result.structure === 'partnership'
                ? `${money(x.buyout)} buyout + ${money(x.sellerAdvances)} fronted = ${money(exit.sellerPayoff)}.`
                : `${money(x.note)} note payoff = ${money(exit.sellerPayoff)}.`,
          ],
        },
        {
          label: 'Pays rehab lender',
          value: money(exit.lenderPayoff),
          overlay: [`Peak rehab loan ${money(totals.peakLender)}; interest ${money(totals.interestTotal)} + points ${money(totals.pointsTotal)} at ${plan.lenderRate}% (estimate).`],
        },
        { label: 'Closing', value: money(exit.closing), overlay: [`Closing costs at refinance: ${money(exit.closing)}.`] },
        {
          label: exit.left >= 0 ? `You take home ${money(exit.left)}` : `You bring ${money(-exit.left)}`,
          value: '',
          big: true,
          tone: exit.left >= 0 ? 'pass' : 'fail',
          overlay: cashOutOverlay,
        },
      ];

  // Step 7: After
  const afterPayment = exit ? full.refiPayment : result.bankPayment;
  const afterLeft = full.cashFlow - afterPayment;
  const afterLines = [
    {
      label: afterLeft >= 0 ? 'Left over each month after every bill' : `Short ${money(-afterLeft)} a month after every bill`,
      value: afterLeft >= 0 ? `${money(afterLeft)}/mo` : '',
      tone: afterLeft >= 0 ? 'pass' : 'fail',
      overlay: [`${money(full.collected)} rent − ${money(fullRunning)} running costs − ${money(afterPayment)} bank payment (${exit ? `${b.refiRate}% / ${b.refiYears} yrs` : `${x.rate}% / ${x.years} yrs`}) = ${money(afterLeft)}/mo.`],
    },
  ];

  return {
    headline: {
      moneyIn: { label: 'Your money in', value: moneyInValue, overlay: moneyInOverlay },
      cashOut: { label: 'Cash out at refinance', value: cashOutValue, positive: exit ? exit.left >= 0 : null, overlay: cashOutOverlay },
      sellerTotal: { label: 'Seller gets in total', value: money(totals.sellerTotal), overlay: sellerTotalOverlay },
      maxSellerAtRefi: { label: 'Most the seller can get at refi with $0 from you', value: maxSellerAtRefi, overlay: maxSellerOverlay },
    },
    steps: [
      { num: 1, title: 'Take over', when: 'Month 1', lines: takeOverLines },
      { num: 2, title: 'Rehab', lines: rehabLines },
      { num: 3, title: 'Holding cost per month', lines: holdingLines },
      { num: 4, title: 'Lease-up', pills: leaseUpPills },
      { num: 5, title: 'Full', lines: fullLines },
      { num: 6, title: 'Refinance', when: exit ? `Month ${exit.month}` : 'No refinance', lines: refiLines },
      { num: 7, title: 'After', lines: afterLines },
    ],
    value: val,
    coveredBy,
  };
}
