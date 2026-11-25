// Deal math. Pure functions, no network. Every default is labeled with where it came from.

// Building numbers shared by every offer. Each deal's real numbers live in its private database row,
// never in this (public) code. These blanks are only a starting template.
export const BASE_FIELDS = [
  ['units', 'Units', 'n'],
  ['tenthUnitRepair', 'Extra repair cost if there are 10 units', '$'],
  ['rent', 'Rent per unit / mo', '$'],
  ['vacancyPct', 'Vacancy + collection loss', '%'],
  ['taxes', 'Taxes / yr', '$'],
  ['insurance', 'Insurance / yr', '$'],
  ['utilities', 'Owner-paid utilities / yr', '$'],
  ['admin', 'Grounds + admin / yr', '$'],
  ['turns', 'Turns / yr', '$'],
  ['mgmtPct', 'Management + maintenance (% of rent collected)', '%'],
  ['reservesPerUnit', 'Reserves per unit / yr', '$'],
  ['value', 'Value after rent-ready (ARV)', '$'],
  ['rehab', 'Rent-ready budget', '$'],
  ['refiRate', 'Refinance rate', '%'],
  ['refiYears', 'Refinance term (years)', 'n'],
  ['refiLtv', 'Most a bank lends, as % of value', '%'],
  ['refiDscr', 'How much rent must exceed the bank payment', 'x'],
  ['refiFeesPct', 'Refinance fees (% of loan)', '%'],
  ['refiFeesFlat', 'Refinance fees, flat', '$'],
  ['refiReserve', 'Cash the bank holds back at refinance', '$'],
];

// How many units can be switched to Airbnb (the switch shows each of these).
export const STR_UNIT_CHOICES = [0, 1, 2, 3];
export const strUnitOptions = () => STR_UNIT_CHOICES.map((n) => [n, n === 0 ? 'None' : `${n} unit${n > 1 ? 's' : ''}`]);

// Short-term rental (Airbnb) assumptions. Defaults are placeholders; each deal's real numbers live in its private row.
export const STR_FIELDS = [
  ['strNightly', 'Nightly rate', '$'],
  ['strOccPct', 'Nights booked', '%'],
  ['strFeesPct', 'Platform fees (% of bookings)', '%'],
  ['strCleaningPerStay', 'Cleaning fee charged per stay', '$'],
  ['strNightsPerStay', 'Average nights per stay', 'n'],
  ['strCostsMo', 'Extra costs per Airbnb unit / mo (utilities, supplies, cleaning)', '$'],
];

// Facts about the building (from the rent roll, bills and seller records). Only the owner can change these.
// Everything else is an assumption anyone with access can try a what-if on.
// Units, rent and the Airbnb switch are what-ifs anyone on the team can try; only the owner's changes save.
export const KNOWN_BASE = ['taxes', 'insurance', 'utilities', 'admin', 'turns'];

export const BASE_DEFAULTS = {
  units: 0, tenthUnitRepair: 30000, rent: 0, vacancyPct: 7,
  strUnits: 0, strNightly: 0, strOccPct: 0, strFeesPct: 15, strCleaningPerStay: 0, strNightsPerStay: 3, strCostsMo: 0, taxes: 0, insurance: 0, utilities: 0, admin: 0, turns: 0,
  mgmtPct: 10, reservesPerUnit: 300, value: 0, rehab: 0,
  refiRate: 7.5, refiYears: 30, refiLtv: 75, refiDscr: 1.25, refiFeesPct: 2.5, refiFeesFlat: 0, refiReserve: 0,
};

