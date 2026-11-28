import { buyerName } from '../lib/people.js';
import { useState } from 'react';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, money, operating, pct, syncOpexOverride, valueSummary } from '../lib/dealmath.js';
import { useDealModel } from '../lib/useDealModel.js';
import { sendToOwner } from './Messages.jsx';
import OperatingBreakdown from './OperatingBreakdown.jsx';
import { Button, Card, CardTitle, OverlayTrigger } from './Shell.jsx';

const num = (v) => (v === '' ? '' : +v);
const stepFor = (unit, label) => (unit === '%' ? 0.25 : unit === 'x' ? 0.05 : unit === 'n' ? 1 : /\/ mo/.test(label) ? 25 : 1000);

function Money({ label, value, onChange, step = 25, suffix }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-soft">{label}</span>
      <span className="flex items-center gap-1">
        <button type="button" aria-label={`Lower ${label}`} onClick={() => onChange(Math.max(0, (+value || 0) - step))} className="h-10 w-10 rounded-lg border border-line bg-white text-ink-soft hover:bg-warm-soft">−</button>
        <span className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>
          <input type="number" inputMode="decimal" min={0} step={step} value={value} aria-label={label} onChange={(e) => onChange(num(e.target.value))}
            className="h-10 w-24 rounded-lg border border-line bg-white pl-5 pr-2 text-right text-sm outline-none focus:border-ink" />
        </span>
        <button type="button" aria-label={`Raise ${label}`} onClick={() => onChange((+value || 0) + step)} className="h-10 w-10 rounded-lg border border-line bg-white text-ink-soft hover:bg-warm-soft">+</button>
        {suffix && <span className="text-xs text-ink-soft">{suffix}</span>}
      </span>
    </label>
  );
}

// Owner "Deal at a glance" inputs removed; rent and repair budget live in the plan and building numbers.
export default function Switches() {
  return null;
}

const LABEL = { ...Object.fromEntries(BASE_FIELDS.map(([k, l]) => [k, l])), rent: 'Rent per unit / month' };

// A plain message to the buyer describing what someone changed and what it does to each offer.
export function whatIfMessage(original, base, offers = []) {
  const list = offers || [];
  const lines = ['What-if from the deal page (nothing was saved):'];
  for (const k of Object.keys({ ...original.base, ...base })) {
    if (['units', 'planOffer', 'askPrice', 'ourOffer'].includes(k) || !(k in BASE_DEFAULTS) || original.base[k] === base[k]) continue;
    lines.push(`- ${LABEL[k] || k}: ${original.base[k] ?? 'blank'} → ${base[k]}`);
  }
  for (const o of list) {
    const before = (original.list || []).find((x) => x.id === o.id);
    if (!before) { lines.push(`- Added a new option: ${o.name}`); continue; }
    for (const [k, l] of STRUCTURES[o.structure].fields) {
      if ((before.inputs?.[k]) !== (o.inputs?.[k])) lines.push(`- ${o.name}, ${l}: ${before.inputs?.[k] ?? 'blank'} → ${o.inputs?.[k]}`);
    }
  }
  if (list.length > 0) {
    lines.push('', 'What you would keep each month, whole building:');
    for (const o of list) {
      const now = evaluate(o.structure, o.inputs, base);
      const was = (original.list || []).find((x) => x.id === o.id);
      const then = was ? evaluate(was.structure, was.inputs, original.base) : null;
      lines.push(`- ${o.name}: ${money(now.keepMonthly)}${then ? ` (was ${money(then.keepMonthly)})` : ''}, rent covers the payment ${Number.isFinite(now.dscr) ? now.dscr.toFixed(2) + 'x' : 'fully'}, total cost ${pct(now.allInPct)} of value`);
    }
  } else {
    const o = operating({ ...base, units: 10 });
    const was = operating({ ...original.base, units: 10 });
    const val = valueSummary({ base: { ...o.b, ...base }, noi: o.noi, units: 10 });
    const valueUnchanged = original.base?.rent === base.rent && original.base?.valueCapRate === base.valueCapRate && original.base?.vacancyPct === base.vacancyPct && original.base?.taxes === base.taxes && original.base?.insurance === base.insurance && original.base?.waterMo === base.waterMo && original.base?.reservesPerUnit === base.reservesPerUnit;
    const shownValue = o.b.value > 0 && valueUnchanged ? o.b.value : (val.income ?? o.b.value);
    lines.push(
      '',
      'Building summary:',
      `- Rent per unit / month: ${money(o.b.rent)} (was ${money(was.b.rent)})`,
      `- Yearly profit before payments: ${money(o.noi)} (was ${money(was.noi)})`,
      `- Value after repairs: ${money(shownValue)}`,
      `- Repair budget: ${money(o.b.rehab)}`,
    );
  }
  return lines.join('\n');
}

