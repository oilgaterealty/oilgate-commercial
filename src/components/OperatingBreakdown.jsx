import { useState } from 'react';
import { Card, CardTitle, OverlayTrigger } from './Shell.jsx';
import { money } from '../lib/dealmath.js';
import { groupOpexCalc } from '../lib/opex.js';

// Shared grouped, collapsed-by-default "Operating costs & laundry" component across all roles.
export default function OperatingBreakdown({ calc, Trigger = OverlayTrigger, card = false, className = '' }) {
  const [open, setOpen] = useState({});
  if (!calc) return null;

  const groups = Array.isArray(calc.groups) && calc.groups.length ? calc.groups : groupOpexCalc(calc);
  const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  const capRate = calc.capRate > 0 ? calc.capRate : 9;

  const body = (
    <div data-wb="opex-breakdown" className={card ? 'divide-y divide-line text-sm tabular-nums' : `mt-3 divide-y divide-line border-t border-line pt-2 text-sm tabular-nums ${className}`}>
      {groups.map((g) => {
        const isOpen = Boolean(open[g.key]);
        return (
          <div
            key={g.key}
            data-opex-group={g.key}
            {...(g.key === 'laundry' ? { 'data-wb': 'laundry-income' } : {})}
            className="py-1 first:pt-0"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(g.key)}
              className="flex min-h-[44px] w-full items-center justify-between gap-x-3 rounded-lg px-1.5 py-1.5 text-left text-sm transition hover:bg-warm-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-ink">
                <span aria-hidden="true" className="shrink-0 text-xs text-ink-soft">{isOpen ? '▴' : '▾'}</span>
                <span className="min-w-0 break-words">{g.label}</span>
              </span>
              <span className={`shrink-0 whitespace-nowrap font-semibold ${g.tone === 'good' ? 'text-good' : 'text-ink'}`}>
                {g.subtotalText}
              </span>
            </button>
            {isOpen && (
              <dl className="mb-1.5 mt-0.5 space-y-1 rounded-xl bg-paper px-3 py-2 text-sm tabular-nums">
                {g.items.map((item) => (
                  <div key={item.key} className="flex items-baseline justify-between gap-x-3 gap-y-0.5 py-0.5">
                    <dt className="min-w-0 flex-1 text-ink-soft">
                      {item.overlay?.length ? <Trigger lines={item.overlay}>{item.label}</Trigger> : item.label}
                    </dt>
                    <dd className={`shrink-0 whitespace-nowrap font-medium ${item.tone === 'good' ? 'text-good' : 'text-ink'}`}>
                      {item.overlay?.length
                        ? <Trigger lines={item.overlay} className={item.tone === 'good' ? 'text-good' : ''}>{item.valueText}</Trigger>
                        : item.valueText}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}

      <div data-opex-summary="noi" className="flex items-baseline justify-between gap-x-3 border-t-2 border-ink/20 pt-3 pb-1.5 font-semibold">
        <span className="min-w-0 text-ink">NOI</span>
        <span className="shrink-0 whitespace-nowrap font-display text-lg text-ink">{money(calc.noiAnnual)}/yr</span>
      </div>

      <div data-opex-summary="value" className="flex items-baseline justify-between gap-x-3 pt-2 font-semibold">
        <span className="min-w-0 text-ink">Value at {capRate}% cap</span>
        <span className="shrink-0 whitespace-nowrap font-display text-xl text-ink">
          <Trigger lines={[`${money(calc.noiAnnual)}/yr ÷ ${capRate}% cap rate = ${money(calc.value)}`]}>
            {money(calc.value)}
          </Trigger>
        </span>
      </div>

      {calc.upside && Array.isArray(calc.upside.items) && calc.upside.items.length > 0 && (
        <div data-opex-group="upside" data-wb="upside" className="mt-2 pt-2">
          <button
            type="button"
            aria-expanded={Boolean(open.upside)}
            onClick={() => toggle('upside')}
            className="flex min-h-[44px] w-full items-center justify-between gap-x-3 rounded-lg px-1.5 py-1.5 text-left text-sm transition hover:bg-warm-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-ink">
              <span aria-hidden="true" className="shrink-0 text-xs text-ink-soft">{open.upside ? '▴' : '▾'}</span>
              <span className="min-w-0 break-words">{calc.upside.label}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs font-medium text-ink-soft">
              {calc.upside.totalText || ''}
            </span>
          </button>
          {open.upside && (
            <dl className="mb-1.5 mt-0.5 space-y-1 rounded-xl bg-paper px-3 py-2 text-sm tabular-nums">
              {calc.upside.items.map((item) => (
                <div key={item.key} className="flex items-baseline justify-between gap-x-3 gap-y-0.5 py-0.5">
                  <dt className="min-w-0 flex-1 text-ink-soft">
                    {item.overlay?.length ? <Trigger lines={item.overlay}>{item.label}</Trigger> : item.label}
                  </dt>
                  <dd className="shrink-0 whitespace-nowrap font-medium text-ink">
                    {item.overlay?.length
                      ? <Trigger lines={item.overlay}>{item.valueText}</Trigger>
                      : item.valueText}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );

  if (!card) return body;

  return (
    <Card>
      <CardTitle
        aside={
          <Trigger
            lines={[`NOI ${money(calc.noiAnnual)}/yr ÷ ${capRate}% cap rate = ${money(calc.value)}`]}
            className="text-sm font-medium text-ink-soft"
          >
            NOI {money(calc.noiAnnual)}/yr
          </Trigger>
        }
      >
        Operating costs &amp; laundry
      </CardTitle>
      {body}
    </Card>
  );
}
