// Month-by-month deal plan. Pure functions, no network.
// One shared model: the building numbers (models.base), each offer's terms (offers) and the owner's
// plan inputs (unit schedule, one-time costs, lender terms) all flow through here, so every page that
// shows a plan updates the moment any input changes. Real deal numbers live only in the owner's private
// database row, never in this public code. Defaults below are blank templates.
import { BASE_DEFAULTS, operating, pmt, pv, STRUCTURES, money, moneyK, sellerLoanText, valueSummary } from './dealmath.js';

export const WEEKS_PER_MONTH = 52 / 12;
export const OPTION_E_OVERLAY = 'His rehab money is only paid back through his share of the rent. It is not added to the buyout unless you turn that on.';

export function ordinal(n) {
  const k = Math.abs(Math.round(n));
  const v = k % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[k % 10] || 'th');
  return `${k}${suffix}`;
}

export const PLAN_DEFAULTS = {
  months: 24, // how many months the table runs
  refiMonth: 12, // month the bank refinance closes (lease, wrap, seller_rehab). Partnership uses its own buyout month.
  leaseUpWeeks: 4, // from rent-ready to a signed lease and a passed inspection
  rehabStartWeek: 0, // when unit work begins
  lenderRate: 0, // short-term lender, interest only, % per year
  lenderPoints: 0, // % of each draw
  contingency: 0, // repair contingency ($)
  lenderSeasoningMonths: null, // months of stabilized operations required by lender, null until confirmed
  lenderEligibilityConfirmed: false, // whether a permanent lender has confirmed refinance eligibility
  sellerLoanBalance: 0, // what the seller still owes their bank (estimate)
  sellerLoanRate: 0,
  sellerLoanYears: 30,
  refiTrigger: { allRented: true },
  units: [], // { id, rehab, ready (week), occupied, rent, optional, note }
  costs: [], // { label, cost, start (week), end (week), group }
  rentOptions: [], // legacy field preserved for normalization compatibility
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
    if (Array.isArray(PLAN_DEFAULTS[k]) || k === 'lenderSeasoningMonths' || k === 'lenderEligibilityConfirmed' || k === 'refiTrigger') continue;
    if (p[k] !== undefined) out[k] = num(p[k], PLAN_DEFAULTS[k]);
  }
  out.contingency = Math.max(0, num(p.contingency, 0));
  out.refiTrigger = {
    allRented: p.refiTrigger && typeof p.refiTrigger === 'object' && p.refiTrigger.allRented !== undefined
      ? Boolean(p.refiTrigger.allRented)
      : true,
  };
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

export function addedUnitOf(planIn) {
  const plan = normalizePlan(planIn);
  return plan.units.find((u) => u.optional) || null;
}

export function addedUnitId(planIn) {
  return addedUnitOf(planIn)?.id || '10';
}

// Owner-only helper so Offers never embeds the deal_plan settings key in public/seller builds.
export async function loadDealPlan(supabase, slug) {
  const { data: row, error } = await supabase.from('commercial_settings').select('value').eq('key', `deal_plan:${slug}`).maybeSingle();
  if (error) return null;
  return row ? normalizePlan(row.value) : null;
}

// Which units are in the plan, in lease-up order, and when each starts paying. Always includes the added unit.
export function unitSchedule(baseIn, planIn) {
  const o = operating(baseIn);
  const plan = normalizePlan(planIn);
  const hasEditableAdded = baseIn && baseIn.tenthUnitRepair !== undefined && baseIn.tenthUnitRepair !== null && baseIn.tenthUnitRepair !== '';
  const hasOptional = plan.units.some((u) => u.optional);
  const chosen = plan.units.map((u) => {
    if (!u.optional) return { ...u };
    const rehab = hasEditableAdded ? num(baseIn.tenthUnitRepair, BASE_DEFAULTS.tenthUnitRepair) : (u.rehab > 0 ? u.rehab : BASE_DEFAULTS.tenthUnitRepair);
    return { ...u, rehab };
  });
  if (!hasOptional && chosen.length === 9) {
    const maxReady = chosen.reduce((m, u) => Math.max(m, u.ready), 0);
    chosen.push({
      id: '10',
      rehab: hasEditableAdded ? num(baseIn.tenthUnitRepair, BASE_DEFAULTS.tenthUnitRepair) : BASE_DEFAULTS.tenthUnitRepair,
      ready: maxReady || 16,
      occupied: false,
      rent: null,
      optional: true,
      note: 'Unit 10 needs its zoning certificate',
    });
  }
  return chosen.map((u) => {
    const startMonth = u.occupied ? 1 : monthOfWeek(u.ready + plan.leaseUpWeeks) + 1;
    return { ...u, mode: 'ltr', rent: u.rent ?? o.b.rent, startMonth };
  }).sort((a, b) => a.startMonth - b.startMonth || a.ready - b.ready);
}

// Monthly money from one long-term renting unit, after vacancy (before management).
const unitCollected = (u, b) => u.rent * (1 - b.vacancyPct / 100);

function sellerPayoff(structure, x, credits, sellerLoanRemaining = 0) {
  if (structure === 'master_lease') return Math.max(0, x.optionPrice + x.sellerAdvances - credits);
  if (structure === 'wrap') return x.note;
  if (structure === 'partnership') return x.buyout + x.sellerAdvances;
  if (structure === 'seller_rehab') return sellerLoanRemaining + (x.addFundToBuyout ? num(x.sellerFund) : 0);
  return 0;
}

