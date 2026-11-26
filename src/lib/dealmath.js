// Deal math. Pure functions, no network. Every default is labeled with where it came from.

// Building numbers shared by every offer. Each deal's real numbers live in its private database row,
// never in this (public) code. These blanks are only a starting template.
export const BASE_FIELDS = [
  ['rent', 'Rent per unit / mo', '$'],
  ['vacancyPct', 'Vacancy + collection loss', '%'],
  ['taxes', 'Taxes / yr', '$'],
  ['insurance', 'Insurance / yr', '$'],
  ['waterMo', 'Water and trash / mo', '$'],
  ['reservesPerUnit', 'Reserves per unit / yr', '$'],
  ['value', 'Value after repairs', '$'],
  ['rehab', 'Repair budget', '$'],
  ['refiRate', 'Refinance rate', '%'],
  ['refiYears', 'Refinance term (years)', 'n'],
  ['refiLtv', 'Most a bank lends, as % of value', '%'],
  ['refiDscr', 'How much rent must exceed the bank payment', 'x'],
  ['refiFeesPct', 'Refinance fees (% of loan)', '%'],
  ['refiFeesFlat', 'Refinance fees, flat', '$'],
  ['refiReserve', 'Cash the bank holds back at refinance', '$'],
];

// Facts about the building (from the rent roll, bills and seller records). Only the owner can change these.
// Everything else is an assumption anyone with access can try a what-if on.
// Rent is a what-if anyone on the team can try; only the owner's changes save.
export const KNOWN_BASE = ['taxes', 'insurance', 'waterMo', 'emptyUnitUtilMo'];

