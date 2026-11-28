import { useEffect, useState } from 'react';
import { Card, CardTitle, Button, OverlayTrigger } from './Shell.jsx';
import { money, moneyK } from '../lib/dealmath.js';
import { defaultMarketRent, operatingBreakdownFor, rangeSummary, rangeValue, whatIfViews, whatIfGrid } from '../lib/rangeValue.js';

const midRent = (mr) => (
  typeof defaultMarketRent === 'function'
    ? defaultMarketRent(mr)
    : mr && Number.isFinite(+mr.defaultRent) && +mr.defaultRent > 0
      ? Math.round(+mr.defaultRent)
      : mr && Number.isFinite(+mr.low) && Number.isFinite(+mr.high)
        ? Math.round((+mr.low + +mr.high) / 2)
        : 0
);

export { whatIfViews, whatIfGrid } from '../lib/rangeValue.js';

export function isRentValue(rv) {
  return Boolean(rv && Array.isArray(rv.units) && rv.units.length && Array.isArray(rv.views) && Array.isArray(rv.grid));
}

const dash = '—';
const cash = (v) => (v === null || v === undefined ? dash : money(v));
const signed = (v) => (v === null || v === undefined ? dash : `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`);
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? null : Math.max(0, +v));

// Unit by unit rent, three side-by-side views and a rent × cap rate value grid. Lender, reviewer and owner only.
// Pure presentation of guide.rentValue; the owner can type rent today and market rent per unit.
// Value range (floor to value by income) and, for the lender and owner, the market rent range with a what-if slider.
// The slider is local only: it never saves and never changes anyone's numbers.
function Ranges({ data, showMarket, sourceLines, Trigger, rent, setRent }) {
  const vr = data.valueRange;
  const mr = showMarket ? data.marketRange : null;
  if (!vr && !mr) return null;
  const summary = mr && typeof rangeSummary === 'function' ? rangeSummary(mr, rent) : null;
  const v = summary ? summary.value : (mr ? rangeValue(mr, rent) : 0);
  const grossMo = summary ? summary.grossMo : (mr ? mr.units * rent : 0);
  const rentMo = summary ? summary.rentMo : (mr ? grossMo * (1 - mr.vacancyPct / 100) : 0);
  const activeCostsMo = summary ? summary.costsMo : (mr ? mr.costsMo : 0);
  const activeVacPct = summary ? summary.vacancyPct : (mr ? mr.vacancyPct : 0);
  const rentOverlayLines = summary?.rentOverlay?.length
    ? summary.rentOverlay
    : [`${mr?.units ?? 0} × ${money(rent)}/mo = ${money(grossMo)}/mo`, `Less ${activeVacPct}% vacancy: ${money(rentMo)}/mo`];
  return (
    <Card>
      <CardTitle>Value and market rent</CardTitle>
      <dl className="grid gap-2 sm:grid-cols-2">
        {vr && (
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Value</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
              <Trigger lines={vr.lowOverlay}>{money(vr.low)}</Trigger> to <Trigger lines={vr.highOverlay}>{money(vr.high)}</Trigger>
            </dd>
          </div>
        )}
        {mr && (
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Market rent per unit</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
              {sourceLines && sourceLines.length ? <Trigger lines={sourceLines}>{`${money(mr.low)} to ${money(mr.high)}`}</Trigger> : `${money(mr.low)} to ${money(mr.high)}`}
            </dd>
          </div>
        )}
      </dl>
      {mr && (
        <div className="mt-3 rounded-2xl border border-line bg-white p-3">
          <label htmlFor="market-rent-what-if" className="flex items-center justify-between text-sm font-medium">
            <span>What if rent is</span>
            <span className="tabular-nums">{money(rent)}</span>
          </label>
          <input id="market-rent-what-if" type="range" min={mr.low} max={mr.high} step={1} value={rent} onChange={(e) => setRent(+e.target.value)} className="mt-2 w-full accent-ink" />
          <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-ink-soft">
            <span>{money(mr.low)}</span>
            <button type="button" onClick={() => setRent(midRent(mr))} className="underline decoration-dotted underline-offset-4 hover:text-ink">
              {money(midRent(mr))}
            </button>
            <span>{money(mr.high)}</span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm tabular-nums">
            <div>
              <dt className="text-ink-soft">Rent in /mo</dt>
              <dd className="font-semibold">
                <Trigger lines={rentOverlayLines}>
                  {money(rentMo)}
                </Trigger>
              </dd>
            </div>
            <div><dt className="text-ink-soft">Value</dt><dd className={`font-semibold ${v >= mr.allIn ? 'text-good' : ''}`}><Trigger lines={[`${mr.units} × ${money(rent)}/mo, less ${activeVacPct}% vacancy`, `Less costs: ${money(activeCostsMo)}/mo`, `÷ ${mr.capRate}% cap rate`, `All in: ${money(mr.allIn)}`]}>{money(v)}</Trigger></dd></div>
          </dl>
        </div>
      )}
    </Card>
  );
}