function capFirst(s) {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function joinLabels(labels) {
  const list = labels.map((s) => String(s || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return capFirst(list[0]);
  if (list.length === 2) return `${capFirst(list[0])} and ${list[1].toLowerCase()}`;
  return `${capFirst(list[0])}, ${list.slice(1, -1).map((x) => x.toLowerCase()).join(', ')}, and ${list.at(-1).toLowerCase()}`;
}

export function buildCostSummary(baseIn = {}, planIn = {}) {
  const plan = normalizePlan(planIn);
  const units = unitSchedule(baseIn, plan);
  const added = units.find((u) => u.optional) || null;
  const pricedUnits = units.filter((u) => num(u.rehab) > 0);
  const unitsTotal = pricedUnits.reduce((s, u) => s + num(u.rehab), 0);
  const topUnits = [...pricedUnits].sort((a, b) => b.rehab - a.rehab).slice(0, 2);
  const unitsInline = topUnits.map((u) => `Unit ${u.id} ${moneyK(u.rehab)}`).join(', ');
  const unitsOverlay = [
    ...pricedUnits.map((u) => `Unit ${u.id}${u.optional ? ' (added unit)' : ''}: ${money(u.rehab)}`),
    ...(added ? [`Unit ${added.id} needs its zoning certificate.`] : []),
    `Total units: ${money(unitsTotal)}.`,
  ];

  const systemsPriced = plan.costs.filter((c) => c.group === 'systems' && c.cost > 0);
  const buildingTotal = systemsPriced.reduce((s, c) => s + c.cost, 0);
  const buildingInline = systemsPriced.map((c) => `${c.label.toLowerCase()} ${moneyK(c.cost)}`).join(', ');
  const buildingOverlay = [
    ...systemsPriced.map((c) => `${c.label}: ${money(c.cost)}`),
    `Total building: ${money(buildingTotal)}.`,
  ];

  const setupItems = plan.costs.filter((c) => c.group !== 'systems' && c.cost > 0);
  const setupTotal = setupItems.reduce((s, c) => s + c.cost, 0);
  const setupInline = setupItems.slice(0, 4).map((c) => c.label.toLowerCase()).join(', ');
  const setupOverlay = [
    ...setupItems.map((c) => `${c.label}: ${money(c.cost)}`),
    `Total setup: ${money(setupTotal)}.`,
  ];

  const contingency = Math.max(0, num(plan.contingency, 0));
  const rehabTotal = unitsTotal + buildingTotal + setupTotal;
  const wholeTotal = rehabTotal + contingency;
  const heading = `Whole job about ${moneyK(wholeTotal)}`;
  const headingOverlay = [
    unitsTotal > 0 ? `Units: ${money(unitsTotal)}` : null,
    buildingTotal > 0 ? `Building: ${money(buildingTotal)}` : null,
    setupTotal > 0 ? `Setup: ${money(setupTotal)}` : null,
    contingency > 0 ? `Rehab subtotal: ${money(rehabTotal)}` : null,
    contingency > 0 ? `Contingency: ${money(contingency)}` : null,
    contingency > 0 ? `Total with contingency: ${money(wholeTotal)}.` : `Total job: ${money(wholeTotal)}.`,
  ].filter(Boolean);

  const lines = [
    ...(unitsTotal > 0 ? [{ key: 'units', label: `Units ${moneyK(unitsTotal)}`, detail: unitsInline, overlay: unitsOverlay }] : []),
    ...(buildingTotal > 0 ? [{ key: 'building', label: `Building ${moneyK(buildingTotal)}`, detail: buildingInline, overlay: buildingOverlay }] : []),
    ...(setupTotal > 0 ? [{ key: 'setup', label: `Setup about ${moneyK(setupTotal)}`, detail: setupInline, overlay: setupOverlay }] : []),
    ...(contingency > 0 ? [{ key: 'contingency', label: `Contingency ${moneyK(contingency)}`, detail: '', overlay: [`Repair contingency: ${money(contingency)}.`] }] : []),
  ];
  const partSummaries = lines.map((l) => l.label);
  const oneLine = partSummaries.length ? `${heading} — ${partSummaries.join(', ')}` : heading;
  return { total: wholeTotal, rehabTotal, contingency, heading, headingOverlay, oneLine, lines };
}

export function monthlyPlan(structure, inputsIn = {}, baseIn = {}, planIn = {}) {
  const o = operating(baseIn);
  const b = o.b;
  const plan = normalizePlan(planIn);
  const def = STRUCTURES[structure]?.defaults || {};
  const x = {
    ...def,
    ...Object.fromEntries(
      Object.entries(inputsIn || {}).map(([k, v]) => [k, typeof def[k] === 'boolean' ? Boolean(v) : num(v, def[k])])
    ),
  };
  const units = unitSchedule(baseIn, plan);
  const total = units.length;
  const fixedMo = (b.taxes + b.insurance + b.utilities + b.admin + b.turns) / 12;

  // One-time costs by month: every listed cost and each unit's rent-ready work (added unit counted once).
  const oneTime = {};
  const items = [];
  const add = (label, group, cost, start, end) => {
    const amt = num(cost);
    if (!amt) return;
    items.push({ label, group, cost: amt, start, end, toInspect: false });
    for (const [m, v] of Object.entries(spread(amt, start, end))) (oneTime[m] ||= []).push({ label, group, amount: v });
  };
  for (const c of plan.costs) add(c.label, c.group, c.cost, c.start, c.end);
  for (const u of units) {
    const label = u.optional ? `Unit ${u.id} (added unit) rehab` : `Unit ${u.id} rent-ready work`;
    add(label, 'units', u.rehab, Math.min(plan.rehabStartWeek, u.ready), u.ready);
  }
  if (structure === 'cash') items.unshift({ label: 'Down payment and closing', group: 'closing', cost: x.price * (x.downPct / 100 + x.closingPct / 100), start: 0, end: 0 });

  // Stabilized: every unit renting long-term. Sizes the bank refinance and the "full" stage.
  const fullCollected = units.reduce((s, u) => s + unitCollected(u, b), 0);
  const fullNoi = fullCollected * (1 - b.mgmtPct / 100) - fixedMo;
  const fullReserves = (total * b.reservesPerUnit) / 12;
  const fullCashFlow = fullNoi - fullReserves;
  const refiLoan = Math.min(Math.max(0, pv(b.refiRate, b.refiYears, fullCashFlow / b.refiDscr)), (b.refiLtv / 100) * b.value);
  const refiNet = refiLoan - (refiLoan * b.refiFeesPct) / 100 - b.refiFeesFlat - b.refiReserve;
  const refiPayment = pmt(b.refiRate, b.refiYears, refiLoan);

  const bankLoan = structure === 'cash' ? x.price * (1 - x.downPct / 100) : 0;
  const bankPayment = structure === 'cash' ? pmt(x.rate, x.years, bankLoan) : 0;
  const exitMonth = structure === 'cash'
    ? null
    : structure === 'partnership'
      ? Math.max(1, Math.round(x.monthsToBuyout))
      : structure === 'seller_rehab'
        ? Math.max(1, Math.round(num(inputsIn?.refiMonth) > 0 ? num(inputsIn.refiMonth) : plan.refiMonth))
        : Math.max(1, Math.round(plan.refiMonth));
  const exitClosing = structure === 'master_lease' ? x.exerciseClosing : (structure === 'partnership' || structure === 'seller_rehab') ? x.closing : 0;
  const sellerLoanPayment = plan.sellerLoanBalance > 0
    ? (plan.sellerLoanRate > 0 ? pmt(plan.sellerLoanRate, plan.sellerLoanYears, plan.sellerLoanBalance) : (plan.sellerLoanYears > 0 ? plan.sellerLoanBalance / (plan.sellerLoanYears * 12) : 0))
    : 0;

  const advancesStart = structure === 'master_lease' || structure === 'partnership' ? x.sellerAdvances : 0;
  const sellerFundStart = structure === 'seller_rehab' ? Math.max(0, num(x.sellerFund)) : 0;
  const startingBuyerCash = structure === 'cash' ? items[0].cost : num(x.buyerCash);
  let sellerPool = advancesStart;
  let sellerFundPool = sellerFundStart;
  let sellerLoanBal = Math.max(0, plan.sellerLoanBalance);
  let buyerPool = structure === 'cash' ? 0 : num(x.buyerCash);
  let lender = 0, credits = 0, refied = false;
  let peakLender = 0, interestTotal = 0, pointsTotal = 0, sellerTotal = structure === 'cash' ? x.price : 0, buyerKeepsTotal = 0, buyerCashTotal = startingBuyerCash, oneTimeTotal = 0;
  const rows = [];
  let exit = null;

  for (let m = 1; m <= plan.months; m++) {
    const renting = units.filter((u) => u.startMonth <= m);
    const collected = renting.reduce((s, u) => s + unitCollected(u, b), 0);
    const mgmt = collected * (b.mgmtPct / 100);
    const operatingCosts = fixedMo + mgmt;
    const noi = collected - operatingCosts;
    const reserves = (renting.length * b.reservesPerUnit) / 12;
    const share = total ? renting.length / total : 0;

    const interest = (lender * plan.lenderRate) / 100 / 12;
    const costs = oneTime[m] || [];
    const costTotal = costs.reduce((s, c) => s + c.amount, 0);

    let seller = 0, bank = 0, fromPool = 0, draw = 0, points = 0, keeps = 0, refi = null;

    if (structure === 'seller_rehab') {
      if (refied) {
        bank = refiPayment;
        let net = noi - reserves - bank - interest - costTotal;
        if (net < 0) {
          const fromBuyerPool = Math.min(buyerPool, -net); buyerPool -= fromBuyerPool; net += fromBuyerPool;
          fromPool = fromBuyerPool;
          if (net < 0) {
            const f = 1 - plan.lenderPoints / 100;
            draw = f > 0 ? -net / f : -net; points = draw - -net; lender += draw;
            net = 0;
          }
        } else {
          keeps = net;
        }
      } else {
        const loanInt = (sellerLoanBal * plan.sellerLoanRate) / 100 / 12;
        const paidSellerLoan = sellerLoanBal > 0 ? Math.min(sellerLoanPayment, sellerLoanBal + loanInt) : 0;
        if (sellerLoanBal > 0) {
          const principalPaid = Math.max(0, paidSellerLoan - loanInt);
          sellerLoanBal = Math.max(0, sellerLoanBal - principalPaid);
        }
        bank = paidSellerLoan;
        const extra = noi - reserves - paidSellerLoan - interest;
        let need = costTotal + (extra < 0 ? -extra : 0);
        if (need > 0) {
          const fromBuyer = Math.min(buyerPool, need); buyerPool -= fromBuyer; need -= fromBuyer;
          const fromSellerFund = Math.min(sellerFundPool, need); sellerFundPool -= fromSellerFund; need -= fromSellerFund;
          fromPool = fromBuyer + fromSellerFund;
          if (need > 0) {
            const f = 1 - plan.lenderPoints / 100;
            draw = f > 0 ? need / f : need; points = draw - need; lender += draw;
          }
        }
        if (extra > 0) {
          if (renting.length < x.fillTarget) {
            seller = extra;
            keeps = 0;
          } else {
            const buyerPct = Math.max(0, Math.min(100, x.buyerSplitPct)) / 100;
            keeps = extra * buyerPct;
            seller = extra - keeps;
          }
        }
      }
    } else {
      if (refied) bank = refiPayment;
      else if (structure === 'master_lease') seller = x.payment * share;
      else if (structure === 'partnership') seller = x.stepUp * share;
      else if (structure === 'wrap') seller = x.amortYears > 0 ? pmt(x.rate, x.amortYears, x.note) : (x.note * x.rate) / 100 / 12;
      if (structure === 'cash') bank = bankPayment;
      if (structure === 'master_lease' && !refied) credits += (seller * x.creditPct) / 100;

      let net = noi - reserves - seller - bank - interest - costTotal;
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
    }

    // Measure peak bridge balance before the refinance payoff clears it to zero.
    const lenderBeforePayoff = lender;
    peakLender = Math.max(peakLender, lenderBeforePayoff);

    if (exitMonth === m && !refied) {
      const payoff = sellerPayoff(structure, x, credits, sellerLoanBal);
      const due = payoff + lenderBeforePayoff + exitClosing;
      refi = {
        loan: refiLoan,
        net: refiNet,
        sellerPayoff: payoff,
        sellerLoanRemaining: structure === 'seller_rehab' ? sellerLoanBal : null,
        sellerFundInBuyout: structure === 'seller_rehab' && x.addFundToBuyout ? num(x.sellerFund) : 0,
        lenderPayoff: lenderBeforePayoff,
        closing: exitClosing,
        left: refiNet - due,
        maxSellerPayoff: refiNet - lenderBeforePayoff - exitClosing,
      };
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
      collected, mgmt, fixed: fixedMo, strCosts: 0, noi, reserves, seller, bank, interest, costs, costTotal,
      fromPool, draw, points, lender, lenderBeforePayoff, keeps, refi, cumulative: buyerKeepsTotal + (refi && refi.left > 0 ? refi.left : 0) + exitCash - buyerCashTotal,
      sellerGap: sellerLoanPayment ? (structure === 'seller_rehab' ? seller : seller - sellerLoanPayment) : null,
      sellerLoanRemaining: structure === 'seller_rehab' ? sellerLoanBal : null,
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
    arvCase: 'stabilized_10_subject_to_approvals',
  };

  const stages = ['vacant', 'partial', 'full', 'after'].map((key) => {
    const rs = rows.filter((r) => r.stage === key && !r.refi);
    if (!rs.length) return { key, from: null, to: null };
    const last = rs[rs.length - 1];
    return {
      key,
      from: rs[0].month,
      to: last.month,
      renting: last.renting,
      collected: last.collected,
      noi: last.noi,
      seller: last.seller,
      sellerAvg: rs.reduce((s, r) => s + r.seller, 0) / rs.length,
      bank: last.bank,
      interest: last.interest,
      keeps: last.noi - last.reserves - last.seller - last.bank - last.interest,
      sellerGap: last.sellerGap,
    };
  });

  return {
    structure, inputs: x, operating: o, plan, units, items, rows, stages, exit, eligibility,
    full: { collected: fullCollected, noi: fullNoi, reserves: fullReserves, cashFlow: fullCashFlow, refiLoan, refiNet, refiPayment, refiLimitedBy: pv(b.refiRate, b.refiYears, fullCashFlow / b.refiDscr) < (b.refiLtv / 100) * b.value ? 'DSCR' : 'LTV' },
    totals: {
      sellerTotal,
      sellerNet: plan.sellerLoanBalance ? sellerTotal - plan.sellerLoanBalance : null,
      buyerKeepsTotal,
      refiCashOut: exit && exit.left > 0 ? exit.left : 0,
      startingBuyerCash,
      unusedBuyerPool: buyerPool,
      buyerCashTotal,
      peakLender,
      interestTotal,
      pointsTotal,
      oneTimeTotal,
      advancesUsed: advancesStart - sellerPool,
      sellerFundUsed: sellerFundStart - sellerFundPool,
      cashPrice: structure === 'cash' ? x.price : null,
    },
    sellerLoanPayment, bankLoan, bankPayment,
  };
}

// Compare long-term rent levels for one unit, per month, after vacancy and management.
export function rentStrategy(baseIn = {}, planIn = {}) {
  const o = operating(baseIn);
  const b = o.b, plan = normalizePlan(planIn);
  const keep = (collected) => collected * (1 - b.mgmtPct / 100);
  const longTerm = [{ key: 'market', label: 'Market rent', rent: b.rent }, ...plan.rentOptions]
    .filter((r) => r.rent > 0)
    .map((r) => ({ ...r, mode: 'ltr', collected: r.rent * (1 - b.vacancyPct / 100), net: keep(r.rent * (1 - b.vacancyPct / 100)) }));
  const best = [...longTerm].sort((a, z) => z.net - a.net)[0] || null;
  return { options: longTerm, best };
}

// Plain lines that show how each headline number is built. Shown only in tap/hover overlays.
export function derivations(p) {
  const x = p.inputs, $ = (v) => (Number.isFinite(v) ? (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US') : '—');
  const L = [];
  const full = p.full;
  const addedId = addedUnitId(p.plan);
  L.push(['Rent once full', `${p.units.length} units collect ${$(full.collected)}/mo after vacancy. Less management, taxes, insurance, utilities, admin and turns leaves ${$(full.noi)}/mo. Less reserves leaves ${$(full.cashFlow)}/mo before any payment.`]);
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
  if (p.structure === 'seller_rehab') {
    L.push(['Seller payment', `Before ${x.fillTarget} units rent, the seller gets all extra cash after his loan payment and rehab loan interest. From ${x.fillTarget} units on, you get ${x.buyerSplitPct}% and the seller gets ${100 - x.buyerSplitPct}%. ${OPTION_E_OVERLAY}`]);
    if (p.exit) L.push(['Buyout', `Seller’s remaining loan balance ${sellerLoanText(p.exit.sellerLoanRemaining ?? 0, false)}${x.addFundToBuyout ? ` + ${$(x.sellerFund)} rehab money` : ''} = ${$(p.exit.sellerPayoff)}, paid in month ${p.exit.month} from the refinance.`]);
  }
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
          : `No lender has confirmed yet. Expected refinance is month ${el.expectedRefiMonth} (all ${p.units.length} units renting by month ${el.stabilizedMonth}). A lender still has to confirm terms and Unit ${addedId} needs its zoning certificate; the math still runs on today’s numbers.`;
    L.push(['Lender eligibility', msg]);
  }
  if (p.units.length >= 10) {
    L.push(['10-unit value', `10-unit plan uses the editable Unit ${addedId} (added unit) rehab estimate once. A lender still has to confirm terms and Unit ${addedId} needs its zoning certificate; the math still runs on today’s numbers.`]);
  }
  if (p.totals.peakLender > 0) L.push(['Short-term lender', `Covers what rent and upfront funds don’t, peaking at ${$(p.totals.peakLender)} before refinance payoff. Interest ${$(p.totals.interestTotal)} + points ${$(p.totals.pointsTotal)} through the refinance.`]);
  if (p.sellerLoanPayment) L.push(['Seller’s own loan', `About ${$(p.sellerLoanPayment)}/mo on ${sellerLoanText(p.plan.sellerLoanBalance, false)} at ${p.plan.sellerLoanRate}%.${p.structure === 'seller_rehab' ? ' Paid from rent each month while his balance pays down.' : ' Months where the seller gets less than that, they cover the difference.'}`]);
  return L;
}

function runningSellerThrough(rows, exit, month) {
  if (!month) return 0;
  let total = 0;
  for (const r of rows) {
    if (r.month <= month) total += r.seller;
  }
  if (exit && exit.month <= month) total += exit.sellerPayoff;
  return total;
}

// Build the full 7-step story and headline row for an offer from its monthlyPlan() result.
export function buildOfferStory(result, { base = {}, comps = [], offer = null } = {}) {
  const x = result.inputs;
  const b = result.operating.b;
  const plan = result.plan;
  const full = result.full;
  const exit = result.exit;
  const totals = result.totals;
  const rows = result.rows;
  const addedId = addedUnitId(plan);
  const effectiveBase = base && Object.keys(base).length ? { ...b, ...base } : b;
  const costSummary = buildCostSummary(effectiveBase, plan);
  const val = valueSummary({ base: effectiveBase, noi: full.noi * 12, units: result.units.length || b.units, comps });
  const row1 = rows[0] || {
    renting: 0, total: result.units.length, seller: 0, bank: 0, interest: 0,
    noi: 0, reserves: 0, collected: 0, mgmt: 0, fixed: 0, strCosts: 0, fromPool: 0,
  };
  const advancesStart = result.structure === 'master_lease' || result.structure === 'partnership'
    ? x.sellerAdvances
    : result.structure === 'seller_rehab'
      ? x.sellerFund
      : 0;

  const usedSellerPool = advancesStart > 0 && rows.some((r) => r.fromPool > 0);
  const usedLender = totals.peakLender > 0;
  const coverParts = [];
  if (usedSellerPool) coverParts.push(result.structure === 'seller_rehab' ? 'the seller’s rehab money' : 'the seller’s upfront money');
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
    plan.sellerLoanBalance > 0 ? `Seller’s own loan is ${sellerLoanText(plan.sellerLoanBalance, false)} (${money(result.sellerLoanPayment)}/mo estimate).` : null,
    result.structure === 'seller_rehab' ? OPTION_E_OVERLAY : null,
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
        : result.structure === 'seller_rehab'
          ? `Month 1 extra rent after his loan payment goes ${row1.renting < x.fillTarget ? 'all to seller' : `${100 - x.buyerSplitPct}% to seller`}: ${money(row1.seller)}/mo. ${OPTION_E_OVERLAY}`
          : `${money(x.price)} paid to seller at closing; bank payment ${money(result.bankPayment)}/mo (${money(result.bankLoan)} at ${x.rate}% / ${x.years} yrs).`;

  const runningM1 = runningSellerThrough(rows, exit, 1);
  const takeOverLines = [
    {
      label: 'Seller gets',
      value: result.structure === 'cash' ? `Paid ${money(x.price)} at closing` : `${money(row1.seller)}/mo · total ${money(runningM1)}`,
      overlay: [
        sellerFormula,
        result.sellerLoanPayment > 0 ? `Seller’s own loan: ${money(result.sellerLoanPayment)}/mo on ${sellerLoanText(plan.sellerLoanBalance, false)} at ${plan.sellerLoanRate}%.` : null,
      ].filter(Boolean),
    },
    {
      label: result.structure === 'seller_rehab' ? 'Seller’s rehab money' : 'Seller fronts',
      value: money(advancesStart),
      overlay: result.structure === 'seller_rehab'
        ? [advancesStart > 0 ? `${money(advancesStart)} put toward rehab (used before rehab draws). ${OPTION_E_OVERLAY}` : OPTION_E_OVERLAY]
        : [advancesStart > 0 ? `${money(advancesStart)} fronted up front for rehab and holding, paid back at the refinance.` : 'No upfront advance from the seller.'],
    },
  ];

  // Step 2: Rehab
  const rehabItems = result.items.filter((item) => item.group !== 'closing' && item.cost > 0);
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
  const vacantStage = result.stages.find((s) => s.key === 'vacant');
  const partialStage = result.stages.find((s) => s.key === 'partial');
  const fullStage = result.stages.find((s) => s.key === 'full');
  const holdEndMonth = vacantStage?.to || 1;
  const runningHold = runningSellerThrough(rows, exit, holdEndMonth);
  const fillEndMonth = partialStage?.to || holdEndMonth;
  const runningFill = runningSellerThrough(rows, exit, fillEndMonth);
  const fullEndMonth = fullStage?.to || (exit ? exit.month - 1 : rows.at(-1)?.month);
  const runningFull = runningSellerThrough(rows, exit, fullEndMonth);

  const holdingOverlay = [
    `Seller payment (month 1): ${money(row1.seller)}/mo${Math.abs(avgSeller - row1.seller) >= 1 ? ` (avg ${money(avgSeller)}/mo while filling up)` : ''}${result.structure === 'wrap' ? ' (estimate)' : ''}`,
    row1.bank > 0 ? `${result.structure === 'seller_rehab' ? 'Seller loan payment' : 'Bank payment'}: ${money(row1.bank)}/mo` : null,
    `Short-term (rehab) loan interest: avg ${money(avgInterest)}/mo, up to ${money(peakInterest)}/mo at ${plan.lenderRate}% (estimate)`,
    result.sellerLoanPayment > 0 && result.structure !== 'seller_rehab' ? `Seller’s own loan: ${money(result.sellerLoanPayment)}/mo on ${sellerLoanText(plan.sellerLoanBalance, false)}` : null,
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
      label: 'Seller gets',
      value: result.structure === 'cash' ? '$0/mo' : `${money(vacantStage?.sellerAvg ?? row1.seller)}/mo · total ${money(runningHold)}`,
      overlay: [
        result.structure === 'cash'
          ? `Paid ${money(x.price)} at closing.`
          : `Fixing up stage (Months ${vacantStage?.from ?? 1}–${holdEndMonth}): running seller total ${money(runningHold)}.`,
      ],
    },
    {
      label: fixupNet < 0 ? `Short ${money(-fixupNet)} a month while fixing up (covered by ${coveredBy})` : 'Left over each month after every bill',
      value: fixupNet < 0 ? '' : `${money(fixupNet)}/mo`,
      tone: fixupNet < 0 ? 'fail' : 'pass',
      overlay: [`${money(fixupRow.collected)} rent − ${money(fixupRow.mgmt + fixupRow.fixed + fixupRow.reserves)} running costs − ${money(fixupRow.seller + fixupRow.bank + fixupRow.interest)} payments & interest = ${money(fixupNet)}/mo.`],
    },
  ];

  // Step 4: Lease-up
  const leaseUpPills = result.units.map((u, idx) => ({
    label: `${ordinal(idx + 1)} Unit ${u.id} · month ${u.startMonth}`,
    overlay: [`${money(u.rent)}/mo rent, ready week ${u.ready}, rent-ready work ${money(u.rehab)}`, u.optional ? `Unit ${u.id} needs its zoning certificate.` : null, u.note || null].filter(Boolean),
  }));
  const fillAvgSeller = partialStage ? partialStage.sellerAvg : avgSeller;
  const leaseUpLines = [
    {
      label: 'Seller gets',
      value: result.structure === 'cash' ? '$0/mo' : `${money(fillAvgSeller)}/mo · total ${money(runningFill)}`,
      overlay: [
        result.structure === 'cash'
          ? `Paid ${money(x.price)} at closing.`
          : `Filling up (Months ${partialStage?.from ?? holdEndMonth}–${fillEndMonth}): average ${money(fillAvgSeller)}/mo, running seller total ${money(runningFill)}.`,
        result.structure === 'seller_rehab' ? OPTION_E_OVERLAY : null,
      ].filter(Boolean),
    },
  ];

  // Step 5: Full
  const fullRunning = full.collected - full.noi + full.reserves;
  const fullSellerPay = result.structure === 'master_lease'
    ? x.payment
    : result.structure === 'partnership'
      ? x.stepUp
      : result.structure === 'seller_rehab'
        ? Math.max(0, (full.cashFlow - result.sellerLoanPayment) * (1 - Math.max(0, Math.min(100, x.buyerSplitPct)) / 100))
        : row1.seller;
  const fullPayment = exit ? fullSellerPay : result.bankPayment;
  const fullLeft = result.structure === 'seller_rehab'
    ? full.cashFlow - result.sellerLoanPayment - fullSellerPay
    : full.cashFlow - fullPayment;
  const fullSellerOverlay = result.structure === 'master_lease'
    ? [`${money(x.payment)} full payment × ${result.units.length} of ${result.units.length} units renting = ${money(fullPayment)}/mo.`]
    : result.structure === 'partnership'
      ? [`${money(x.stepUp)} full payment × ${result.units.length} of ${result.units.length} units renting = ${money(fullPayment)}/mo.`]
      : result.structure === 'seller_rehab'
        ? [
            `Rent cash flow ${money(full.cashFlow)} − seller loan payment ${money(result.sellerLoanPayment)} = ${money(full.cashFlow - result.sellerLoanPayment)}/mo extra; ${100 - x.buyerSplitPct}% to seller (${money(fullSellerPay)}/mo) and ${x.buyerSplitPct}% to you (${money(fullLeft)}/mo).`,
            OPTION_E_OVERLAY,
          ]
        : [sellerFormula];

  const fullLines = [
    { label: 'Rent in', value: `${money(full.collected)}/mo`, overlay: [`${result.units.length} units after ${b.vacancyPct}% vacancy = ${money(full.collected)}/mo.`] },
    { label: 'Running costs', value: `${money(fullRunning)}/mo`, overlay: [`Management ${money(full.collected * (b.mgmtPct / 100))}/mo + fixed bills ${money((b.taxes + b.insurance + b.utilities + b.admin + b.turns) / 12)}/mo + reserves ${money(full.reserves)}/mo = ${money(fullRunning)}/mo.`] },
    ...(result.structure === 'seller_rehab' && result.sellerLoanPayment > 0
      ? [{ label: 'Seller loan payment', value: `${money(result.sellerLoanPayment)}/mo`, overlay: [`Paid from rent toward ${sellerLoanText(plan.sellerLoanBalance, false)}.`] }]
      : []),
    {
      label: result.structure === 'cash' ? 'Bank payment' : 'Seller gets',
      value: result.structure === 'cash' ? `${money(fullPayment)}/mo` : `${money(fullPayment)}/mo · total ${money(runningFull)}`,
      overlay: fullSellerOverlay,
    },
    {
      label: fullLeft >= 0 ? 'Left over each month after every bill' : `Short ${money(-fullLeft)} a month (covered by ${coveredBy})`,
      value: fullLeft >= 0 ? `${money(fullLeft)}/mo` : '',
      tone: fullLeft >= 0 ? 'pass' : 'fail',
      overlay: [`${money(full.collected)} rent − ${money(fullRunning)} running costs${result.structure === 'seller_rehab' ? ` − ${money(result.sellerLoanPayment)} seller loan` : ''} − ${money(fullPayment)} payment = ${money(fullLeft)}/mo.`],
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
            !result.eligibility?.lenderConfirmed ? `No lender has confirmed yet. A lender still has to confirm terms and Unit ${addedId} needs its zoning certificate; the math still runs on today’s numbers.` : null,
          ].filter(Boolean),
        },
        ...(val.compsLine ? [{ label: val.compsLine, value: '', overlay: val.compsOverlay }] : []),
        { label: 'Loan', value: money(exit.loan), overlay: [`${money(exit.loan)} (${full.refiLimitedBy === 'LTV' ? `${b.refiLtv}% of value` : `${b.refiDscr}x rent coverage`}) − fees & holdback = ${money(exit.net)} net.`] },
        {
          label: 'Seller gets',
          value: result.structure === 'seller_rehab'
            ? `${sellerLoanText(exit.sellerPayoff, false)} · total ${money(totals.sellerTotal)}`
            : `${money(exit.sellerPayoff)} · total ${money(totals.sellerTotal)}`,
          overlay: [
            result.structure === 'master_lease'
              ? `${money(x.optionPrice)} locked price + ${money(x.sellerAdvances)} fronted − ${money(exit.credits)} credited = ${money(exit.sellerPayoff)}.`
              : result.structure === 'partnership'
                ? `${money(x.buyout)} buyout + ${money(x.sellerAdvances)} fronted = ${money(exit.sellerPayoff)}.`
                : result.structure === 'seller_rehab'
                  ? `Remaining seller loan ${sellerLoanText(exit.sellerLoanRemaining ?? 0, false)}${x.addFundToBuyout ? ` + ${money(x.sellerFund)} rehab money` : ''} = ${money(exit.sellerPayoff)}. ${OPTION_E_OVERLAY}`
                  : `${money(x.note)} note payoff = ${money(exit.sellerPayoff)}.`,
            `Total to seller across all months + refinance: ${money(totals.sellerTotal)}.`,
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

  const unitsGuide = buildLeadGuide(effectiveBase, plan, offer || { structure: result.structure, inputs: x }, comps);

  return {
    costSummary,
    unitsGuide,
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
      { num: 4, title: 'Lease-up', pills: leaseUpPills, lines: leaseUpLines },
      { num: 5, title: 'Full', lines: fullLines },
      { num: 6, title: 'Refinance', when: exit ? `Month ${exit.month}` : 'No refinance', lines: refiLines },
      { num: 7, title: 'After', lines: afterLines },
    ],
    value: val,
    coveredBy,
  };
}

function repairLoanNumbers(baseIn = {}, planIn = {}, offerIn = {}) {
  const plan = normalizePlan(planIn);
  const units = unitSchedule(baseIn, plan);
  const unitsTotal = units.reduce((s, u) => s + num(u.rehab), 0);
  const costsTotal = plan.costs.filter((c) => c.cost > 0).reduce((s, c) => s + c.cost, 0);
  const rehabBudget = (units.length > 0 || plan.costs.length > 0)
    ? (unitsTotal + costsTotal)
    : (Math.max(0, num(baseIn?.rehab, 0)) + Math.max(0, num(baseIn?.tenthUnitRepair, 0)));
  const contingency = Math.max(0, num(plan.contingency, 0));
  const pointsPct = Math.max(0, num(plan.lenderPoints, 0));
  const factor = 1 - pointsPct / 100;
  const fullLoan = factor > 0 ? (rehabBudget + contingency) / factor : (rehabBudget + contingency);
  const points = fullLoan - (rehabBudget + contingency);
  const drawnUnused = rehabBudget + points;
  const drawnUsed = fullLoan;
  const lenderRate = Math.max(0, num(plan.lenderRate, 0));
  const interestUnused = (drawnUnused * (lenderRate / 100)) / 12;
  const interestUsed = (drawnUsed * (lenderRate / 100)) / 12;
  const x = offerIn?.inputs && typeof offerIn.inputs === 'object' ? offerIn.inputs : (offerIn || {});
  const shortCarry = Math.max(0, num(x.shortCarry, 0));
  const closing = Math.max(0, x.exerciseClosing !== undefined && x.exerciseClosing !== '' ? num(x.exerciseClosing) : num(x.closing, 0));
  return {
    plan,
    rehabBudget,
    contingency,
    pointsPct,
    fullLoan,
    points,
    drawnUnused,
    drawnUsed,
    lenderRate,
    interestUnused,
    interestUsed,
    shortCarry,
    closing,
  };
}

// Refinance math at full occupancy (all 10 units rented). Pure function.
export function refi(baseIn = {}, planIn = {}, offerIn = {}) {
  const loanInfo = repairLoanNumbers(baseIn, planIn, offerIn);
  const { plan, rehabBudget, contingency, pointsPct, fullLoan, points, drawnUnused, drawnUsed, shortCarry, closing } = loanInfo;

  const rent = Math.max(0, num(baseIn?.rent, 0));
  const vacancyPct = num(baseIn?.vacancyPct, BASE_DEFAULTS.vacancyPct);
  const taxesMo = Math.max(0, num(baseIn?.taxes, 0)) / 12;
  const insuranceMo = Math.max(0, num(baseIn?.insurance, 0)) / 12;
  const waterMo = Math.max(0, num(baseIn?.waterMo, 0));
  const reservesPerUnit = Math.max(0, num(baseIn?.reservesPerUnit, BASE_DEFAULTS.reservesPerUnit));

  const estimatedValue = Math.max(0, num(baseIn?.value, 0));
  const refiRate = num(baseIn?.refiRate, BASE_DEFAULTS.refiRate);
  const refiYears = num(baseIn?.refiYears, BASE_DEFAULTS.refiYears);
  const refiLtv = num(baseIn?.refiLtv, BASE_DEFAULTS.refiLtv);
  const refiDscr = num(baseIn?.refiDscr, BASE_DEFAULTS.refiDscr);
  const refiFeesPct = num(baseIn?.refiFeesPct, BASE_DEFAULTS.refiFeesPct);
  const refiFeesFlat = Math.max(0, num(baseIn?.refiFeesFlat, BASE_DEFAULTS.refiFeesFlat));
  const refiReserve = Math.max(0, num(baseIn?.refiReserve, BASE_DEFAULTS.refiReserve));

  // DSCR NOI at full occupancy: rent less vacancy, taxes, insurance, water and reserves. No management, admin, turnover or old utilities.
  const fullRentMo = 10 * rent;
  const fullCollectedMo = fullRentMo * (1 - vacancyPct / 100);
  const fullReservesMo = (10 * reservesPerUnit) / 12;
  const dscrNoiMo = fullCollectedMo - taxesMo - insuranceMo - waterMo - fullReservesMo;
  const dscrNoiAnnual = dscrNoiMo * 12;

  const loanByDscr = refiDscr > 0 ? Math.max(0, pv(refiRate, refiYears, dscrNoiMo / refiDscr)) : 0;
  const loanByLtv = (refiLtv / 100) * estimatedValue;
  const loan = Math.min(loanByDscr, loanByLtv);
  const limitedBy = loanByDscr < loanByLtv ? 'DSCR' : 'LTV';
  const ltvShownPct = estimatedValue > 0 ? Math.round((loan / estimatedValue) * 100) : Math.round(refiLtv);

  const feesPctAmt = (loan * refiFeesPct) / 100;
  const inHand = loan - feesPctAmt - refiFeesFlat - refiReserve;

  const sellerPayoff = Math.max(0, num(plan.sellerLoanBalance, 0));
  const sellerPayoffText = sellerLoanText(sellerPayoff, false);
  const repairLoanPayoff = drawnUnused + shortCarry;
  const repairLoanPayoffContUsed = drawnUsed + shortCarry;

  const leftForYou = inHand - sellerPayoff - repairLoanPayoff - closing;
  const leftForYouContUsed = inHand - sellerPayoff - repairLoanPayoffContUsed - closing;

  const estimatedValueOverlay = [
    'Estimated value by income',
    dscrNoiAnnual > 0 ? `Full-occupancy NOI ${money(dscrNoiAnnual)}/yr (${money(dscrNoiMo)}/mo after vacancy, taxes, insurance, water and reserves)` : null,
    baseIn?.valueSource ? `Source: ${String(baseIn.valueSource)}` : null,
  ].filter(Boolean);

  const loanOverlay = [
    `Lower of ${refiDscr}x DSCR loan (${money(loanByDscr)}) and ${refiLtv}% of value (${money(loanByLtv)}) at ${refiRate}% / ${refiYears} yrs (estimate).`,
  ];

  const inHandOverlay = [
    `Loan: ${money(loan)}`,
    feesPctAmt > 0 ? `Fees (${refiFeesPct}%): −${money(feesPctAmt)} (estimate)` : null,
    refiFeesFlat > 0 ? `Flat fees: −${money(refiFeesFlat)} (estimate)` : null,
    refiReserve > 0 ? `Lender holdback: −${money(refiReserve)} (estimate)` : null,
    `In hand: ${money(inHand)}.`,
  ].filter(Boolean);

  const sellerPayoffOverlay = [
    `Seller’s current loan balance ${sellerPayoffText} paid off at refinance (estimate).`,
  ];

  const repairLoanOverlay = [
    rehabBudget > 0 ? `Rehab budget: ${money(rehabBudget)}` : null,
    points > 0 ? `Points (${pointsPct}% on ${money(fullLoan)}): ${money(points)} (estimate)` : null,
    contingency > 0 ? `Contingency (if all used): ${money(contingency)}` : null,
    shortCarry > 0 ? `Short months carried by repair loan: ${money(shortCarry)}` : null,
    `Contingency unused: ${money(repairLoanPayoff)} · Contingency used: ${money(repairLoanPayoffContUsed)}.`,
  ].filter(Boolean);

  const closingOverlay = closing > 0 ? [`Closing costs at refinance: ${money(closing)} (estimate).`] : [];

  const leftForYouOverlay = [
    `${money(inHand)} in hand − ${money(sellerPayoff)} seller − ${money(repairLoanPayoff)} repair loan (contingency unused)${closing > 0 ? ` − ${money(closing)} closing` : ''} = ${money(leftForYou)}.`,
  ];

  const leftForYouContUsedOverlay = [
    `${money(inHand)} in hand − ${money(sellerPayoff)} seller − ${money(repairLoanPayoffContUsed)} repair loan (contingency used)${closing > 0 ? ` − ${money(closing)} closing` : ''} = ${money(leftForYouContUsed)}.`,
  ];

  return {
    estimatedValue,
    estimatedValueLabel: 'Estimated value',
    estimatedValueOverlay,
    dscrNoiMo,
    dscrNoiAnnual,
    loanByDscr,
    loanByLtv,
    loan,
    limitedBy,
    ltvPct: refiLtv,
    ltvShownPct,
    loanOverlay,
    feesPctAmt,
    feesFlat: refiFeesFlat,
    reserve: refiReserve,
    inHand,
    inHandOverlay,
    sellerPayoff,
    sellerPayoffText,
    sellerPayoffOverlay,
    repairLoanPayoff,
    repairLoanPayoffContUsed,
    repairLoanOverlay,
    shortCarry,
    closing,
    closingOverlay,
    leftForYou,
    leftForYouContUsed,
    leftForYouOverlay,
    leftForYouContUsedOverlay,
  };
}

// Units-rented table model (0..10 units rented) and refinance summary. Pure function.
export function unitsRentedTable(baseIn = {}, planIn = {}, offerIn = {}) {
  const loanInfo = repairLoanNumbers(baseIn, planIn, offerIn);
  const { plan, rehabBudget, contingency, points, fullLoan, drawnUnused, drawnUsed, lenderRate, interestUnused, interestUsed, shortCarry } = loanInfo;

  const totalUnits = 10;
  const rent = Math.max(0, num(baseIn?.rent, 0));
  const taxesMo = Math.max(0, num(baseIn?.taxes, 0)) / 12;
  const insuranceMo = Math.max(0, num(baseIn?.insurance, 0)) / 12;
  const waterMo = Math.max(0, num(baseIn?.waterMo, 0));
  const emptyUnitUtilMo = Math.max(0, num(baseIn?.emptyUnitUtilMo, 0));
  const reservesPerUnit = Math.max(0, num(baseIn?.reservesPerUnit, BASE_DEFAULTS.reservesPerUnit));
  const sellerLoanMo = plan.sellerLoanBalance > 0 ? pmt(plan.sellerLoanRate, plan.sellerLoanYears, plan.sellerLoanBalance) : 0;

  const rows = [];
  for (let units = 0; units <= totalUnits; units++) {
    const emptyUnits = totalUnits - units;
    const rentIn = rent * units;
    const emptyUtilTotal = emptyUnits * emptyUnitUtilMo;

    const sellerCostsBreakdown = [
      sellerLoanMo > 0 ? { key: 'sellerLoan', label: 'Seller’s loan', amount: sellerLoanMo, estimate: true, text: `Seller’s loan: ${money(sellerLoanMo)}/mo (estimate)` } : null,
      taxesMo > 0 ? { key: 'taxes', label: 'Property tax', amount: taxesMo, estimate: false, text: `Property tax: ${money(taxesMo)}/mo` } : null,
      insuranceMo > 0 ? { key: 'insurance', label: 'Insurance', amount: insuranceMo, estimate: true, text: `Insurance: ${money(insuranceMo)}/mo (estimate)` } : null,
      waterMo > 0 ? { key: 'water', label: 'Water', amount: waterMo, estimate: true, text: `Water: ${money(waterMo)}/mo (estimate)` } : null,
      emptyUtilTotal > 0 ? { key: 'emptyUtils', label: `Empty-unit utilities (${emptyUnits})`, amount: emptyUtilTotal, estimate: true, text: `Empty-unit utilities (${emptyUnits} × ${money(emptyUnitUtilMo)}): ${money(emptyUtilTotal)}/mo (estimate)` } : null,
    ].filter(Boolean);

    const sellerCosts = sellerLoanMo + taxesMo + insuranceMo + waterMo + emptyUtilTotal;
    const sellerCostsOverlay = sellerCostsBreakdown.length
      ? [...sellerCostsBreakdown.map((i) => i.text), `Total seller’s costs: ${money(sellerCosts)}/mo.`]
      : ['$0/mo'];

    const covered = units === 0 ? 'no' : (rentIn + 1e-6 < sellerCosts ? 'partly' : 'yes');
    const aboveSellerCosts = Math.max(0, rentIn - sellerCosts);

    const reservesMo = (units * reservesPerUnit) / 12;
    const buyerCosts = interestUnused + reservesMo;
    const buyerCostsContUsed = interestUsed + reservesMo;

    const buyerCostsBreakdown = [
      interestUnused > 0 ? { key: 'interest', label: 'Repair-loan interest', amount: interestUnused, estimate: true, text: `Repair-loan interest (${money(drawnUnused)} at ${lenderRate}%): ${money(interestUnused)}/mo (estimate)` } : null,
      reservesMo > 0 ? { key: 'reserves', label: `Reserves (${units} rented)`, amount: reservesMo, estimate: true, text: `Reserves (${units} × ${money(reservesPerUnit)}/yr ÷ 12): ${money(reservesMo)}/mo (estimate)` } : null,
    ].filter(Boolean);

    const buyerCostsContUsedBreakdown = [
      interestUsed > 0 ? { key: 'interest', label: 'Repair-loan interest', amount: interestUsed, estimate: true, text: `Repair-loan interest (${money(drawnUsed)} at ${lenderRate}%): ${money(interestUsed)}/mo (estimate)` } : null,
      reservesMo > 0 ? { key: 'reserves', label: `Reserves (${units} rented)`, amount: reservesMo, estimate: true, text: `Reserves (${units} × ${money(reservesPerUnit)}/yr ÷ 12): ${money(reservesMo)}/mo (estimate)` } : null,
    ].filter(Boolean);

    const buyerNet = aboveSellerCosts - buyerCosts;
    const buyerNetContUsed = aboveSellerCosts - buyerCostsContUsed;

    const buyerNetOverlay = [
      `Above seller’s costs: ${money(aboveSellerCosts)}/mo`,
      ...buyerCostsBreakdown.map((i) => i.text),
      `You net: ${money(buyerNet)}/mo.`,
    ];

    const buyerNetContUsedOverlay = [
      `Above seller’s costs: ${money(aboveSellerCosts)}/mo`,
      ...buyerCostsContUsedBreakdown.map((i) => i.text),
      `You net (contingency used): ${money(buyerNetContUsed)}/mo.`,
    ];

    rows.push({
      units,
      rentIn,
      sellerCosts,
      sellerCostsBreakdown,
      sellerCostsOverlay,
      covered,
      aboveSellerCosts,
      buyerCosts,
      buyerCostsBreakdown,
      buyerCostsContUsed,
      buyerCostsContUsedBreakdown,
      buyerNet,
      buyerNetContUsed,
      buyerNetOverlay,
      buyerNetContUsedOverlay,
    });
  }

  const sellerCoveredAt = rows.find((r) => r.covered === 'yes')?.units ?? null;
  const breakEvenUnits = rows.find((r) => r.buyerNet >= -1e-6)?.units ?? null;
  const breakEvenUnitsContUsed = rows.find((r) => r.buyerNetContUsed >= -1e-6)?.units ?? null;
  const refiResult = refi(baseIn, planIn, offerIn);

  return {
    rows,
    sellerCoveredAt,
    breakEvenUnits,
    breakEvenUnitsContUsed,
    repairLoan: {
      rehabBudget,
      contingency,
      points,
      fullLoan,
      drawnUnused,
      drawnUsed,
      interestUnused,
      interestUsed,
      shortCarry,
    },
    refi: refiResult,
    refiTrigger: plan.refiTrigger,
  };
}

export function buildLeadGuide(baseIn = {}, planIn = {}, offerIn = {}, _comps = []) {
  const cs = buildCostSummary(baseIn, planIn);
  const table = unitsRentedTable(baseIn, planIn, offerIn);
  return {
    version: 2,
    model: 'units_rented',
    rent: num(baseIn?.rent, 0),
    contingency: cs.contingency,
    costSummary: cs,
    costHeading: cs.heading,
    costHeadingOverlay: cs.headingOverlay,
    cost: cs.lines,
    rows: table.rows,
    sellerCoveredAt: table.sellerCoveredAt,
    breakEvenUnits: table.breakEvenUnits,
    breakEvenUnitsContUsed: table.breakEvenUnitsContUsed,
    refi: table.refi,
  };
}

// Build plain-English seller_summary JSONB (owner-only; never embeds option letters or buyer returns).
export function buildSellerSummary(offer, result, { base = {}, comps = [] } = {}) {
  const x = result.inputs;
  const b = result.operating.b;
  const plan = result.plan;
  const effectiveBase = base && Object.keys(base).length ? { ...b, ...base } : b;
  const structure = offer?.structure || result.structure;
  const title = STRUCTURES[structure]?.label || String(offer?.name || '').replace(/^[A-Z]\s*:\s*/, '');

  const table = unitsRentedTable(effectiveBase, plan, offer || { structure, inputs: x });
  const guide = buildLeadGuide(effectiveBase, plan, offer || { structure, inputs: x }, comps);
  const costSummary = guide.costSummary;

  const intro = 'I take over the leasing and the repairs. Rent pays your costs first. Once every unit is rented, I buy the building through a refinance.';
  const sellerTable = table.rows.map((r) => ({ units: r.units, rentIn: r.rentIn, covered: r.covered }));
  const refiLine = `Once all 10 are rented, I refinance and pay you ${sellerLoanText(table.refi.sellerPayoff, true)}, and your loan is paid off.`;

  const terms = [
    {
      label: 'How it works',
      value: intro,
      overlay: ['Rent pays your holding costs first. Anything above that goes to the buyer.'],
    },
    {
      label: 'Payoff at refinance',
      value: sellerLoanText(table.refi.sellerPayoff, true),
      overlay: [
        refiLine,
        structure === 'seller_rehab' ? OPTION_E_OVERLAY : null,
      ].filter(Boolean),
    },
    ...(plan.sellerLoanBalance > 0 ? [{
      label: 'Your current loan',
      value: sellerLoanText(plan.sellerLoanBalance, true),
      overlay: result.sellerLoanPayment > 0
        ? `Estimated ${money(result.sellerLoanPayment)}/mo at ${plan.sellerLoanRate}% (${plan.sellerLoanYears}-yr schedule).`
        : 'Current loan payoff is confirmed by your lender payoff letter.',
    }] : []),
    {
      label: 'What I take on',
      value: 'Repairs, leasing, day-to-day operations, city approvals, and permanent bank financing.',
      overlay: 'I coordinate contractors, fill vacant units, and arrange the refinance once all 10 units are rented.',
    },
  ];

  const steps = [
    {
      title: 'Take over',
      when: '',
      detail: 'I take over the leasing and the repairs across all 10 units.',
    },
    {
      title: 'Repairs',
      when: '',
      detail: costSummary.oneLine,
    },
    {
      title: 'Rent pays your costs first',
      when: '',
      detail: table.sellerCoveredAt !== null
        ? `Rent covers your costs starting at ${table.sellerCoveredAt} units rented.`
        : 'Rent goes toward your holding costs first as units fill.',
    },
    {
      title: 'Refinance',
      when: '',
      detail: refiLine,
    },
  ];

  return {
    version: 1,
    locked: false,
    title,
    intro,
    sellerTable,
    sellerCoveredAt: table.sellerCoveredAt,
    refiLine,
    terms,
    steps,
    guide,
  };
}

export function nextSellerSummary(offer, result, opts = {}) {
  const fresh = buildSellerSummary(offer, result, opts);
  if (offer?.seller_summary?.locked) {
    return { ...offer.seller_summary, guide: fresh.guide };
  }
  return fresh;
}

// Convenience wrappers used by Offers.jsx so the owner-only dynamic module never exposes monthlyPlan/buildOfferStory identifiers in public/seller bundles.
export function offerPlanStory(offer, base, plan, comps) {
  const planRes = monthlyPlan(offer.structure, offer.inputs, base, plan);
  return buildOfferStory(planRes, { base, comps, offer });
}

export function offerSellerSummary(offer, base, plan, comps, force = false) {
  const planRes = monthlyPlan(offer.structure, offer.inputs, base, plan);
  return force
    ? buildSellerSummary(offer, planRes, { base, comps })
    : nextSellerSummary(offer, planRes, { base, comps });
}