export const STRUCTURES = {
  master_lease: {
    label: 'Lease now, buy later',
    fields: [
      ['payment', 'Monthly payment to the seller (once full)', '$'],
      ['optionPrice', 'Price we lock in to buy later', '$'],
      ['sellerAdvances', 'Seller’s upfront money, added to the price', '$'],
      ['creditPct', 'Share of each payment that counts toward the price', '%'],
      ['exerciseClosing', 'Closing costs when we buy', '$'],
      ['buyerCash', 'Your cash in', '$'],
    ],
    defaults: { payment: 0, optionPrice: 0, sellerAdvances: 0, creditPct: 100, exerciseClosing: 0, buyerCash: 0 },
  },
  wrap: {
    label: 'Buy now, seller is paid monthly',
    fields: [
      ['note', 'What we owe the seller (price + their upfront money)', '$'],
      ['rate', 'Interest rate we pay the seller', '%'],
      ['amortYears', 'Years to pay it down (0 = interest only)', 'n'],
      ['sellerLoanPayment', 'Seller’s own loan payment / mo (0 = unknown)', '$'],
      ['buyerCash', 'Your cash in', '$'],
    ],
    defaults: { note: 0, rate: 5, amortYears: 0, sellerLoanPayment: 0, buyerCash: 0 },
  },
  partnership: {
    label: 'Partner now, buy out later',
    fields: [
      ['buyout', 'Buyout price, paid by a refinance', '$'],
      ['sellerAdvances', 'Seller’s upfront money, paid back at buyout', '$'],
      ['stepUp', 'Monthly payment to the seller once full', '$'],
      ['monthsToBuyout', 'Months until we buy them out', 'n'],
      ['closing', 'Closing costs at buyout', '$'],
      ['buyerCash', 'Your cash in', '$'],
    ],
    defaults: { buyout: 0, sellerAdvances: 0, stepUp: 0, monthsToBuyout: 12, closing: 0, buyerCash: 0 },
  },
  cash: {
    label: 'Straight sale with a bank loan',
    fields: [
      ['price', 'Price', '$'],
      ['downPct', 'Down payment', '%'],
      ['rate', 'Loan rate', '%'],
      ['years', 'Loan term (years)', 'n'],
      ['closingPct', 'Closing costs (% of price)', '%'],
    ],
    defaults: { price: 0, downPct: 25, rate: 7.5, years: 30, closingPct: 2 },
  },
};

const num = (v, d = 0) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);

export function pmt(ratePct, years, principal) {
  const r = ratePct / 100 / 12, n = years * 12;
  if (!principal || n <= 0) return 0;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}
export function pv(ratePct, years, payment) {
  const r = ratePct / 100 / 12, n = years * 12;
  if (r === 0) return payment * n;
  return (payment * (1 - (1 + r) ** -n)) / r;
}

export function operating(baseIn = {}) {
  const b = { ...BASE_DEFAULTS, ...Object.fromEntries(Object.entries(baseIn).map(([k, v]) => [k, num(v, BASE_DEFAULTS[k])])) };
  const str = strMonthly(b);
  const strUnits = Math.max(0, Math.min(b.units, Math.round(b.strUnits)));
  const ltrUnits = b.units - strUnits;
  const gpr = ltrUnits * b.rent * 12 + strUnits * str.gross * 12;
  const egi = ltrUnits * b.rent * 12 * (1 - b.vacancyPct / 100) + strUnits * str.collected * 12;
  const mgmt = egi * (b.mgmtPct / 100);
  const fixed = b.taxes + b.insurance + b.utilities + b.admin + b.turns + strUnits * b.strCostsMo * 12;
  const extraRepair = b.units >= 10 ? b.tenthUnitRepair : 0;
  b.rehab += extraRepair;
  const noi = egi - mgmt - fixed;
  const reserves = b.units * b.reservesPerUnit;
  const cashFlow = noi - reserves; // yearly, before any debt or payment to the seller
  const loanByDscr = Math.max(0, pv(b.refiRate, b.refiYears, cashFlow / b.refiDscr / 12));
  const loanByLtv = (b.refiLtv / 100) * b.value;
  const refiLoan = Math.min(loanByDscr, loanByLtv);
  const refiNet = refiLoan - (refiLoan * b.refiFeesPct) / 100 - b.refiFeesFlat - b.refiReserve;
  const refiPayment = pmt(b.refiRate, b.refiYears, refiLoan);
  return { b, str, strUnits, ltrUnits, extraRepair, gpr, egi, mgmt, fixed, noi, reserves, cashFlow, capRate: b.value ? noi / b.value : null, refiLoan, refiLimitedBy: loanByDscr < loanByLtv ? 'DSCR' : 'LTV', refiNet, refiPayment };
}

// One Airbnb unit, per month: what guests pay (gross), and what we collect after platform fees.
export function strMonthly(b) {
  const nights = 30.4 * (b.strOccPct / 100);
  const stays = b.strNightsPerStay > 0 ? nights / b.strNightsPerStay : 0;
  const gross = nights * b.strNightly + stays * b.strCleaningPerStay;
  const collected = gross * (1 - b.strFeesPct / 100);
  return { nights, gross, collected, net: collected - b.strCostsMo };
}