// Views with the same numbers merge into one column, so the table never repeats itself.
export function mergeViews(views) {
  const out = [];
  for (const v of views || []) {
    const prev = out[out.length - 1];
    const same = prev && ['rented', 'rentMo', 'costsMo', 'netYr', 'value', 'allIn'].every((k) => Math.round(+prev[k] || 0) === Math.round(+v[k] || 0));
    if (same) out[out.length - 1] = { ...prev, key: `${prev.key}+${v.key}`, label: `${prev.label} / ${v.label}` };
    else out.push(v);
  }
  return out;
}

function OperatingBreakdownCard({ calc, Trigger }) {
  if (!calc) return null;
  const l = calc.laundry;
  return (
    <Card data-wb="opex-breakdown">
      <CardTitle
        aside={
          <Trigger
            lines={[`NOI ${money(calc.noiAnnual)}/yr ÷ ${calc.capRate}% cap rate = ${money(calc.value)}`]}
            className="text-sm font-medium text-ink-soft"
          >
            NOI {money(calc.noiAnnual)}/yr
          </Trigger>
        }
      >
        Operating costs &amp; laundry
      </CardTitle>

      <dl className="divide-y divide-line text-sm tabular-nums">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0">
          <dt className="min-w-0 text-ink-soft">
            Gross rent ({calc.units} units × {money(calc.grossMonthly / Math.max(1, calc.units))}/mo)
          </dt>
          <dd className="shrink-0 font-semibold text-ink">{money(calc.grossAnnual)}/yr</dd>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
          <dt className="min-w-0 text-ink-soft">
            <Trigger lines={[calc.vacancyOverlayLine].filter(Boolean)}>Vacancy ({calc.vacancyPct}%)</Trigger>
          </dt>
          <dd className="shrink-0 font-semibold text-ink">−{money(calc.vacancyAnnual)}/yr</dd>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 font-semibold">
          <dt className="min-w-0 text-ink">Effective rent</dt>
          <dd className="shrink-0 text-ink">{money(calc.effectiveRentAnnual)}/yr</dd>
        </div>

        {calc.lines.map((line) => (
          <div key={line.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
            <dt className="min-w-0 text-ink-soft">
              <Trigger lines={[line.text]}>{line.label}</Trigger>
            </dt>
            <dd className="shrink-0 font-medium text-ink">
              <Trigger lines={[line.text]}>−{money(line.annual)}/yr</Trigger>
            </dd>
          </div>
        ))}

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 font-semibold">
          <dt className="min-w-0 text-ink">Total operating costs</dt>
          <dd className="shrink-0 text-ink">
            <Trigger lines={calc.costsOverlay}>−{money(calc.totalExpensesAnnual)}/yr</Trigger>
          </dd>
        </div>

        {l?.enabled && (
          <div data-wb="laundry-income" className="space-y-1.5 py-2.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Laundry income ({l.stacks} stacks)
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <dt className="min-w-0 text-ink-soft">
                <Trigger lines={l.overlay}>Loads ({l.rentedUnits} rented)</Trigger>
              </dt>
              <dd className="shrink-0 font-medium text-ink">{Math.round(l.loads).toLocaleString('en-US')}/yr</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <dt className="min-w-0 text-ink-soft">
                <Trigger lines={l.overlay}>Laundry gross</Trigger>
              </dt>
              <dd className="shrink-0 font-medium text-ink">{money(l.grossAnnual)}/yr</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <dt className="min-w-0 text-ink-soft">
                <Trigger lines={l.overlay}>Laundry costs</Trigger>
              </dt>
              <dd className="shrink-0 font-medium text-ink">−{money(l.costsAnnual)}/yr</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-semibold">
              <dt className="min-w-0 text-ink">
                <Trigger lines={l.overlay}>Laundry net</Trigger>
              </dt>
              <dd className="shrink-0 text-good">
                <Trigger lines={l.overlay} className="text-good">+{money(l.netAnnual)}/yr</Trigger>
              </dd>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t-2 border-ink/20 pt-3 font-semibold">
          <dt className="min-w-0 text-ink">Yearly NOI</dt>
          <dd className="shrink-0 font-display text-lg text-ink">{money(calc.noiAnnual)}/yr</dd>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 pt-2 font-semibold last:pb-0">
          <dt className="min-w-0 text-ink">Value ({calc.capRate}% cap)</dt>
          <dd className="shrink-0 font-display text-xl text-ink">
            <Trigger lines={[`${money(calc.noiAnnual)}/yr ÷ ${calc.capRate}% cap rate = ${money(calc.value)}`]}>
              {money(calc.value)}
            </Trigger>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export default function RentValue({ data, editable = false, onSave, Trigger = OverlayTrigger, showMarket = false, sourceLines = null, hideUnits = false, rent: controlledRent = null, onRentChange = null }) {
  const [draft, setDraft] = useState({});
  const [state, setState] = useState('');
  const mr = showMarket && data?.marketRange ? data.marketRange : null;
  const [internalRent, setInternalRent] = useState(mr ? midRent(mr) : 0);
  const isControlled = controlledRent !== null && controlledRent !== undefined && typeof onRentChange === 'function';
  const rent = isControlled ? controlledRent : internalRent;
  const setRent = isControlled ? onRentChange : setInternalRent;
  useEffect(() => { setDraft({}); }, [data]);
  useEffect(() => { if (mr && !isControlled) setInternalRent(midRent(mr)); }, [mr?.low, mr?.high, mr?.defaultRent, isControlled]);
  if (!isRentValue(data)) return null;

  const val = (u, k) => (draft[u.id] && k in draft[u.id] ? draft[u.id][k] : u[k] ?? '');
  const set = (id, k, v) => setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));
  const dirty = Object.keys(draft).length > 0;
  const save = async () => {
    if (!onSave || !dirty) return;
    setState('Saving…');
    const units = data.units.map((u) => ({ id: u.id, rentToday: numOrNull(val(u, 'rentToday')), marketRent: numOrNull(val(u, 'marketRent')) }));
    const error = await onSave(units);
    setState(error ? 'Not saved. Try again.' : 'Saved.');
  };
  const input = (u, k, label) => (
    <input
      aria-label={`Unit ${u.id} ${label}`}
      type="number"
      inputMode="numeric"
      min={0}
      step={25}
      value={val(u, k)}
      onChange={(e) => set(u.id, k, e.target.value)}
      className="w-24 rounded-lg border border-line bg-white px-2 py-1.5 text-right tabular-nums focus:border-ink focus:outline-none"
    />
  );

  const useSlider = Boolean(mr);
  const views = mergeViews(useSlider ? whatIfViews(data, rent) : data.views);
  const grid = useSlider ? whatIfGrid(data, rent) : data.grid;
  const activeRent = useSlider ? rent : data.ourRent;
  const opexBreakdown = typeof operatingBreakdownFor === 'function' ? operatingBreakdownFor(data, activeRent) : null;
  const rows = [
    ['Units rented', (v) => `${v.rented} of ${v.total}`, (v) => v.rentOverlay],
    ['Rent in /mo', (v) => money(v.rentMo), (v) => v.rentOverlay],
    ['Costs /mo', (v) => money(v.costsMo), (v) => v.costsOverlay],
    ['Net /yr', (v) => money(v.netYr), (v) => v.netOverlay],
    ['Value', (v) => money(v.value), (v) => v.valueOverlay],
    ['All in', (v) => money(v.allIn), (v) => v.allInOverlay],
  ];

  return (
    <div className="space-y-5">
      <Ranges data={data} showMarket={showMarket} sourceLines={sourceLines} Trigger={Trigger} rent={rent} setRent={setRent} />
      <OperatingBreakdownCard calc={opexBreakdown} Trigger={Trigger} />
      {!hideUnits && <Card>
        <CardTitle aside={editable ? <Button kind="secondary" onClick={save} disabled={!dirty}>Save</Button> : null}>Unit by unit</CardTitle>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} role="region" aria-label="Unit by unit rent">
          <table className="w-full min-w-[560px] border-collapse text-right text-sm tabular-nums">
            <thead className="bg-ink text-xs text-white">
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-ink px-3 py-2.5 text-left">Unit</th>
                <th scope="col" className="px-3 py-2.5">Repairs</th>
                <th scope="col" className="px-3 py-2.5">Rent today</th>
                <th scope="col" className="px-3 py-2.5">Our rent</th>
                {showMarket ? <th scope="col" className="px-3 py-2.5">Market rent</th> : null}
                {showMarket ? <th scope="col" className="px-3 py-2.5">Gap</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.units.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left">{u.id}</th>
                  <td className="px-3 py-2">{money(u.repairs)}</td>
                  <td className="px-3 py-2">{editable ? input(u, 'rentToday', 'rent today') : u.rentToday === null && !u.occupied ? 'Empty' : cash(u.rentToday)}</td>
                  <td className="px-3 py-2 font-semibold">{money(u.ourRent)}</td>
                  {showMarket ? <td className="px-3 py-2">{editable ? input(u, 'marketRent', 'market rent') : cash(u.marketRent)}</td> : null}
                  {showMarket ? <td className={`px-3 py-2 font-semibold ${u.gap > 0 ? 'text-good' : u.gap < 0 ? 'text-red-700' : 'text-ink'}`}>{signed(u.gap)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && state && <p role="status" className="mt-2 text-sm text-ink-soft">{state}</p>}
      </Card>}

      <Card>
        <CardTitle>{views.map((v) => v.label).join(', ')}</CardTitle>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} role="region" aria-label="Three views side by side">
          <table className={`w-full ${views.length >= 3 ? 'min-w-[480px] ' : ''}border-collapse text-right text-sm tabular-nums`}>
            <thead className="bg-ink text-xs text-white">
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-ink px-3 py-2.5 text-left"><span className="sr-only">Line</span></th>
                {views.map((v) => <th key={v.key} scope="col" className="px-3 py-2.5">{v.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, show, overlay]) => (
                <tr key={label} className={`border-t border-line ${label === 'Value' ? 'bg-paper font-semibold' : ''}`}>
                  <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left ${label === 'Value' ? 'bg-paper' : 'bg-white'}`}>{label}</th>
                  {views.map((v) => (
                    <td key={v.key} className={`px-3 py-2 ${label === 'Net /yr' && v.netYr < 0 ? 'text-red-700' : ''}`}>
                      <Trigger lines={overlay(v)}>{show(v)}</Trigger>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Value by rent and cap rate</CardTitle>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} role="region" aria-label="Value by rent and cap rate">
          <table className="w-full min-w-[420px] border-collapse text-right text-sm tabular-nums">
            <thead className="bg-ink text-xs text-white">
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-ink px-3 py-2.5 text-left">Rent / unit</th>
                {data.caps.map((c) => <th key={c} scope="col" className="px-3 py-2.5">{c}% cap</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row.rent} className="border-t border-line">
                  <th scope="row" className={`sticky left-0 z-10 bg-white px-3 py-2 text-left ${row.rent === activeRent ? 'font-semibold' : 'font-normal'}`}>{money(row.rent)}</th>
                  {row.cells.map((c) => (
                    <td key={c.cap} className="p-1">
                      <Trigger
                        lines={c.overlay}
                        className={`block w-full rounded-lg px-2 py-1.5 text-right ${c.clears ? 'bg-emerald-50 font-semibold text-good' : 'text-ink-soft'} ${c.stabilized ? 'ring-2 ring-ink' : ''}`}
                      >
                        {moneyK(c.value)}
                      </Trigger>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