export const BASE_DEFAULTS = {
  units: 10, rent: 0, vacancyPct: 7,
  taxes: 0, insurance: 0, waterMo: 0, emptyUnitUtilMo: 0, utilities: 0, admin: 0, turns: 0,
  mgmtPct: 0, reservesPerUnit: 300, value: 0, rehab: 0,
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
      ['shortCarry', 'Short months paid by the repair loan ($)', '$'],
      ['buyerCash', 'Your cash in', '$'],
    ],
    defaults: { payment: 0, optionPrice: 0, sellerAdvances: 0, creditPct: 100, exerciseClosing: 0, shortCarry: 0, buyerCash: 0 },
  },
  wrap: {
    label: 'Seller financing',
    fields: [
      ['note', 'What we owe the seller (price + their upfront money)', '$'],
      ['rate', 'Interest rate we pay the seller', '%'],
      ['amortYears', 'Years to pay it down (0 = interest only)', 'n'],
      ['sellerLoanPayment', 'Seller’s own loan payment / mo (0 = unknown)', '$'],
      ['closing', 'Closing costs', '$'],
      ['buyerCash', 'Your cash in', '$'],
      ['billsFromRent', 'Bills paid from rent first; the rest is paid at refi', 'bool'],
      ['renoFromSeller', 'Seller funds the repairs as a second note', 'bool'],
      ['renoRate', 'Seller repair note rate (interest only, no points)', '%'],
    ],
    defaults: { note: 0, rate: 5, amortYears: 0, sellerLoanPayment: 0, closing: 0, shortCarry: 0, buyerCash: 0, billsFromRent: false, renoFromSeller: false, renoRate: 8 },
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
    defaults: { buyout: 0, sellerAdvances: 0, stepUp: 0, monthsToBuyout: 12, closing: 0, shortCarry: 0, buyerCash: 0 },
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
  seller_rehab: {
    label: 'Seller funds part of the rehab, buyout at refi',
    fields: [
      ['sellerFund', 'Seller’s rehab money', '$'],
      ['fillTarget', 'Units filled before you share in the rent', 'n'],
      ['buyerSplitPct', 'Your share of what’s left after that', '%'],
      ['refiMonth', 'Months to the refinance', 'n'],
      ['closing', 'Closing costs at the refinance', '$'],
      ['buyerCash', 'Your cash in', '$'],
      ['addFundToBuyout', 'Add his rehab money to the buyout', 'bool'],
    ],
    defaults: { sellerFund: 0, fillTarget: 7, buyerSplitPct: 50, refiMonth: 12, closing: 0, shortCarry: 0, buyerCash: 0, addFundToBuyout: false },
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
  // All units are long-term rentals; ignore any legacy short-term values.
  const strUnits = 0;
  const ltrUnits = b.units;
  const gpr = ltrUnits * b.rent * 12;
  const egi = gpr * (1 - b.vacancyPct / 100);
  const mgmt = egi * (b.mgmtPct / 100);
  const fixed = b.taxes + b.insurance + b.utilities + b.admin + b.turns;
  const noi = egi - mgmt - fixed;
  const reserves = b.units * b.reservesPerUnit;
  const cashFlow = noi - reserves; // yearly, before any debt or payment to the seller
  const loanByDscr = Math.max(0, pv(b.refiRate, b.refiYears, cashFlow / b.refiDscr / 12));
  const loanByLtv = (b.refiLtv / 100) * b.value;
  const refiLoan = Math.min(loanByDscr, loanByLtv);
  const refiNet = refiLoan - (refiLoan * b.refiFeesPct) / 100 - b.refiFeesFlat - b.refiReserve;
  const refiPayment = pmt(b.refiRate, b.refiYears, refiLoan);
  return { b, strUnits, ltrUnits, gpr, egi, mgmt, fixed, noi, reserves, cashFlow, capRate: b.value ? noi / b.value : null, refiLoan, refiLimitedBy: loanByDscr < loanByLtv ? 'DSCR' : 'LTV', refiNet, refiPayment };
}

// Occupancy needed to cover fixed costs, reserves and the yearly payment.
const breakEven = (o, debtYearly) => (o.gpr ? (o.fixed + o.reserves + debtYearly) / (o.gpr * (1 - o.b.mgmtPct / 100)) : null);

export function evaluate(structure, inputsIn = {}, baseIn = {}) {
  const o = operating(baseIn);
  const def = STRUCTURES[structure]?.defaults || {};
  const x = {
    ...def,
    ...Object.fromEntries(
      Object.entries(inputsIn || {}).map(([k, v]) => [k, typeof def[k] === 'boolean' ? Boolean(v) : num(v, def[k])])
    ),
  };
  let debtMonthly = 0, sellerMonthly = 0, sellerNet = null, allIn = 0, cashIn = num(x.buyerCash), extra = [];

  if (structure === 'master_lease') {
    debtMonthly = sellerMonthly = x.payment;
    allIn = x.optionPrice + x.sellerAdvances + x.exerciseClosing + cashIn;
    const needed = Math.max(0, x.optionPrice + x.sellerAdvances + x.exerciseClosing - o.refiNet);
    extra = [
      ['Credits needed before a refi can buy it', needed, '$'],
      ['You keep after we buy and refinance', o.cashFlow / 12 - o.refiPayment, '$/mo'],
    ];
  } else if (structure === 'wrap') {
    debtMonthly = sellerMonthly = x.amortYears > 0 ? pmt(x.rate, x.amortYears, x.note) : (x.note * x.rate) / 100 / 12;
    if (x.sellerLoanPayment > 0) sellerNet = sellerMonthly - x.sellerLoanPayment;
    allIn = x.note + x.closing + cashIn;
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
  } else if (structure === 'seller_rehab') {
    debtMonthly = o.refiPayment;
    const buyerShare = Math.max(0, Math.min(100, x.buyerSplitPct)) / 100;
    sellerMonthly = Math.max(0, (o.cashFlow / 12) * (1 - buyerShare));
    allIn = (x.addFundToBuyout ? x.sellerFund : 0) + x.closing + cashIn;
    extra = [
      ['Seller’s rehab money', x.sellerFund, '$'],
      ['You keep after refinance', o.cashFlow / 12 - o.refiPayment, '$/mo'],
    ];
  }

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

export function moneyK(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '$0';
  const sign = v < 0 ? '−' : '';
  if (abs < 500) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  return `${sign}$${Math.round(abs / 1000).toLocaleString('en-US')}K`;
}

export function sellerLoanText(amount, forSeller = false) {
  return money(amount);
}

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

  const incomeLine = income !== null ? `Value ${money(income)}` : 'Value —';
  const compsLine = compsCalc.total !== null
    ? (compsCalc.perUnit !== null ? `Value by comps: ${money(compsCalc.total)} (${money(compsCalc.perUnit)}/unit)` : `Value by comps: ${money(compsCalc.total)}`)
    : null;

  const incomeOverlay = [];
  if (income !== null) {
    incomeOverlay.push(incomePerUnit !== null ? `Value by income: ${money(income)} (${money(incomePerUnit)}/unit)` : `Value by income: ${money(income)}`);
  }
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
  const taxesMo = b.taxes / 12;
  const insMo = b.insurance / 12;
  const waterMo = num(b.waterMo, 0);
  const reservesMo = o.reserves / 12;
  const runningMo = taxesMo + insMo + waterMo + reservesMo;
  const runningParts = [
    taxesMo > 0 ? `Taxes ${money(taxesMo)}/mo` : null,
    insMo > 0 ? `Insurance ${money(insMo)}/mo` : null,
    waterMo > 0 ? `Water and trash ${money(waterMo)}/mo` : null,
    reservesMo > 0 ? `Reserves ${money(reservesMo)}/mo` : null,
  ].filter(Boolean);
  const runningOverlay = runningParts.length
    ? [`${runningParts.join(' + ')} = ${money(runningMo)}/mo.`]
    : ['No running costs entered.'];
  const paymentMo = evalResult.sellerMonthly ?? (o.cashFlow / 12 - evalResult.keepMonthly);
  const fullLeft = evalResult.keepMonthly;

  const advances = structure === 'master_lease' || structure === 'partnership' ? x.sellerAdvances : structure === 'seller_rehab' ? x.sellerFund : 0;
  const closingCostRaw = structure === 'master_lease' ? x.exerciseClosing : (structure === 'partnership' || structure === 'seller_rehab' || structure === 'wrap') ? x.closing : 0;
  // Seller repair note (seller financing): the repair budget plus the closing costs rolled into it, paid off at the refi.
  const renoNoteEst = structure === 'wrap' && x.renoFromSeller ? Math.max(0, num(b.rehab, 0)) + Math.max(0, num(x.closing, 0)) : 0;
  const closingCost = renoNoteEst > 0 ? 0 : closingCostRaw;
  const sellerPayoffBase = structure === 'master_lease'
    ? x.optionPrice + x.sellerAdvances
    : structure === 'wrap'
      ? x.note
      : structure === 'partnership'
        ? x.buyout + x.sellerAdvances
        : structure === 'seller_rehab'
          ? (x.addFundToBuyout ? x.sellerFund : 0)
          : x.price;
  const sellerPayoffEst = sellerPayoffBase + renoNoteEst;
  const refiLeft = structure === 'cash' ? null : o.refiNet - sellerPayoffEst - closingCost;
  const maxSellerAtRefi = structure === 'cash' ? null : o.refiNet - closingCost;
  const afterLeft = structure === 'cash' ? fullLeft : o.cashFlow / 12 - o.refiPayment;

  const sellerLine = structure === 'cash'
    ? `Paid ${money(x.price)} at closing`
    : structure === 'seller_rehab'
      ? `${money(evalResult.sellerMonthly)}/mo once full`
      : `${money(evalResult.sellerMonthly)}/mo once full`;
  const sellerOverlay = structure === 'master_lease'
    ? [`${money(x.payment)} full payment when all ${b.units} units rent (${x.creditPct}% credited toward the ${money(x.optionPrice)} locked price).`]
    : structure === 'partnership'
      ? [`${money(x.stepUp)} full payment once all ${b.units} units rent.`]
      : structure === 'wrap'
        ? [`${money(x.note)} owed × ${x.rate}% ÷ 12 = ${money(evalResult.sellerMonthly)}/mo${x.amortYears > 0 ? ` (${x.amortYears}-yr amort)` : ' (interest only)'}.`]
        : structure === 'seller_rehab'
          ? [
              `Seller gets all extra rent until ${x.fillTarget} units are filled, then ${100 - x.buyerSplitPct}% of what is left after his loan payment.`,
              'His rehab money is only paid back through his share of the rent. It is not added to the buyout unless you turn that on.',
            ]
          : [`${money(x.price)} paid at closing; bank payment ${money(paymentMo)}/mo (${x.downPct}% down, ${x.rate}% / ${x.years} yrs).`];

  const rehabItems = [`Repair budget: ${money(b.rehab)}`];

  const steps = [
    {
      num: 1,
      title: 'Take over',
      lines: [
        { label: 'Seller gets', value: sellerLine, overlay: sellerOverlay },
        {
          label: structure === 'seller_rehab' ? 'Seller’s rehab money' : 'Seller fronts',
          value: money(advances),
          overlay: structure === 'seller_rehab'
            ? ['His rehab money is only paid back through his share of the rent. It is not added to the buyout unless you turn that on.']
            : [advances > 0 ? `${money(advances)} fronted by the seller and paid back at the refinance.` : 'No upfront advance from the seller.'],
        },
      ],
    },
    {
      num: 2,
      title: 'Rehab',
      lines: [
        { label: 'Repair budget', value: money(b.rehab), overlay: [...rehabItems, `Total: ${money(b.rehab)}.`] },
      ],
    },
    {
      num: 5,
      title: 'Full',
      lines: structure === 'seller_rehab'
        ? [
            { label: 'Rent in', value: `${money(rentMo)}/mo`, overlay: [`${b.units} units after ${b.vacancyPct}% vacancy = ${money(rentMo)}/mo.`] },
            ...(runningMo > 0 ? [{ label: 'Running costs', value: `${money(runningMo)}/mo`, overlay: runningOverlay }] : []),
            { label: 'Seller gets', value: `${money(evalResult.sellerMonthly)}/mo`, overlay: sellerOverlay },
            {
              label: 'Left over each month after every bill',
              value: `${money(Math.max(0, (o.cashFlow / 12) * (Math.max(0, Math.min(100, x.buyerSplitPct)) / 100)))}/mo`,
              tone: 'pass',
              overlay: sellerOverlay,
            },
          ]
        : [
            { label: 'Rent in', value: `${money(rentMo)}/mo`, overlay: [`${b.units} units after ${b.vacancyPct}% vacancy = ${money(rentMo)}/mo.`] },
            ...(runningMo > 0 ? [{ label: 'Running costs', value: `${money(runningMo)}/mo`, overlay: runningOverlay }] : []),
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
            { label: val.incomeLine, value: '', overlay: [...val.incomeOverlay, 'No lender has confirmed yet. A lender still has to confirm terms; the math still runs on today’s numbers.'] },
            ...(val.compsLine ? [{ label: val.compsLine, value: '', overlay: val.compsOverlay }] : []),
            { label: 'Loan', value: money(o.refiLoan), overlay: [`${money(o.refiLoan)} (${o.refiLimitedBy === 'LTV' ? `${b.refiLtv}% of value` : `${b.refiDscr}x rent coverage`}) − fees & holdback = ${money(o.refiNet)} net.`] },
            {
              label: 'Pays seller',
              value: structure === 'seller_rehab'
                ? (x.addFundToBuyout ? `${money(x.sellerFund)} + his loan` : 'His loan')
                : money(sellerPayoffEst),
              overlay: structure === 'seller_rehab'
                ? ['His remaining loan balance at refinance is paid off.', 'His rehab money is only paid back through his share of the rent. It is not added to the buyout unless you turn that on.']
                : [`Payoff ${money(sellerPayoffEst)} before monthly credits.`],
            },
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
        value: structure === 'seller_rehab'
          ? (x.addFundToBuyout ? `${money(x.sellerFund)} + his loan` : 'His loan')
          : money(sellerPayoffEst),
        overlay: structure === 'seller_rehab'
          ? ['Seller loan payoff at refinance plus monthly rent share.', 'His rehab money is only paid back through his share of the rent. It is not added to the buyout unless you turn that on.']
          : [`${money(sellerPayoffEst)} at closing/refinance, plus monthly payments along the way.`],
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

// Snapshot story for non-owner roles: when the saved units-rented guide has refi numbers, use them so every
// role shows the same payoff and the story adds up step by step (purchase note, repairs, lease-up, full, payoff).
export function applyGuideRefi(story, rf, guide = null) {
  if (!story || !rf || !Number.isFinite(+rf.leftForYou)) return story;
  const left = +rf.leftForYou;
  const sellerTotal = +(rf.sellerTotalPayoff ?? rf.sellerPayoff ?? 0);
  const leftLines = Array.isArray(rf.leftForYouOverlay) ? rf.leftForYouOverlay : [];
  const purchase = +(rf.sellerNotePrincipal ?? 0);
  const reno = rf.renoFromSeller ? +(rf.renoNotePrincipal ?? 0) : 0;
  const deferred = +(rf.sellerCarriedBills ?? 0);
  const payoffLines = [
    { label: 'Purchase note', value: money(purchase), overlay: Array.isArray(rf.sellerPayoffOverlay) ? rf.sellerPayoffOverlay : [], payback: true },
    ...(reno > 0 ? [{ label: 'Renovation note', value: money(reno), overlay: Array.isArray(rf.repairLoanOverlay) ? rf.repairLoanOverlay : [], payback: true }] : []),
    ...(deferred > 0 ? [{ label: 'Bills and payments that waited', value: money(deferred), overlay: Array.isArray(rf.sellerCarriedBillsOverlay) ? rf.sellerCarriedBillsOverlay : [], payback: true }] : []),
    { label: 'Pays seller', value: money(sellerTotal), overlay: [`${money(purchase)} + ${money(reno)} + ${money(deferred)} = ${money(sellerTotal)}.`], payback: true },
  ];
  const next = { ...story, headline: { ...story.headline } };
  next.headline.cashOut = { ...story.headline.cashOut, value: left >= 0 ? money(left) : `Bring ${money(-left)}`, positive: left >= 0, overlay: leftLines };
  next.headline.sellerTotal = { ...story.headline.sellerTotal, value: money(sellerTotal), overlay: payoffLines.map((l) => `${l.label}: ${l.value}`) };

  const last = guide && Array.isArray(guide.rows) && guide.rows.length ? guide.rows[guide.rows.length - 1] : null;
  const notePay = last ? +(last.notePaid ?? 0) : null;
  const renoPay = last ? +(last.renoPaid ?? 0) : 0;
  const rc = rf.renoCompare || null;
  const budget = guide?.costSummary?.total ?? null;
  let steps = (story.steps || []).map((s) => {
    if (s.title === 'Refinance') {
      return {
        ...s,
        lines: [
          ...s.lines.filter((l) => !['Pays seller', 'Closing'].includes(l.label) && !l.big),
          ...payoffLines,
          { label: 'Closing', value: money(+(rf.closing ?? 0)), overlay: [`Closing costs at refinance: ${money(+(rf.closing ?? 0))}.`] },
          { label: left >= 0 ? `You take home ${money(left)}` : `You bring ${money(-left)}`, value: '', big: true, tone: left >= 0 ? 'pass' : 'fail', overlay: leftLines },
        ],
      };
    }
    if (!rf.renoFromSeller) return s;
    if (s.title === 'Take over' && notePay !== null) {
      return { ...s, lines: [
        { label: 'Seller financing: purchase note', value: money(purchase), overlay: [] },
        { label: 'Purchase note payment', value: `${money(notePay)}/mo`, overlay: ['Paid from rent once units are rented.'] },
      ] };
    }
    if (s.title === 'Rehab') {
      return { ...s, lines: [
        ...(budget !== null ? [{ label: 'Repair budget', value: money(budget), overlay: s.lines[0]?.overlay || [] }] : s.lines),
        ...(+(rf.closingInLoan ?? 0) > 0 ? [{ label: 'Closing costs rolled in', value: money(+rf.closingInLoan), overlay: [] }] : []),
        ...(+(guide?.costSummary?.contingency ?? 0) > 0 ? [{ label: 'Contingency', value: `${money(+guide.costSummary.contingency)}, only if used`, overlay: ['Not in the note unless it is used.'] }] : []),
        { label: 'Seller renovation note', value: rc ? `${money(reno)} at ${rc.sellerRate}%, no points` : money(reno), overlay: rc ? [`Interest only: ${money(rc.sellerMo)}/mo, paid from rent once units are rented.`] : [] },
        ...(rc ? [{ label: 'Or a repair loan', value: `${rc.regularRate}% + ${rc.regularPointsPct} points`, overlay: [`Interest only: ${money(rc.regularMo)}/mo, plus ${money(rc.regularPoints)} in points upfront.`] }] : []),
      ] };
    }
    if (s.title === 'Full' && notePay !== null) {
      const payments = notePay + renoPay;
      const fullLeft = +(rf.dscrNoiMo ?? 0) - payments;
      return { ...s, lines: s.lines.map((l) => {
        if (l.label === 'Seller payment') return { ...l, label: 'Both note payments', value: `${money(payments)}/mo`, overlay: [`Purchase note ${money(notePay)}/mo + renovation note ${money(renoPay)}/mo.`] };
        if (l.tone) return { ...l, label: fullLeft >= 0 ? 'Left over each month after every bill' : `Short ${money(-fullLeft)} a month`, value: `${money(fullLeft)}/mo`, tone: fullLeft >= 0 ? 'pass' : 'fail', overlay: [] };
        return l;
      }) };
    }
    return s;
  });
  if (rf.renoFromSeller && guide && !steps.some((s) => s.title === 'Lease-up')) {
    const at = guide.sellerCoveredAt;
    const leaseUp = { num: 4, title: 'Lease-up', lines: [
      { label: 'Rent pays', value: 'Bills, then both notes', overlay: [] },
      ...(at !== null && at !== undefined ? [{ label: 'Everything covered at', value: `${at} units rented`, overlay: [] }] : []),
      { label: 'Not covered yet', value: 'Added to the payoff', overlay: [] },
    ] };
    const i = steps.findIndex((s) => s.num > 4);
    steps = i < 0 ? [...steps, leaseUp] : [...steps.slice(0, i), leaseUp, ...steps.slice(i)];
  }
  next.steps = steps.map((s, i) => ({ ...s, num: i + 1 }));
  return next;
}

// Shared views (realtor, reviewer, lender): the refinance step only says the seller is paid back in full.
// What the buyer clears at the refi is owner-only. The repair-loan alternative shows only when loanOption is on (reviewer).
export function sharedRefiStory(story, { loanOption = false } = {}) {
  if (!story) return story;
  const h = story.headline || {};
  const next = { ...story, headline: { ...h, cashOut: null, maxSellerAtRefi: null } };
  next.steps = (story.steps || []).map((s) => {
    if (s.title === 'Rehab' && !loanOption) return { ...s, lines: s.lines.filter((l) => l.label !== 'Or a repair loan') };
    if (s.title !== 'Refinance') return s;
    const pays = s.lines.filter((l) => l.payback || l.label === 'Pays seller');
    if (!pays.length) return s;
    return { ...s, title: 'Seller paid back', lines: pays.map((l) => (l.label === 'Pays seller' ? { ...l, label: 'Paid back in full' } : l)) };
  });
  return next;
}
