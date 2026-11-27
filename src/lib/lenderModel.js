import { BASE_DEFAULTS, money, moneyK } from './dealmath.js';

// Pure Plan 1A lender package derivation. Imported only by Lender views and tests; never by Seller or Realtor.
export const LENDER_DEFAULTS = {
  bridgeRate: 13,
  bridgePointsPct: 1,
  bridgeProcessing: 1295,
  bridgeDeferredMonths: 2,
  bridgeTermMonths: 12,
  privateMinParticipation: 20000,
  refiLtv: 75,
  refiFeesPct: 2.1,
  refiFeesFlat: 5000,
};

export const LENDER_LENSES = {
  bridge: {
    key: 'bridge',
    label: 'Bridge',
    program: 'bridge',
    title: 'Bridge loan',
    lead: 'Purchase + repairs + fees in one loan, $0 down',
    heroLabel: 'Total bridge loan',
    ctaLabel: 'Send bridge terms',
  },
  private: {
    key: 'private',
    label: 'Private',
    program: 'private',
    title: 'Private pooled loan',
    lead: 'Pooled first-position funding for purchase, repairs and fees',
    heroLabel: 'Total funds needed',
    ctaLabel: 'Send private terms',
  },
  dscr: {
    key: 'dscr',
    label: 'DSCR',
    program: 'dscr',
    title: 'Commercial DSCR takeout',
    lead: 'Stabilized refinance at full occupancy pays off the bridge',
    heroLabel: 'Takeout refi loan',
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
  const processing = firstSet(base?.bridgeProcessing, gb.processing) ?? LENDER_DEFAULTS.bridgeProcessing;
  const pointsPct = firstSet(base?.bridgePointsPct, gb.pointsPct) ?? LENDER_DEFAULTS.bridgePointsPct;
  const ratePct = firstSet(base?.bridgeRate, gb.ratePct) ?? LENDER_DEFAULTS.bridgeRate;
  const deferredMonths = firstSet(base?.bridgeDeferredMonths, gb.deferredMonths) ?? LENDER_DEFAULTS.bridgeDeferredMonths;
  const termMonths = pos(base?.bridgeTermMonths, gb.termMonths, LENDER_DEFAULTS.bridgeTermMonths);
  const minParticipation = pos(base?.privateMinParticipation, gb.minParticipation, LENDER_DEFAULTS.privateMinParticipation);

  const subtotal = purchase + repairs + closing + processing;
  const pointsRate = pointsPct / 100;
  const deferredRate = (deferredMonths * ratePct) / 100 / 12;
  const factor = 1 - pointsRate - deferredRate;
  const totalLoan = factor > 0 ? subtotal / factor : subtotal;
  const points = totalLoan * pointsRate;
  const monthlyInterest = (totalLoan * ratePct) / 100 / 12;
  const deferredInterest = monthlyInterest * deferredMonths;
  const feesTotal = closing + processing + points + deferredInterest;
  const downPayment = 0;
  const ltcPct = totalLoan > 0 ? 100 : 0;

  const activeLens = baseLens.key === 'private'
    ? { ...baseLens, lead: `Pooled first-position funding, ${money(minParticipation)} minimum per lender` }
    : baseLens;

  const value = pos(rf.estimatedValue, base?.value, valSummary?.income);
  const ltvPct = value > 0 && totalLoan > 0 ? (totalLoan / value) * 100 : 0;
  const refiLtv = pos(base?.refiLtv, rf.ltvPct, LENDER_DEFAULTS.refiLtv);
  const newLoan = value > 0 ? (value * refiLtv) / 100 : num(rf.loan, 0);
  const loanByDscr = num(rf.loanByDscr, 0);

  const refiFeesFlat = firstSet(base?.refiFeesFlat, rf.feesFlat) ?? LENDER_DEFAULTS.refiFeesFlat;
  const refiFeesPct = firstSet(base?.refiFeesPct, rf.feesPct) ?? LENDER_DEFAULTS.refiFeesPct;
  const refiFeesPctAmt = (newLoan * refiFeesPct) / 100;
  const refiFeesTotal = refiFeesFlat + refiFeesPctAmt;
  const netAtRefi = newLoan - totalLoan - refiFeesTotal;
  const isGap = netAtRefi < 0;

  const firstLeaseStage = Math.min(6, units);
  const pointsWord = pointsPct === 1 ? 'point' : 'points';
  const steps = [
    {
      num: '01',
      title: 'Close',
      figure: purchase > 0 ? money(purchase) : '$0 down',
      overlay: [
        purchase > 0
          ? `Lender pays off seller's mortgage (${money(purchase)}) at closing.`
          : 'Lender funds purchase payoff at closing.',
        '$0 cash down from the buyer.',
      ],
    },
    {
      num: '02',
      title: 'Fix + lease',
      figure: `${firstLeaseStage} units → ${units}`,
      overlay: [
        repairs > 0 ? `${money(repairs)} repair budget released in draws as work finishes.` : 'Repairs funded in draws as work finishes.',
        deferredMonths > 0 ? `${deferredMonths}-month deferred interest cushion (${money(deferredInterest)}) covers initial lease-up.` : null,
        `Lease ${firstLeaseStage} units first, then stabilize all ${units} units.`,
      ].filter(Boolean),
    },
    {
      num: '03',
      title: 'Refinance',
      figure: newLoan > 0 ? money(newLoan) : `${refiLtv}% LTV`,
      overlay: [
        value > 0
          ? `${refiLtv}% of ${money(value)} value by income = ${money(newLoan)}.`
          : `${refiLtv}% LTV permanent commercial refinance.`,
        loanByDscr > 0 ? `DSCR sizing capacity: ${money(loanByDscr)}.` : null,
      ].filter(Boolean),
    },
    {
      num: '04',
      title: 'Bridge paid off',
      figure: totalLoan > 0 ? money(totalLoan) : 'Paid in full',
      overlay: [
        totalLoan > 0
          ? `Permanent refinance pays off the ${money(totalLoan)} bridge loan in full.`
          : 'Permanent refinance retires the bridge loan.',
      ],
    },
  ];

  const loanAskRows = [
    {
      key: 'purchase',
      label: 'Purchase',
      value: purchase,
      display: money(purchase),
      overlay: ['Seller payoff placeholder until exact payoff statement is confirmed.'],
    },
    {
      key: 'repairs',
      label: 'Repairs',
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
      overlay: ['Underwriting / processing baseline from past bridge loan terms.'],
    },
    {
      key: 'points',
      label: `${pointsPct} ${pointsWord}`,
      value: points,
      display: money(points),
      overlay: [
        `${pointsPct}% origination rolled into the ${money(totalLoan)} loan (${money(subtotal)} net before points and deferred interest).`,
        'Counter points in Your terms.',
      ],
    },
    ...(deferredMonths > 0
      ? [{
          key: 'deferredInterest',
          label: `${deferredMonths} mo deferred interest`,
          value: deferredInterest,
          display: money(deferredInterest),
          overlay: [
            `${deferredMonths} months interest-only lease-up cushion (${deferredMonths} × ${money(monthlyInterest)}/mo = ${money(deferredInterest)}) rolled into the loan.`,
          ],
        }]
      : []),
    {
      key: 'total',
      label: activeLens.key === 'private' ? 'Total funds needed ($0 down)' : 'Total loan ($0 down)',
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
          deferredMonths > 0 ? `${money(deferredInterest)} deferred interest` : null,
        ].filter(Boolean).join(' + ') + ` = ${money(totalLoan)}.`,
        value > 0 ? `${Math.round(ltvPct)}% of ${money(value)} stabilized value; ${ltcPct}% of cost.` : null,
      ].filter(Boolean),
    },
    {
      key: 'interest',
      label: `Interest (${ratePct}% IO)`,
      value: monthlyInterest,
      display: `${money(monthlyInterest)}/mo`,
      emphasis: 'accent',
      overlay: [
        `${money(totalLoan)} × ${ratePct}% ÷ 12 = ${money(monthlyInterest)}/mo interest-only (full drawn balance).`,
        deferredMonths > 0 ? `First ${deferredMonths} months deferred in loan; counter rate or deferred months in Your terms.` : 'Counter rate and draw interest in Your terms.',
      ],
    },
  ];

  const refiCheckRows = [
    {
      key: 'newLoan',
      label: value > 0 ? `New loan (${refiLtv}% of ${moneyK(value)})` : `New loan (${refiLtv}% LTV)`,
      value: newLoan,
      display: money(newLoan),
      overlay: [
        value > 0
          ? `${refiLtv}% × ${money(value)} value by income = ${money(newLoan)}.`
          : 'Permanent takeout loan sized at stabilized refinance.',
        loanByDscr > 0 ? `DSCR sizing: ${money(loanByDscr)}.` : null,
      ].filter(Boolean),
    },
    {
      key: 'payoff',
      label: 'Pays off bridge',
      value: -totalLoan,
      display: totalLoan > 0 ? `−${money(totalLoan)}` : '$0',
      overlay: [
        `Retires full bridge payoff (${money(totalLoan)}).`,
      ],
    },
    {
      key: 'refiFees',
      label: 'Refi fees',
      value: -refiFeesTotal,
      display: refiFeesTotal > 0 ? `−${money(refiFeesTotal)}` : '$0',
      overlay: [
        `${money(refiFeesFlat)} flat + ${refiFeesPct}% (${money(refiFeesPctAmt)}) broker/points = ${money(refiFeesTotal)}.`,
        'Modeled from 4 past bridge refinances.',
      ],
    },
    {
      key: 'gap',
      label: isGap ? 'Gap at low value' : 'Surplus at low value',
      value: netAtRefi,
      display: isGap ? money(Math.abs(netAtRefi)) : money(netAtRefi),
      tone: isGap ? 'warn' : 'good',
      emphasis: 'total',
      overlay: isGap
        ? [
            `${money(newLoan)} − ${money(totalLoan)} bridge − ${money(refiFeesTotal)} refi fees = ${money(Math.abs(netAtRefi))} short at ${money(value)} value.`,
            'Covered by lease-up rent or stabilized value above the low valuation.',
          ]
        : [
            `${money(newLoan)} − ${money(totalLoan)} bridge − ${money(refiFeesTotal)} refi fees = ${money(netAtRefi)} net proceeds.`,
          ],
    },
  ];

  const participantCap = minParticipation > 0 && totalLoan > 0 ? Math.max(1, Math.floor(totalLoan / minParticipation)) : 1;
  const privatePoolRows = [
    {
      key: 'totalFunds',
      label: 'Total funds needed',
      value: totalLoan,
      display: money(totalLoan),
      overlay: [
        `${money(purchase)} purchase + ${money(repairs)} repairs + ${money(feesTotal)} closing, points, processing, and ${deferredMonths}-mo deferred interest.`,
      ],
    },
    {
      key: 'minParticipation',
      label: 'Minimum participation',
      value: minParticipation,
      display: money(minParticipation),
      overlay: [
        `Pooled private money: several lenders can combine at ${money(minParticipation)} minimum each to fill the ${money(totalLoan)} total.`,
      ],
    },
    {
      key: 'poolStructure',
      label: 'Pool structure',
      value: participantCap,
      display: 'First-lien pool',
      overlay: [
        `Up to ${participantCap} lenders at ${money(minParticipation)} minimum, or fewer with larger shares.`,
        `${ratePct}% IO, ${deferredMonths} months deferred interest, ${termMonths}-month term.`,
      ],
    },
    {
      key: 'surplus',
      label: isGap ? 'Gap at refinance' : 'Left over at refinance',
      value: netAtRefi,
      display: isGap ? money(Math.abs(netAtRefi)) : money(netAtRefi),
      tone: isGap ? 'warn' : 'good',
      emphasis: 'total',
      overlay: isGap
        ? [
            `${money(newLoan)} takeout refi − ${money(totalLoan)} payoff − ${money(refiFeesTotal)} refi fees = ${money(Math.abs(netAtRefi))} gap at ${money(value)} value.`,
          ]
        : [
            `${money(newLoan)} takeout refi − ${money(totalLoan)} payoff − ${money(refiFeesTotal)} refi fees = ${money(netAtRefi)} left over at refinance.`,
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
    monthlyInterest,
    downPayment,
    ltcPct,
    value,
    ltvPct,
    steps,
    loanAskRows,
    privatePoolRows,
    refiCheck: {
      refiLtv,
      newLoan,
      loanByDscr,
      refiFeesFlat,
      refiFeesPct,
      refiFeesPctAmt,
      refiFeesTotal,
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
