import { buyerName, possessive } from '../lib/people.js';
import { useState } from 'react';
import { BASE_DEFAULTS, BASE_FIELDS, STR_FIELDS, STRUCTURES, evaluate, money, pct, strMonthly } from '../lib/dealmath.js';
import { sendToOwner } from './Messages.jsx';
import { Button } from './Shell.jsx';

const val = (base, k) => (base[k] ?? BASE_DEFAULTS[k]);
const num = (v) => (v === '' ? '' : +v);

function Segmented({ label, options, value, onChange }) {
  return (
    <div>
      <p className="mb-1 text-xs text-ink-soft">{label}</p>
      <div className="inline-flex rounded-full border border-line bg-white p-0.5" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={`rounded-full px-3 py-1 text-sm transition ${value === v ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Money({ label, value, onChange, step = 25, suffix }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-soft">{label}</span>
      <span className="flex items-center gap-1">
        <button type="button" aria-label={`Lower ${label}`} onClick={() => onChange(Math.max(0, (+value || 0) - step))} className="h-8 w-8 rounded-lg border border-line bg-white text-ink-soft hover:bg-warm-soft">−</button>
        <span className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>
          <input type="number" inputMode="decimal" min={0} step={step} value={value} aria-label={label} onChange={(e) => onChange(num(e.target.value))}
            className="h-8 w-24 rounded-lg border border-line bg-white pl-5 pr-2 text-right text-sm outline-none focus:border-ink" />
        </span>
        <button type="button" aria-label={`Raise ${label}`} onClick={() => onChange((+value || 0) + step)} className="h-8 w-8 rounded-lg border border-line bg-white text-ink-soft hover:bg-warm-soft">+</button>
        {suffix && <span className="text-xs text-ink-soft">{suffix}</span>}
      </span>
    </label>
  );
}

// The three switches: units (9 or 10), rent, and how many units run as Airbnb.
// Owner, realtor, reviewer and lender see them. Never the seller or viewers.
export default function Switches({ base, setBase, owner }) {
  const [details, setDetails] = useState(false);
  const set = (p) => setBase({ ...base, ...p });
  const units = +val(base, 'units') >= 10 ? 10 : 9;
  const strUnits = Math.round(+val(base, 'strUnits')) || 0;
  const s = strMonthly({ ...BASE_DEFAULTS, ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, +v || 0])) });
  const hasStr = +val(base, 'strNightly') > 0;
  return (
    <div className="rounded-2xl bg-paper p-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Segmented label="Units" options={[[9, '9 units'], [10, '10 units']]} value={units} onChange={(u) => set({ units: u })} />
        {units === 10 && <Money label="Extra repair for the 10th unit" value={val(base, 'tenthUnitRepair')} step={500} onChange={(v) => set({ tenthUnitRepair: v })} />}
        <Money label="Rent per unit / month" value={val(base, 'rent')} onChange={(v) => set({ rent: v })} />
        <Segmented label="Units as Airbnb" options={[[0, 'None'], [1, '1 unit'], [2, '2 units']]} value={strUnits} onChange={(n) => set({ strUnits: n })} />
      </div>
      {strUnits > 0 && (
        <div className="mt-3 text-sm">
          {hasStr
            ? <p>Each Airbnb unit brings in about <strong>{money(s.net)}/mo</strong> after fees and costs, against {money(+val(base, 'rent'))}/mo as a regular rental. {money(+val(base, 'strNightly'))} a night, {Math.round(+val(base, 'strOccPct'))}% of nights booked.</p>
            : <p className="text-ink-soft">No Airbnb numbers entered yet, so Airbnb units show no income.</p>}
          {owner && base.strSource && <p className="mt-1 text-xs text-ink-soft">Source: {base.strSource}</p>}
          <button type="button" onClick={() => setDetails(!details)} className="mt-1 text-xs underline">{details ? 'Hide Airbnb numbers' : 'Change Airbnb numbers'}</button>
          {details && (
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {STR_FIELDS.map(([k, l, u]) => (
                <label key={k} className="text-xs text-ink-soft">{l}
                  <input type="number" aria-label={l} min={0} step={u === '%' ? 1 : u === 'n' ? 0.5 : 5} value={val(base, k)} onChange={(e) => set({ [k]: num(e.target.value) })}
                    className="mt-1 block h-8 w-full rounded-lg border border-line bg-white px-2 text-right text-sm text-ink outline-none focus:border-ink" />
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-ink-soft">{owner ? 'Your changes save and update every offer.' : `Try any number. Nothing you change here is saved or changes ${possessive(buyerName())} numbers.`}</p>
    </div>
  );
}

const LABEL = { ...Object.fromEntries([...BASE_FIELDS, ...STR_FIELDS].map(([k, l]) => [k, l])), units: 'Units', tenthUnitRepair: 'Extra repair for the 10th unit', rent: 'Rent per unit / month', strUnits: 'Units as Airbnb' };

// A plain message to the buyer describing what someone changed and what it does to each offer.
export function whatIfMessage(original, base, offers) {
  const lines = ['What-if from the deal page (nothing was saved):'];
  for (const k of Object.keys({ ...original.base, ...base })) {
    if (['strSource', 'planOffer', 'askPrice', 'ourOffer'].includes(k) || original.base[k] === base[k]) continue;
    lines.push(`- ${LABEL[k] || k}: ${original.base[k] ?? 'blank'} → ${base[k]}`);
  }
  for (const o of offers) {
    const before = original.list.find((x) => x.id === o.id);
    if (!before) { lines.push(`- Added a new option: ${o.name}`); continue; }
    for (const [k, l] of STRUCTURES[o.structure].fields) {
      if ((before.inputs?.[k]) !== (o.inputs?.[k])) lines.push(`- ${o.name}, ${l}: ${before.inputs?.[k] ?? 'blank'} → ${o.inputs?.[k]}`);
    }
  }
  lines.push('', 'What you would keep each month, whole building:');
  for (const o of offers) {
    const now = evaluate(o.structure, o.inputs, base);
    const was = original.list.find((x) => x.id === o.id);
    const then = was ? evaluate(was.structure, was.inputs, original.base) : null;
    lines.push(`- ${o.name}: ${money(now.keepMonthly)}${then ? ` (was ${money(then.keepMonthly)})` : ''}, rent covers the payment ${Number.isFinite(now.dscr) ? now.dscr.toFixed(2) + 'x' : 'fully'}, total cost ${pct(now.allInPct)} of value`);
  }
  return lines.join('\n');
}

export function SendWhatIf({ deal, me, role, preview, model }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  if (!model.touched) return null;
  const text = () => whatIfMessage(model.original, model.base, model.offers);
  const send = async () => {
    if (busy) return;
    if (preview) { setShow(true); setStatus('Preview: this is exactly what lands in your Messages when a real sign-in taps Send.'); return; }
    setBusy(true);
    try {
      const error = await sendToOwner(deal, me, role, text(), 'What-if');
      setStatus(error ? 'Not sent. Try again.' : `Sent to ${buyerName()}. It’s in Messages.`);
    } catch { setStatus('Not sent. Try again.'); }
    finally { setBusy(false); }
  };
  // Pinned to the bottom of the screen so it's there wherever the numbers were changed.
  return (
    <div className="fixed inset-x-0 bottom-3 z-30 mx-auto w-[min(720px,calc(100%-24px))] rounded-2xl border border-warm bg-white px-4 py-3 text-sm shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">You’re trying your own numbers.</span>
        <Button onClick={send} disabled={busy}>{busy ? 'Sending…' : `Send to ${buyerName()}`}</Button>
        <Button kind="secondary" onClick={() => { model.reset(); setStatus(''); setShow(false); }}>Reset</Button>
        <span role="status" className="text-ink-soft">{status}</span>
      </div>
      {show && <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-paper p-3 font-sans text-xs">{text()}</pre>}
    </div>
  );
}