// Occupancy needed to cover fixed costs, reserves and the yearly payment.
const breakEven = (o, debtYearly) => (o.gpr ? (o.fixed + o.reserves + debtYearly) / (o.gpr * (1 - o.b.mgmtPct / 100)) : null);

export function evaluate(structure, inputsIn = {}, baseIn = {}) {
  const o = operating(baseIn);
  const def = STRUCTURES[structure]?.defaults || {};
  const x = { ...def, ...Object.fromEntries(Object.entries(inputsIn).map(([k, v]) => [k, num(v, def[k])])) };
  let debtMonthly = 0, sellerMonthly = 0, sellerNet = null, allIn = 0, cashIn = num(x.buyerCash), extra = [];

  if (structure === 'master_lease') {
    debtMonthly = sellerMonthly = x.payment;
    allIn = x.optionPrice + x.sellerAdvances + x.exerciseClosing + cashIn;
    const needed = Math.max(0, x.optionPrice + x.sellerAdvances + x.exerciseClosing - o.refiNet);
    const credit = (x.payment * x.creditPct) / 100;
    const months = needed === 0 ? 0 : credit > 0 ? needed / credit : Infinity;
    extra = [
      ['Credits needed before a refi can buy it', needed, '$'],
      ['Months until we can buy', months, 'mo'],
      ['You keep after we buy and refinance', o.cashFlow / 12 - o.refiPayment, '$/mo'],
    ];
  } else if (structure === 'wrap') {
    debtMonthly = sellerMonthly = x.amortYears > 0 ? pmt(x.rate, x.amortYears, x.note) : (x.note * x.rate) / 100 / 12;
    if (x.sellerLoanPayment > 0) sellerNet = sellerMonthly - x.sellerLoanPayment;
    allIn = x.note + cashIn;
    extra = [['Seller keeps after their own loan payment', sellerNet, '$/mo']];
  } else if (structure === 'partnership') {
    sellerMonthly = x.stepUp;
    debtMonthly = o.refiPayment; // after the buyout the bank loan is the only payment
    allIn = x.buyout + x.sellerAdvances + x.closing + cashIn;
    const gap = x.buyout + x.sellerAdvances + x.closing - o.refiNet;
    extra = [
      ['You keep before the buyout (after step-ups)', o.cashFlow / 12 - x.stepUp, '$/mo'],
      ['Refinance comes up short at buyout by (negative = cash left over)', gap, '$'],
      ['Seller receives at buyout', x.buyout + x.sellerAdvances, '$'],
    ];
  } else if (structure === 'cash') {
    const loan = x.price * (1 - x.downPct / 100);
    debtMonthly = pmt(x.rate, x.years, loan);
    cashIn = x.price * (x.downPct / 100) + (x.price * x.closingPct) / 100 + o.b.rehab;
    allIn = x.price + (x.price * x.closingPct) / 100 + o.b.rehab;
    sellerMonthly = null; // paid once at closing
    extra = [['Seller is paid at closing', x.price, '$'], ['Loan amount', loan, '$']];
  }

  if (structure !== 'cash') allIn += o.extraRepair;
  const keepMonthly = o.cashFlow / 12 - debtMonthly;
  const dscr = debtMonthly > 0 ? o.cashFlow / (debtMonthly * 12) : Infinity;
  return {
    operating: o,
    inputs: x,
    sellerMonthly,
    sellerNet,
    keepMonthly,
    dscr,
    cashIn,
    cashOnCash: cashIn > 0 ? (keepMonthly * 12) / cashIn : null,
    allIn,
    allInPct: o.b.value ? allIn / o.b.value : null,
    breakEven: breakEven(o, debtMonthly * 12),
    extra,
  };
}

// Generally accepted tests (Nov 19 rule): DSCR 1.20-1.25, break-even <= ~85%, cash-on-cash 8-12%, all-in <= ~75% of ARV.
export function grade(metric, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'none';
  v = Math.round(v * 100) / 100; // grade what is shown, so 1.25x never reads as "close"
  switch (metric) {
    case 'dscr': return v >= 1.25 ? 'pass' : v >= 1.2 ? 'close' : 'fail';
    case 'breakEven': return v <= 0.85 ? 'pass' : v <= 0.9 ? 'close' : 'fail';
    case 'cashOnCash': return v >= 0.08 ? 'pass' : v >= 0.05 ? 'close' : 'fail';
    case 'allInPct': return v <= 0.75 ? 'pass' : v <= 0.8 ? 'close' : 'fail';
    case 'keep': return v > 0 ? 'pass' : 'fail';
    default: return 'none';
  }
}

