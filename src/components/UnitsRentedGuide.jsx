import CostSummary from './CostSummary.jsx';
import { OverlayTrigger } from './Shell.jsx';
import { money } from '../lib/dealmath.js';

export function isUnitsGuide(guide) {
  return Boolean(guide && Array.isArray(guide.rows) && guide.rows.length > 0 && guide.refi);
}

const COVERED_CLS = {
  yes: 'text-good font-semibold',
  partly: 'text-amber-800 font-medium',
  no: 'text-ink-soft',
};

// Pure presentation of the units-rented table (0..10 units) and refinance block. No plan-math imports.
export default function UnitsRentedGuide({ guide, Trigger = OverlayTrigger, showCostSummary = true, className = '', shared = false }) {
  if (!isUnitsGuide(guide)) return null;
  const costSummary = guide.costSummary || (guide.cost?.length
    ? { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost }
    : null);
  const r = guide.refi;
  const reno = Boolean(r.renoFromSeller);
  const oneBudget = Boolean(guide.oneBudget || reno);
  const showDeferred = Boolean(r.billsFromRent || r.sellerCarriedBills > 0);
  // Rate comparison with a regular repair lender is owner-only.
  const rc = shared ? null : r.renoCompare || null;
  const compareLines = rc
    ? [
        `Seller note: ${rc.sellerRate}% interest only, no points. ${money(rc.sellerMo)}/mo.`,
        `Regular repair lender: ${rc.regularRate}% interest only plus ${rc.regularPointsPct} points (${money(rc.regularPoints)}). ${money(rc.regularMo)}/mo.`,
      ]
    : [];
  const paidBack = r.sellerTotalPayoff ?? r.sellerPayoff;
  const paidBackLines = [
    `Purchase note: ${money(r.sellerNotePrincipal ?? 0)}`,
    reno ? `Renovation note: ${money(r.renoNotePrincipal ?? 0)}` : null,
    (r.sellerCarriedBills || 0) > 0 ? `Deferred holding costs: ${money(r.sellerCarriedBills)}` : null,
  ].filter(Boolean);
  // Shared views only need to know the seller is paid back in full; the rest of the refi stays on the owner's page.
  const vr = guide.rentValue?.valueRange;
  const refiLines = shared ? [
    vr && vr.low > 0 && vr.high > vr.low
      ? { label: 'Value', value: `${money(vr.low)} to ${money(vr.high)}`, overlay: [...(vr.lowOverlay || []), ...(vr.highOverlay || []), `Loan figured on ${money(r.estimatedValue)}.`] }
      : { label: r.estimatedValueLabel || 'Value', value: money(r.estimatedValue), overlay: r.estimatedValueOverlay },
    { label: `Loan at ${r.ltvShownPct}%`, value: money(r.loan), overlay: r.loanOverlay },
    { label: 'Seller paid back in full', value: money(paidBack), overlay: paidBackLines },
  ] : [
    { label: r.estimatedValueLabel || 'Value', value: money(r.estimatedValue), overlay: r.estimatedValueOverlay },
    { label: `Loan at ${r.ltvShownPct}%`, value: money(r.loan), overlay: r.loanOverlay },
    { label: 'In hand after fees and reserve', value: money(r.inHand), overlay: r.inHandOverlay },
    {
      label: r.sellerPayoffLabel || 'Seller paid off',
      value: showDeferred ? money(r.sellerNotePrincipal ?? r.sellerPayoff) : r.sellerPayoffText,
      overlay: r.sellerPayoffOverlay,
    },
    ...(reno ? [{ label: r.renoNoteLabel || 'Seller renovation note paid off', value: money(r.renoNotePrincipal), overlay: r.repairLoanOverlay }] : []),
    ...(showDeferred
      ? [{ label: r.sellerCarriedBillsLabel || 'Deferred holding costs, paid at refi', value: money(r.sellerCarriedBills || 0), overlay: r.sellerCarriedBillsOverlay }]
      : []),
    ...(reno ? [] : [{
      label: 'Repair loan paid off',
      value: `${money(r.repairLoanPayoff)} unused · ${money(r.repairLoanPayoffContUsed)} all used`,
      overlay: r.repairLoanOverlay,
    }]),
    ...(r.closing > 0 ? [{ label: 'Closing', value: money(r.closing), overlay: r.closingOverlay }] : []),
  ];

  return (
    <div className={`space-y-4 ${className}`}>
      {showCostSummary && costSummary && <CostSummary summary={costSummary} Trigger={Trigger} />}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} role="region" aria-label="Units rented table">
        <table className={`w-full ${oneBudget ? 'min-w-0' : 'min-w-[540px]'} border-collapse text-right text-sm tabular-nums`}>
          <thead className="bg-ink text-xs text-white">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-ink px-3 py-2.5 text-left">Units</th>
              <th scope="col" className="px-3 py-2.5">Rent in</th>
              <th scope="col" className="px-3 py-2.5">{guide.costsLabel || 'Seller’s costs'}</th>
              <th scope="col" className="px-3 py-2.5 text-center">Covered</th>
              {!shared && <th scope="col" className="px-3 py-2.5">You net</th>}
              {!oneBudget && !shared && <th scope="col" className="px-3 py-2.5">You net, contingency used</th>}
            </tr>
          </thead>
          <tbody>
            {guide.rows.map((row) => {
              const isBreakEven = guide.breakEvenUnits !== null && guide.breakEvenUnits !== undefined && row.units === guide.breakEvenUnits;
              const isSellerCovered = guide.sellerCoveredAt !== null && guide.sellerCoveredAt !== undefined && row.units === guide.sellerCoveredAt;
              const rowBg = isBreakEven ? 'bg-emerald-50 font-semibold' : isSellerCovered ? 'bg-warm-soft/80 font-semibold' : 'bg-white';
              const stickyBg = isBreakEven ? 'bg-emerald-50' : isSellerCovered ? 'bg-warm-soft/80' : 'bg-white';
              return (
                <tr key={row.units} className={`${rowBg} border-t border-line`}>
                  <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left ${stickyBg}`}>{row.units}</th>
                  <td className="px-3 py-2">{money(row.rentIn)}</td>
                  <td className="px-3 py-2">
                    <Trigger lines={row.sellerCostsOverlay}>{money(row.sellerCosts)}</Trigger>
                  </td>
                  <td className={`px-3 py-2 text-center ${COVERED_CLS[row.covered] || 'text-ink-soft'}`}>{row.covered}</td>
                  {!shared && <td className="px-3 py-2">
                    <Trigger lines={row.buyerNetOverlay} className={row.buyerNet >= 0 ? 'font-semibold text-good' : 'text-red-700'}>
                      {money(row.buyerNet)}
                    </Trigger>
                  </td>}
                  {!oneBudget && !shared && <td className="px-3 py-2">
                    <Trigger lines={row.buyerNetContUsedOverlay} className={row.buyerNetContUsed >= 0 ? 'font-semibold text-good' : 'text-red-700'}>
                      {money(row.buyerNetContUsed)}
                    </Trigger>
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="font-display text-lg font-semibold text-ink">
          <Trigger lines={['Refinance happens when all 10 units are rented.']}>Refinance</Trigger>
        </div>
        {rc && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm" role="group" aria-label="Renovation note vs regular lender">
            <div className="rounded-xl bg-paper p-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Seller note</div>
              <Trigger lines={compareLines} className="font-semibold text-good">{rc.sellerRate}%, no points</Trigger>
            </div>
            <div className="rounded-xl bg-paper p-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Regular lender</div>
              <Trigger lines={compareLines} className="font-semibold text-ink">{rc.regularRate}% + {rc.regularPointsPct} points</Trigger>
            </div>
          </div>
        )}
        <ol className="mt-3 space-y-2 text-sm">
          {refiLines.map((line, idx) => (
            <li key={line.label} className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-start gap-2 text-ink-soft">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-semibold text-ink">{idx + 1}</span>
                <span className="min-w-0">{line.label}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-right"><Trigger lines={line.overlay} className="font-semibold text-ink">{line.value}</Trigger></span>
            </li>
          ))}
          {!shared && <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2.5">
            <span className="flex items-center gap-2 font-semibold text-ink">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{refiLines.length + 1}</span>
              <span>Left for you</span>
            </span>
            <span className="flex flex-wrap items-baseline justify-end gap-x-2 font-display text-2xl font-semibold leading-tight">
              {oneBudget ? (
                <Trigger lines={r.leftForYouOverlay} className={r.leftForYou >= 0 ? 'text-good' : 'text-red-700'}>
                  {money(r.leftForYou)}
                </Trigger>
              ) : (
                <>
                  <Trigger lines={r.leftForYouOverlay} className={r.leftForYou >= 0 ? 'text-good' : 'text-red-700'}>
                    {money(r.leftForYou)} unused
                  </Trigger>
                  <span className="text-sm font-normal text-ink-soft">·</span>
                  <Trigger lines={r.leftForYouContUsedOverlay} className={r.leftForYouContUsed >= 0 ? 'text-good' : 'text-red-700'}>
                    {money(r.leftForYouContUsed)} all used
                  </Trigger>
                </>
              )}
            </span>
          </li>}
        </ol>
      </div>
    </div>
  );
}
