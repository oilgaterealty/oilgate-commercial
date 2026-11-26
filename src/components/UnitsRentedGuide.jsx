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
export default function UnitsRentedGuide({ guide, Trigger = OverlayTrigger, showCostSummary = true, className = '' }) {
  if (!isUnitsGuide(guide)) return null;
  const costSummary = guide.costSummary || (guide.cost?.length
    ? { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost }
    : null);
  const r = guide.refi;
  const refiLines = [
    { label: r.estimatedValueLabel || 'Estimated value', value: money(r.estimatedValue), overlay: r.estimatedValueOverlay },
    { label: `Loan at ${r.ltvShownPct}%`, value: money(r.loan), overlay: r.loanOverlay },
    { label: 'In hand after fees and reserve', value: money(r.inHand), overlay: r.inHandOverlay },
    { label: r.sellerPayoffLabel || 'Seller paid off', value: r.sellerPayoffText, overlay: r.sellerPayoffOverlay },
    {
      label: 'Repair loan paid off',
      value: `${money(r.repairLoanPayoff)} unused · ${money(r.repairLoanPayoffContUsed)} all used`,
      overlay: r.repairLoanOverlay,
    },
    ...(r.closing > 0 ? [{ label: 'Closing', value: money(r.closing), overlay: r.closingOverlay }] : []),
  ];

  return (
    <div className={`space-y-4 ${className}`}>
      {showCostSummary && costSummary && <CostSummary summary={costSummary} Trigger={Trigger} />}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} role="region" aria-label="Units rented table">
        <table className="w-full min-w-[540px] border-collapse text-right text-sm tabular-nums">
          <thead className="bg-ink text-xs text-white">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-ink px-3 py-2.5 text-left">Units</th>
              <th scope="col" className="px-3 py-2.5">Rent in</th>
              <th scope="col" className="px-3 py-2.5">{guide.costsLabel || 'Seller’s costs'}</th>
              <th scope="col" className="px-3 py-2.5 text-center">Covered</th>
              <th scope="col" className="px-3 py-2.5">You net</th>
              <th scope="col" className="px-3 py-2.5">You net, contingency used</th>
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
                  <td className="px-3 py-2">
                    <Trigger lines={row.buyerNetOverlay} className={row.buyerNet >= 0 ? 'font-semibold text-good' : 'text-red-700'}>
                      {money(row.buyerNet)}
                    </Trigger>
                  </td>
                  <td className="px-3 py-2">
                    <Trigger lines={row.buyerNetContUsedOverlay} className={row.buyerNetContUsed >= 0 ? 'font-semibold text-good' : 'text-red-700'}>
                      {money(row.buyerNetContUsed)}
                    </Trigger>
                  </td>
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
        <ol className="mt-3 space-y-2 text-sm">
          {refiLines.map((line, idx) => (
            <li key={line.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="flex items-center gap-2 text-ink-soft">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-semibold text-ink">{idx + 1}</span>
                <span>{line.label}</span>
              </span>
              <Trigger lines={line.overlay} className="text-right font-semibold text-ink">{line.value}</Trigger>
            </li>
          ))}
          <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2.5">
            <span className="flex items-center gap-2 font-semibold text-ink">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{refiLines.length + 1}</span>
              <span>Left for you</span>
            </span>
            <span className="flex flex-wrap items-baseline justify-end gap-x-2 font-display text-2xl font-semibold leading-tight">
              <Trigger lines={r.leftForYouOverlay} className={r.leftForYou >= 0 ? 'text-good' : 'text-red-700'}>
                {money(r.leftForYou)} unused
              </Trigger>
              <span className="text-sm font-normal text-ink-soft">·</span>
              <Trigger lines={r.leftForYouContUsedOverlay} className={r.leftForYouContUsed >= 0 ? 'text-good' : 'text-red-700'}>
                {money(r.leftForYouContUsed)} all used
              </Trigger>
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}
