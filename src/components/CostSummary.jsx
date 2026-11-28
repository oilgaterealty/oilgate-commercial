import { useState } from 'react';
import { OverlayTrigger } from './Shell.jsx';

const fmtAmt = (v) => (Number.isFinite(+v) ? `$${Math.round(+v).toLocaleString('en-US')}` : '');
const isLaundryLine = (line) => String(line?.key || '').startsWith('laundry-');

export default function CostSummary({ summary, Trigger = OverlayTrigger, className = '' }) {
  const [laundryOpen, setLaundryOpen] = useState(false);
  if (!summary) return null;

  const allLines = summary.lines || [];
  const laundryLines = allLines.filter(isLaundryLine);
  const laundryTotal = laundryLines.reduce((s, l) => s + (Number.isFinite(+l.amount) ? +l.amount : 0), 0);
  let renderedLaundry = false;

  return (
    <div className={`rounded-2xl border border-line bg-paper p-3.5 text-sm ${className}`}>
      <div className="font-display text-lg font-semibold leading-snug text-ink">
        <Trigger lines={summary.headingOverlay}>{summary.heading}</Trigger>
      </div>
      <ul className="mt-2 space-y-1.5">
        {allLines.map((line) => {
          if (isLaundryLine(line)) {
            if (renderedLaundry) return null;
            renderedLaundry = true;
            return (
              <li key="laundry-group" className="text-sm leading-snug">
                <button
                  type="button"
                  aria-expanded={laundryOpen}
                  data-cost-group="laundry"
                  onClick={() => setLaundryOpen((v) => !v)}
                  className="flex min-h-[40px] w-full items-center justify-between gap-x-3 rounded-lg px-1 -mx-1 text-left transition hover:bg-warm-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
                    <span aria-hidden="true" className="shrink-0 text-xs text-ink-soft">{laundryOpen ? '▴' : '▾'}</span>
                    <span>Laundry</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-ink">{fmtAmt(laundryTotal)}</span>
                </button>
                {laundryOpen && (
                  <ul className="mt-1 space-y-1.5 border-t border-line/70 pt-1.5 pl-4">
                    {laundryLines.map((lItem) => {
                      const lines = [lItem.detail, ...(lItem.overlay || [])].filter(Boolean);
                      return (
                        <li key={lItem.key || lItem.label} className="flex items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-snug">
                          <Trigger lines={lines} className="min-w-0 font-medium text-ink">
                            {lItem.title || lItem.label}
                          </Trigger>
                          <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-ink">{fmtAmt(lItem.amount)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          }
          const lines = [line.detail, ...(line.overlay || [])].filter(Boolean);
          if (line.title && line.amount !== undefined) {
            return (
              <li key={line.key || line.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm leading-snug">
                <Trigger lines={lines} className="min-w-0 font-medium text-ink">
                  {line.title}
                </Trigger>
                <span className="shrink-0 font-semibold tabular-nums text-ink">{fmtAmt(line.amount)}</span>
              </li>
            );
          }
          return (
            <li key={line.key || line.label} className="flex flex-wrap items-baseline gap-x-1.5 text-sm leading-snug">
              <Trigger lines={lines} className="font-medium text-ink">
                {line.label}
              </Trigger>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
