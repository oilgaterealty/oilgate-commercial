import { OverlayTrigger } from './Shell.jsx';

export default function CostSummary({ summary, Trigger = OverlayTrigger, className = '' }) {
  if (!summary) return null;
  return (
    <div className={`rounded-2xl border border-line bg-paper p-3.5 text-sm ${className}`}>
      <div className="font-display text-lg font-semibold leading-snug text-ink">
        <Trigger lines={summary.headingOverlay}>{summary.heading}</Trigger>
      </div>
      <ul className="mt-2 space-y-1">
        {(summary.lines || []).map((line) => (
          <li key={line.key || line.label} className="flex flex-wrap items-baseline gap-x-1.5 text-sm leading-snug">
            <Trigger lines={[line.detail, ...(line.overlay || [])].filter(Boolean)} className="font-medium text-ink">
              {line.label}
            </Trigger>
          </li>
        ))}
      </ul>
    </div>
  );
}
