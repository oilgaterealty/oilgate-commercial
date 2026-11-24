import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { CAP_RATES, arvEstimate, compWhatIfMessage, pricePerUnit, unitCount, v5Access, validComp } from '../lib/leaseUp.js';
import { money, operating } from '../lib/dealmath.js';
import { roleLabel } from '../lib/format.js';
import { COMP_SORTS, compSource, compsForView, milesLabel, perUnitOf, pickers, picksByComp, soldLabel, sortComps, yearOf } from '../lib/v63.js';
import { Button, Card, CardTitle, Empty, Field } from '../components/Shell.jsx';
import { sendToOwner } from '../components/Messages.jsx';
import { buyerName, possessive } from '../lib/people.js';

const BLANK = { address: '', city: '', units: '', sale_price: '', sale_date: '', distance_mi: '', source: '' };
const digits = (v) => v.replace(/[^\d]/g, '');
const decimal = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

// One comp, easy to scan: the four numbers that matter in bold, then where it came from.
function CompFacts({ c }) {
  const sold = soldLabel(c.sale_date);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      <div><dt className="text-xs text-ink-soft">Units</dt><dd className="text-lg font-semibold">{c.units}</dd></div>
      <div><dt className="text-xs text-ink-soft">Sale price</dt><dd className="text-lg font-semibold">{money(+c.sale_price)}</dd></div>
      <div><dt className="text-xs text-ink-soft">Per unit</dt><dd className="text-lg font-semibold">{money(pricePerUnit(c))}</dd></div>
      <div><dt className="text-xs text-ink-soft">Sold</dt><dd className="text-lg font-semibold">{sold || 'Not found'}</dd></div>
    </dl>
  );
}

