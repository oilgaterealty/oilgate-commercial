import { BASE_DEFAULTS, money, pmt } from './dealmath.js';

// Pure lender package derivation for three separate tabs: Bridge, Private, DSCR.
// Imported only by Lender views and tests; never by Seller or Realtor.
export const LENDER_DEFAULTS = {
  bridgeRate: 10,
  bridgePointsPct: 1,
  bridgeProcessing: 1295,
  bridgeDeferredMonths: 2,
  bridgeTermMonths: 12,
  privateRate: 8,
  privatePointsPct: 0,
  privateMinParticipation: 20000,
  privateTermMonths: 12,
  refiLtv: 75,
  refiRate: 7.5,
  refiYears: 30,
  refiDscr: 1.25,
  refiFeesPct: 2.1,
  refiFeesFlat: 5000,
};

export const LENDER_LENSES = {
  bridge: {
    key: 'bridge',
    label: 'Bridge',
    program: 'bridge',
    title: 'Bridge loan',
    lead: 'Purchase + repairs + fees rolled in, $0 down · 10% non-Dutch',
    heroLabel: 'Total bridge loan',
    ctaLabel: 'Send bridge terms',
  },
  private: {
    key: 'private',
    label: 'Private',
    program: 'private',
    title: 'Private pooled loan',
    lead: 'First-lien pool at 8% interest, no points, $20,000 minimum',
    heroLabel: 'Total funds needed',
    ctaLabel: 'Send private terms',
  },
  dscr: {
    key: 'dscr',
    label: 'DSCR',
    program: 'dscr',
    title: 'Commercial DSCR refinance',
    lead: 'Permanent takeout after lease-up pays off the bridge',
    heroLabel: 'Takeout loan',
    ctaLabel: 'Send DSCR terms',
  },
};

const num = (v, d = 0) => (v !== undefined && v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
const pos = (...vals) => {
  for (const v of vals) {
    const n = num(v, 0);
    if (n > 0) return n;
  }
  return 0;
};
const firstSet = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(+v)) return Math.max(0, +v);
  }
  return null;
};