export const money = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'));
export const pct = (v, d = 0) => (v === null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(d) + '%');

// Exact median $/unit from valid comps, scaled to the property's unit count.
export function compsMedian(comps = [], units = 0) {
  const perUnits = (comps || [])
    .filter((c) => Number.isFinite(+c?.units) && +c.units > 0 && Number.isFinite(+c?.sale_price) && +c.sale_price > 0)
    .map((c) => +c.sale_price / +c.units)
    .sort((a, b) => a - b);
  if (!perUnits.length) return { count: 0, perUnit: null, total: null };
  const mid = Math.floor(perUnits.length / 2);
  const perUnit = perUnits.length % 2 === 1 ? perUnits[mid] : (perUnits[mid - 1] + perUnits[mid]) / 2;
  const n = Math.round(+units || 0);
  return { count: perUnits.length, perUnit, total: n > 0 ? perUnit * n : null };
}

// Income value (NOI / cap rate) is primary; comps median is secondary. Math and valueSource stay in overlays.
export function valueSummary({ base = {}, noi = 0, units = 0, comps = [] } = {}) {
  const unitCount = Math.round(+units || +base.units || 0);
  const capRate = Number.isFinite(+base.valueCapRate) && +base.valueCapRate > 0 ? +base.valueCapRate : 9;
  const noiAnnual = Number.isFinite(+noi) ? +noi : 0;
  const incomeFromNoi = noiAnnual > 0 ? noiAnnual / (capRate / 100) : null;
  const savedVal = Number.isFinite(+base.value) && +base.value > 0 ? +base.value : null;
  const income = base.valueBasis === 'income' && savedVal !== null ? savedVal : (incomeFromNoi ?? savedVal);
  const incomePerUnit = income !== null && unitCount > 0 ? income / unitCount : null;

  let compsCalc = compsMedian(comps, unitCount);
  if (compsCalc.count === 0 && (+base.compsPerUnit > 0 || +base.compsValue > 0)) {
    const perUnit = +base.compsPerUnit > 0 ? +base.compsPerUnit : (unitCount > 0 ? +base.compsValue / unitCount : null);
    const total = +base.compsValue > 0 ? +base.compsValue : (unitCount > 0 && perUnit !== null ? perUnit * unitCount : null);
    compsCalc = { count: Math.round(+base.compsCount || 0), perUnit, total };
  }

  const incomeLine = income !== null
    ? (incomePerUnit !== null ? `Value by income: ${money(income)} (${money(incomePerUnit)}/unit)` : `Value by income: ${money(income)}`)
    : 'Value by income: —';
  const compsLine = compsCalc.total !== null
    ? (compsCalc.perUnit !== null ? `By comps: ${money(compsCalc.total)} (${money(compsCalc.perUnit)}/unit)` : `By comps: ${money(compsCalc.total)}`)
    : null;

  const incomeOverlay = [];
  if (noiAnnual > 0) {
    const computed = noiAnnual / (capRate / 100);
    incomeOverlay.push(`${money(noiAnnual)} yearly NOI ÷ ${capRate}% cap rate = ${money(computed)}${unitCount > 0 ? ` (${money(computed / unitCount)}/unit across ${unitCount} units)` : ''}.`);
  }
  if (savedVal !== null && (noiAnnual <= 0 || Math.abs(savedVal - noiAnnual / (capRate / 100)) >= 500)) {
    incomeOverlay.push(`Saved value on file: ${money(savedVal)}${unitCount > 0 ? ` (${money(savedVal / unitCount)}/unit)` : ''}.`);
  }
  if (base.valueSource) incomeOverlay.push(`Source: ${String(base.valueSource)}`);

  const compsOverlay = compsCalc.total !== null
    ? [`${money(compsCalc.perUnit)} median/unit × ${unitCount} units = ${money(compsCalc.total)}${compsCalc.count ? ` (from ${compsCalc.count} comps)` : ''}.`]
    : [];

  return {
    units: unitCount,
    capRate,
    noiAnnual,
    income,
    incomePerUnit,
    compsCount: compsCalc.count,
    compsPerUnit: compsCalc.perUnit,
    compsTotal: compsCalc.total,
    valueSource: base.valueSource ? String(base.valueSource) : '',
    incomeLine,
    compsLine,
    incomeOverlay,
    compsOverlay,
  };
}

