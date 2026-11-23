import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { CAP_RATES, arvEstimate, compWhatIfMessage, pricePerUnit, unitCount, v5Access, validComp } from '../lib/leaseUp.js';
import { money, operating } from '../lib/dealmath.js';
import { Button, Card, CardTitle, Empty, Field } from '../components/Shell.jsx';
import { sendToOwner } from '../components/Messages.jsx';
import { buyerName, possessive } from '../lib/people.js';

const BLANK = { address: '', units: '', sale_price: '' };

export default function Comps({ deal, me, role, preview }) {
  const access = v5Access(role);
  const owner = access.saveComps && !preview;
  const [base, setBase] = useState(null);
  const [savedComps, setSavedComps] = useState(null);
  const [savedCap, setSavedCap] = useState(9);
  const [cap, setCap] = useState(9);
  const [localUnits, setLocalUnits] = useState(null);
  const [localComps, setLocalComps] = useState([]);
  const [draft, setDraft] = useState(BLANK);
  const [loadErr, setLoadErr] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendStatus, setSendStatus] = useState('');
  const [showPreviewMsg, setShowPreviewMsg] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!access.comps) return;
    let live = true;
    Promise.all([
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('commercial_comps').select('*').eq('deal_id', deal.id).order('created_at'),
      supabase.from('commercial_comp_settings').select('cap_rate').eq('deal_id', deal.id).maybeSingle(),
    ]).then(([m, c, s]) => {
      if (!live) return;
      setBase(m.data?.base || {});
      setSavedComps(c.data || []);
      const loadedCap = s.data?.cap_rate ? Number(s.data.cap_rate) : 9;
      setSavedCap(loadedCap);
      setCap(loadedCap);
      setLoadErr(c.error ? 'Comps could not load. Refresh to try again.' : '');
    });
    return () => { live = false; };
  }, [deal.id, access.comps, refresh]);

  if (!access.comps) return null;

  const modelUnits = unitCount(base?.units);
  const units = localUnits ?? modelUnits;
  const noi = base ? operating({ ...base, units }).noi : null;
  const allComps = [...(savedComps || []), ...localComps];
  const calc = arvEstimate(allComps, units, noi, cap);
  const canAdd = validComp(draft);
  const dirty = !owner && (localComps.length > 0 || cap !== savedCap || (localUnits !== null && localUnits !== modelUnits));

  const setCapRate = async (nextCap) => {
    setCap(nextCap);
    if (!owner) return;
    setStatus('Saving…');
    const { error } = await supabase
      .from('commercial_comp_settings')
      .upsert({ deal_id: deal.id, cap_rate: nextCap, updated_at: new Date().toISOString() });
    if (error) {
      setStatus('Cap rate could not save.');
    } else {
      setSavedCap(nextCap);
      setStatus('Cap rate saved.');
    }
  };

  const addComp = async (e) => {
    e.preventDefault();
    if (!canAdd || pending || loadErr) return;
    const row = { address: draft.address.trim(), units: +draft.units, sale_price: +draft.sale_price };
    if (!owner) {
      setLocalComps((prev) => [...prev, { ...row, id: crypto.randomUUID(), local: true }]);
      setDraft(BLANK);
      setStatus('Added to your what-if.');
      return;
    }
    setPending(true);
    setStatus('');
    try {
      const { error } = await supabase.from('commercial_comps').insert({ deal_id: deal.id, ...row });
      if (error) { setStatus('Comp could not save.'); return; }
      setDraft(BLANK);
      setStatus('Comp saved.');
      setRefresh((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  const removeComp = async (row) => {
    if (row.local) {
      setLocalComps((prev) => prev.filter((x) => x.id !== row.id));
      return;
    }
    if (!owner || pending || !window.confirm(`Remove ${row.address}?`)) return;
    setPending(true);
    try {
      const { error } = await supabase.from('commercial_comps').delete().eq('id', row.id).eq('deal_id', deal.id);
      setStatus(error ? 'Comp could not be removed.' : 'Comp removed.');
      setRefresh((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  const whatIfBody = () => compWhatIfMessage({ savedComps, localComps, units, noi, cap });

  const sendWhatIf = async () => {
    if (sendBusy || !dirty) return;
    if (preview) {
      setShowPreviewMsg(true);
      setSendStatus('Preview: this is exactly what lands in Messages when a real sign-in taps Send.');
      return;
    }
    setSendBusy(true);
    setSendStatus('');
    try {
      const body = whatIfBody();
      if (body.length > 4000) {
        setSendStatus('Remove some local comps before sending.');
        return;
      }
      const err = await sendToOwner(deal, me, role, body, 'Comps / ARV what-if');
      setSendStatus(err ? 'Not sent. Try again.' : `Sent to ${buyerName()}. It’s in Messages.`);
    } catch {
      setSendStatus('Not sent. Try again.');
    } finally {
      setSendBusy(false);
    }
  };

  const resetWhatIf = () => {
    setLocalComps([]);
    setCap(savedCap);
    setLocalUnits(null);
    setSendStatus('');
    setShowPreviewMsg(false);
  };

  return (
    <div className="space-y-5 pb-20">
      <Card>
        <CardTitle aside={<span className="text-xs text-ink-soft">{owner ? 'Your comps & cap rate save' : `What-ifs never overwrite ${possessive(buyerName())} numbers`}</span>}>
          Comps / ARV calculator
        </CardTitle>
        {loadErr && <p role="alert" className="mb-3 text-sm text-red-700">{loadErr}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-ink p-5 text-white">
            <p className="text-xs uppercase tracking-[0.16em] text-warm">Value by comps</p>
            <p className="mt-1 font-display text-3xl font-semibold sm:text-4xl">{money(calc.market)}</p>
            <p className="mt-1 text-xs text-white/75">
              {calc.avg !== null ? `${money(calc.avg)} avg/unit × ${units} units` : `Add comps below to value ${units} units`}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">Value by income</p>
            <p className="mt-1 font-display text-3xl font-semibold sm:text-4xl">{money(calc.income)}</p>
            <p className="mt-1 text-xs text-ink-soft">
              {noi !== null ? `${money(noi)} yearly NOI ÷ ${cap}% cap rate` : 'Enter rent in the deal model for NOI'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl bg-paper p-4">
          <div>
            <p className="mb-1 text-xs text-ink-soft">Cap rate</p>
            <div className="inline-flex flex-wrap rounded-full border border-line bg-white p-0.5" role="group" aria-label="Cap rate">
              {CAP_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  aria-pressed={cap === rate}
                  onClick={() => setCapRate(rate)}
                  className={`rounded-full px-3 py-1 text-sm transition ${cap === rate ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'}`}
                >
                  {rate}%
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-soft">Units {owner ? '(from building switch)' : '(building switch / what-if)'}</p>
            {owner ? (
              <p className="py-1 text-sm font-medium">{modelUnits} units</p>
            ) : (
              <div className="inline-flex rounded-full border border-line bg-white p-0.5" role="group" aria-label="Units what-if">
                {[9, 10].map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={units === u}
                    onClick={() => setLocalUnits(u === modelUnits ? null : u)}
                    className={`rounded-full px-3 py-1 text-sm transition ${units === u ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'}`}
                  >
                    {u} units
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={addComp} className="mt-4 grid items-end gap-2.5 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <label className="text-xs text-ink-soft">
            Address
            <Field
              required
              aria-label="Comp address"
              placeholder="e.g. 123 Main St"
              maxLength={240}
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-ink-soft">
            Units
            <Field
              required
              type="number"
              aria-label="Comp units"
              min="1"
              max="10000"
              step="1"
              placeholder="8"
              value={draft.units}
              onChange={(e) => setDraft({ ...draft, units: e.target.value })}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-ink-soft">
            Sale price
            <Field
              required
              type="number"
              aria-label="Comp sale price"
              min="1"
              step="any"
              placeholder="520000"
              value={draft.sale_price}
              onChange={(e) => setDraft({ ...draft, sale_price: e.target.value })}
              className="mt-1"
            />
          </label>
          <Button type="submit" disabled={!canAdd || pending || Boolean(loadErr)}>
            {owner ? 'Add comp' : 'Add what-if comp'}
          </Button>
        </form>

        {status && <p role="status" className="mt-2 text-sm text-ink-soft">{status}</p>}

        <div className="mt-4">
          {savedComps === null ? (
            <Empty>Loading…</Empty>
          ) : allComps.length === 0 ? (
            <Empty>No comps entered yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {allComps.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium break-words">{r.address}</span>
                    {r.local && <span className="ml-1.5 rounded-full bg-warm-soft px-2 py-0.5 text-xs">what-if</span>}
                    <p className="text-xs text-ink-soft">
                      {r.units} units · Sale {money(+r.sale_price)}{r.sale_date ? ` · ${new Date(r.sale_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''} · <strong className="text-ink">{money(pricePerUnit(r))}/unit</strong>
                    </p>
                    {r.source && <p className="text-[11px] text-ink-soft break-words">Source: {r.source}</p>}
                  </div>
                  {(owner || r.local) && (
                    <button type="button" disabled={pending} onClick={() => removeComp(r)} className="text-xs text-ink-soft underline hover:text-red-700">
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {dirty && (
        <div className="fixed inset-x-0 bottom-3 z-30 mx-auto w-[min(720px,calc(100%-24px))] rounded-2xl border border-warm bg-white px-4 py-3 text-sm shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">You’re trying your own comps / ARV numbers.</span>
            <Button type="button" onClick={sendWhatIf} disabled={sendBusy}>{sendBusy ? 'Sending…' : `Send to ${buyerName()}`}</Button>
            <Button type="button" kind="secondary" onClick={resetWhatIf}>Reset</Button>
            <span role="status" className="text-ink-soft">{sendStatus}</span>
          </div>
          {showPreviewMsg && (
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-paper p-3 font-sans text-xs">{whatIfBody()}</pre>
          )}
        </div>
      )}
    </div>
  );
}