export function buildLenderPackage({ base = {}, offer = null, guide = null, valSummary = null, lens = 'bridge' } = {}) {
  const baseLens = LENDER_LENSES[lens] || LENDER_LENSES.bridge;
  const x = offer?.inputs && typeof offer.inputs === 'object' ? offer.inputs : {};
  const rf = guide?.refi || {};
  const gb = guide?.bridge || {};
  const units = Math.max(1, num(base?.units, 10) || 10);

  const purchase = pos(
    base?.purchasePrice,
    gb.purchase,
    x.note,
    x.optionPrice,
    x.buyout,
    x.price,
    rf.sellerNotePrincipal,
    rf.sellerPayoff,
  );
  const repairs = pos(
    guide?.costSummary?.total,
    gb.repairs,
    base?.rehab,
    base?.bridgeRepairs,
  );
  const closing = pos(
    base?.bridgeClosing,
    gb.closing,
    x.exerciseClosing,
    x.closing,
    rf.closingInLoan,
    rf.closing,
  );

  // 1. Bridge (hard money: non-Dutch draws, deferred interest due at payoff, $0 down)
  const processing = firstSet(base?.bridgeProcessing, gb.processing) ?? LENDER_DEFAULTS.bridgeProcessing;
  const pointsPct = firstSet(base?.bridgePointsPct, gb.pointsPct) ?? LENDER_DEFAULTS.bridgePointsPct;
  const ratePct = firstSet(base?.bridgeRate, gb.ratePct) ?? LENDER_DEFAULTS.bridgeRate;
  const deferredMonths = firstSet(base?.bridgeDeferredMonths, gb.deferredMonths) ?? LENDER_DEFAULTS.bridgeDeferredMonths;
  const termMonths = pos(base?.bridgeTermMonths, gb.termMonths, LENDER_DEFAULTS.bridgeTermMonths);

  const subtotal = purchase + repairs + closing + processing;
  const pointsRate = pointsPct / 100;
  const totalLoan = pointsRate < 1 ? subtotal / (1 - pointsRate) : subtotal;
  const points = totalLoan * pointsRate;
  const initialDrawn = Math.max(0, totalLoan - repairs);
  const initialMonthlyInterest = (initialDrawn * ratePct) / 100 / 12;
  const fullMonthlyInterest = (totalLoan * ratePct) / 100 / 12;
  const monthlyInterest = initialMonthlyInterest;
  const deferredInterest = initialMonthlyInterest * deferredMonths;
  const bridgePayoff = totalLoan + deferredInterest;
  const feesTotal = closing + processing + points + deferredInterest;
  const downPayment = 0;
  const ltcPct = totalLoan > 0 ? 100 : 0;

  // 2. Private (individuals pooling: 8%, no points, no processing, $20,000 minimum)
  const privateRate = firstSet(base?.privateRate, gb.privateRate) ?? LENDER_DEFAULTS.privateRate;
  const privatePointsPct = LENDER_DEFAULTS.privatePointsPct;
  const privateTermMonths = pos(base?.privateTermMonths, gb.privateTermMonths, LENDER_DEFAULTS.privateTermMonths);
  const minParticipation = pos(base?.privateMinParticipation, gb.minParticipation, LENDER_DEFAULTS.privateMinParticipation);
  const privateTotalFunds = purchase + repairs + closing;
  const privateMonthlyInterest = (privateTotalFunds * privateRate) / 100 / 12;
  const privateMinMonthlyReturn = (minParticipation * privateRate) / 100 / 12;

  // 3. DSCR (permanent refinance takeout)
  const value = pos(rf.estimatedValue, base?.value, valSummary?.income);
  const refiLtv = pos(base?.refiLtv, rf.ltvPct, LENDER_DEFAULTS.refiLtv);
  const newLoan = value > 0 ? (value * refiLtv) / 100 : num(rf.loan, 0);
  const refiRate = firstSet(base?.refiRate) ?? LENDER_DEFAULTS.refiRate;
  const refiYears = pos(base?.refiYears, LENDER_DEFAULTS.refiYears);
  const refiDscr = pos(base?.refiDscr, LENDER_DEFAULTS.refiDscr);
  const refiPayment = pmt(refiRate, refiYears, newLoan);
  const loanByDscr = num(rf.loanByDscr, 0);

  const refiFeesFlat = firstSet(base?.refiFeesFlat, rf.feesFlat) ?? LENDER_DEFAULTS.refiFeesFlat;
  const refiFeesPct = firstSet(base?.refiFeesPct, rf.feesPct) ?? LENDER_DEFAULTS.refiFeesPct;
  const refiFeesPctAmt = (newLoan * refiFeesPct) / 100;
  const refiFeesTotal = refiFeesFlat + refiFeesPctAmt;
  const netAtRefi = newLoan - bridgePayoff - refiFeesTotal;
  const isGap = netAtRefi < 0;

  const privateSurplusAtRefi = newLoan - privateTotalFunds - refiFeesTotal;
  const privateIsGap = privateSurplusAtRefi < 0;

  const activeLens = baseLens.key === 'private'
    ? { ...baseLens, lead: `First-lien pool at ${privateRate}% interest, no points, ${money(minParticipation)} minimum` }
    : baseLens.key === 'bridge'
      ? { ...baseLens, lead: `Purchase + repairs + fees rolled in, $0 down · ${ratePct}% non-Dutch` }
      : { ...baseLens, heroLabel: `Takeout loan (${refiLtv}% LTV)` };

  const firstLeaseStage = Math.min(6, units);
  const pointsWord = pointsPct === 1 ? 'point' : 'points';

  const bridgeSteps = [
    {
      num: '01',
      title: 'Close',
      figure: money(initialDrawn),
      overlay: [
        `Funds ${money(purchase)} purchase, ${money(closing)} closing, ${money(processing)} processing, and ${money(points)} origination (${money(initialDrawn)} drawn at close).`,
        '$0 cash down.',
      ],
    },
    {
      num: '02',
      title: 'Repairs in draws',
      figure: money(repairs),
      overlay: [
        `${money(repairs)} repair budget released in inspection draws. Interest charged only on repair money once drawn (non-Dutch).`,
      ],
    },
    {
      num: '03',
      title: 'Lease-up',
      figure: deferredMonths > 0 ? `${deferredMonths} mo deferred` : `${units} units`,
      overlay: [
        deferredMonths > 0 ? `${deferredMonths}-month deferred interest (${money(deferredInterest)}) due at payoff.` : null,
        `Lease ${firstLeaseStage} units first, then all ${units} units.`,
      ].filter(Boolean),
    },
    {
      num: '04',
      title: 'Exit',
      figure: 'Refinance payoff',
      overlay: ['Paid off by refinance after lease-up.'],
    },
  ];

  const privateSteps = [
    {
      num: '01',
      title: 'Pool closes',
      figure: money(privateTotalFunds),
      overlay: [
        `First-lien pooled note covers ${money(purchase)} purchase, ${money(repairs)} repairs, and ${money(closing)} title/closing.`,
      ],
    },
    {
      num: '02',
      title: 'Interest earned',
      figure: `${privateRate}% · no points`,
      overlay: [
        `${money(minParticipation)} minimum participation earns ${money(privateMinMonthlyReturn)}/mo at ${privateRate}% (no points).`,
      ],
    },
    {
      num: '03',
      title: 'Lease-up',
      figure: `${firstLeaseStage} units → ${units}`,
      overlay: [`Repairs complete and units lease up to all ${units} units.`],
    },
    {
      num: '04',
      title: privateIsGap ? 'Gap at refinance' : 'Surplus at refinance',
      figure: money(Math.abs(privateSurplusAtRefi)),
      overlay: [
        privateIsGap
          ? `Takeout refinance leaves ${money(Math.abs(privateSurplusAtRefi))} gap after paying off the ${money(privateTotalFunds)} pool.`
          : `Takeout refinance pays off the ${money(privateTotalFunds)} pool with ${money(privateSurplusAtRefi)} surplus at refinance.`,
      ],
    },
  ];

  const dscrSteps = [
    {
      num: '01',
      title: 'Stabilized value',
      figure: money(value),
      overlay: [`Income-based value at stabilization: ${money(value)}.`],
    },
    {
      num: '02',
      title: `Takeout loan (${refiLtv}% LTV)`,
      figure: money(newLoan),
      overlay: [`${refiLtv}% LTV · Value ${money(value)} · Loan ${money(newLoan)}.`],
    },
    {
      num: '03',
      title: 'Pays off bridge',
      figure: money(bridgePayoff),
      overlay: [`Takeout loan pays off the ${money(bridgePayoff)} bridge balance and ${money(refiFeesTotal)} refi fees.`],
    },
    {
      num: '04',
      title: 'Permanent term',
      figure: `${refiYears}-yr · ${refiRate}%`,
      overlay: [`${refiYears}-year amortization at ${refiRate}% (${money(refiPayment)}/mo P&I), ${refiDscr}x minimum DSCR.`],
    },
  ];

  const steps = activeLens.key === 'private'
    ? privateSteps
    : activeLens.key === 'dscr'
      ? dscrSteps
      : bridgeSteps;

  const loanAskRows = [
    {
      key: 'purchase',
      label: 'Purchase',
      value: purchase,
      display: money(purchase),
      overlay: ['Seller payoff baseline for closing.'],
    },
    {
      key: 'repairs',
      label: 'Repairs (in draws)',
      value: repairs,
      display: money(repairs),
      overlay: guide?.costSummary?.lines?.length
        ? guide.costSummary.lines.map((l) => l.label).filter(Boolean)
        : ['Unit-by-unit rehab scope released in inspection draws.'],
    },
    {
      key: 'closing',
      label: 'Title / closing',
      value: closing,
      display: money(closing),
      overlay: ['Title, lender policy, recording, and closing costs rolled into the loan.'],
    },
    {
      key: 'processing',
      label: 'Processing',
      value: processing,
      display: money(processing),
      overlay: ['Underwriting / processing fee rolled into the loan.'],
    },
    {
      key: 'points',
      label: `${pointsPct} ${pointsWord}`,
      value: points,
      display: money(points),
      overlay: [
        `${pointsPct}% origination rolled into the ${money(totalLoan)} loan (${money(subtotal)} net before points).`,
        'Counter points in Your terms.',
      ],
    },
    {
      key: 'total',
      label: `Total bridge loan (${ltcPct}% LTC · $0 down)`,
      value: totalLoan,
      display: money(totalLoan),
      emphasis: 'total',
      overlay: [
        [
          `${money(purchase)} purchase`,
          `${money(repairs)} repairs`,
          `${money(closing)} closing`,
          `${money(processing)} processing`,
          `${money(points)} points`,
        ].join(' + ') + ` = ${money(totalLoan)}.`,
        `${ltcPct}% of cost · $0 cash down.`,
      ],
    },
    {
      key: 'interest',
      label: `Interest (${ratePct}% IO · non-Dutch)`,
      value: initialMonthlyInterest,
      display: `${money(initialMonthlyInterest)}/mo at close`,
      emphasis: 'accent',
      overlay: [
        `${money(initialDrawn)} drawn at close × ${ratePct}% ÷ 12 = ${money(initialMonthlyInterest)}/mo.`,
        `Interest charged only on repair money once drawn (${money(fullMonthlyInterest)}/mo once all ${money(repairs)} in repairs are drawn).`,
      ],
    },
    ...(deferredMonths > 0
      ? [{
          key: 'deferredInterest',
          label: `Deferred interest (${deferredMonths} mo · due at payoff)`,
          value: deferredInterest,
          display: money(deferredInterest),
          overlay: [
            `${deferredMonths} months × ${money(initialMonthlyInterest)}/mo = ${money(deferredInterest)} due at payoff.`,
          ],
        }]
      : []),
  ];

  const bridgeTermsRows = [
    {
      key: 'ltc',
      label: 'Loan-to-cost',
      value: ltcPct,
      display: `${ltcPct}% LTC · Loan ${money(totalLoan)}`,
      overlay: [`${ltcPct}% of total project cost (${money(totalLoan)}) with $0 down.`],
    },
    {
      key: 'rate',
      label: 'Interest rate',
      value: ratePct,
      display: `${ratePct}% IO · non-Dutch`,
      overlay: ['Interest charged only on funds drawn, including repair draws as released.'],
    },
    {
      key: 'draws',
      label: 'Repair draws',
      value: repairs,
      display: 'Released in draws',
      overlay: [`${money(repairs)} repair budget released in inspection draws; interest accrues only on drawn funds.`],
    },
    {
      key: 'deferred',
      label: 'Deferred interest',
      value: deferredMonths,
      display: deferredMonths > 0 ? `${deferredMonths} months (due at payoff)` : 'None',
      overlay: [
        deferredMonths > 0
          ? `${deferredMonths} months deferred interest (${money(deferredInterest)}) due at payoff.`
          : 'No deferred interest.',
      ],
    },
    {
      key: 'term',
      label: 'Loan term',
      value: termMonths,
      display: `${termMonths} months`,
      overlay: [`${termMonths}-month bridge term with extension options in Your terms.`],
    },
    {
      key: 'exit',
      label: 'Exit',
      value: 0,
      display: 'Paid off by refinance after lease-up',
      emphasis: 'total',
      tone: 'good',
      overlay: ['Paid off by refinance after lease-up.'],
    },
  ];

  const privateFundsRows = [
    {
      key: 'purchase',
      label: 'Purchase',
      value: purchase,
      display: money(purchase),
      overlay: ['Seller payoff at closing.'],
    },
    {
      key: 'repairs',
      label: 'Repairs',
      value: repairs,
      display: money(repairs),
      overlay: guide?.costSummary?.lines?.length
        ? guide.costSummary.lines.map((l) => l.label).filter(Boolean)
        : ['Unit-by-unit rehab budget.'],
    },
    {
      key: 'closing',
      label: 'Title / closing',
      value: closing,
      display: money(closing),
      overlay: ['Title, recording, and closing costs.'],
    },
    {
      key: 'total',
      label: 'Total funds needed',
      value: privateTotalFunds,
      display: money(privateTotalFunds),
      emphasis: 'total',
      overlay: [
        `${money(purchase)} purchase + ${money(repairs)} repairs + ${money(closing)} title/closing = ${money(privateTotalFunds)}.`,
        'No points or extra upfront fees.',
      ],
    },
    {
      key: 'interest',
      label: `Interest (${privateRate}% · no points)`,
      value: privateMonthlyInterest,
      display: `${money(privateMonthlyInterest)}/mo`,
      emphasis: 'accent',
      overlay: [
        `${money(privateTotalFunds)} × ${privateRate}% ÷ 12 = ${money(privateMonthlyInterest)}/mo across the pool (${money(privateMinMonthlyReturn)}/mo per ${money(minParticipation)} share).`,
      ],
    },
  ];

  const participantCap = minParticipation > 0 && privateTotalFunds > 0 ? Math.max(1, Math.floor(privateTotalFunds / minParticipation)) : 1;
  const privatePoolRows = [
    {
      key: 'rate',
      label: 'Interest rate',
      value: privateRate,
      display: `${privateRate}% · no points`,
      overlay: [`${privateRate}% annual interest, no points, no upfront fees.`],
    },
    {
      key: 'minParticipation',
      label: 'Minimum participation',
      value: minParticipation,
      display: money(minParticipation),
      overlay: [
        `Pooled private money: several lenders can combine at ${money(minParticipation)} minimum each (${money(privateMinMonthlyReturn)}/mo at ${privateRate}%).`,
      ],
    },
    {
      key: 'poolStructure',
      label: 'Pool structure',
      value: participantCap,
      display: 'First-lien pooled',
      overlay: [
        `First-lien pool up to ${participantCap} lenders at ${money(minParticipation)} minimum, or fewer with larger shares.`,
      ],
    },
    {
      key: 'term',
      label: 'Loan term',
      value: privateTermMonths,
      display: `${privateTermMonths} months`,
      overlay: [`${privateTermMonths}-month private pool term.`],
    },
    {
      key: 'surplus',
      label: privateIsGap ? 'Gap at refinance' : 'Surplus at refinance',
      value: privateSurplusAtRefi,
      display: money(Math.abs(privateSurplusAtRefi)),
      tone: privateIsGap ? 'warn' : 'good',
      emphasis: 'total',
      overlay: [
        privateIsGap
          ? `Takeout refinance (${money(newLoan)}) leaves ${money(Math.abs(privateSurplusAtRefi))} gap after paying off the ${money(privateTotalFunds)} pool.`
          : `Takeout refinance (${money(newLoan)}) pays off the ${money(privateTotalFunds)} pool in full with ${money(privateSurplusAtRefi)} surplus at refinance.`,
      ],
    },
  ];

  const dscrLoanRows = [
    {
      key: 'value',
      label: 'Stabilized value',
      value: value,
      display: money(value),
      overlay: [`Stabilized income valuation: ${money(value)}.`],
    },
    {
      key: 'loan',
      label: `Takeout loan (${refiLtv}% LTV)`,
      value: newLoan,
      display: money(newLoan),
      emphasis: 'total',
      overlay: [`${refiLtv}% LTV · Value ${money(value)} · Loan ${money(newLoan)}.`],
    },
    {
      key: 'rate',
      label: 'Interest rate',
      value: refiRate,
      display: `${refiRate}%`,
      overlay: [`Permanent DSCR rate: ${refiRate}%.`],
    },
    {
      key: 'amortization',
      label: 'Amortization',
      value: refiYears,
      display: `${refiYears} years`,
      overlay: [`${refiYears}-year amortization schedule.`],
    },
    {
      key: 'payment',
      label: 'Monthly payment (P&I)',
      value: refiPayment,
      display: `${money(refiPayment)}/mo`,
      emphasis: 'accent',
      overlay: [`${money(newLoan)} over ${refiYears} years at ${refiRate}% = ${money(refiPayment)}/mo P&I.`],
    },
    {
      key: 'dscr',
      label: 'Minimum DSCR',
      value: refiDscr,
      display: `${refiDscr}x`,
      overlay: [`Minimum debt-service coverage ratio: ${refiDscr}x.`],
    },
  ];

  const refiCheckRows = [
    {
      key: 'newLoan',
      label: value > 0 ? `New loan (${refiLtv}% LTV · Value ${money(value)})` : `New loan (${refiLtv}% LTV)`,
      value: newLoan,
      display: money(newLoan),
      overlay: [
        value > 0
          ? `${refiLtv}% LTV · Value ${money(value)} · Loan ${money(newLoan)}.`
          : 'Permanent takeout loan sized at stabilized refinance.',
        loanByDscr > 0 ? `DSCR sizing capacity: ${money(loanByDscr)}.` : null,
      ].filter(Boolean),
    },
    {
      key: 'payoff',
      label: 'Pays off bridge',
      value: -bridgePayoff,
      display: bridgePayoff > 0 ? `−${money(bridgePayoff)}` : '$0',
      overlay: [
        `Pays off the ${money(bridgePayoff)} bridge payoff in full.`,
      ],
    },
    {
      key: 'refiFees',
      label: `Refi fees (${money(refiFeesFlat)} flat + ${refiFeesPct}%)`,
      value: -refiFeesTotal,
      display: refiFeesTotal > 0 ? `−${money(refiFeesTotal)}` : '$0',
      overlay: [
        `${money(refiFeesFlat)} flat + ${refiFeesPct}% (${money(refiFeesPctAmt)}) = ${money(refiFeesTotal)}.`,
      ],
    },
    {
      key: 'gap',
      label: isGap ? 'Gap at refinance' : 'Surplus at refinance',
      value: netAtRefi,
      display: isGap ? money(Math.abs(netAtRefi)) : money(netAtRefi),
      tone: isGap ? 'warn' : 'good',
      emphasis: 'total',
      overlay: isGap
        ? [
            `Loan ${money(newLoan)} − Bridge payoff ${money(bridgePayoff)} − Refi fees ${money(refiFeesTotal)} = ${money(Math.abs(netAtRefi))} gap.`,
          ]
        : [
            `Loan ${money(newLoan)} − Bridge payoff ${money(bridgePayoff)} − Refi fees ${money(refiFeesTotal)} = ${money(netAtRefi)} surplus.`,
          ],
    },
  ];

  const hasSellerFinancingOption = offer?.structure === 'wrap';

  return {
    lens: activeLens,
    units,
    purchase,
    repairs,
    closing,
    processing,
    pointsPct,
    points,
    ratePct,
    deferredMonths,
    deferredInterest,
    termMonths,
    minParticipation,
    feesTotal,
    subtotal,
    totalLoan,
    initialDrawn,
    initialMonthlyInterest,
    fullMonthlyInterest,
    monthlyInterest,
    bridgePayoff,
    downPayment,
    ltcPct,
    value,
    steps,
    loanAskRows,
    bridgeTermsRows,
    privatePool: {
      ratePct: privateRate,
      pointsPct: privatePointsPct,
      termMonths: privateTermMonths,
      minParticipation,
      totalFunds: privateTotalFunds,
      monthlyInterest: privateMonthlyInterest,
      minMonthlyReturn: privateMinMonthlyReturn,
      participantCap,
      surplusAtRefi: privateSurplusAtRefi,
      isGap: privateIsGap,
    },
    privateFundsRows,
    privatePoolRows,
    dscrLoanRows,
    refiCheck: {
      refiLtv,
      refiRate,
      refiYears,
      refiDscr,
      refiPayment,
      newLoan,
      loanByDscr,
      refiFeesFlat,
      refiFeesPct,
      refiFeesPctAmt,
      refiFeesTotal,
      bridgePayoff,
      netAtRefi,
      isGap,
    },
    refiCheckRows,
    hasSellerFinancingOption,
  };
}

