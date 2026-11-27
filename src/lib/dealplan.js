// Month-by-month deal plan. Pure functions, no network.
// One shared model: the building numbers (models.base), each offer's terms (offers) and the owner's
// plan inputs (unit schedule, one-time costs, lender terms) all flow through here, so every page that
// shows a plan updates the moment any input changes. Real deal numbers live only in the owner's private
// database row, never in this public code. Defaults below are blank templates.
import { BASE_DEFAULTS, operating, pmt, pv, STRUCTURES, money, sellerLoanText, valueSummary } from './dealmath.js';

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
  bridgeRate: 13, // Plan 1A bridge rate, interest only, % per year
  bridgePoints: 2, // Plan 1A bridge origination points (%)
  bridgeProcessing: 1295, // Plan 1A bridge processing fee ($)
  bridgeClosing: 0, // Plan 1A bridge title/closing costs ($)
  contingency: 0, // repair contingency ($)
  lenderSeasoningMonths: null, // months of stabilized operations required by lender, null until confirmed
  lenderEligibilityConfirmed: false, // whether a permanent lender has confirmed refinance eligibility
  sellerLoanBalance: 0, // what the seller still owes their bank
  sellerLoanRate: 0,
  sellerLoanYears: 30,
  refiTrigger: { allRented: true },
  units: [], // { id, rehab, ready (week), occupied, rent, optional, note }
  costs: [], // { label, cost, start (week), end (week), group }
  rentOptions: [], // legacy field preserved for normalization compatibility
};

const num = (v, d = 0) => (Number.isFinite(+v) && v !== '' && v !== null && v !== undefined ? +v : d);
const optNum = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? null : Math.max(0, +v));
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
  out.units = (Array.isArray(p.units) ? p.units : []).map((u) => ({ id: String(u.id ?? ''), rehab: num(u.rehab), ready: num(u.ready), occupied: !!u.occupied, rent: u.rent === undefined || u.rent === null || u.rent === '' ? null : num(u.rent), rentToday: optNum(u.rentToday), marketRent: optNum(u.marketRent), optional: !!u.optional, note: u.note ? String(u.note) : '' }));
  out.costs = (Array.isArray(p.costs) ? p.costs : []).map((c) => ({ label: String(c.label ?? ''), cost: num(c.cost), start: num(c.start), end: num(c.end, num(c.start)), group: c.group ? String(c.group) : 'other' }));
  out.rentOptions = (Array.isArray(p.rentOptions) ? p.rentOptions : []).map((r) => ({ key: String(r.key ?? r.label ?? ''), label: String(r.label ?? ''), rent: num(r.rent) }));
  out.sources = p.sources && typeof p.sources === 'object' ? p.sources : {};
  // Market rent range per unit. Kept in the owner-only plan; its source never leaves the owner's page.
  const mr = p.marketRent && typeof p.marketRent === 'object' ? p.marketRent : null;
  out.marketRent = mr && optNum(mr.low) !== null && optNum(mr.high) !== null
    ? { low: optNum(mr.low), high: optNum(mr.high), source: mr.source ? String(mr.source) : '' }
    : null;
  return out;
}

export function addedUnitOf(planIn) {
  const plan = normalizePlan(planIn);
  return plan.units.find((u) => u.optional) || null;
}

export function addedUnitId(planIn) {
  return addedUnitOf(planIn)?.id || '10';
}

export function overallRepairBudget(planIn = {}) {
  const plan = normalizePlan(planIn);
  const unitsTotal = plan.units.reduce((s, u) => s + Math.max(0, num(u.rehab, 0)), 0);
  const costsTotal = plan.costs.reduce((s, c) => s + Math.max(0, num(c.cost, 0)), 0);
  return unitsTotal + costsTotal + Math.max(0, num(plan.contingency, 0));
}

// Owner-only helper so Offers never embeds the deal_plan settings key in public/seller builds.
export async function loadDealPlan(supabase, slug) {
  const { data: row, error } = await supabase.from('commercial_settings').select('value').eq('key', `deal_plan:${slug}`).maybeSingle();
  if (error) return null;
  return row ? normalizePlan(row.value) : null;
}