// Snapshot story for non-owner roles (never imports dealplan).
export function buildLeadStory(structure, evalResult, { base = {}, comps = [] } = {}) {
  const o = evalResult.operating;
  const b = o.b;
  const x = evalResult.inputs;
  const val = valueSummary({ base: { ...b, ...base }, noi: o.noi, units: b.units, comps });
  const rentMo = o.egi / 12;
  const runningMo = (o.mgmt + o.fixed + o.reserves) / 12;
  const paymentMo = evalResult.sellerMonthly ?? (o.cashFlow / 12 - evalResult.keepMonthly);
  const fullLeft = evalResult.keepMonthly;

  const advances = structure === 'master_lease' || structure === 'partnership' ? x.sellerAdvances : 0;
  const closingCost = structure === 'master_lease' ? x.exerciseClosing : structure === 'partnership' ? x.closing : 0;
  const sellerPayoffEst = structure === 'master_lease'
    ? x.optionPrice + x.sellerAdvances
    : structure === 'wrap'
      ? x.note
      : structure === 'partnership'
        ? x.buyout + x.sellerAdvances
        : x.price;
  const refiLeft = structure === 'cash' ? null : o.refiNet - sellerPayoffEst - closingCost;
  const maxSellerAtRefi = structure === 'cash' ? null : o.refiNet - closingCost;
  const afterLeft = structure === 'cash' ? fullLeft : o.cashFlow / 12 - o.refiPayment;

  const sellerLine = structure === 'cash'
    ? `Paid ${money(x.price)} at closing`
    : `${money(evalResult.sellerMonthly)}/mo once full`;
  const sellerOverlay = structure === 'master_lease'
    ? [`${money(x.payment)} full payment when all ${b.units} units rent (${x.creditPct}% credited toward the ${money(x.optionPrice)} locked price).`]
    : structure === 'partnership'
      ? [`${money(x.stepUp)} full payment once all ${b.units} units rent.`]
      : structure === 'wrap'
        ? [`${money(x.note)} owed × ${x.rate}% ÷ 12 = ${money(evalResult.sellerMonthly)}/mo${x.amortYears > 0 ? ` (${x.amortYears}-yr amort)` : ' (interest only)'} (seller loan terms are estimates).`]
        : [`${money(x.price)} paid at closing; bank payment ${money(paymentMo)}/mo (${x.downPct}% down, ${x.rate}% / ${x.years} yrs).`];

  const rehabItems = [];
  const baseRehab = Math.max(0, b.rehab - o.extraRepair);
  if (baseRehab > 0) rehabItems.push(`Rent-ready budget: ${money(baseRehab)}`);
  if (o.extraRepair > 0) rehabItems.push(`Unit 10 rehab: ${money(o.extraRepair)}`);
  if (!rehabItems.length) rehabItems.push(`Total rehab budget: ${money(b.rehab)}`);

  const steps = [
    {
      num: 1,
      title: 'Take over',
      lines: [
        { label: 'Seller gets', value: sellerLine, overlay: sellerOverlay },
        {
          label: 'Seller fronts',
          value: money(advances),
          overlay: [advances > 0 ? `${money(advances)} fronted by the seller and paid back at the refinance.` : 'No upfront advance from the seller.'],
        },
      ],
    },
    {
      num: 2,
      title: 'Rehab',
      lines: [
        { label: 'Total rehab', value: money(b.rehab), overlay: [...rehabItems, `Total: ${money(b.rehab)}.`] },
      ],
    },
    {
      num: 5,
      title: 'Full',
      lines: [
        { label: 'Rent in', value: `${money(rentMo)}/mo`, overlay: [`${b.units} units after ${b.vacancyPct}% vacancy = ${money(rentMo)}/mo.`] },
        { label: 'Running costs', value: `${money(runningMo)}/mo`, overlay: [`Management ${money(o.mgmt / 12)}/mo + fixed bills ${money(o.fixed / 12)}/mo + reserves ${money(o.reserves / 12)}/mo = ${money(runningMo)}/mo.`] },
        { label: structure === 'cash' ? 'Bank payment' : 'Seller payment', value: `${money(paymentMo)}/mo`, overlay: sellerOverlay },
        {
          label: fullLeft >= 0 ? 'Left over each month after every bill' : `Short ${money(-fullLeft)} a month`,
          value: `${money(fullLeft)}/mo`,
          tone: fullLeft >= 0 ? 'pass' : 'fail',
          overlay: [`${money(rentMo)} rent − ${money(runningMo)} running costs − ${money(paymentMo)} payment = ${money(fullLeft)}/mo.`],
        },
      ],
    },
    {
      num: 6,
      title: 'Refinance',
      lines: structure === 'cash'
        ? [
            { label: val.incomeLine, value: '', overlay: val.incomeOverlay },
            ...(val.compsLine ? [{ label: val.compsLine, value: '', overlay: val.compsOverlay }] : []),
            { label: 'Loan', value: `${money(x.price * (1 - x.downPct / 100))} at closing`, overlay: [`Straight bank purchase loan from day 1.`] },
          ]
        : [
            { label: val.incomeLine, value: '', overlay: [...val.incomeOverlay, 'No lender has confirmed yet. A lender still has to confirm terms and Unit 10 needs its zoning certificate; the math still runs on today’s numbers.'] },
            ...(val.compsLine ? [{ label: val.compsLine, value: '', overlay: val.compsOverlay }] : []),
            { label: 'Loan', value: money(o.refiLoan), overlay: [`${money(o.refiLoan)} (${o.refiLimitedBy === 'LTV' ? `${b.refiLtv}% of value` : `${b.refiDscr}x rent coverage`}) − fees & holdback = ${money(o.refiNet)} net.`] },
            { label: 'Pays seller', value: money(sellerPayoffEst), overlay: [`Estimated payoff ${money(sellerPayoffEst)} before monthly credits.`] },
            { label: 'Closing', value: money(closingCost), overlay: [`Closing costs at refinance: ${money(closingCost)}.`] },
            {
              label: refiLeft >= 0 ? `You take home ${money(refiLeft)}` : `You bring ${money(-refiLeft)}`,
              value: '',
              big: true,
              tone: refiLeft >= 0 ? 'pass' : 'fail',
              overlay: [`${money(o.refiNet)} net loan − ${money(sellerPayoffEst)} seller − ${money(closingCost)} closing = ${money(refiLeft)}.`],
            },
          ],
    },
    {
      num: 7,
      title: 'After',
      lines: [
        {
          label: afterLeft >= 0 ? 'Left over each month after every bill' : `Short ${money(-afterLeft)} a month after every bill`,
          value: `${money(afterLeft)}/mo`,
          tone: afterLeft >= 0 ? 'pass' : 'fail',
          overlay: [`${money(rentMo)} rent − ${money(runningMo)} running costs − ${money(structure === 'cash' ? paymentMo : o.refiPayment)} bank payment = ${money(afterLeft)}/mo.`],
        },
      ],
    },
  ];

  return {
    headline: {
      moneyIn: {
        label: 'Your money in',
        value: evalResult.cashIn > 0 ? money(evalResult.cashIn) : '$0',
        overlay: [evalResult.cashIn > 0 ? `${money(evalResult.cashIn)} buyer cash in.` : '$0 buyer cash in upfront.'],
      },
      cashOut: {
        label: 'Cash out at refinance',
        value: structure === 'cash' ? 'No refinance' : (refiLeft >= 0 ? money(refiLeft) : `Bring ${money(-refiLeft)}`),
        positive: structure === 'cash' ? null : refiLeft >= 0,
        overlay: structure === 'cash'
          ? ['Straight bank loan from closing; no refinance planned.']
          : [`${money(o.refiNet)} net loan − ${money(sellerPayoffEst)} seller − ${money(closingCost)} closing = ${money(refiLeft)}.`],
      },
      sellerTotal: {
        label: 'Seller gets at payoff',
        value: money(sellerPayoffEst),
        overlay: [`${money(sellerPayoffEst)} at closing/refinance, plus monthly payments along the way.`],
      },
      maxSellerAtRefi: {
        label: 'Most the seller can get at refi with $0 from you',
        value: maxSellerAtRefi !== null ? money(maxSellerAtRefi) : '—',
        overlay: maxSellerAtRefi !== null ? [`${money(o.refiNet)} net loan − ${money(closingCost)} closing = ${money(maxSellerAtRefi)}.`] : [],
      },
    },
    steps,
    value: val,
  };
}
