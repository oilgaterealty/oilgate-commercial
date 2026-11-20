import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, grade, money, pct } from '../lib/dealmath.js';
import { Card, CardTitle, Button, Badge, Empty } from '../components/Shell.jsx';

const stepFor = (unit, label) => (unit === '%' ? 0.25 : unit === 'x' ? 0.05 : unit === 'n' ? 1 : /\/ mo/.test(label) ? 25 : 1000);

function NumberRow({ label, unit, value, onChange, changed }) {
  const step = stepFor(unit, label);
  const v = value ?? '';
  const bump = (d) => onChange(Math.round((+v + d * step) * 100) / 100);
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className={`text-sm ${changed ? 'font-medium text-ink' : 'text-ink-soft'}`}>{label}</span>
      <span className="flex items-center gap-1">
        <button type="button" onClick={() => bump(-1)} className="h-8 w-8 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">−</button>
        <span className="relative">
          {unit === '$' && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>}
          <input type="number" inputMode="decimal" value={v} step={step} onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)}
            className={`h-8 w-28 rounded-lg border border-line bg-white text-right text-sm outline-none focus:border-ink ${unit === '$' ? 'pl-5 pr-2' : 'px-2'}`} />
        </span>
        <span className="w-4 text-xs text-ink-soft">{unit === '%' ? '%' : unit === 'x' ? 'x' : ''}</span>
        <button type="button" onClick={() => bump(1)} className="h-8 w-8 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">+</button>
      </span>
    </label>
  );
}

function Metric({ label, value, tone, sub }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs uppercase tracking-wider text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
      <div className="mt-1 flex items-center gap-2">{tone && tone !== 'none' && <Badge tone={tone}>{{ pass: 'Passes', close: 'Close', fail: 'Fails' }[tone]}</Badge>}{sub && <span className="text-xs text-ink-soft">{sub}</span>}</div>
    </div>
  );
}

