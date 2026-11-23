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
  units: 0, tenthUnitRepair: 12000, rent: 0, vacancyPct: 7,
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
