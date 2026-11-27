import { useEffect, useState } from 'react';
import { buyerName } from '../lib/people.js';
import { money } from '../lib/dealmath.js';
import { buildLenderPackage } from '../lib/lenderModel.js';
import { sendToOwner } from './Messages.jsx';
import { Button, Card, CardTitle, OverlayTrigger } from './Shell.jsx';

function NumberStepRow({ label, unit, value, step, min = 0, max, onChange, changed }) {
  const v = value ?? '';
  const bump = (dir) => {
    const next = Math.round(((+v || 0) + dir * step) * 100) / 100;
    const clamped = Math.max(min, max !== undefined ? Math.min(max, next) : next);
    onChange(clamped);
  };
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-2 py-1.5">
      <span className={`text-sm ${changed ? 'font-medium text-ink' : 'text-ink-soft'}`}>{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`Lower ${label}`}
          onClick={() => bump(-1)}
          className="h-10 w-10 rounded-lg border border-line bg-white text-ink-soft hover:bg-warm-soft"
        >
          −
        </button>
        <span className="relative">
          {unit === '$' && (
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>
          )}
          <input
            type="number"
            inputMode="decimal"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={v}
            onChange={(e) => onChange(e.target.value === '' ? '' : Math.max(min, +e.target.value))}
            className={`h-10 w-24 rounded-lg border border-line bg-white text-right text-sm tabular-nums outline-none focus:border-ink sm:w-28 ${
              unit === '$' ? 'pl-5 pr-2' : 'px-2'
            }`}
          />
        </span>
        <span className="w-6 text-xs text-ink-soft">{unit === '$' ? '' : unit}</span>
        <button
          type="button"
          aria-label={`Raise ${label}`}
          onClick={() => bump(1)}
          className="h-10 w-10 rounded-lg border border-line bg-white text-ink-soft hover:bg-warm-soft"
        >
          +
        </button>
      </span>
    </label>
  );
}

function ResultTile({ label, value, tone = 'default', overlay }) {
  const toneCls = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-amber-800' : 'text-ink';
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <dt className="text-xs uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className={`mt-1 font-display text-2xl font-semibold tabular-nums ${toneCls}`}>
        <OverlayTrigger lines={overlay} className={toneCls}>{value}</OverlayTrigger>
      </dd>
    </div>
  );
}

