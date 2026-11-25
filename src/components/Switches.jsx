import { buyerName } from '../lib/people.js';
import { useState } from 'react';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, money, pct } from '../lib/dealmath.js';
import { sendToOwner } from './Messages.jsx';
import { Button } from './Shell.jsx';

const val = (base, k) => (base[k] ?? BASE_DEFAULTS[k]);
const num = (v) => (v === '' ? '' : +v);

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

// Always 10 long-term units: rent per unit and added unit rehab.
// Owner, realtor, reviewer and lender see them. Never the seller or viewers.
export default function Switches({ base, setBase }) {
  const set = (p) => setBase({ ...base, ...p });
  return (
    <div className="rounded-2xl bg-paper p-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Money label="Rent per unit / month" value={val(base, 'rent')} onChange={(v) => set({ rent: v })} />
        <Money label="Added unit rehab" value={val(base, 'tenthUnitRepair')} step={500} onChange={(v) => set({ tenthUnitRepair: v })} />
      </div>
    </div>
  );
}

const LABEL = { ...Object.fromEntries(BASE_FIELDS.map(([k, l]) => [k, l])), tenthUnitRepair: 'Added unit rehab', rent: 'Rent per unit / month' };

// A plain message to the buyer describing what someone changed and what it does to each offer.
export function whatIfMessage(original, base, offers) {
  const lines = ['What-if from the deal page (nothing was saved):'];
  for (const k of Object.keys({ ...original.base, ...base })) {
    if (['units', 'planOffer', 'askPrice', 'ourOffer'].includes(k) || !(k in BASE_DEFAULTS) || original.base[k] === base[k]) continue;
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
    lines.push(`- ${o.name}: ${money(now.keepMonthly)}${then ? ` (was ${money(then.keepMonthly)})` : ''}, rent covers the payment ${Number.isFinite(now.dscr) ? now.dscr.toFixed(2) + 'x' : 'fully'}, total cost ${pct(now.allInPct)} of estimated value`);
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