// Fallback rent-plan builder when commercial_get_lead_guide is not yet populated for a deal.
export function buildFallbackRentValue(base = {}, pkg = null) {
  const rent = num(base?.rent, 0);
  const low = pos(base?.marketRentLow);
  const high = pos(base?.marketRentHigh);
  if (!(rent > 0) && !(low > 0 && high >= low)) return null;
  const unitsCount = Math.max(1, num(base?.units, 10) || 10);
  const ourRent = rent > 0 ? rent : Math.round((low + high) / 2);
  const vacancyPct = num(base?.vacancyPct, BASE_DEFAULTS.vacancyPct);
  const capRate = num(base?.valueCapRate, 9) > 0 ? num(base?.valueCapRate, 9) : 9;
  const taxesMo = Math.max(0, num(base?.taxes, 0)) / 12;
  const insuranceMo = Math.max(0, num(base?.insurance, 0)) / 12;
  const waterMo = Math.max(0, num(base?.waterMo, 0));
  const emptyUnitUtilMo = Math.max(0, num(base?.emptyUnitUtilMo, 0));
  const reservesMo = (unitsCount * Math.max(0, num(base?.reservesPerUnit, BASE_DEFAULTS.reservesPerUnit))) / 12;
  const costsMo = taxesMo + insuranceMo + waterMo + reservesMo;
  const asisCostsMo = taxesMo + insuranceMo + waterMo + unitsCount * emptyUnitUtilMo;
  const allIn = pkg?.totalLoan || (pkg?.purchase || 0) + (pkg?.repairs || 0);
  const rentMoAfter = unitsCount * ourRent * (1 - vacancyPct / 100);
  const netYrAfter = (rentMoAfter - costsMo) * 12;
  const valueAfter = Math.max(0, netYrAfter / (capRate / 100));
  const asisNetYr = (0 - asisCostsMo) * 12;
  const caps = [capRate, capRate + 1, capRate + 2, capRate + 3];
  const maxRent = high > 0 ? high : Infinity;
  const cappedBase = Math.min(ourRent, maxRent);
  const rents = [...new Set(
    [-2, -1, 0, 1, 2]
      .map((k) => Math.min(cappedBase + k * 100, maxRent))
      .filter((r) => r > 0),
  )].sort((a, b) => a - b);
  return {
    version: 1,
    ourRent,
    capRate,
    allIn,
    buyout: pkg?.purchase || 0,
    repairs: pkg?.repairs || 0,
    units: Array.from({ length: unitsCount }, (_, i) => ({
      id: String(i + 1),
      repairs: 0,
      occupied: false,
      rentToday: null,
      ourRent,
      marketRent: null,
      gap: null,
      note: '',
    })),
    views: [
      {
        key: 'asis',
        label: 'As is',
        rented: 0,
        total: unitsCount,
        rentMo: 0,
        costsMo: asisCostsMo,
        netYr: asisNetYr,
        value: 0,
        allIn: pkg?.purchase || 0,
        rentOverlay: [`0 of ${unitsCount} rented today`],
        costsOverlay: [`Operating costs: ${money(asisCostsMo)}/mo`],
        netOverlay: [`($0 − ${money(asisCostsMo)}) × 12 = ${money(asisNetYr)}/yr`],
        valueOverlay: ['$0/yr'],
        allInOverlay: [`Purchase: ${money(pkg?.purchase || 0)}`],
      },
      {
        key: 'after',
        label: 'After repairs',
        rented: unitsCount,
        total: unitsCount,
        rentMo: rentMoAfter,
        costsMo,
        netYr: netYrAfter,
        value: valueAfter,
        allIn,
        rentOverlay: [`${unitsCount} × ${money(ourRent)}/mo = ${money(unitsCount * ourRent)}/mo`, `Less ${vacancyPct}% vacancy: ${money(rentMoAfter)}/mo`],
        costsOverlay: [`Operating costs: ${money(costsMo)}/mo`],
        netOverlay: [`(${money(rentMoAfter)} − ${money(costsMo)}) × 12 = ${money(netYrAfter)}/yr`],
        valueOverlay: [`${money(netYrAfter)}/yr ÷ ${capRate}% cap rate = ${money(valueAfter)}`],
        allInOverlay: [`Total cost: ${money(allIn)}`],
      },
    ],
    caps,
    grid: rents.map((r) => {
      const rMo = unitsCount * r * (1 - vacancyPct / 100);
      const nYr = (rMo - costsMo) * 12;
      return {
        rent: r,
        cells: caps.map((c) => {
          const v = Math.max(0, nYr / (c / 100));
          return {
            cap: c,
            value: v,
            clears: v >= allIn,
            stabilized: r === cappedBase && c === capRate,
            overlay: [`${unitsCount} units × ${money(r)}/mo, less ${vacancyPct}% vacancy: ${money(rMo)}/mo`, `Less costs: ${money(costsMo)}/mo`, `${money(nYr)}/yr ÷ ${c}% = ${money(v)}`, `All in: ${money(allIn)}`],
          };
        }),
      };
    }),
    marketRange: low > 0 && high >= low
      ? { low, high, units: unitsCount, vacancyPct, costsMo, capRate, allIn }
      : null,
    valueRange: pkg?.value > 0 && valueAfter > pkg.value
      ? { low: pkg.value, high: valueAfter, lowOverlay: ['Value used for the refinance'], highOverlay: [`${money(netYrAfter)}/yr ÷ ${capRate}% cap rate = ${money(valueAfter)}`] }
      : null,
  };
}
