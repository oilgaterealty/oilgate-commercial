import { DictatedField } from '../components/Dictation.jsx';
import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useDealModel } from '../lib/useDealModel.js';
import Switches, { SendWhatIf } from '../components/Switches.jsx';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, evaluate, grade, money, pct } from '../lib/dealmath.js';
import { Card, CardTitle, Button, Badge, Empty } from '../components/Shell.jsx';
import { plain } from '../lib/plain.js';
import { breakEvenCount } from '../lib/occupancy.js';

const stepFor = (unit, label) => (unit === '%' ? 0.25 : unit === 'x' ? 0.05 : unit === 'n' ? 1 : /\/ mo/.test(label) ? 25 : 1000);

function NumberRow({ label, unit, value, onChange, changed, locked }) {
  const step = stepFor(unit, label);
  const v = value ?? '';
  if (locked) {
    const shown = unit === '$' ? money(+v) : unit === '%' ? `${v}%` : unit === 'x' ? `${v}x` : v;
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className="flex items-center gap-2 text-sm font-medium" title="From the property's records. Only LaVante can change it.">{shown}<span className="rounded-full bg-warm-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-soft">Locked</span></span>
      </div>
    );
  }
  const bump = (d) => onChange(Math.round((+v + d * step) * 100) / 100);
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className={`text-sm ${changed ? 'font-medium text-ink' : 'text-ink-soft'}`}>{label}</span>
      <span className="flex items-center gap-1">
        <button type="button" onClick={() => bump(-1)} className="h-8 w-8 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">−</button>
        <span className="relative">
          {unit === '$' && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>}
          <DictatedField type="number" inputMode="decimal" value={v} step={step} onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)}
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
        <Metric label="Seller gets / mo" value={r.sellerMonthly === null ? 'At closing' : money(r.sellerMonthly)} sub={r.sellerMonthly === null ? '' : r.sellerNet !== null ? `${money(r.sellerNet)} after their loan` : 'Before their own loan payment'} />
        <Metric label="Rent covers the payment" value={Number.isFinite(r.dscr) ? r.dscr.toFixed(2) + 'x' : 'No payment'} tone={grade('dscr', r.dscr)} sub="Target 1.20x or more" />
        <Metric label="Yearly return on cash in" value={r.cashOnCash === null ? 'No cash in' : pct(r.cashOnCash, 1)} tone={r.cashOnCash === null ? 'none' : grade('cashOnCash', r.cashOnCash)} sub={r.cashIn > 0 ? `${money(r.cashIn)} in` : 'Target 8–12%'} />
        <Metric label="Total cost vs value" value={pct(r.allInPct)} tone={grade('allInPct', r.allInPct)} sub={`${money(r.allIn)} of ${money(r.operating.b.value)}`} />
        <Metric label="Rented units to break even" value={pct(r.breakEven)} tone={grade('breakEven', r.breakEven)} sub={`${breakEvenCount(r)} · Target 85% or less`} />
      </div>
      {r.extra.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white px-4">
          {r.extra.map(([l, v, u]) => <li key={l} className="flex justify-between gap-3 py-2 text-sm"><span className="text-ink-soft">{l}</span><span className="font-medium">{fmt(v, u)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

function BuildingNumbers({ base, setBase, o, owner }) {
  const [open, setOpen] = useState(!owner);
  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="font-display text-xl font-semibold">Building numbers</span>
        <span className="text-sm text-ink-soft">Yearly profit before payments {money(o.noi)} · a refinance nets {money(o.refiNet)} {open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-ink-soft">{owner
            ? 'Shared by every offer, saved privately with this deal. Rents, taxes, insurance and repairs stay unverified until the rent roll, bills and bids are in.'
            : 'These are LaVante’s numbers for the building. Try your own on any of them; nothing you change is saved, and Send to LaVante shows him what you changed.'}</p>
          <div className="grid gap-x-8 md:grid-cols-2">
            {BASE_FIELDS.filter(([k]) => !['units', 'tenthUnitRepair', 'rent'].includes(k)).map(([k, l, u]) => (
              <NumberRow key={k} label={l} unit={u} value={base[k] ?? BASE_DEFAULTS[k]} changed={base[k] !== undefined && base[k] !== BASE_DEFAULTS[k]}
                onChange={(v) => setBase({ ...base, [k]: v })} />
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">A refinance could lend {money(o.refiLoan)}, limited by {o.refiLimitedBy === 'DSCR' ? 'the rent' : 'the building’s value'}. Yearly return on the value (cap rate) {pct(o.capRate, 1)}.</p>
        </div>
      )}
    </Card>
  );
}


export const letterOf = (o, i) => (/^([A-Z])\s*:/.exec(o.name)?.[1]) || String.fromCharCode(65 + i);
export const titleOf = (o) => o.name.replace(/^[A-Z]\s*:\s*/, '');

const NUMBERS = [
  ['You keep / month (whole building)', (e) => money(e.keepMonthly)],
  ['Seller gets / month', (e) => (e.sellerMonthly === null ? 'Paid in full at closing' : money(e.sellerMonthly))],
  ['Our cash in', (e) => money(e.cashIn)],
  ['Rent covers the payment', (e) => (Number.isFinite(e.dscr) ? `${e.dscr.toFixed(2)}x` : 'No payment')],
  ['Total cost vs value', (e) => `${money(e.allIn)} · ${pct(e.allInPct)}`],
  ['Rented units to break even', (e) => breakEvenCount(e)],
];

// Same layout the seller sees: a letter, a plain name, one line, how it works, then the numbers.
export function OptionCard({ o, i, e }) {
  const p = plain(o.structure, e);
  return (
    <div className="rounded-3xl border-2 border-ink bg-white p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink font-display text-lg text-white">{letterOf(o, i)}</span>
      <h3 className="mt-3 font-display text-2xl font-semibold leading-tight">{titleOf(o)}</h3>
      <p className="mt-1 text-ink-soft">{p.glance}</p>
      <ol className="mt-4 space-y-2">{p.lines.map((s, n) => <li key={n} className="flex gap-3 text-sm"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warm-soft text-xs">{n + 1}</span>{s}</li>)}</ol>
      <div className="mt-4 rounded-2xl bg-ink p-4 text-white">
        <p className="text-xs uppercase tracking-[0.18em] text-warm">The numbers</p>
        <ul className="mt-2 space-y-2">{NUMBERS.map(([l, f]) => <li key={l} className="flex justify-between gap-3 text-sm"><span>{l}</span><span className="text-right font-medium">{f(e)}</span></li>)}</ul>
      </div>
      <p className="mt-4 text-sm text-ink-soft"><span className="font-medium text-ink">Worth knowing: </span>{p.risk}.</p>
    </div>
  );
}

export function OptionTable({ offers, evals }) {
  const rows = [
    ['At a glance', (o, e) => plain(o.structure, e).glance],
    ['How it works', (o, e) => <ol className="list-decimal space-y-2 pl-4">{plain(o.structure, e).lines.map((s, n) => <li key={n}>{s}</li>)}</ol>],
    ['The numbers', (o, e) => NUMBERS.map(([l, f]) => <p key={l} className="mb-2"><strong>{l}:</strong> {f(e)}</p>)],
    ['Who owns the building', (o, e) => plain(o.structure, e).owns],
    ['When the seller is paid off', (o, e) => plain(o.structure, e).payoff],
    ['Worth knowing', (o, e) => plain(o.structure, e).risk],
  ];
  return (
    <div className="comparison-scroll" tabIndex={0} aria-label="Options side by side; scroll sideways">
      <table className="comparison-table">
        <thead><tr><th>Compare</th>{offers.map((o, i) => <th key={o.id}>Option {letterOf(o, i)}<br />{titleOf(o)}</th>)}</tr></thead>
        <tbody>{rows.map(([label, f]) => <tr key={label}><th>{label}</th>{offers.map((o) => <td key={o.id}>{f(o, evals[o.id])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Owner: saves. Everyone else (realtor, reviewer, lender): terms and switches are a what-if they can send to LaVante.
export default function Offers({ deal, canSave, onlyShared, me, role, preview }) {
  const owner = !!canSave;
  const model = useDealModel(deal, { owner, onlyShared });
  const { offers, setOffers, base, setBase, later, saved } = model;
  const [active, setActive] = useState(null);
  const [view, setView] = useState('table');

  const patch = (id, p) => {
    setOffers((list) => list.map((o) => (o.id === id ? { ...o, ...p } : o)));
    later(id, () => supabase.from('commercial_offers').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id));
  };
  const add = async (structure, from) => {
    const row = { deal_id: deal.id, structure, name: from ? from.name + ' (copy)' : STRUCTURES[structure].label, inputs: from ? from.inputs : {}, sort: (offers?.length || 0) + 1 };
    if (!owner) { const local = { ...row, id: crypto.randomUUID() }; setOffers([...offers, local]); return setActive(local.id); }
    const { data } = await supabase.from('commercial_offers').insert(row).select().single();
    if (data) { setOffers([...offers, data]); setActive(data.id); }
  };
  const remove = async (o) => {
    if (!window.confirm(`Delete “${o.name}”?`)) return;
    if (owner) await supabase.from('commercial_offers').delete().eq('id', o.id);
    const rest = offers.filter((x) => x.id !== o.id);
    setOffers(rest);
    setActive(rest[0]?.id || null);
  };

  const evals = useMemo(() => Object.fromEntries((offers || []).map((o) => [o.id, evaluate(o.structure, o.inputs, base)])), [offers, base]);
  if (offers === null) return <Empty>Loading…</Empty>;
  const cur = offers.find((o) => o.id === active) || offers[0];
  const r = cur && evals[cur.id];
  const o = evaluate('cash', {}, base).operating;
  const showEdit = view === 'edit';

  return (
    <div className="space-y-5">
      {model.error && <p role="alert" className="text-sm text-red-700">{model.error}</p>}
      <Switches base={base} setBase={setBase} owner={owner} />
      {!owner && <SendWhatIf deal={deal} me={me} role={role} preview={preview} model={model} />}
      <div className="flex flex-wrap items-center gap-2" aria-label="Offer layout">
        <Button kind={view === 'table' ? 'primary' : 'secondary'} onClick={() => setView('table')} aria-pressed={view === 'table'}>Table view</Button>
        <Button kind={view === 'cards' ? 'primary' : 'secondary'} onClick={() => setView('cards')} aria-pressed={view === 'cards'}>Card view</Button>
        <Button kind={showEdit ? 'primary' : 'secondary'} onClick={() => setView('edit')} aria-pressed={showEdit}>{owner ? 'Edit terms' : 'Try different terms'}</Button>
        <span className="ml-auto text-xs text-ink-soft">{owner ? saved : 'Shared for review. Questions go through Messages.'}</span>
      </div>
      {!offers.length && <Card><Empty>{owner ? 'Add an offer to start.' : 'No offers have been shared with you yet.'}</Empty></Card>}
      {offers.length > 0 && view === 'table' && <OptionTable offers={offers} evals={evals} />}
      {offers.length > 0 && view === 'cards' && <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-4">{offers.map((x, i) => <OptionCard key={x.id} o={x} i={i} e={evals[x.id]} />)}</div>}

      {showEdit && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {offers.map((x) => (
              <button key={x.id} onClick={() => setActive(x.id)} aria-pressed={cur?.id === x.id}
                className={`rounded-full border px-4 py-1.5 text-sm ${cur?.id === x.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>
                {x.name} <span className={cur?.id === x.id ? 'text-white/70' : 'text-ink-soft'}>· {money(evals[x.id].keepMonthly)}/mo</span>
              </button>
            ))}
            <select aria-label="Add an option" value="" onChange={(e) => e.target.value && add(e.target.value)} className="rounded-full border border-dashed border-line bg-white px-3 py-1.5 text-sm">
              <option value="">{owner ? '+ Add an offer' : '+ Try another kind of offer'}</option>
              {Object.entries(STRUCTURES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </div>
          {cur && (
            <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
              <Card>
                {owner
                  ? <DictatedField aria-label="Offer name" value={cur.name} onChange={(e) => patch(cur.id, { name: e.target.value.slice(0, 80) || cur.name })}
                      className="mb-1 w-full rounded-lg border border-transparent px-1 font-display text-xl font-semibold outline-none hover:border-line focus:border-ink" />
                  : <h3 className="mb-1 px-1 font-display text-xl font-semibold">{cur.name}</h3>}
                <div className="mb-3 space-y-1.5 rounded-xl bg-warm-soft/60 px-3 py-2.5 text-sm">
                  {plain(cur.structure, r).lines.map((t, i) => <p key={i}>{t}</p>)}
                  <p className="text-ink-soft"><span className="font-medium text-ink">Worth knowing:</span> {plain(cur.structure, r).risk}.</p>
                </div>
                <p className="mb-2 px-1 text-xs text-ink-soft">{owner ? 'Change one number and watch the results move.' : 'Try a number and watch the results move. Nothing is saved.'}</p>
                {STRUCTURES[cur.structure].fields.map(([k, l, u]) => {
                  const d = STRUCTURES[cur.structure].defaults[k];
                  const v = cur.inputs?.[k];
                  return <NumberRow key={k} label={l} unit={u} value={v ?? d} changed={v !== undefined && v !== d}
                    onChange={(nv) => patch(cur.id, { inputs: { ...cur.inputs, [k]: nv } })} />;
                })}
                {owner ? (
                  <>
                    <DictatedField as="textarea" aria-label="Notes on this offer" value={cur.note || ''} onChange={(e) => patch(cur.id, { note: e.target.value.slice(0, 2000) })} placeholder="Notes on this offer"
                      className="mt-3 min-h-20 w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button kind="secondary" onClick={() => add(cur.structure, cur)}>Duplicate</Button>
                      <Button kind="secondary" onClick={() => remove(cur)}>Delete</Button>
                      {base.planOffer === cur.id
                        ? <span className="self-center text-sm font-medium text-good">Lenders see this as the plan</span>
                        : <Button kind="secondary" onClick={() => setBase({ ...base, planOffer: cur.id })}>Show lenders this as the plan</Button>}
                    </div>
                    <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
                      <p className="font-medium">Who else can see this offer</p>
                      {'share_realtor' in cur && <label className="flex items-center gap-2"><input type="checkbox" checked={cur.share_realtor} onChange={(e) => patch(cur.id, { share_realtor: e.target.checked })} /> Realtor</label>}
                      <label className="flex items-center gap-2"><input type="checkbox" checked={cur.share_reviewer} onChange={(e) => patch(cur.id, { share_reviewer: e.target.checked })} /> Reviewer</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={cur.share_lender} onChange={(e) => patch(cur.id, { share_lender: e.target.checked })} /> Lender</label>
                      <p className="text-xs text-ink-soft">The seller never sees this page. What the seller reads is under Seller page.</p>
                    </div>
                  </>
                ) : cur.note ? <p className="mt-3 whitespace-pre-line rounded-xl bg-warm-soft/60 px-3 py-2 text-sm">{cur.note}</p> : null}
              </Card>
              <div className="space-y-5">
                <Results r={r} />
                <p className="text-xs text-ink-soft">Tests: rent covers the payment 1.20x or more, 85% or fewer units rented to break even, 8–12% yearly return on cash in, total cost 75% of value or less. The seller’s loan terms are unconfirmed, and nothing here is a lender quote.</p>
              </div>
            </div>
          )}
        </>
      )}
      <BuildingNumbers base={base} setBase={setBase} o={o} owner={owner} />
    </div>
  );
}