// Local-only bridge + refinance what-if calculator for lenders. Never saves to commercial_models or commercial_offers.
export default function LenderWhatIf({ deal, me, preview, pkg, base, offer, guide, lens = 'bridge' }) {
  const initialFromPkg = (p) => ({
    ratePct: p.ratePct,
    pointsPct: p.pointsPct,
    deferredMonths: p.deferredMonths,
    processing: p.processing,
    repairs: p.repairs,
    refiLtv: p.refiCheck.refiLtv,
    value: p.value,
  });

  const [inputs, setInputs] = useState(() => initialFromPkg(pkg));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInputs(initialFromPkg(pkg));
    setStatus('');
  }, [pkg.ratePct, pkg.pointsPct, pkg.deferredMonths, pkg.processing, pkg.repairs, pkg.refiCheck.refiLtv, pkg.value]);

  const defaults = initialFromPkg(pkg);
  const touched = Object.keys(defaults).some((k) => +inputs[k] !== +defaults[k]);

  const numOr = (val, fallback) => (val === '' || val === null || val === undefined || !Number.isFinite(+val) ? fallback : Math.max(0, +val));

  const simBase = {
    ...base,
    purchasePrice: pkg.purchase,
    bridgeClosing: pkg.closing,
    bridgeRate: numOr(inputs.ratePct, pkg.ratePct),
    bridgePointsPct: numOr(inputs.pointsPct, pkg.pointsPct),
    bridgeDeferredMonths: numOr(inputs.deferredMonths, pkg.deferredMonths),
    bridgeProcessing: numOr(inputs.processing, pkg.processing),
    rehab: numOr(inputs.repairs, pkg.repairs),
    refiLtv: numOr(inputs.refiLtv, pkg.refiCheck.refiLtv),
    value: numOr(inputs.value, pkg.value),
  };
  const simGuide = guide
    ? {
        ...guide,
        costSummary: { ...(guide.costSummary || {}), total: simBase.rehab },
        refi: { ...(guide.refi || {}), estimatedValue: simBase.value, ltvPct: simBase.refiLtv },
      }
    : null;
  const simPkg = buildLenderPackage({ base: simBase, offer, guide: simGuide, lens });

  const reset = () => {
    setInputs(defaults);
    setStatus('');
  };

  const buildSummary = () => [
    `Lender what-if (${simPkg.lens.label}, nothing was saved):`,
    `- Rate: ${simPkg.ratePct}% IO (was ${pkg.ratePct}%)`,
    `- Points: ${simPkg.pointsPct} (${money(simPkg.points)})`,
    `- Deferred interest: ${simPkg.deferredMonths} mo (${money(simPkg.deferredInterest)})`,
    `- Processing: ${money(simPkg.processing)}`,
    `- Repairs: ${money(simPkg.repairs)}`,
    `- Total loan: ${money(simPkg.totalLoan)} (${Math.round(simPkg.ltvPct)}% LTV on ${money(simPkg.value)})`,
    `- Refinance (${simPkg.refiCheck.refiLtv}% LTV): ${money(simPkg.refiCheck.newLoan)}, ${simPkg.refiCheck.isGap ? `gap ${money(Math.abs(simPkg.refiCheck.netAtRefi))}` : `left over ${money(simPkg.refiCheck.netAtRefi)}`}`,
  ].join('\n');

  const send = async () => {
    if (busy) return;
    if (preview) {
      setStatus('Preview: what-if numbers are not sent from preview.');
      return;
    }
    setBusy(true);
    try {
      const error = await sendToOwner(deal, me, 'lender', buildSummary(), 'Lender what-if');
      setStatus(error ? 'Not sent. Try again.' : `Sent to ${buyerName()}. It’s in Messages.`);
    } catch {
      setStatus('Not sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ['ratePct', 'Bridge rate', '%', 0.25, 0, 30],
    ['pointsPct', 'Origination points', 'pts', 0.25, 0, 10],
    ['deferredMonths', 'Deferred interest', 'mo', 1, 0, 12],
    ['processing', 'Processing fee', '$', 100, 0, undefined],
    ['repairs', 'Repair budget', '$', 5000, 0, undefined],
    ['refiLtv', 'Takeout refi LTV', '%', 5, 0, 100],
    ['value', 'Stabilized value', '$', 10000, 0, undefined],
  ];

  const totalLabel = lens === 'private' ? 'Total funds needed' : 'Total bridge loan';
  const netLabel = simPkg.refiCheck.isGap ? 'Gap at refinance' : 'Left over at refinance';

  return (
    <div className="space-y-5">
      {touched && (
        <div className="rounded-2xl border border-warm bg-white px-4 py-3 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Trying your own loan numbers.</span>
            <Button type="button" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : `Send to ${buyerName()}`}
            </Button>
            <Button type="button" kind="secondary" onClick={reset}>
              Reset
            </Button>
            {status && <span role="status" className="text-ink-soft">{status}</span>}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardTitle
            aside={touched ? (
              <button type="button" onClick={reset} className="text-sm font-medium text-ink underline underline-offset-4">
                Reset
              </button>
            ) : null}
          >
            Loan assumptions
          </CardTitle>
          <div className="divide-y divide-line">
            {rows.map(([k, label, unit, step, min, max]) => (
              <NumberStepRow
                key={k}
                label={label}
                unit={unit}
                step={step}
                min={min}
                max={max}
                value={inputs[k]}
                changed={+inputs[k] !== +defaults[k]}
                onChange={(val) => setInputs((prev) => ({ ...prev, [k]: val }))}
              />
            ))}
          </div>
        </Card>

        <dl className="grid grid-cols-2 gap-3 self-start lg:grid-cols-3">
          <ResultTile
            label={totalLabel}
            value={money(simPkg.totalLoan)}
            overlay={simPkg.loanAskRows.find((r) => r.key === 'total')?.overlay}
          />
          <ResultTile
            label={`Interest (${simPkg.ratePct}% IO)`}
            value={`${money(simPkg.monthlyInterest)}/mo`}
            overlay={simPkg.loanAskRows.find((r) => r.key === 'interest')?.overlay}
          />
          <ResultTile
            label={`Deferred (${simPkg.deferredMonths} mo)`}
            value={money(simPkg.deferredInterest)}
            overlay={[`${simPkg.deferredMonths} months × ${money(simPkg.monthlyInterest)}/mo = ${money(simPkg.deferredInterest)} rolled into loan.`]}
          />
          <ResultTile
            label="Loan vs value"
            value={simPkg.ltvPct > 0 ? `${Math.round(simPkg.ltvPct)}% LTV` : '—'}
            overlay={[`${money(simPkg.totalLoan)} of ${money(simPkg.value)} stabilized value.`]}
          />
          <ResultTile
            label={`Takeout refi (${simPkg.refiCheck.refiLtv}%)`}
            value={money(simPkg.refiCheck.newLoan)}
            overlay={simPkg.refiCheckRows[0]?.overlay}
          />
          <ResultTile
            label={netLabel}
            value={money(Math.abs(simPkg.refiCheck.netAtRefi))}
            tone={simPkg.refiCheck.isGap ? 'warn' : 'good'}
            overlay={simPkg.refiCheckRows[3]?.overlay}
          />
        </dl>
      </div>
    </div>
  );
}