export function Results({ r }) {
  const fmt = (v, u) => (u === '$' ? money(v) : u === '$/mo' ? (v === null ? 'Needs their loan payment' : money(v) + '/mo') : u === 'mo' ? (Number.isFinite(v) ? `${Math.ceil(v)} months` : 'Never at this credit') : v);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="You keep / mo (whole building)" value={money(r.keepMonthly)} tone={grade('keep', r.keepMonthly)} sub={r.operating.b.units ? `${money(r.keepMonthly / r.operating.b.units)} per unit` : ''} />
        <Metric label="Seller gets / mo" value={money(r.sellerMonthly)} sub={r.sellerNet !== null ? `${money(r.sellerNet)} after their loan` : 'Before their own loan payment'} />
        <Metric label="DSCR" value={Number.isFinite(r.dscr) ? r.dscr.toFixed(2) + 'x' : 'No payment'} tone={grade('dscr', r.dscr)} sub="Target 1.20–1.25" />
        <Metric label="Cash-on-cash" value={r.cashOnCash === null ? 'No cash in' : pct(r.cashOnCash, 1)} tone={r.cashOnCash === null ? 'none' : grade('cashOnCash', r.cashOnCash)} sub={r.cashIn > 0 ? `${money(r.cashIn)} in` : 'Target 8–12%'} />
        <Metric label="All-in vs value" value={pct(r.allInPct)} tone={grade('allInPct', r.allInPct)} sub={`${money(r.allIn)} of ${money(r.operating.b.value)}`} />
        <Metric label="Break-even occupancy" value={pct(r.breakEven)} tone={grade('breakEven', r.breakEven)} sub="Target 85% or less" />
      </div>
      {r.extra.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white px-4">
          {r.extra.map(([l, v, u]) => <li key={l} className="flex justify-between gap-3 py-2 text-sm"><span className="text-ink-soft">{l}</span><span className="font-medium">{fmt(v, u)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

function BuildingNumbers({ base, setBase, o }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="font-display text-xl font-semibold">Building numbers</span>
        <span className="text-sm text-ink-soft">NOI {money(o.noi)} · cash flow {money(o.cashFlow)}/yr · refi nets {money(o.refiNet)} {open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-ink-soft">Shared by every offer, saved privately with this deal. Rents, taxes, insurance and repairs stay unverified until the rent roll, bills and bids are in.</p>
          <div className="grid gap-x-8 md:grid-cols-2">
            {BASE_FIELDS.map(([k, l, u]) => (
              <NumberRow key={k} label={l} unit={u} value={base[k] ?? BASE_DEFAULTS[k]} changed={base[k] !== undefined && base[k] !== BASE_DEFAULTS[k]}
                onChange={(v) => setBase({ ...base, [k]: v })} />
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">Refi loan {money(o.refiLoan)}, limited by {o.refiLimitedBy}. Cap rate {pct(o.capRate, 1)}.</p>
        </div>
      )}
    </Card>
  );
}

// Owner: saves. Reviewer and lender: can try numbers, nothing saves.
export default function Offers({ deal, canSave, onlyShared }) {
  const [offers, setOffers] = useState(null);
  const [base, setBaseState] = useState({});
  const [active, setActive] = useState(null);
  const [saved, setSaved] = useState('');
  const timers = useRef({});

  useEffect(() => {
    Promise.all([
      supabase.from('commercial_offers').select('*').eq('deal_id', deal.id).order('sort'),
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
    ]).then(([a, b]) => {
      const list = (a.data || []).filter((x) => !onlyShared || x['share_' + onlyShared]);
      setOffers(list);
      setBaseState(b.data?.base || {});
      if (list.length) setActive(list[0].id);
    });
  }, [deal.id]);

  const later = (key, fn) => {
    if (!canSave) return;
    clearTimeout(timers.current[key]);
    setSaved('Saving…');
    timers.current[key] = setTimeout(async () => { const { error } = await fn(); setSaved(error ? 'Not saved. Check your connection.' : 'Saved'); }, 600);
  };
  const setBase = (b) => { setBaseState(b); later('base', () => supabase.from('commercial_models').upsert({ deal_id: deal.id, base: b, updated_at: new Date().toISOString() })); };
  const patch = (id, p) => {
    setOffers((list) => list.map((o) => (o.id === id ? { ...o, ...p } : o)));
    later(id, () => supabase.from('commercial_offers').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id));
  };
  const add = async (structure, from) => {
    const row = { deal_id: deal.id, structure, name: from ? from.name + ' (copy)' : STRUCTURES[structure].label, inputs: from ? from.inputs : {}, sort: (offers?.length || 0) + 1 };
    if (!canSave) { const local = { ...row, id: crypto.randomUUID() }; setOffers([...offers, local]); return setActive(local.id); }
    const { data } = await supabase.from('commercial_offers').insert(row).select().single();
    if (data) { setOffers([...offers, data]); setActive(data.id); }
  };
  const remove = async (o) => {
    if (!window.confirm(`Delete “${o.name}”?`)) return;
    if (canSave) await supabase.from('commercial_offers').delete().eq('id', o.id);
    const rest = offers.filter((x) => x.id !== o.id);
    setOffers(rest);
    setActive(rest[0]?.id || null);
  };

  const evals = useMemo(() => Object.fromEntries((offers || []).map((o) => [o.id, evaluate(o.structure, o.inputs, base)])), [offers, base]);
  if (offers === null) return <Empty>Loading…</Empty>;
  const cur = offers.find((o) => o.id === active);
  const r = cur && evals[cur.id];
  const o = evaluate('cash', {}, base).operating;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {offers.map((x) => (
          <button key={x.id} onClick={() => setActive(x.id)}
            className={`rounded-full border px-4 py-1.5 text-sm ${active === x.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>
            {x.name} <span className={active === x.id ? 'text-white/70' : 'text-ink-soft'}>· {money(evals[x.id].keepMonthly)}/mo</span>
          </button>
        ))}
        <select value="" onChange={(e) => e.target.value && add(e.target.value)} className="rounded-full border border-dashed border-line bg-white px-3 py-1.5 text-sm">
          <option value="">+ Add an offer</option>
          {Object.entries(STRUCTURES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        <span className="ml-auto text-xs text-ink-soft">{canSave ? saved : 'Try your own numbers here. Nothing you change is saved.'}</span>
      </div>

      {!cur ? <Card><Empty>{canSave ? 'Add an offer to start.' : 'No offers have been shared with you yet.'}</Empty></Card> : (
        <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
          <Card>
            <input value={cur.name} onChange={(e) => patch(cur.id, { name: e.target.value.slice(0, 80) || cur.name })}
              className="mb-1 w-full rounded-lg border border-transparent px-1 font-display text-xl font-semibold outline-none hover:border-line focus:border-ink" />
            <p className="mb-3 px-1 text-xs text-ink-soft">{STRUCTURES[cur.structure].label}. Change one number and watch the results move.</p>
            {STRUCTURES[cur.structure].fields.map(([k, l, u]) => {
              const d = STRUCTURES[cur.structure].defaults[k];
              const v = cur.inputs?.[k];
              return <NumberRow key={k} label={l} unit={u} value={v ?? d} changed={v !== undefined && v !== d}
                onChange={(nv) => patch(cur.id, { inputs: { ...cur.inputs, [k]: nv } })} />;
            })}
            <textarea value={cur.note || ''} onChange={(e) => patch(cur.id, { note: e.target.value.slice(0, 2000) })} placeholder="Notes on this offer"
              className="mt-3 min-h-20 w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button kind="secondary" onClick={() => add(cur.structure, cur)}>Duplicate</Button>
              <Button kind="secondary" onClick={() => remove(cur)}>Delete</Button>
            </div>
            {canSave && (
              <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
                <p className="font-medium">Who else can see this offer</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={cur.share_reviewer} onChange={(e) => patch(cur.id, { share_reviewer: e.target.checked })} /> Reviewer</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={cur.share_lender} onChange={(e) => patch(cur.id, { share_lender: e.target.checked })} /> Lender</label>
                <p className="text-xs text-ink-soft">The seller never sees this page. What the seller reads is under Seller page.</p>
              </div>
            )}
          </Card>
          <div className="space-y-5">
            <Results r={r} />
            <Card>
              <CardTitle>Side by side</CardTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-soft">
                    <th className="py-2 pr-3">Offer</th><th className="pr-3">You keep</th><th className="pr-3">Seller gets</th><th className="pr-3">DSCR</th><th className="pr-3">All-in</th><th>Break-even</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line">
                    {offers.map((x) => { const e = evals[x.id]; return (
                      <tr key={x.id} onClick={() => setActive(x.id)} className={`cursor-pointer ${x.id === active ? 'bg-warm-soft/60' : 'hover:bg-warm-soft/30'}`}>
                        <td className="py-2 pr-3 font-medium">{x.name}</td>
                        <td className="pr-3">{money(e.keepMonthly)}</td>
                        <td className="pr-3">{money(e.sellerMonthly)}</td>
                        <td className="pr-3"><Badge tone={grade('dscr', e.dscr)}>{Number.isFinite(e.dscr) ? e.dscr.toFixed(2) : '—'}</Badge></td>
                        <td className="pr-3"><Badge tone={grade('allInPct', e.allInPct)}>{pct(e.allInPct)}</Badge></td>
                        <td><Badge tone={grade('breakEven', e.breakEven)}>{pct(e.breakEven)}</Badge></td>
                      </tr>); })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-ink-soft">Tests: DSCR 1.20–1.25 or better, break-even occupancy 85% or less, cash-on-cash 8–12%, all-in 75% of value or less. The seller’s loan terms are unconfirmed, and nothing here is a lender quote.</p>
            </Card>
          </div>
        </div>
      )}
      <BuildingNumbers base={base} setBase={setBase} o={o} />
    </div>
  );
}
