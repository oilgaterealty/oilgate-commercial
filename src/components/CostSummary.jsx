import { OverlayTrigger } from './Shell.jsx';

const fmtAmt = (v) => (Number.isFinite(+v) ? `$${Math.round(+v).toLocaleString('en-US')}` : '');

export default function CostSummary({ summary, Trigger = OverlayTrigger, className = '' }) {
  if (!summary) return null;
  return (
    <div className={`rounded-2xl border border-line bg-paper p-3.5 text-sm ${className}`}>
      <div className="font-display text-lg font-semibold leading-snug text-ink">
        <Trigger lines={summary.headingOverlay}>{summary.heading}</Trigger>
      </div>
      <ul className="mt-2 space-y-1.5">
        {(summary.lines || []).map((line) => {
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