export default function Comps({ deal, me, role, preview }) {
  const access = v5Access(role);
  const owner = access.saveComps && !preview;
  const canPick = ['owner', 'realtor', 'reviewer'].includes(role) && !preview && Boolean(me?.uid);
  const [base, setBase] = useState(null);
  const [savedComps, setSavedComps] = useState(null);
  const [savedCap, setSavedCap] = useState(9);
  const [cap, setCap] = useState(9);
  const [localUnits, setLocalUnits] = useState(null);
  const [localComps, setLocalComps] = useState([]);
  const [draft, setDraft] = useState(BLANK);
  const [picks, setPicks] = useState([]);
  const [view, setView] = useState('all'); // 'all' or a picker's uid; only changes what this screen shows
  const [loadErr, setLoadErr] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendStatus, setSendStatus] = useState('');
  const [showPreviewMsg, setShowPreviewMsg] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState({ key: null, dir: 'asc' }); // only changes this screen's order
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: ['sale_price', 'per_unit', 'sale_date', 'units'].includes(key) ? 'desc' : 'asc' }));

  useEffect(() => {
    if (!access.comps) return;
    let live = true;
    Promise.all([
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('commercial_comps').select('*').eq('deal_id', deal.id).order('created_at'),
      supabase.from('commercial_comp_settings').select('cap_rate').eq('deal_id', deal.id).maybeSingle(),
      canPick ? supabase.from('commercial_comp_picks').select('*').eq('deal_id', deal.id) : Promise.resolve({ data: [] }),
    ]).then(([m, c, s, p]) => {
      if (!live) return;
      setBase(m.data?.base || {});
      setSavedComps(c.data || []);
      setPicks(p.data || []);
      const loadedCap = s.data?.cap_rate ? Number(s.data.cap_rate) : 9;
      setSavedCap(loadedCap);
      setCap(loadedCap);
      setLoadErr(c.error ? 'Comps could not load. Refresh to try again.' : '');
    });
    return () => { live = false; };
  }, [deal.id, access.comps, refresh, canPick]);

  if (!access.comps) return null;

  const modelUnits = unitCount(base?.units);
  const units = localUnits ?? modelUnits;
  const noi = base ? operating({ ...base, units }).noi : null;
  const allComps = [...(savedComps || []), ...localComps];
  const shownComps = sortComps(allComps, sort.key, sort.dir);
  const people = canPick ? pickers(picks, me?.uid, (r) => roleLabel[r] || r) : [];
  const viewOn = people.some((p) => p.uid === view) ? view : 'all';
  const viewComps = compsForView(allComps, picks, viewOn);
  const inView = (c) => viewOn === 'all' || viewComps.includes(c);
  const calc = arvEstimate(viewComps, units, noi, cap);
  const valueFor = (uid) => arvEstimate(compsForView(allComps, picks, uid), units, noi, cap).market;
  const canAdd = validComp(draft);
  const dirty = !owner && (localComps.length > 0 || cap !== savedCap || (localUnits !== null && localUnits !== modelUnits));
  const autoPerUnit = perUnitOf(draft.sale_price, draft.units);
  const autoYear = yearOf(draft.sale_date);
  const myPick = (c) => picks.find((p) => p.comp_id === c.id && p.picker_uid === me?.uid);
  const pickedBy = picksByComp(picks.filter((p) => p.picker_uid !== me?.uid), (r) => roleLabel[r] || r);

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
    const extra = {
      city: draft.city.trim() || null,
      sale_date: draft.sale_date || null,
      distance_mi: draft.distance_mi === '' ? null : +draft.distance_mi,
      source: draft.source.trim(),
      source_kind: 'user',
      added_by_role: role,
    };
    if (!owner) {
      setLocalComps((prev) => [...prev, { ...row, ...extra, id: crypto.randomUUID(), local: true }]);
      setDraft(BLANK);
      setStatus('Added to your what-if.');
      return;
    }
    setPending(true);
    setStatus('');
    try {
      let { error } = await supabase.from('commercial_comps').insert({ deal_id: deal.id, ...row, ...extra });
      // Before migration 0014 is applied the new columns don't exist yet; save the basics.
      if (error) ({ error } = await supabase.from('commercial_comps').insert({ deal_id: deal.id, ...row, sale_date: extra.sale_date, source: extra.source }));
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

  const togglePick = async (c) => {
    if (!canPick || c.local || pending) return;
    setPending(true);
    try {
      const mine = myPick(c);
      const { error } = mine
        ? await supabase.from('commercial_comp_picks').delete().eq('id', mine.id)
        : await supabase.from('commercial_comp_picks').insert({ deal_id: deal.id, comp_id: c.id, picker_uid: me.uid, picker_role: role, picker_name: me.name || '' });
      setStatus(error ? 'Your pick did not save. Try again.' : mine ? 'Pick removed.' : 'Picked.');
      if (!error) setRefresh((n) => n + 1);
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
      const err = await sendToOwner(deal, me, role, body, 'Comps / value what-if');
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

  const PickButton = ({ c }) => (canPick && !c.local ? (
    <button type="button" aria-pressed={Boolean(myPick(c))} disabled={pending} onClick={() => togglePick(c)}
      className={`inline-flex min-h-[40px] items-center rounded-full px-3 text-sm font-medium ${myPick(c) ? 'bg-ink text-white' : 'border border-line bg-white hover:border-ink'}`}>
      {myPick(c) ? '★ My pick' : '☆ Pick'}
    </button>
  ) : null);
  const meta = (c) => [c.city, milesLabel(c.distance_mi)].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5 pb-20">
      <Card>
        <CardTitle aside={<span className="text-xs text-ink-soft">{owner ? 'Your comps and cap rate save' : `What-ifs never change ${possessive(buyerName())} numbers`}</span>}>
          What it’s worth
        </CardTitle>
        {loadErr && <p role="alert" className="mb-3 text-sm text-red-700">{loadErr}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-ink p-5 text-white">
            <p className="text-xs uppercase tracking-[0.16em] text-warm">Value by comps</p>
            <p className="mt-1 font-display text-3xl font-semibold sm:text-4xl">{money(calc.market)}</p>
            <p className="mt-1 text-sm text-white/80">
              {calc.avg !== null ? `${money(calc.avg)} average per unit × ${units} units` : viewOn === 'all' ? `Add comps below to value ${units} units` : 'No picks yet. Tap Pick on the comps you trust.'}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">Value by income</p>
            <p className="mt-1 font-display text-3xl font-semibold sm:text-4xl">{money(calc.income)}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {noi !== null ? `${money(noi)} yearly NOI ÷ ${cap}% cap rate` : 'Enter rent in the deal model for NOI'}
            </p>
          </div>
        </div>

        {people.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-sm font-medium">Value by comps uses</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Whose comps the value uses">
              {[{ uid: 'all', label: 'All comps' }, ...people].map((o) => {
                const val = o.uid === 'all' ? null : valueFor(o.uid);
                return (
                  <button key={o.uid} type="button" aria-pressed={viewOn === o.uid} onClick={() => setView(o.uid)}
                    className={`min-h-[40px] rounded-full px-3 py-1 text-sm font-medium ${viewOn === o.uid ? 'bg-ink text-white' : 'border border-line bg-white text-ink hover:border-ink'}`}>
                    {o.label}{val ? `: ${money(val)}` : ''}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-sm text-ink-soft">Switching only changes this view. It never changes saved numbers.</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl bg-paper p-4">
          <div>
            <p className="mb-1 text-xs text-ink-soft">Cap rate</p>
            <div className="inline-flex flex-wrap rounded-full border border-line bg-white p-0.5" role="group" aria-label="Cap rate">
              {CAP_RATES.map((rate) => (
                <button key={rate} type="button" aria-pressed={cap === rate} onClick={() => setCapRate(rate)}
                  className={`min-h-[40px] rounded-full px-3 py-1 text-sm transition ${cap === rate ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'}`}>
                  {rate}%
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-soft">Units {owner ? '(from the building switch)' : '(building switch or what-if)'}</p>
            {owner ? (
              <p className="py-1 text-sm font-medium">{modelUnits} units</p>
            ) : (
              <div className="inline-flex rounded-full border border-line bg-white p-0.5" role="group" aria-label="Units what-if">
                {[9, 10].map((u) => (
                  <button key={u} type="button" aria-pressed={units === u} onClick={() => setLocalUnits(u === modelUnits ? null : u)}
                    className={`min-h-[40px] rounded-full px-3 py-1 text-sm transition ${units === u ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'}`}>
                    {u} units
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle aside={<span className="text-sm text-ink-soft">{allComps.length} comp{allComps.length === 1 ? '' : 's'}{canPick ? ' · pick the ones you trust' : ''}</span>}>Comparable sales</CardTitle>
        {status && <p role="status" className="mb-3 text-sm text-ink-soft">{status}</p>}
        {savedComps === null ? (
          <Empty>Loading…</Empty>
        ) : allComps.length === 0 ? (
          <Empty>No comps entered yet.</Empty>
        ) : (
          <>
            {/* Phone: a sort picker, then one card per comp. */}
            <div className="mb-3 flex flex-wrap items-center gap-2 md:hidden">
              <label htmlFor="comp-sort" className="text-sm text-ink-soft">Sort by</label>
              <select id="comp-sort" value={sort.key || ''} onChange={(e) => setSort({ key: e.target.value || null, dir: ['sale_price', 'per_unit', 'sale_date', 'units'].includes(e.target.value) ? 'desc' : 'asc' })}
                className="min-h-[40px] rounded-full border border-line bg-white px-3 text-sm">
                <option value="">As entered</option>
                {COMP_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {sort.key && <button type="button" onClick={() => sortBy(sort.key)} className="min-h-[40px] rounded-full border border-line bg-white px-3 text-sm">{sort.dir === 'asc' ? 'Low to high ↑' : 'High to low ↓'}</button>}
            </div>
            <ul className="space-y-3 md:hidden">
              {shownComps.map((c) => (
                <li key={c.id} className={`space-y-3 rounded-2xl border border-line bg-white p-4 ${inView(c) ? '' : 'opacity-50'}`}>
                  <div>
                    <p className="text-base font-semibold break-words">{c.address}{c.local && <span className="ml-1.5 rounded-full bg-warm-soft px-2 py-0.5 text-xs font-medium">what-if</span>}</p>
                    {meta(c) && <p className="text-sm text-ink-soft">{meta(c)}</p>}
                  </div>
                  <CompFacts c={c} />
                  {compSource(c) && <p className="text-sm text-ink-soft break-words">Source: {compSource(c)}</p>}
                  {role === 'owner' && pickedBy[c.id] && <p className="text-sm"><span className="font-medium">Picked by:</span> {pickedBy[c.id].join(', ')}</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <PickButton c={c} />
                    {(owner || c.local) && <button type="button" disabled={pending} onClick={() => removeComp(c)} className="text-sm text-ink-soft underline hover:text-red-700">Remove</button>}
                  </div>
                </li>
              ))}
            </ul>
            {/* Desktop: a roomy table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-separate border-spacing-0 text-left text-base">
                <thead>
                  <tr className="text-sm text-ink-soft">
                    {COMP_SORTS.map(([k, h]) => (
                      <th key={k} className="border-b border-line px-1 py-2 font-medium" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" onClick={() => sortBy(k)} className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 hover:bg-warm-soft ${sort.key === k ? 'text-ink' : ''}`}>
                          {h}<span aria-hidden="true" className="text-xs">{sort.key === k ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                        </button>
                      </th>
                    ))}
                    <th className="border-b border-line px-3 py-3 font-medium"><span className="sr-only">Pick</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shownComps.map((c) => (
                    <tr key={c.id} className={`align-top ${inView(c) ? '' : 'opacity-50'}`}>
                      <td className="border-b border-line px-3 py-4">
                        <p className="font-semibold">{c.address}{c.local && <span className="ml-1.5 rounded-full bg-warm-soft px-2 py-0.5 text-xs font-medium">what-if</span>}</p>
                        {c.city && <p className="text-sm text-ink-soft">{c.city}</p>}
                        {role === 'owner' && pickedBy[c.id] && <p className="mt-1 text-sm"><span className="font-medium">Picked by:</span> {pickedBy[c.id].join(', ')}</p>}
                      </td>
                      <td className="border-b border-line px-3 py-4 font-semibold">{c.units}</td>
                      <td className="border-b border-line px-3 py-4 font-semibold">{money(+c.sale_price)}</td>
                      <td className="border-b border-line px-3 py-4 font-semibold">{money(pricePerUnit(c))}</td>
                      <td className="border-b border-line px-3 py-4 font-semibold">{soldLabel(c.sale_date) || 'Not found'}</td>
                      <td className="border-b border-line px-3 py-4">{milesLabel(c.distance_mi) || '—'}</td>
                      <td className="max-w-[260px] border-b border-line px-3 py-4 text-sm text-ink-soft">{compSource(c) || '—'}</td>
                      <td className="border-b border-line px-3 py-4">
                        <div className="flex flex-col items-start gap-2">
                          <PickButton c={c} />
                          {(owner || c.local) && <button type="button" disabled={pending} onClick={() => removeComp(c)} className="text-sm text-ink-soft underline hover:text-red-700">Remove</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-3 text-sm text-ink-soft">Distances are miles from {deal.address || 'the property'}. {role === 'owner' ? 'You see everyone’s picks.' : 'Only you and the buyer see your picks.'}</p>
      </Card>

      <Card>
        <CardTitle>{owner ? 'Add a comp' : 'Try a comp (what-if)'}</CardTitle>
        <form onSubmit={addComp} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-ink-soft sm:col-span-2">Address
            <Field required aria-label="Comp address" autoComplete="street-address" placeholder="e.g. 123 Main St" maxLength={240} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className="mt-1" />
          </label>
          <label className="text-sm text-ink-soft">City
            <Field aria-label="Comp city" autoComplete="address-level2" placeholder="City" maxLength={120} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className="mt-1" />
          </label>
          <label className="text-sm text-ink-soft">Distance (miles)
            <Field aria-label="Distance in miles" inputMode="decimal" autoComplete="off" placeholder="0.8" value={draft.distance_mi} onChange={(e) => setDraft({ ...draft, distance_mi: decimal(e.target.value) })} className="mt-1" />
          </label>
          <label className="text-sm text-ink-soft">Units
            <Field required aria-label="Comp units" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="8" value={draft.units} onChange={(e) => setDraft({ ...draft, units: digits(e.target.value) })} className="mt-1" />
          </label>
          <label className="text-sm text-ink-soft">Sale price ($)
            <Field required aria-label="Comp sale price" inputMode="decimal" autoComplete="off" placeholder="520000" value={draft.sale_price} onChange={(e) => setDraft({ ...draft, sale_price: decimal(e.target.value) })} className="mt-1" />
          </label>
          <label className="text-sm text-ink-soft">Sale date
            <Field type="date" aria-label="Comp sale date" autoComplete="off" value={draft.sale_date} onChange={(e) => setDraft({ ...draft, sale_date: e.target.value })} className="mt-1" />
          </label>
          <div className="text-sm text-ink-soft">Filled in for you
            <p className="mt-1 rounded-xl bg-paper px-3 py-2 text-base text-ink">{autoPerUnit ? `${money(autoPerUnit)}/unit` : '$ per unit'} · {autoYear || 'year'}</p>
          </div>
          <label className="text-sm text-ink-soft sm:col-span-2 lg:col-span-3">Source (optional)
            <Field aria-label="Comp source" autoComplete="off" maxLength={600} placeholder="e.g. Broker name, company: data as of date" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} className="mt-1" />
          </label>
          <div className="flex items-end">
            <Button type="submit" className="min-h-[44px] w-full" disabled={!canAdd || pending || Boolean(loadErr)}>{owner ? 'Add comp' : 'Add what-if comp'}</Button>
          </div>
        </form>
      </Card>

      {dirty && (
        <div className="fixed inset-x-0 bottom-3 z-30 mx-auto w-[min(720px,calc(100%-24px))] rounded-2xl border border-warm bg-white px-4 py-3 text-sm shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">You’re trying your own comps and values.</span>
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
