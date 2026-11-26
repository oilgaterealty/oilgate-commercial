import { useEffect, useState } from 'react';
import { Card, CardTitle, Button, OverlayTrigger } from './Shell.jsx';
import { money, moneyK } from '../lib/dealmath.js';
import { rangeValue } from '../lib/rangeValue.js';

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
function Ranges({ data, showMarket, sourceLines, Trigger }) {
  const vr = data.valueRange;
  const mr = showMarket ? data.marketRange : null;
  const [rent, setRent] = useState(mr ? mr.low : 0);
  useEffect(() => { if (mr) setRent(mr.low); }, [mr?.low, mr?.high]);
  if (!vr && !mr) return null;
  const v = mr ? rangeValue(mr, rent) : 0;
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
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm tabular-nums">
            <div><dt className="text-ink-soft">Rent in /mo</dt><dd className="font-semibold">{money(mr.units * rent)}</dd></div>
            <div><dt className="text-ink-soft">Value</dt><dd className={`font-semibold ${v >= mr.allIn ? 'text-good' : ''}`}><Trigger lines={[`${mr.units} × ${money(rent)}/mo, less ${mr.vacancyPct}% vacancy`, `Less costs: ${money(mr.costsMo)}/mo`, `÷ ${mr.capRate}% cap rate`, `All in: ${money(mr.allIn)}`]}>{money(v)}</Trigger></dd></div>
          </dl>
        </div>
      )}
    </Card>
  );
}

export default function RentValue({ data, editable = false, onSave, Trigger = OverlayTrigger, showMarket = false, sourceLines = null }) {
  const [draft, setDraft] = useState({});
  const [state, setState] = useState('');
  useEffect(() => { setDraft({}); }, [data]);
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

  const views = data.views;
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
      <Ranges data={data} showMarket={showMarket} sourceLines={sourceLines} Trigger={Trigger} />
      <Card>
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
      </Card>

      <Card>
        <CardTitle>As is, after repairs, full market</CardTitle>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} role="region" aria-label="Three views side by side">
          <table className="w-full min-w-[480px] border-collapse text-right text-sm tabular-nums">
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
              {data.grid.map((row) => (
                <tr key={row.rent} className="border-t border-line">
                  <th scope="row" className={`sticky left-0 z-10 bg-white px-3 py-2 text-left ${row.rent === data.ourRent ? 'font-semibold' : 'font-normal'}`}>{money(row.rent)}</th>
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
