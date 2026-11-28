import { useEffect, useState } from 'react';
import { buyerName } from '../lib/people.js';
import { money } from '../lib/dealmath.js';
import { buildLenderPackage } from '../lib/lenderModel.js';
import { sendToOwner } from './Messages.jsx';
import { Button, Card, CardTitle, OverlayTrigger } from './Shell.jsx';

function NumberStepRow({ label, unit, value, step, min = 0, max, onChange, changed, presets }) {
  const v = value ?? '';
  const bump = (dir) => {
    const next = Math.round(((+v || 0) + dir * step) * 100) / 100;
    const clamped = Math.max(min, max !== undefined ? Math.min(max, next) : next);
    onChange(clamped);
  };
  return (
    <div className="py-1.5 space-y-1.5">
      <label className="flex min-h-[44px] items-center justify-between gap-2">
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
      {Array.isArray(presets) && presets.length > 0 && (
        <div className="flex justify-end gap-1.5" role="group" aria-label={`${label} quick options`}>
          {presets.map((p) => {
            const active = +v === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                className={`min-h-[34px] rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'
                }`}
              >
                {p}{unit}
              </button>
            );
          })}
        </div>
      )}
    </div>
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

// Local-only per-tab what-if calculator for lenders. Never saves to commercial_models or commercial_offers.
export default function LenderWhatIf({ deal, me, preview, pkg, base, offer, guide, lens = 'bridge' }) {
  const initialFromPkg = (p) => ({
    ratePct: p.ratePct,
    pointsPct: p.pointsPct,
    deferredMonths: p.deferredMonths,
    processing: p.processing,
    repairs: p.repairs,
    participation: p.minParticipation,
    privateRate: p.privatePool.ratePct,
    privateTermMonths: p.privatePool.termMonths,
    refiLtv: p.refiCheck.refiLtv,
    value: p.value,
    refiRate: p.refiCheck.refiRate,
    refiYears: p.refiCheck.refiYears,
    refiFeesPct: p.refiCheck.refiFeesPct,
    refiFeesFlat: p.refiCheck.refiFeesFlat,
  });

  const [inputs, setInputs] = useState(() => initialFromPkg(pkg));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInputs(initialFromPkg(pkg));
    setStatus('');
  }, [
    lens,
    pkg.ratePct,
    pkg.pointsPct,
    pkg.deferredMonths,
    pkg.processing,
    pkg.repairs,
    pkg.minParticipation,
    pkg.privatePool.ratePct,
    pkg.privatePool.termMonths,
    pkg.refiCheck.refiLtv,
    pkg.value,
    pkg.refiCheck.refiRate,
    pkg.refiCheck.refiYears,
    pkg.refiCheck.refiFeesPct,
    pkg.refiCheck.refiFeesFlat,
  ]);

  const defaults = initialFromPkg(pkg);
  const keysByLens = {
    bridge: ['ratePct', 'pointsPct', 'deferredMonths', 'processing', 'repairs'],
    private: ['participation', 'privateRate', 'repairs', 'privateTermMonths'],
    dscr: ['refiLtv', 'value', 'refiRate', 'refiYears', 'refiFeesPct', 'refiFeesFlat'],
  };
  const activeKeys = keysByLens[lens] || keysByLens.bridge;
  const touched = activeKeys.some((k) => +inputs[k] !== +defaults[k]);

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
    privateMinParticipation: numOr(inputs.participation, pkg.minParticipation),
    privateRate: numOr(inputs.privateRate, pkg.privatePool.ratePct),
    privateTermMonths: numOr(inputs.privateTermMonths, pkg.privatePool.termMonths),
    refiLtv: numOr(inputs.refiLtv, pkg.refiCheck.refiLtv),
    value: numOr(inputs.value, pkg.value),
    refiRate: numOr(inputs.refiRate, pkg.refiCheck.refiRate),
    refiYears: numOr(inputs.refiYears, pkg.refiCheck.refiYears),
    refiFeesPct: numOr(inputs.refiFeesPct, pkg.refiCheck.refiFeesPct),
    refiFeesFlat: numOr(inputs.refiFeesFlat, pkg.refiCheck.refiFeesFlat),
  };
  const simGuide = guide
    ? {
        ...guide,
        costSummary: { ...(guide.costSummary || {}), total: simBase.rehab },
        refi: {
          ...(guide.refi || {}),
          estimatedValue: simBase.value,
          ltvPct: simBase.refiLtv,
          feesPct: simBase.refiFeesPct,
          feesFlat: simBase.refiFeesFlat,
        },
      }
    : null;
  const simPkg = buildLenderPackage({ base: simBase, offer, guide: simGuide, lens });

  const reset = () => {
    setInputs(defaults);
    setStatus('');
  };

  const share = numOr(inputs.participation, pkg.minParticipation);
  const shareMonthly = (share * simPkg.privatePool.ratePct) / 100 / 12;
  const shareTotal = shareMonthly * simPkg.privatePool.termMonths;

  const buildSummary = () => {
    if (lens === 'private') {
      return [
        `Lender what-if (${simPkg.lens.label}, nothing was saved):`,
        `- Your share: ${money(share)}`,
        `- Rate: ${simPkg.privatePool.ratePct}%`,
        `- Term: ${simPkg.privatePool.termMonths} months`,
        `- Total funds needed: ${money(simPkg.privatePool.totalFunds)}`,
        `- Your monthly return: ${money(shareMonthly)}/mo`,
        `- ${simPkg.privatePool.isGap ? 'Gap at refinance' : 'Surplus at refinance'}: ${money(Math.abs(simPkg.privatePool.surplusAtRefi))}`,
      ].join('\n');
    }
    if (lens === 'dscr') {
      return [
        `Lender what-if (${simPkg.lens.label}, nothing was saved):`,
        `- Takeout loan: ${simPkg.refiCheck.refiLtv}% LTV · Value ${money(simPkg.value)} · Loan ${money(simPkg.refiCheck.newLoan)}`,
        `- Rate & amortization: ${simPkg.refiCheck.refiRate}% over ${simPkg.refiCheck.refiYears} years (${money(simPkg.refiCheck.refiPayment)}/mo P&I)`,
        `- Refi fees: ${money(simPkg.refiCheck.refiFeesTotal)}`,
        `- Pays off bridge: ${money(simPkg.refiCheck.bridgePayoff)}`,
        `- ${simPkg.refiCheck.isGap ? 'Gap at refinance' : 'Surplus at refinance'}: ${money(Math.abs(simPkg.refiCheck.netAtRefi))}`,
      ].join('\n');
    }
    return [
      `Lender what-if (${simPkg.lens.label}, nothing was saved):`,
      `- Rate: ${simPkg.ratePct}% IO non-Dutch (was ${pkg.ratePct}%)`,
      `- Points: ${simPkg.pointsPct} (${money(simPkg.points)})`,
      `- Deferred interest: ${simPkg.deferredMonths} mo (${money(simPkg.deferredInterest)} due at payoff)`,
      `- Processing: ${money(simPkg.processing)}`,
      `- Repairs: ${money(simPkg.repairs)}`,
      `- Total bridge loan: ${money(simPkg.totalLoan)} (100% LTC, $0 down)`,
    ].join('\n');
  };

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

  const rowsByLens = {
    bridge: [
      ['ratePct', 'Bridge rate', '%', 0.25, 0, 30],
      ['pointsPct', 'Origination points', 'pts', 0.25, 0, 10],
      ['deferredMonths', 'Deferred interest', 'mo', 1, 0, 12],
      ['processing', 'Processing fee', '$', 100, 0, undefined],
      ['repairs', 'Repair budget', '$', 5000, 0, undefined],
    ],
    private: [
      ['participation', 'Your share', '$', 5000, 0, undefined],
      ['privateRate', 'Interest rate', '%', 0.25, 0, 30],
      ['repairs', 'Repair budget', '$', 5000, 0, undefined],
      ['privateTermMonths', 'Loan term', 'mo', 1, 1, 60],
    ],
    dscr: [
      ['refiLtv', 'Takeout LTV', '%', 5, 0, 100, [75, 80]],
      ['value', 'Stabilized value', '$', 10000, 0, undefined],
      ['refiRate', 'Interest rate', '%', 0.25, 0, 20],
      ['refiYears', 'Amortization', 'yr', 5, 5, 40],
      ['refiFeesPct', 'Refi fee (%)', '%', 0.1, 0, 10],
      ['refiFeesFlat', 'Flat refi fee', '$', 500, 0, undefined],
    ],
  };

  const rows = rowsByLens[lens] || rowsByLens.bridge;

  const tiles = lens === 'private'
    ? [
        {
          key: 'totalFunds',
          label: 'Total funds needed',
          value: money(simPkg.privatePool.totalFunds),
          overlay: simPkg.privateFundsRows.find((r) => r.key === 'total')?.overlay,
        },
        {
          key: 'share',
          label: 'Your share',
          value: money(share),
          overlay: [`Minimum participation: ${money(simPkg.minParticipation)}.`],
        },
        {
          key: 'shareMonthly',
          label: `Your monthly return (${simPkg.privatePool.ratePct}%)`,
          value: `${money(shareMonthly)}/mo`,
          overlay: [`${money(share)} × ${simPkg.privatePool.ratePct}% ÷ 12 = ${money(shareMonthly)}/mo.`],
        },
        {
          key: 'shareTotal',
          label: `Your interest (${simPkg.privatePool.termMonths} mo)`,
          value: money(shareTotal),
          overlay: [`${simPkg.privatePool.termMonths} months × ${money(shareMonthly)}/mo = ${money(shareTotal)}.`],
        },
        {
          key: 'poolMonthly',
          label: 'Pool monthly interest',
          value: `${money(simPkg.privatePool.monthlyInterest)}/mo`,
          overlay: simPkg.privateFundsRows.find((r) => r.key === 'interest')?.overlay,
        },
        {
          key: 'surplus',
          label: simPkg.privatePool.isGap ? 'Gap at refinance' : 'Surplus at refinance',
          value: money(Math.abs(simPkg.privatePool.surplusAtRefi)),
          tone: simPkg.privatePool.isGap ? 'warn' : 'good',
          overlay: simPkg.privatePoolRows.find((r) => r.key === 'surplus')?.overlay,
        },
      ]
    : lens === 'dscr'
      ? [
          {
            key: 'newLoan',
            label: `Takeout loan (${simPkg.refiCheck.refiLtv}% LTV)`,
            value: money(simPkg.refiCheck.newLoan),
            overlay: [`${simPkg.refiCheck.refiLtv}% LTV · Value ${money(simPkg.value)} · Loan ${money(simPkg.refiCheck.newLoan)}.`],
          },
          {
            key: 'payment',
            label: 'Monthly payment (P&I)',
            value: `${money(simPkg.refiCheck.refiPayment)}/mo`,
            overlay: [`${money(simPkg.refiCheck.newLoan)} over ${simPkg.refiCheck.refiYears} years at ${simPkg.refiCheck.refiRate}%.`],
          },
          {
            key: 'refiFees',
            label: 'Refi fees',
            value: money(simPkg.refiCheck.refiFeesTotal),
            overlay: simPkg.refiCheckRows.find((r) => r.key === 'refiFees')?.overlay,
          },
          {
            key: 'payoff',
            label: 'Pays off bridge',
            value: money(simPkg.refiCheck.bridgePayoff),
            overlay: simPkg.refiCheckRows.find((r) => r.key === 'payoff')?.overlay,
          },
          {
            key: 'dscr',
            label: 'Minimum DSCR',
            value: `${simPkg.refiCheck.refiDscr}x`,
            overlay: [`Minimum debt-service coverage ratio required: ${simPkg.refiCheck.refiDscr}x.`],
          },
          {
            key: 'surplus',
            label: simPkg.refiCheck.isGap ? 'Gap at refinance' : 'Surplus at refinance',
            value: money(Math.abs(simPkg.refiCheck.netAtRefi)),
            tone: simPkg.refiCheck.isGap ? 'warn' : 'good',
            overlay: simPkg.refiCheckRows.find((r) => r.key === 'gap')?.overlay,
          },
        ]
      : [
          {
            key: 'totalLoan',
            label: 'Total bridge loan',
            value: money(simPkg.totalLoan),
            overlay: simPkg.loanAskRows.find((r) => r.key === 'total')?.overlay,
          },
          {
            key: 'initialDrawn',
            label: 'Drawn at close',
            value: money(simPkg.initialDrawn),
            overlay: [`${money(simPkg.totalLoan)} total − ${money(simPkg.repairs)} repairs held for draws = ${money(simPkg.initialDrawn)} at close.`],
          },
          {
            key: 'initialInterest',
            label: `Interest at close (${simPkg.ratePct}% IO)`,
            value: `${money(simPkg.initialMonthlyInterest)}/mo`,
            overlay: simPkg.loanAskRows.find((r) => r.key === 'interest')?.overlay,
          },
          {
            key: 'fullInterest',
            label: 'Interest once repairs drawn',
            value: `${money(simPkg.fullMonthlyInterest)}/mo`,
            overlay: [`${money(simPkg.totalLoan)} × ${simPkg.ratePct}% ÷ 12 = ${money(simPkg.fullMonthlyInterest)}/mo once all ${money(simPkg.repairs)} in repairs are drawn.`],
          },
          {
            key: 'deferred',
            label: `Deferred (${simPkg.deferredMonths} mo · due at payoff)`,
            value: money(simPkg.deferredInterest),
            overlay: [`${simPkg.deferredMonths} months × ${money(simPkg.initialMonthlyInterest)}/mo = ${money(simPkg.deferredInterest)} due at payoff.`],
          },
          {
            key: 'payoff',
            label: 'Total payoff',
            value: money(simPkg.bridgePayoff),
            overlay: [`${money(simPkg.totalLoan)} principal + ${money(simPkg.deferredInterest)} deferred interest = ${money(simPkg.bridgePayoff)}.`],
          },
        ];

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
            {rows.map(([k, label, unit, step, min, max, presets]) => (
              <NumberStepRow
                key={`${lens}:${k}`}
                label={label}
                unit={unit}
                step={step}
                min={min}
                max={max}
                presets={presets}
                value={inputs[k]}
                changed={+inputs[k] !== +defaults[k]}
                onChange={(val) => setInputs((prev) => ({ ...prev, [k]: val }))}
              />
            ))}
          </div>
        </Card>

        <dl className="grid grid-cols-2 gap-3 self-start lg:grid-cols-3">
          {tiles.map((t) => (
            <ResultTile
              key={t.key}
              label={t.label}
              value={t.value}
              tone={t.tone}
              overlay={t.overlay}
            />
          ))}
        </dl>
      </div>
    </div>
  );
}