function WhatIfRow({ label, unit, value, onChange, changed }) {
  const step = stepFor(unit, label);
  const v = value ?? '';
  const bump = (d) => onChange(Math.round((+v + d * step) * 100) / 100);
  return (
    <label className="flex min-h-[40px] items-center justify-between gap-2 py-1.5">
      <span className={`text-sm ${changed ? 'font-medium text-ink' : 'text-ink-soft'}`}>{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label={`Lower ${label}`} onClick={() => bump(-1)} className="h-10 w-10 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">−</button>
        <span className="relative">
          {unit === '$' && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>}
          <input type="number" inputMode={unit === 'n' ? 'numeric' : 'decimal'} value={v} step={step} onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)}
            className={`h-10 w-24 rounded-lg border border-line bg-white text-right text-sm outline-none focus:border-ink sm:w-28 ${unit === '$' ? 'pl-5 pr-2' : 'px-2'}`} />
        </span>
        <span className="w-4 text-xs text-ink-soft">{unit === '%' ? '%' : unit === 'x' ? 'x' : ''}</span>
        <button type="button" aria-label={`Raise ${label}`} onClick={() => bump(1)} className="h-10 w-10 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">+</button>
      </span>
    </label>
  );
}

// Local-only building numbers what-if card for non-owner roles (such as the realtor) with Send to buyer.
export function WhatIfNumbers({ deal, me, role, preview, planRepairBudget = 0 }) {
  const model = useDealModel(deal, { owner: false, onlyShared: preview ? role : undefined });
  const { base, setBase } = model;
  const [open, setOpen] = useState(false);
  const rehabEdited = Boolean(model.original && base.rehab !== model.original.base?.rehab);
  const effectiveBase = planRepairBudget > 0 && !rehabEdited ? { ...base, rehab: planRepairBudget } : base;
  const effectiveOriginal = model.original && planRepairBudget > 0
    ? { ...model.original, base: { ...model.original.base, rehab: planRepairBudget } }
    : model.original;
  const o = operating({ ...effectiveBase, units: 10 });
  const val = valueSummary({ base: { ...o.b, ...effectiveBase }, noi: o.noi, units: 10 });
  const valueChanged = effectiveBase.value !== model.original?.base?.value;
  const shownValue = Boolean(effectiveBase?.opex) && !valueChanged
    ? (val.income ?? o.b.value)
    : (o.b.value > 0 && (!model.touched || valueChanged) ? o.b.value : (val.income ?? o.b.value));
  const fields = role === 'owner' ? BASE_FIELDS : BASE_FIELDS.filter(([k]) => !String(k).startsWith('refi'));
  return (
    <>
      <SendWhatIf deal={deal} me={me} role={role} preview={preview} model={{ ...model, base: effectiveBase, original: effectiveOriginal }} />
      <Card>
        <CardTitle>What-if numbers</CardTitle>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Rent per unit</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{money(o.b.rent)}/mo</dd>
          </div>
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Yearly profit before payments</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{money(o.noi)}/yr</dd>
          </div>
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Value after repairs</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{money(shownValue)}</dd>
          </div>
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Repair budget</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{money(o.b.rehab)}</dd>
          </div>
        </dl>
        {o.opexCalc && <OperatingBreakdown calc={o.opexCalc} Trigger={OverlayTrigger} />}
        <div className="mt-3 border-t border-line pt-2.5">
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-1 py-1 text-left text-sm font-medium text-ink hover:bg-warm-soft/60">
            <span>Assumptions</span>
            <span aria-hidden="true" className="text-ink-soft">{open ? '▴' : '▾'}</span>
          </button>
          {open && (
            <div className="mt-3 grid gap-x-8 md:grid-cols-2">
              {fields.map(([k, l, u]) => (
                <WhatIfRow key={k} label={l} unit={u} value={effectiveBase[k] ?? BASE_DEFAULTS[k]} changed={effectiveBase[k] !== undefined && effectiveBase[k] !== BASE_DEFAULTS[k]}
                  onChange={(v) => {
                    const next = syncOpexOverride ? syncOpexOverride(base, k, v) : { ...base, [k]: v };
                    setBase(k === 'value' ? { ...next, _valueOverride: true } : next);
                  }} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  );
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