// Which units are in the plan, in lease-up order, and when each starts paying. Always 10 units.
export function unitSchedule(baseIn, planIn) {
  const o = operating(baseIn);
  const plan = normalizePlan(planIn);
  const hasOptional = plan.units.some((u) => u.optional);
  const chosen = plan.units.map((u) => ({ ...u }));
  if (!hasOptional && chosen.length === 9) {
    const maxReady = chosen.reduce((m, u) => Math.max(m, u.ready), 0);
    chosen.push({
      id: '10',
      rehab: 0,
      ready: maxReady || 16,
      occupied: false,
      rent: null,
      optional: false,
      note: '',
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
  const pricedUnits = units.filter((u) => num(u.rehab) > 0);
  const unitsTotal = pricedUnits.reduce((s, u) => s + num(u.rehab), 0);
  const topUnits = [...pricedUnits].sort((a, b) => b.rehab - a.rehab).slice(0, 2);
  const unitsInline = topUnits.map((u) => `Unit ${u.id} ${money(u.rehab)}`).join(', ');
  const unitsOverlay = [
    ...pricedUnits.map((u) => `Unit ${u.id}: ${money(u.rehab)}`),
    `Total units: ${money(unitsTotal)}.`,
  ];

  const systemsPriced = plan.costs.filter((c) => c.group === 'systems' && c.cost > 0);
  const buildingTotal = systemsPriced.reduce((s, c) => s + c.cost, 0);
  const buildingInline = systemsPriced.map((c) => `${c.label.toLowerCase()} ${money(c.cost)}`).join(', ');
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
  const heading = `Repair budget ${money(wholeTotal)}`;
  const headingOverlay = [
    unitsTotal > 0 ? `Units: ${money(unitsTotal)}` : null,
    buildingTotal > 0 ? `Building: ${money(buildingTotal)}` : null,
    setupTotal > 0 ? `Setup: ${money(setupTotal)}` : null,
    contingency > 0 ? `Rehab subtotal: ${money(rehabTotal)}` : null,
    contingency > 0 ? `Contingency: ${money(contingency)}` : null,
    contingency > 0 ? `Total with contingency: ${money(wholeTotal)}.` : `Total job: ${money(wholeTotal)}.`,
  ].filter(Boolean);

  const lines = [
    ...(unitsTotal > 0 ? [{ key: 'units', label: `Units ${money(unitsTotal)}`, detail: unitsInline, overlay: unitsOverlay }] : []),
    ...(buildingTotal > 0 ? [{ key: 'building', label: `Building ${money(buildingTotal)}`, detail: buildingInline, overlay: buildingOverlay }] : []),
    ...(setupTotal > 0 ? [{ key: 'setup', label: `Setup ${money(setupTotal)}`, detail: setupInline, overlay: setupOverlay }] : []),
    ...(contingency > 0 ? [{ key: 'contingency', label: `Contingency ${money(contingency)}`, detail: '', overlay: [`Repair contingency: ${money(contingency)}.`] }] : []),
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
  const renoFromSeller = structure === 'wrap' && Boolean(x.renoFromSeller);
  const lenderRateUsed = renoFromSeller ? Math.max(0, num(x.renoRate, 8)) : plan.lenderRate;
  const lenderPointsUsed = renoFromSeller ? 0 : plan.lenderPoints;
  const units = unitSchedule(baseIn, plan);
  const total = units.length;
  const fixedMo = (b.taxes + b.insurance + b.utilities + b.admin + b.turns) / 12;

  // One-time costs by month: every listed cost and each unit's rehab.
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
    add(`Unit ${u.id} rehab`, 'units', u.rehab, Math.min(plan.rehabStartWeek, u.ready), u.ready);
  }
  if (structure === 'wrap' && num(x.closing) > 0) add('Closing costs (in the repair loan)', 'closing', x.closing, 0, 0);
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
  let lender = 0, credits = 0, carriedBillsAcc = 0, refied = false;
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

    const interest = (lender * lenderRateUsed) / 100 / 12;
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
            const f = 1 - lenderPointsUsed / 100;
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
            const f = 1 - lenderPointsUsed / 100;
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
      let net;
      if (structure === 'wrap' && x.billsFromRent && !refied) {
        const fullNoteMo = x.amortYears > 0 ? pmt(x.rate, x.amortYears, x.note) : (x.note * x.rate) / 100 / 12;
        const holdingBillsMo = (b.taxes + b.insurance) / 12 + (num(b.waterMo, 0) > 0 ? num(b.waterMo, 0) : b.utilities / 12) + Math.max(0, total - renting.length) * num(b.emptyUnitUtilMo, 0);
        const billsPaid = Math.min(collected, holdingBillsMo);
        const billsCarried = Math.max(0, holdingBillsMo - billsPaid);
        const rentAfterBills = Math.max(0, collected - billsPaid);
        seller = Math.min(rentAfterBills, fullNoteMo);
        // Bills and note payments rent does not cover yet wait and are paid at the refinance.
        carriedBillsAcc += billsCarried + (fullNoteMo - seller);
        const otherFixedMo = (b.admin + b.turns) / 12 + mgmt;
        const leftAfterBillsAndNote = Math.max(0, collected - holdingBillsMo - fullNoteMo) - otherFixedMo;
        net = leftAfterBillsAndNote - reserves - bank - interest - costTotal;
      } else {
        if (refied) bank = refiPayment;
        else if (structure === 'master_lease') seller = x.payment * share;
        else if (structure === 'partnership') seller = x.stepUp * share;
        else if (structure === 'wrap') seller = x.amortYears > 0 ? pmt(x.rate, x.amortYears, x.note) : (x.note * x.rate) / 100 / 12;
        if (structure === 'cash') bank = bankPayment;
        if (structure === 'master_lease' && !refied) credits += (seller * x.creditPct) / 100;

        net = noi - reserves - seller - bank - interest - costTotal;
      }
      if (net < 0) {
        const fromSellerPool = Math.min(sellerPool, -net); sellerPool -= fromSellerPool; net += fromSellerPool;
        const fromBuyerPool = Math.min(buyerPool, -net); buyerPool -= fromBuyerPool; net += fromBuyerPool;
        fromPool = fromSellerPool + fromBuyerPool;
        if (net < 0) {
          if (structure === 'cash') { buyerCashTotal += -net; } else {
            const f = 1 - lenderPointsUsed / 100;
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
      const basePayoff = sellerPayoff(structure, x, credits, sellerLoanBal);
      const sellerCarriedBills = structure === 'wrap' && x.billsFromRent ? carriedBillsAcc : 0;
      const payoff = basePayoff + sellerCarriedBills;
      const due = payoff + lenderBeforePayoff + exitClosing;
      refi = {
        loan: refiLoan,
        net: refiNet,
        sellerPayoff: payoff,
        sellerCarriedBills,
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
      sellerCarriedBills: structure === 'wrap' && x.billsFromRent ? carriedBillsAcc : 0,
      cashPrice: structure === 'cash' ? x.price : null,
    },
    sellerLoanPayment, bankLoan, bankPayment, lenderRateUsed, renoFromSeller,
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
  const ob = p.operating?.b || {};
  const costWords = [num(ob.mgmtPct) > 0 ? 'management' : null, 'taxes', 'insurance', num(ob.utilities) > 0 ? 'water and trash' : null, num(ob.admin) > 0 ? 'admin' : null, num(ob.turns) > 0 ? 'turns' : null].filter(Boolean);
  const costList = costWords.length > 1 ? `${costWords.slice(0, -1).join(', ')} and ${costWords[costWords.length - 1]}` : costWords[0];
  L.push(['Rent once full', `${p.units.length} units collect ${$(full.collected)}/mo after vacancy. Less ${costList} leaves ${$(full.noi)}/mo. Less reserves leaves ${$(full.cashFlow)}/mo before any payment.`]);
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
          : `No lender has confirmed yet. Expected refinance is month ${el.expectedRefiMonth} (all ${p.units.length} units renting by month ${el.stabilizedMonth}). A lender still has to confirm terms; the math still runs on today’s numbers.`;
    L.push(['Lender eligibility', msg]);
  }
  if (p.units.length >= 10) {
    L.push(['10-unit value', `10-unit plan covers all ${p.units.length} units.`]);
  }
  if (p.totals.peakLender > 0) L.push([p.renoFromSeller ? 'Seller renovation note' : 'Short-term lender', `Covers what rent and upfront funds don’t, peaking at ${$(p.totals.peakLender)} before refinance payoff. Interest ${$(p.totals.interestTotal)} + points ${$(p.totals.pointsTotal)} through the refinance.`]);
  if (p.sellerLoanPayment) L.push(['Seller’s own loan', `${$(p.sellerLoanPayment)}/mo on ${sellerLoanText(p.plan.sellerLoanBalance, false)} at ${p.plan.sellerLoanRate}%.${p.structure === 'seller_rehab' ? ' Paid from rent each month while his balance pays down.' : ' Months where the seller gets less than that, they cover the difference.'}`]);
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
    plan.sellerLoanBalance > 0 ? `Seller’s own loan is ${sellerLoanText(plan.sellerLoanBalance, false)} (${money(result.sellerLoanPayment)}/mo).` : null,
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
        ? `${money(x.note)} owed × ${x.rate}% ÷ 12 = ${money(row1.seller)}/mo from month 1${x.amortYears > 0 ? ` (${x.amortYears}-yr amort)` : ' (interest only)'}.`
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
      label: 'Repair budget',
      value: money(rehabTotal),
      overlay: [
        ...rehabItems.map((item) => `${item.label}: ${money(item.cost)}`),
        `Repair budget: ${money(rehabTotal)}.`,
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
    `Seller payment (month 1): ${money(row1.seller)}/mo${Math.abs(avgSeller - row1.seller) >= 1 ? ` (avg ${money(avgSeller)}/mo while filling up)` : ''}`,
    row1.bank > 0 ? `${result.structure === 'seller_rehab' ? 'Seller loan payment' : 'Bank payment'}: ${money(row1.bank)}/mo` : null,
    `Short-term (rehab) loan interest: avg ${money(avgInterest)}/mo, up to ${money(peakInterest)}/mo at ${plan.lenderRate}%`,
    result.sellerLoanPayment > 0 && result.structure !== 'seller_rehab' ? `Seller’s own loan: ${money(result.sellerLoanPayment)}/mo on ${sellerLoanText(plan.sellerLoanBalance, false)}` : null,
    `Taxes: ${money(taxesMo)}/mo`,
    `Insurance: ${money(insMo)}/mo`,
    utilMo > 0 ? `Water and trash: ${money(utilMo)}/mo` : null,
    adminMo > 0 ? `Admin: ${money(adminMo)}/mo` : null,
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
    overlay: [`${money(u.rent)}/mo rent, ready week ${u.ready}, rent-ready work ${money(u.rehab)}`, u.note || null].filter(Boolean),
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
    { label: 'Running costs', value: `${money(fullRunning)}/mo`, overlay: [`${b.mgmtPct > 0 ? `Management ${money(full.collected * (b.mgmtPct / 100))}/mo + ` : ''}taxes, insurance and water and trash ${money((b.taxes + b.insurance + b.utilities + b.admin + b.turns) / 12)}/mo + reserves ${money(full.reserves)}/mo = ${money(fullRunning)}/mo.`] },
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
            !result.eligibility?.lenderConfirmed ? 'No lender has confirmed yet. A lender still has to confirm terms; the math still runs on today’s numbers.' : null,
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
          label: result.renoFromSeller ? 'Pays seller renovation note' : 'Pays rehab lender',
          value: money(exit.lenderPayoff),
          overlay: [`Peak rehab loan ${money(totals.peakLender)}; interest ${money(totals.interestTotal)} + points ${money(totals.pointsTotal)} at ${result.lenderRateUsed ?? plan.lenderRate}%.`],
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

// Seller financing (structure 'wrap'): title moves at closing and the seller holds a note.
// When billsFromRent is true, rent pays holding bills first, then the note; what rent does not cover yet waits and is paid at refinance.
// When renoFromSeller is true, the seller also funds the repair budget as a second note (no points), paid off at refinance.
export function sellerNote(offerIn = {}, planIn = {}) {
  const structure = offerIn?.structure;
  if (structure !== 'wrap') return { isNote: false, note: 0, notePay: 0, billsFromRent: false, renoFromSeller: false, renoRate: 0 };
  const x = offerIn?.inputs && typeof offerIn.inputs === 'object' ? offerIn.inputs : {};
  const plan = normalizePlan(planIn);
  const note = Math.max(0, num(x.note, plan.sellerLoanBalance));
  const rate = Math.max(0, num(x.rate, 0));
  const years = Math.max(0, num(x.amortYears, 0));
  const notePay = years > 0 ? pmt(rate, years, note) : (note * rate) / 100 / 12;
  return { isNote: true, note, notePay, rate, years, billsFromRent: Boolean(x.billsFromRent), renoFromSeller: Boolean(x.renoFromSeller), renoRate: Math.max(0, num(x.renoRate, 8)) };
}

function repairLoanNumbers(baseIn = {}, planIn = {}, offerIn = {}) {
  const plan = normalizePlan(planIn);
  const units = unitSchedule(baseIn, plan);
  const unitsTotal = units.reduce((s, u) => s + num(u.rehab), 0);
  const costsTotal = plan.costs.filter((c) => c.cost > 0).reduce((s, c) => s + c.cost, 0);
  const rehabBudget = (units.length > 0 || plan.costs.length > 0)
    ? (unitsTotal + costsTotal)
    : Math.max(0, num(baseIn?.rehab, 0));
  const contingency = Math.max(0, num(plan.contingency, 0));
  const lenderPointsPct = Math.max(0, num(plan.lenderPoints, 0));
  const x = offerIn?.inputs && typeof offerIn.inputs === 'object' ? offerIn.inputs : (offerIn || {});
  const shortCarry = Math.max(0, num(x.shortCarry, 0));
  const closingAll = Math.max(0, x.exerciseClosing !== undefined && x.exerciseClosing !== '' ? num(x.exerciseClosing) : num(x.closing, 0));
  // Seller financing: the closing cost is rolled into the repair loan, so nothing is paid at closing.
  const closingInLoan = offerIn?.structure === 'wrap' ? closingAll : 0;
  const closing = closingAll - closingInLoan;
  // Seller financing can have the seller fund the repairs as a second note: whole budget, no points, the seller's rate.
  const fromSeller = offerIn?.structure === 'wrap' && Boolean(x.renoFromSeller);
  const loanBase = rehabBudget + closingInLoan;
  const regularRate = Math.max(0, num(plan.lenderRate, 0));
  const regularFactor = 1 - lenderPointsPct / 100;
  const regularLoan = regularFactor > 0 ? (loanBase + contingency) / regularFactor : (loanBase + contingency);
  const regular = {
    rate: regularRate,
    pointsPct: lenderPointsPct,
    loan: regularLoan,
    points: regularLoan - (loanBase + contingency),
    interestMo: (regularLoan * regularRate) / 100 / 12,
  };
  const pointsPct = fromSeller ? 0 : lenderPointsPct;
  const fullLoan = fromSeller ? loanBase + contingency : regularLoan;
  const points = fromSeller ? 0 : regular.points;
  // One repair budget. The contingency is drawn only if it is used, so the seller note's payments and payoff
  // count it only when used (drawnUsed).
  const drawnUnused = fromSeller ? loanBase : loanBase + points;
  const drawnUsed = fullLoan;
  const lenderRate = fromSeller ? Math.max(0, num(x.renoRate, 8)) : regularRate;
  const interestUnused = (drawnUnused * (lenderRate / 100)) / 12;
  const interestUsed = (drawnUsed * (lenderRate / 100)) / 12;
  return {
    fromSeller,
    regular,
    closingInLoan,
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

// What waits until the refinance during lease-up: holding bills rent does not cover yet, then the purchase-note
// payment, then the seller renovation-note payment. Everything that waits is paid to the seller at the refinance.
export function deferredAtRefi(baseIn = {}, planIn = {}, offerIn = {}) {
  const plan = normalizePlan(planIn);
  const noteInfo = sellerNote(offerIn, plan);
  if (!noteInfo.isNote) return { bills: 0, purchaseNote: 0, renoNote: 0, total: 0 };
  const x = offerIn?.inputs && typeof offerIn.inputs === 'object' ? offerIn.inputs : {};
  const loanInfo = repairLoanNumbers(baseIn, plan, offerIn);
  const renoMo = loanInfo.fromSeller ? loanInfo.interestUnused : 0;

  const rent = Math.max(0, num(baseIn?.rent, 0));
  const taxesMo = Math.max(0, num(baseIn?.taxes, 0)) / 12;
  const insuranceMo = Math.max(0, num(baseIn?.insurance, 0)) / 12;
  const waterMo = Math.max(0, num(baseIn?.waterMo, 0));
  const emptyUnitUtilMo = Math.max(0, num(baseIn?.emptyUnitUtilMo, 0));
  const units = unitSchedule(baseIn, plan);
  const totalUnits = units.length || 10;
  const stabilizedMonth = units.length ? Math.max(...units.map((u) => u.startMonth)) : 0;
  const endMonth = Math.max(Math.round(num(plan.refiMonth, 12)), stabilizedMonth, 1);

  let bills = 0, purchaseNote = 0, renoNote = 0;
  for (let m = 1; m <= endMonth; m++) {
    const rented = units.filter((u) => u.startMonth <= m).length;
    const empty = Math.max(0, totalUnits - rented);
    let rentLeft = rent * rented;
    if (noteInfo.billsFromRent) {
      const billsMo = taxesMo + insuranceMo + waterMo + empty * emptyUnitUtilMo;
      const billsPaid = Math.min(rentLeft, billsMo);
      rentLeft -= billsPaid;
      bills += billsMo - billsPaid;
    }
    const notePaid = Math.min(rentLeft, noteInfo.notePay);
    rentLeft -= notePaid;
    purchaseNote += noteInfo.notePay - notePaid;
    const renoPaid = Math.min(rentLeft, renoMo);
    rentLeft -= renoPaid;
    renoNote += renoMo - renoPaid;
  }
  if (noteInfo.billsFromRent && Number.isFinite(+x.carriedBills) && +x.carriedBills > 0) bills = +x.carriedBills;
  return { bills, purchaseNote, renoNote, total: bills + purchaseNote + renoNote };
}

// Holding bills alone (kept for older callers).
export function carriedBillsTotal(baseIn = {}, planIn = {}, offerIn = {}) {
  return deferredAtRefi(baseIn, planIn, offerIn).bills;
}

// Refinance math at full occupancy (all 10 units rented). Pure function.
export function refi(baseIn = {}, planIn = {}, offerIn = {}) {
  const loanInfo = repairLoanNumbers(baseIn, planIn, offerIn);
  const { plan, rehabBudget, contingency, pointsPct, fullLoan, points, drawnUnused, drawnUsed, shortCarry, closing, closingInLoan, fromSeller, regular, lenderRate, interestUsed } = loanInfo;

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

  const noteInfo = sellerNote(offerIn, plan);
  const sellerNotePrincipal = noteInfo.isNote ? noteInfo.note : Math.max(0, num(plan.sellerLoanBalance, 0));
  const deferred = deferredAtRefi(baseIn, plan, offerIn);
  const sellerCarriedBills = deferred.total;
  const sellerPayoff = sellerNotePrincipal + sellerCarriedBills;
  const sellerPayoffText = sellerLoanText(sellerPayoff, false);
  const repairLoanPayoff = drawnUnused + shortCarry;
  const repairLoanPayoffContUsed = drawnUsed + shortCarry;

  const leftForYou = inHand - sellerPayoff - repairLoanPayoff - closing;
  const leftForYouContUsed = inHand - sellerPayoff - repairLoanPayoffContUsed - closing;

  const estimatedValueOverlay = [
    'Value by income',
    dscrNoiAnnual > 0 ? `Full-occupancy NOI ${money(dscrNoiAnnual)}/yr (${money(dscrNoiMo)}/mo after vacancy, taxes, insurance, water and reserves)` : null,
    baseIn?.valueSource ? `Source: ${String(baseIn.valueSource)}` : null,
  ].filter(Boolean);

  const loanOverlay = [
    `Lower of ${refiDscr}x DSCR loan (${money(loanByDscr)}) and ${refiLtv}% of value (${money(loanByLtv)}) at ${refiRate}% / ${refiYears} yrs.`,
  ];

  const inHandOverlay = [
    `Loan: ${money(loan)}`,
    feesPctAmt > 0 ? `Fees (${refiFeesPct}%): −${money(feesPctAmt)}` : null,
    refiFeesFlat > 0 ? `Flat fees: −${money(refiFeesFlat)}` : null,
    refiReserve > 0 ? `Lender holdback: −${money(refiReserve)}` : null,
    `In hand: ${money(inHand)}.`,
  ].filter(Boolean);

  const sellerPayoffOverlay = noteInfo.isNote
    ? [`Seller’s note ${sellerLoanText(sellerNotePrincipal, false)} paid off at refinance.${sellerCarriedBills > 0 ? ` Plus ${money(sellerCarriedBills)} in deferred holding costs.` : ''}`]
    : [`Seller’s current loan balance ${sellerPayoffText} paid off at refinance.`];

  const sellerCarriedBillsLabel = 'Deferred holding costs, paid at refi';
  const sellerCarriedBillsOverlay = [
    deferred.bills > 0 ? `Holding bills rent did not cover yet: ${money(deferred.bills)}` : null,
    deferred.purchaseNote > 0 ? `Purchase note payments that waited: ${money(deferred.purchaseNote)}` : null,
    deferred.renoNote > 0 ? `Renovation note payments that waited: ${money(deferred.renoNote)}` : null,
    `Paid to the seller at the refi: ${money(deferred.total)}.`,
  ].filter(Boolean);

  const repairLoanOverlay = fromSeller ? [
    rehabBudget + contingency > 0 ? `Repair budget: ${money(rehabBudget + contingency)}` : null,
    closingInLoan > 0 ? `Closing costs: ${money(closingInLoan)}` : null,
    contingency > 0 ? `Contingency: ${money(contingency)}, added only if used` : null,
    shortCarry > 0 ? `Short months: ${money(shortCarry)}` : null,
    `${lenderRate}% interest only, no points.`,
    `Seller renovation note paid off: ${money(repairLoanPayoff)}.`,
  ].filter(Boolean) : [
    rehabBudget > 0 ? `Repair budget: ${money(rehabBudget)}` : null,
    closingInLoan > 0 ? `Closing costs: ${money(closingInLoan)} in the repair loan` : null,
    points > 0 ? `Points (${pointsPct}% on ${money(fullLoan)}): ${money(points)}` : null,
    contingency > 0 ? `Contingency (if all used): ${money(contingency)}` : null,
    shortCarry > 0 ? `Short months paid by the repair loan: ${money(shortCarry)}` : null,
    `Contingency unused: ${money(repairLoanPayoff)} · Contingency used: ${money(repairLoanPayoffContUsed)}.`,
  ].filter(Boolean);

  const closingOverlay = closing > 0 ? [`${noteInfo.isNote ? 'Closing costs' : 'Closing costs at refinance'}: ${money(closing)}.`] : [];

  const carriedPart = sellerCarriedBills > 0 ? ` − ${money(sellerCarriedBills)} deferred costs` : '';
  const leftForYouOverlay = [
    `${money(inHand)} in hand − ${money(sellerNotePrincipal)} seller${carriedPart} − ${money(repairLoanPayoff)} ${fromSeller ? 'seller renovation note' : 'repair loan (contingency unused)'}${closing > 0 ? ` − ${money(closing)} closing` : ''} = ${money(leftForYou)}.`,
  ];

  const leftForYouContUsedOverlay = [
    `${money(inHand)} in hand − ${money(sellerNotePrincipal)} seller${carriedPart} − ${money(repairLoanPayoffContUsed)} ${fromSeller ? 'seller renovation note' : 'repair loan (contingency used)'}${closing > 0 ? ` − ${money(closing)} closing` : ''} = ${money(leftForYouContUsed)}.`,
  ];

  return {
    billsFromRent: Boolean(noteInfo.isNote && noteInfo.billsFromRent),
    estimatedValue,
    estimatedValueLabel: 'Value',
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
    sellerNotePrincipal,
    sellerCarriedBills,
    sellerCarriedBillsLabel,
    sellerCarriedBillsOverlay,
    sellerPayoff,
    sellerPayoffText,
    sellerPayoffLabel: noteInfo.isNote ? 'Seller purchase note paid off' : 'Seller paid off',
    renoFromSeller: fromSeller,
    renoNotePrincipal: fromSeller ? repairLoanPayoff : 0,
    renoNoteLabel: 'Seller renovation note paid off',
    renoRate: fromSeller ? lenderRate : null,
    renoCompare: fromSeller
      ? { sellerRate: lenderRate, sellerAmount: drawnUnused, sellerMo: (drawnUnused * lenderRate) / 100 / 12, regularRate: regular.rate, regularPointsPct: regular.pointsPct, regularPoints: regular.points, regularLoan: regular.loan, regularMo: regular.interestMo }
      : null,
    deferred,
    sellerTotalPayoff: sellerPayoff + (fromSeller ? repairLoanPayoff : 0),
    sellerPayoffOverlay,
    repairLoanPayoff,
    repairLoanPayoffContUsed,
    repairLoanOverlay,
    shortCarry,
    closing,
    closingInLoan,
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
  const { plan, rehabBudget, contingency, points, fullLoan, drawnUnused, drawnUsed, lenderRate, interestUnused, interestUsed, shortCarry, fromSeller } = loanInfo;

  const totalUnits = 10;
  const rent = Math.max(0, num(baseIn?.rent, 0));
  const taxesMo = Math.max(0, num(baseIn?.taxes, 0)) / 12;
  const insuranceMo = Math.max(0, num(baseIn?.insurance, 0)) / 12;
  const waterMo = Math.max(0, num(baseIn?.waterMo, 0));
  const emptyUnitUtilMo = Math.max(0, num(baseIn?.emptyUnitUtilMo, 0));
  const reservesPerUnit = Math.max(0, num(baseIn?.reservesPerUnit, BASE_DEFAULTS.reservesPerUnit));
  const noteInfo = sellerNote(offerIn, plan);
  const isNote = noteInfo.isNote;
  const billsFromRent = Boolean(isNote && noteInfo.billsFromRent);
  const sellerLoanMo = isNote
    ? noteInfo.notePay
    : (plan.sellerLoanBalance > 0 ? pmt(plan.sellerLoanRate, plan.sellerLoanYears, plan.sellerLoanBalance) : 0);
  // Seller renovation note: interest only, paid from rent after the bills and the purchase note; any part rent does not cover yet waits.
  const renoMo = fromSeller ? interestUnused : 0;
  const costsWord = billsFromRent ? 'Paid at refi' : (isNote ? 'Note and bills' : 'Seller’s costs');

  const rows = [];
  for (let units = 0; units <= totalUnits; units++) {
    const emptyUnits = totalUnits - units;
    const rentIn = rent * units;
    const emptyUtilTotal = emptyUnits * emptyUnitUtilMo;
    const billsTotal = taxesMo + insuranceMo + waterMo + emptyUtilTotal;

    let renoPaid = 0, renoWaits = 0;
    let notePaid, noteWaits, billsPaidFromRent, billsSellerCarries, sellerCostsBreakdown, sellerCosts, sellerCostsOverlay, covered, noteCovered, aboveSellerCosts;

    if (billsFromRent) {
      // Rent pays holding bills first, then the purchase note, then the seller renovation note. What rent does not cover yet waits and is paid at the refi.
      billsPaidFromRent = Math.min(rentIn, billsTotal);
      billsSellerCarries = Math.max(0, billsTotal - billsPaidFromRent);
      const rentAfterBills = Math.max(0, rentIn - billsPaidFromRent);
      notePaid = Math.min(rentAfterBills, sellerLoanMo);
      noteWaits = Math.max(0, sellerLoanMo - notePaid);
      const noteText = noteWaits > 0
        ? `Note to the seller: ${money(notePaid)}/mo paid from rent, ${money(noteWaits)}/mo waits until the refinance`
        : `Note to the seller: ${money(sellerLoanMo)}/mo paid from rent`;
      renoPaid = Math.min(Math.max(0, rentAfterBills - notePaid), renoMo);
      renoWaits = Math.max(0, renoMo - renoPaid);
      const renoText = renoWaits > 0
        ? `Renovation note: ${money(renoPaid)}/mo paid from rent, ${money(renoWaits)}/mo waits until the refi`
        : `Renovation note: ${money(renoMo)}/mo paid from rent`;
      sellerCostsBreakdown = [
        taxesMo > 0 ? { key: 'taxes', label: 'Property tax', amount: taxesMo, estimate: false, text: `Property tax: ${money(taxesMo)}/mo` } : null,
        insuranceMo > 0 ? { key: 'insurance', label: 'Insurance', amount: insuranceMo, estimate: true, text: `Insurance: ${money(insuranceMo)}/mo` } : null,
        waterMo > 0 ? { key: 'water', label: 'Water and trash', amount: waterMo, estimate: true, text: `Water and trash: ${money(waterMo)}/mo` } : null,
        emptyUtilTotal > 0 ? { key: 'emptyUtils', label: `Empty-unit utilities (${emptyUnits})`, amount: emptyUtilTotal, estimate: true, text: `Empty-unit utilities (${emptyUnits} × ${money(emptyUnitUtilMo)}): ${money(emptyUtilTotal)}/mo` } : null,
        sellerLoanMo > 0 ? { key: 'sellerLoan', label: 'Note to the seller', amount: notePaid, estimate: true, text: noteText } : null,
        renoMo > 0 ? { key: 'renoNote', label: 'Renovation note', amount: renoPaid, estimate: true, text: renoText } : null,
      ].filter(Boolean);
      sellerCosts = billsSellerCarries + noteWaits + renoWaits;
      sellerCostsOverlay = [
        ...sellerCostsBreakdown.filter((i) => i.key !== 'sellerLoan' && i.key !== 'renoNote').map((i) => i.text),
        `Holding bills total: ${money(billsTotal)}/mo.`,
        `Paid from rent: ${money(billsPaidFromRent)}/mo.`,
        billsSellerCarries > 0 ? `Bills that wait for the refi: ${money(billsSellerCarries)}/mo.` : 'Bills covered by rent.',
        sellerLoanMo > 0 ? noteText : null,
        renoMo > 0 ? renoText : null,
        `Paid at refi: ${money(billsSellerCarries + noteWaits + renoWaits)}/mo.`,
      ].filter(Boolean);
      covered = units === 0 ? 'no' : (rentIn + 1e-6 < billsTotal + sellerLoanMo + renoMo ? 'partly' : 'yes');
      noteCovered = units === 0 ? 'no' : (rentAfterBills + 1e-6 < sellerLoanMo + renoMo ? 'partly' : 'yes');
      aboveSellerCosts = Math.max(0, rentIn - billsTotal - sellerLoanMo - renoMo);
    } else {
      billsPaidFromRent = 0;
      billsSellerCarries = 0;
      // Seller financing: rent pays the note first. Any part of a payment rent doesn't cover waits and is paid at the refinance.
      notePaid = isNote ? Math.min(rentIn, sellerLoanMo) : sellerLoanMo;
      noteWaits = isNote ? Math.max(0, sellerLoanMo - notePaid) : 0;
      renoPaid = Math.min(Math.max(0, rentIn - notePaid), renoMo);
      renoWaits = Math.max(0, renoMo - renoPaid);
      const noteText = noteWaits > 0
        ? `Note to the seller: ${money(notePaid)}/mo paid from rent, ${money(noteWaits)}/mo waits until the refinance`
        : `${isNote ? 'Note to the seller' : 'Seller’s loan'}: ${money(sellerLoanMo)}/mo`;
      sellerCostsBreakdown = [
        sellerLoanMo > 0 ? { key: 'sellerLoan', label: isNote ? 'Note to the seller' : 'Seller’s loan', amount: notePaid, estimate: true, text: noteText } : null,
        renoMo > 0 ? { key: 'renoNote', label: 'Renovation note', amount: renoPaid, estimate: true, text: renoWaits > 0 ? `Renovation note: ${money(renoPaid)}/mo paid from rent, ${money(renoWaits)}/mo waits until the refi` : `Renovation note: ${money(renoMo)}/mo` } : null,
        taxesMo > 0 ? { key: 'taxes', label: 'Property tax', amount: taxesMo, estimate: false, text: `Property tax: ${money(taxesMo)}/mo` } : null,
        insuranceMo > 0 ? { key: 'insurance', label: 'Insurance', amount: insuranceMo, estimate: true, text: `Insurance: ${money(insuranceMo)}/mo` } : null,
        waterMo > 0 ? { key: 'water', label: 'Water and trash', amount: waterMo, estimate: true, text: `Water and trash: ${money(waterMo)}/mo` } : null,
        emptyUtilTotal > 0 ? { key: 'emptyUtils', label: `Empty-unit utilities (${emptyUnits})`, amount: emptyUtilTotal, estimate: true, text: `Empty-unit utilities (${emptyUnits} × ${money(emptyUnitUtilMo)}): ${money(emptyUtilTotal)}/mo` } : null,
      ].filter(Boolean);

      sellerCosts = notePaid + renoPaid + taxesMo + insuranceMo + waterMo + emptyUtilTotal;
      sellerCostsOverlay = sellerCostsBreakdown.length
        ? [...sellerCostsBreakdown.map((i) => i.text), `${isNote ? 'Note and bills' : 'Total seller’s costs'}: ${money(sellerCosts)}/mo.`]
        : ['$0/mo'];

      covered = units === 0 ? 'no' : (rentIn + 1e-6 < sellerCosts ? 'partly' : 'yes');
      noteCovered = units === 0 ? 'no' : (rentIn + 1e-6 < sellerLoanMo + renoMo ? 'partly' : 'yes');
      // Master lease: a shortfall below the seller's costs stays the seller's. Seller financing: the note and bills are the owner's, so a shortfall is ours.
      aboveSellerCosts = isNote ? rentIn - sellerCosts : Math.max(0, rentIn - sellerCosts);
    }

    const reservesMo = (units * reservesPerUnit) / 12;
    const buyerCosts = (fromSeller ? 0 : interestUnused) + reservesMo;
    const buyerCostsContUsed = (fromSeller ? 0 : interestUsed) + reservesMo;

    const buyerCostsBreakdown = [
      !fromSeller && interestUnused > 0 ? { key: 'interest', label: 'Repair-loan interest', amount: interestUnused, estimate: true, text: `Repair-loan interest (${money(drawnUnused)} at ${lenderRate}%): ${money(interestUnused)}/mo` } : null,
      reservesMo > 0 ? { key: 'reserves', label: `Reserves (${units} rented)`, amount: reservesMo, estimate: true, text: `Reserves (${units} × ${money(reservesPerUnit)}/yr ÷ 12): ${money(reservesMo)}/mo` } : null,
    ].filter(Boolean);

    const buyerCostsContUsedBreakdown = [
      !fromSeller && interestUsed > 0 ? { key: 'interest', label: 'Repair-loan interest', amount: interestUsed, estimate: true, text: `Repair-loan interest (${money(drawnUsed)} at ${lenderRate}%): ${money(interestUsed)}/mo` } : null,
      reservesMo > 0 ? { key: 'reserves', label: `Reserves (${units} rented)`, amount: reservesMo, estimate: true, text: `Reserves (${units} × ${money(reservesPerUnit)}/yr ÷ 12): ${money(reservesMo)}/mo` } : null,
    ].filter(Boolean);

    const buyerNet = aboveSellerCosts - buyerCosts;
    const buyerNetContUsed = aboveSellerCosts - buyerCostsContUsed;

    const aboveLabel = billsFromRent
      ? `Rent after bills and ${renoMo > 0 ? 'notes' : 'note'}: ${money(aboveSellerCosts)}/mo`
      : `${isNote ? 'Rent after the note and bills' : 'Above seller’s costs'}: ${money(aboveSellerCosts)}/mo`;
    const waitNoteLine = billsFromRent && (billsSellerCarries > 0 || noteWaits > 0 || renoWaits > 0)
      ? 'You pay $0 out of pocket for the notes or bills during lease-up.'
      : null;

    const buyerNetOverlay = [
      aboveLabel,
      waitNoteLine,
      ...buyerCostsBreakdown.map((i) => i.text),
      `You net: ${money(buyerNet)}/mo.`,
    ].filter(Boolean);

    const buyerNetContUsedOverlay = [
      aboveLabel,
      waitNoteLine,
      ...buyerCostsContUsedBreakdown.map((i) => i.text),
      `You net (contingency used): ${money(buyerNetContUsed)}/mo.`,
    ].filter(Boolean);

    rows.push({
      units,
      rentIn,
      sellerCosts,
      sellerCostsBreakdown,
      sellerCostsOverlay,
      covered,
      noteCovered,
      notePaid,
      noteWaits,
      renoPaid,
      renoWaits,
      billsTotal,
      billsPaidFromRent,
      billsSellerCarries,
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
  const noteCoveredAt = rows.find((r) => r.noteCovered === 'yes')?.units ?? null;
  const breakEvenUnits = rows.find((r) => r.buyerNet >= -1e-6)?.units ?? null;
  const breakEvenUnitsContUsed = rows.find((r) => r.buyerNetContUsed >= -1e-6)?.units ?? null;
  const refiResult = refi(baseIn, planIn, offerIn);

  return {
    rows,
    isNote,
    billsFromRent,
    notePay: isNote ? sellerLoanMo : 0,
    renoPay: renoMo,
    renoFromSeller: fromSeller,
    oneBudget: fromSeller,
    costsLabel: costsWord,
    sellerCoveredAt,
    noteCoveredAt,
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
      closingInLoan: loanInfo.closingInLoan,
      fromSeller,
      rate: lenderRate,
      regular: loanInfo.regular,
    },
    refi: refiResult,
    refiTrigger: plan.refiTrigger,
  };
}

// Rent and value views for the lender, reviewer and owner pages: unit by unit rent vs market,
// as is / after repairs / full market side by side, and a rent × cap rate value grid.
// Costs follow the refinance math: taxes, insurance, water, reserves and empty-unit utilities. No management, admin or turnover.
export function rentValue(baseIn = {}, planIn = {}, offerIn = {}) {
  const loanInfo = repairLoanNumbers(baseIn, planIn, offerIn);
  const { plan, rehabBudget, contingency } = loanInfo;
  const ourRent = Math.max(0, num(baseIn?.rent, 0));
  const vacancyPct = num(baseIn?.vacancyPct, BASE_DEFAULTS.vacancyPct);
  const taxesMo = Math.max(0, num(baseIn?.taxes, 0)) / 12;
  const insuranceMo = Math.max(0, num(baseIn?.insurance, 0)) / 12;
  const waterMo = Math.max(0, num(baseIn?.waterMo, 0));
  const emptyUnitUtilMo = Math.max(0, num(baseIn?.emptyUnitUtilMo, 0));
  const reservesPerUnit = Math.max(0, num(baseIn?.reservesPerUnit, BASE_DEFAULTS.reservesPerUnit));
  const capRate = num(baseIn?.valueCapRate, 9) > 0 ? num(baseIn?.valueCapRate, 9) : 9;
  const noteInfo = sellerNote(offerIn, plan);
  const buyout = noteInfo.isNote ? noteInfo.note : Math.max(0, num(plan.sellerLoanBalance, 0));
  const buyoutWord = noteInfo.isNote ? 'Seller’s note' : 'Buyout';
  const repairs = rehabBudget + contingency;

  const unitRents = baseIn?.unitRents && typeof baseIn.unitRents === 'object' ? baseIn.unitRents : {};
  const schedule = unitSchedule(baseIn, plan);
  const units = [...schedule]
    .sort((a, z) => (Number(a.id) || 0) - (Number(z.id) || 0))
    .map((u) => {
      const typed = unitRents[String(u.id)] || {};
      const marketRent = optNum(typed.marketRent) ?? u.marketRent ?? null;
      return {
        id: String(u.id),
        repairs: num(u.rehab),
        occupied: !!u.occupied,
        // A rented unit with no known rent counts as $0 today; no rent is guessed.
        rentToday: optNum(typed.rentToday) ?? u.rentToday ?? (u.occupied ? 0 : null),
        ourRent,
        marketRent,
        gap: marketRent === null ? null : marketRent - ourRent,
        note: u.note || '',
      };
    });
  const total = units.length || 10;

  const costsFor = (rented) => {
    const empty = Math.max(0, total - rented);
    const lines = [
      taxesMo > 0 ? [`Property tax`, taxesMo] : null,
      insuranceMo > 0 ? [`Insurance`, insuranceMo] : null,
      waterMo > 0 ? [`Water and trash`, waterMo] : null,
      rented > 0 && reservesPerUnit > 0 ? [`Reserves (${rented} rented)`, (rented * reservesPerUnit) / 12] : null,
      empty > 0 && emptyUnitUtilMo > 0 ? [`Empty-unit utilities (${empty})`, empty * emptyUnitUtilMo] : null,
    ].filter(Boolean);
    return { amount: lines.reduce((s, [, v]) => s + v, 0), overlay: lines.map(([l, v]) => `${l}: ${money(v)}/mo`) };
  };

  const view = (key, label, rented, grossMo, applyVacancy, allIn, rentOverlay) => {
    const rentMo = applyVacancy ? grossMo * (1 - vacancyPct / 100) : grossMo;
    const costs = costsFor(rented);
    const netYr = (rentMo - costs.amount) * 12;
    const value = Math.max(0, netYr / (capRate / 100));
    return {
      key, label, rented, total, rentMo, costsMo: costs.amount, netYr, value, allIn,
      rentOverlay: [...rentOverlay, applyVacancy ? `Less ${vacancyPct}% vacancy: ${money(rentMo)}/mo` : null].filter(Boolean),
      costsOverlay: costs.overlay.length ? costs.overlay : ['$0/mo'],
      netOverlay: [`(${money(rentMo)} − ${money(costs.amount)}) × 12 = ${money(netYr)}/yr`],
      valueOverlay: [`${money(netYr)}/yr ÷ ${capRate}% cap rate = ${money(value)}`],
      allInOverlay: allIn > buyout ? [`${buyoutWord} ${money(buyout)}`, `Repairs ${money(repairs)}`] : [`${buyoutWord} ${money(buyout)}`],
    };
  };

  const todayRented = units.filter((u) => u.occupied || (u.rentToday ?? 0) > 0);
  const todayGross = units.reduce((s, u) => s + (u.rentToday ?? 0), 0);
  const unknownToday = todayRented.filter((u) => u.rentToday === null).map((u) => u.id);
  const marketGross = units.reduce((s, u) => s + (u.marketRent ?? u.ourRent), 0);
  const views = [
    view('asis', 'As is', todayRented.length, todayGross, false, buyout,
      [`${todayRented.length} of ${total} rented today`, ...unknownToday.map((id) => `Unit ${id}: rent today not entered`)]),
    view('after', 'After repairs', total, total * ourRent, true, buyout + repairs, [`${total} × ${money(ourRent)}/mo = ${money(total * ourRent)}/mo`]),
    view('market', 'Full market rent', total, marketGross, true, buyout + repairs,
      units.map((u) => `Unit ${u.id}: ${money(u.marketRent ?? u.ourRent)}/mo${u.marketRent === null ? ' (our rent)' : ''}`)),
  ];

  const step = 100;
  const rents = [-4, -3, -2, -1, 0, 1].map((k) => ourRent + k * step).filter((r) => r > 0);
  const caps = [capRate, capRate + 1, capRate + 2, capRate + 3];
  const fullCosts = costsFor(total).amount;
  const allInAfter = buyout + repairs;
  const grid = rents.map((r) => {
    const rentMo = total * r * (1 - vacancyPct / 100);
    const netYr = (rentMo - fullCosts) * 12;
    return {
      rent: r,
      cells: caps.map((c) => {
        const value = Math.max(0, netYr / (c / 100));
        return {
          cap: c,
          value,
          clears: value >= allInAfter,
          stabilized: r === ourRent && c === capRate,
          overlay: [
            `${total} units × ${money(r)}/mo, less ${vacancyPct}% vacancy: ${money(rentMo)}/mo`,
            `Less costs: ${money(fullCosts)}/mo`,
            `${money(netYr)}/yr ÷ ${c}% = ${money(value)}`,
            `All in: ${money(allInAfter)}`,
          ],
        };
      }),
    };
  });

  // Market rent range per unit (lender and owner only; the reviewer's copy drops it) and the value range:
  // the locked value is the floor, the high end is value by income after repairs.
  const baseLowRent = optNum(baseIn?.marketRentLow);
  const baseHighRent = optNum(baseIn?.marketRentHigh);
  const lowRent = plan.marketRent ? plan.marketRent.low : (baseLowRent && baseLowRent > 0 ? baseLowRent : null);
  const rawHighRent = plan.marketRent ? plan.marketRent.high : (baseHighRent && baseHighRent > 0 ? baseHighRent : null);
  const highRent = rawHighRent !== null && baseHighRent && baseHighRent > rawHighRent ? baseHighRent : rawHighRent;
  const marketRange = lowRent !== null && highRent !== null && highRent >= lowRent && lowRent > 0
    ? { low: lowRent, high: highRent, units: total, vacancyPct, costsMo: fullCosts, capRate, allIn: allInAfter }
    : null;
  const floor = Math.max(0, num(baseIn?.value, 0));
  const top = views[1].value;
  const valueRange = floor > 0 && top > floor
    ? { low: floor, high: top, lowOverlay: ['Value used for the refinance'], highOverlay: [...views[1].netOverlay, ...views[1].valueOverlay] }
    : null;

  return { version: 1, ourRent, capRate, allIn: allInAfter, buyout, repairs, units, views, caps, grid, marketRange, valueRange };
}

export function buildLeadGuide(baseIn = {}, planIn = {}, offerIn = {}, _comps = []) {
  const plan = normalizePlan(planIn);
  const cs = buildCostSummary(baseIn, plan);
  const table = unitsRentedTable(baseIn, plan, offerIn);
  const x = offerIn?.inputs && typeof offerIn.inputs === 'object' ? offerIn.inputs : {};
  const bridge = {
    purchase: Math.max(0, num(baseIn?.purchasePrice, 0))
      || Math.max(0, num(x.note, 0))
      || Math.max(0, num(x.optionPrice, 0))
      || Math.max(0, num(x.buyout, 0))
      || Math.max(0, num(x.price, 0))
      || Math.max(0, num(plan.sellerLoanBalance, 0)),
    repairs: Math.max(0, num(baseIn?.bridgeRepairs, 0))
      || cs.total
      || Math.max(0, num(baseIn?.rehab, 0)),
    closing: Math.max(0, num(baseIn?.bridgeClosing, 0))
      || Math.max(0, num(plan.bridgeClosing, 0))
      || Math.max(0, num(x.exerciseClosing, 0))
      || Math.max(0, num(x.closing, 0))
      || Math.max(0, num(table.refi?.closingInLoan, 0)),
    processing: baseIn?.bridgeProcessing !== undefined && baseIn?.bridgeProcessing !== ''
      ? Math.max(0, num(baseIn.bridgeProcessing, 0))
      : Math.max(0, num(plan.bridgeProcessing, PLAN_DEFAULTS.bridgeProcessing)),
    pointsPct: baseIn?.bridgePointsPct !== undefined && baseIn?.bridgePointsPct !== ''
      ? Math.max(0, num(baseIn.bridgePointsPct, 0))
      : Math.max(0, num(plan.bridgePoints, PLAN_DEFAULTS.bridgePoints)),
    ratePct: baseIn?.bridgeRate !== undefined && baseIn?.bridgeRate !== ''
      ? Math.max(0, num(baseIn.bridgeRate, 0))
      : Math.max(0, num(plan.bridgeRate, PLAN_DEFAULTS.bridgeRate)),
  };
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
    billsFromRent: table.billsFromRent,
    costsLabel: table.costsLabel,
    sellerCoveredAt: table.sellerCoveredAt,
    breakEvenUnits: table.breakEvenUnits,
    breakEvenUnitsContUsed: table.breakEvenUnitsContUsed,
    oneBudget: table.oneBudget,
    renoFromSeller: table.renoFromSeller,
    refi: table.refi,
    bridge,
    rentValue: rentValue(baseIn, plan, offerIn),
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

  const unitsCount = table.rows.length ? table.rows[table.rows.length - 1].units : 10;
  if (table.isNote) return sellerNoteSummary({ title, table, guide, costSummary, unitsCount });
  const intro = 'I take over the leasing and the repairs. Rent pays your costs first. Once every unit is rented, I buy the building through a refinance.';
  const sellerTable = table.rows.map((r) => ({ units: r.units, rentIn: r.rentIn, covered: r.covered }));
  const payoffText = sellerLoanText(table.refi.sellerPayoff, true);
  const refiLine = `Once all ${unitsCount} are rented, I refinance and pay you ${payoffText}, and your loan is paid off.`;

  const SELLER_COST_WORDS = { sellerLoan: 'your loan', taxes: 'taxes', insurance: 'insurance', water: 'water' };
  const emptyRow = table.rows[0] || { sellerCostsBreakdown: [] };
  const keepPaying = (emptyRow.sellerCostsBreakdown || []).filter((i) => SELLER_COST_WORDS[i.key] && i.amount > 0);
  const keepWords = keepPaying.map((i) => SELLER_COST_WORDS[i.key]);
  const joinWords = (w) => (w.length <= 1 ? (w[0] || '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);
  const keepValue = keepWords.length ? joinWords(keepWords).replace(/^./, (c) => c.toUpperCase()) : 'Your current holding costs';
  const keepOverlay = (emptyRow.sellerCostsBreakdown || [])
    .filter((i) => i.amount > 0)
    .map((i) => (i.key === 'emptyUtils'
      ? `Utilities on each empty unit: ${money(i.amount / Math.max(1, unitsCount))}/mo`
      : `${i.key === 'sellerLoan' ? 'Your loan' : i.label}: ${money(i.amount)}/mo`));

  const coveredAt = table.sellerCoveredAt;
  const terms = [
    { label: 'Buyout', value: payoffText, overlay: ['Paid at the refinance. Your loan is paid off.', structure === 'seller_rehab' ? OPTION_E_OVERLAY : null].filter(Boolean) },
    { label: 'You keep paying', value: keepValue, overlay: keepOverlay },
    { label: 'Rent pays you first', value: coveredAt !== null ? `Covered at ${coveredAt} units rented` : 'Rent goes to your costs first', overlay: [] },
    { label: 'I buy when', value: `All ${unitsCount} units are rented`, overlay: ['I refinance and pay you off then.'] },
  ];

  const repairsTotal = Math.round(num(costSummary.total, 0));
  const repairsOverlay = (costSummary.lines || []).map((l) => l.label.replace(/^Setup /, 'Setup ')).filter(Boolean);
  const steps = [
    { title: 'Master lease', detail: 'We sign a master lease. I take over the leasing and the repairs.', overlay: [] },
    { title: 'Repairs', detail: repairsTotal > 0 ? `I pay for the repairs, ${money(repairsTotal)}. You put in nothing.` : 'I pay for the repairs. You put in nothing.', overlay: repairsOverlay },
    { title: 'Rent', detail: coveredAt !== null ? `Rent pays your costs first. You are covered at ${coveredAt} units rented.` : 'Rent pays your costs first.', overlay: [] },
    { title: 'Refinance', detail: `Once all ${unitsCount} are rented, I refinance and pay you ${payoffText}.`, overlay: [] },
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

// Seller-facing summary for seller financing. Steps and the seller's own terms only; none of the buyer's numbers.
function sellerNoteSummary({ title, table, guide, costSummary, unitsCount }) {
  const billsFromRent = Boolean(table.billsFromRent);
  const rf = table.refi || {};
  const reno = Boolean(table.renoFromSeller && rf.renoFromSeller);
  const payoffText = sellerLoanText(rf.sellerPayoff, true);
  const notePrincipalText = sellerLoanText(rf.sellerNotePrincipal ?? rf.sellerPayoff, true);
  const deferredAmt = Math.round(num(rf.sellerCarriedBills, 0));
  const renoAmt = reno ? Math.round(num(rf.renoNotePrincipal, 0)) : 0;
  const totalText = money(num(rf.sellerPayoff, 0) + renoAmt);
  const coveredAt = billsFromRent ? table.sellerCoveredAt : table.noteCoveredAt;
  const notePay = table.notePay;
  const renoPay = reno ? num(table.renoPay, 0) : 0;
  const BILL_KEYS = ['taxes', 'insurance', 'water', 'emptyUtils'];
  const sellerTable = table.rows.map((r) => {
    const billsList = (r.sellerCostsBreakdown || []).filter((i) => BILL_KEYS.includes(i.key));
    const billsTotal = billsList.reduce((s, i) => s + i.amount, 0);
    const waits = num(r.noteWaits, 0) + num(r.renoWaits, 0);
    return {
      units: r.units,
      rentIn: r.rentIn,
      note: (r.notePaid ?? notePay) + num(r.renoPaid, 0),
      ...(waits > 0 ? { noteWaits: waits } : {}),
      bills: billsFromRent ? (r.billsSellerCarries ?? 0) : billsTotal,
      billsLines: billsFromRent
        ? [
            ...billsList.map((i) => i.text),
            `Paid from rent: ${money(r.billsPaidFromRent ?? 0)}/mo`,
            (r.billsSellerCarries ?? 0) > 0
              ? `Added to your payoff: ${money(r.billsSellerCarries)}/mo`
              : 'All bills paid from rent',
          ]
        : billsList.map((i) => i.text),
      covered: billsFromRent ? r.covered : r.noteCovered,
    };
  });
  const rl = table.repairLoan || {};
  const repairLend = Math.round(num(rl.rehabBudget, 0) + num(rl.closingInLoan, 0) + num(rl.contingency, 0));
  const repairLendOverlay = [
    rl.rehabBudget + rl.contingency > 0 ? `Repair budget: ${money(num(rl.rehabBudget, 0) + num(rl.contingency, 0))}` : null,
    rl.closingInLoan > 0 ? `Closing costs: ${money(rl.closingInLoan)}` : null,
    num(rl.contingency, 0) > 0 ? `Contingency: ${money(rl.contingency)}, added only if used` : null,
    'A second seller note. Paid from rent as units are rented, then paid back in full.',
  ].filter(Boolean);
  const rc = rf.renoCompare || null;
  // Seller sees only their own note terms; the regular lender's rate and points are never on the seller page.
  const compareOverlay = rc
    ? [
        `${money(rc.sellerMo)}/mo when your payments are full.`,
      ]
    : [];
  const repairsTotal = Math.round(num(costSummary.total, 0));
  const repairsOverlay = (costSummary.lines || []).map((l) => l.label).filter(Boolean);
  const coveredLine = coveredAt !== null ? ` Everything is covered at ${coveredAt} units rented.` : '';
  const fullAt = coveredAt !== null ? `at ${coveredAt} units rented` : 'once enough units are rented';

  if (reno) {
    const payLines = [
      `Purchase note: ${money(notePay)}/mo`,
      `Renovation note: ${money(renoPay)}/mo`,
      `Full payment: ${money(notePay + renoPay)}/mo, ${fullAt}.`,
      'Payments start as units are rented and grow with each one. Rent pays the holding bills first, then you. Any part not paid yet is added to what you are paid back.',
    ];
    const payoffLines = [
      `Purchase note: ${notePrincipalText}`,
      `Renovation note: ${money(renoAmt)}`,
      deferredAmt > 0 ? `Deferred holding costs: ${money(deferredAmt)}` : null,
      `Total paid back: ${totalText}, on top of your payments from rent.`,
    ].filter(Boolean);
    const terms = [
      { label: 'Purchase note', value: notePrincipalText, overlay: ['Seller financing. You deed the building to the buyer at closing. Paid from rent as units are rented, then paid back in full.'] },
      { label: 'Renovation note', value: money(renoAmt), overlay: repairLendOverlay },
      ...(rc ? [
        { label: 'Renovation note rate', value: `${rc.sellerRate}% a year`, overlay: compareOverlay },
      ] : []),
      { label: 'Your payments', value: `Up to ${money(notePay + renoPay)}/mo`, overlay: payLines },
      ...(billsFromRent ? [{ label: 'Holding bills', value: 'Paid from rent first', overlay: ['Rent pays property tax, insurance, water and trash first. Any part rent does not cover yet is added to your payoff.'] }] : []),
      { label: 'All covered', value: coveredAt !== null ? `At ${coveredAt} units rented` : 'Paid from rent as units fill', overlay: [] },
      { label: 'Paid back in full', value: totalText, overlay: payoffLines },
    ];
    const steps = [
      { title: 'Seller financing', detail: `At closing you deed the building to the buyer. Your purchase note is reported as ${notePrincipalText}. You can change this if it's not accurate. The buyer takes over the leasing and the repairs.`, overlay: [] },
      { title: 'Repairs', detail: `You fund the repairs with a second seller note, ${money(renoAmt)}, at ${rf.renoRate}% a year${num(rl.contingency, 0) > 0 ? `, plus a ${money(rl.contingency)} contingency only if it's needed` : ''}. The buyer runs the work.`, overlay: [...repairsOverlay, ...compareOverlay] },
      { title: 'Paid as units are rented', detail: billsFromRent
        ? `Your payments start as units are rented and grow with each one. Rent pays the property tax, insurance, water and trash first, then you. ${fullAt[0].toUpperCase()}${fullAt.slice(1)} you get the full ${money(notePay + renoPay)} a month: ${money(notePay)} on the purchase note and ${money(renoPay)} on the renovation note. Any part not paid before then is added to what you are paid back.`
        : `Your payments start as units are rented and grow with each one. ${fullAt[0].toUpperCase()}${fullAt.slice(1)} you get the full ${money(notePay + renoPay)} a month: ${money(notePay)} on the purchase note and ${money(renoPay)} on the renovation note. Any part not paid before then is added to what you are paid back. The buyer pays the taxes, insurance, water and trash.`, overlay: payLines },
      { title: 'Paid back in full', detail: `You are paid back in full, ${totalText}, on top of your payments from rent.`, overlay: payoffLines },
    ];
    return {
      version: 1,
      locked: false,
      billsFromRent,
      renoFromSeller: true,
      title,
      intro: billsFromRent
        ? 'Seller financing with two seller notes: the purchase note and a renovation note that pays for the repairs. Rent pays the holding bills first, then both notes. Any part rent does not cover yet is added to your payoff.'
        : 'Seller financing with two seller notes: the purchase note and a renovation note that pays for the repairs. Rent pays both notes. Any part rent does not cover yet is added to your payoff.',
      sellerTable,
      sellerCoveredAt: coveredAt,
      refiLine: `Your payments grow as units are rented, up to ${money(notePay + renoPay)} a month, then you are paid back in full: ${totalText}.`,
      terms,
      steps,
      guide,
    };
  }

  const optionTerm = repairLend > 0 ? [{ label: 'You can also fund the repairs', value: `${money(repairLend)} second note`, overlay: repairLendOverlay }] : [];
  const optionStep = repairLend > 0 ? [{ title: 'Your choice: fund the repairs', detail: `You can also be the buyer's repair lender: ${money(repairLend)} as a second note, paid off at the refinance with your first note.`, overlay: repairLendOverlay }] : [];
  const repairsStep = { title: 'Repairs', detail: repairsTotal > 0 ? `The buyer pays for the repairs, ${money(repairsTotal)}. You put in nothing.` : 'The buyer pays for the repairs. You put in nothing.', overlay: repairsOverlay };

  if (billsFromRent) {
    const terms = [
      { label: 'Your note', value: notePrincipalText, overlay: [`Seller financing. You deed the building to the buyer at closing. Paid back in full when all ${unitsCount} units are rented.`] },
      { label: 'Note payment', value: `${money(notePay)}/mo`, overlay: ['Paid from rent after property tax, insurance, water and trash. Any part rent does not cover yet is added to your payoff.'] },
      { label: 'Holding bills', value: 'Paid from rent first', overlay: ['Rent pays property tax, insurance, water and trash first. Any part rent does not cover yet is added to your payoff.'] },
      { label: 'All bills + note covered', value: coveredAt !== null ? `Covered at ${coveredAt} units rented` : 'Rent pays bills first, then note', overlay: [] },
      { label: 'Paid off when', value: `All ${unitsCount} units are rented`, overlay: [`The buyer refinances and pays off your note (${notePrincipalText})${deferredAmt > 0 ? ` plus ${money(deferredAmt)} in deferred holding costs` : ''}.`] },
      ...optionTerm,
    ];
    const steps = [
      { title: 'Seller financing', detail: `At closing you deed the building to the buyer. Your note is ${notePrincipalText}. The buyer takes over the leasing and the repairs.`, overlay: [] },
      repairsStep,
      { title: 'Rent', detail: `Rent pays the property tax, insurance, water and trash first, then your note.${coveredLine} Any part rent does not cover yet is added to your payoff.`, overlay: [] },
      ...optionStep,
      { title: 'Refinance', detail: `Once all ${unitsCount} are rented, the buyer refinances and pays off your note${deferredAmt > 0 ? ' and the deferred holding costs' : ''}.`, overlay: [] },
    ];
    return {
      version: 1,
      locked: false,
      billsFromRent: true,
      title,
      intro: 'Seller financing. Rent pays the holding bills (property tax, insurance, water and trash) first, then your note. Any part rent does not cover yet is added to your payoff.',
      sellerTable,
      sellerCoveredAt: coveredAt,
      refiLine: deferredAmt > 0
        ? `Once all ${unitsCount} are rented, the buyer refinances and pays off your note (${notePrincipalText}) plus ${money(deferredAmt)} in deferred holding costs: ${payoffText}.`
        : `Once all ${unitsCount} are rented, the buyer refinances and pays off your note: ${payoffText}.`,
      terms,
      steps,
      guide,
    };
  }

  const terms = [
    { label: 'Your note', value: notePrincipalText, overlay: [`Seller financing. You deed the building to the buyer at closing. Paid back in full when all ${unitsCount} units are rented.`] },
    { label: 'Note payment', value: `${money(notePay)}/mo`, overlay: ['You keep paying your own loan from it.'] },
    { label: 'Rent pays you first', value: coveredAt !== null ? `Covered at ${coveredAt} units rented` : 'Rent goes to your note first', overlay: ['Any part rent does not cover yet is added to your payoff.', 'The buyer pays the taxes, insurance, water and trash.'] },
    { label: 'Paid off when', value: `All ${unitsCount} units are rented`, overlay: [`The buyer refinances and pays off your note${deferredAmt > 0 ? ` plus ${money(deferredAmt)} in deferred payments` : ''}: ${payoffText}.`] },
    ...optionTerm,
  ];
  const steps = [
    { title: 'Seller financing', detail: `At closing you deed the building to the buyer. Your note is ${notePrincipalText}. The buyer takes over the leasing and the repairs.`, overlay: [] },
    repairsStep,
    { title: 'Rent', detail: `Rent pays your note first.${coveredAt !== null ? ` It is covered at ${coveredAt} units rented.` : ''} Any part rent does not cover yet is added to your payoff. The buyer pays the taxes, insurance, water and trash.`, overlay: [] },
    ...optionStep,
    { title: 'Refinance', detail: `Once all ${unitsCount} are rented, the buyer refinances and pays off your note.`, overlay: [] },
  ];
  return {
    version: 1,
    locked: false,
    title,
    intro: 'Seller financing. Rent pays your note first, and any part rent does not cover yet is paid at refi. Once every unit is rented, the buyer refinances and pays off your note.',
    sellerTable,
    sellerCoveredAt: coveredAt,
    refiLine: `Once all ${unitsCount} are rented, the buyer refinances and pays off your note: ${payoffText}.`,
    terms,
    steps,
    guide,
  };
}

export function nextSellerSummary(offer, result, opts = {}) {
  // Always regenerated from the numbers; the seller page is never typed by hand.
  return buildSellerSummary(offer, result, opts);
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
