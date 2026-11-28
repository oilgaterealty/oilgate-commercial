import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { CAP_RATES, arvEstimate, compWhatIfMessage, pricePerUnit, unitCount, v5Access, validComp } from '../lib/leaseUp.js';
import { money, operating } from '../lib/dealmath.js';
import { roleLabel } from '../lib/format.js';
import { COMP_SORTS, checkedLabel, compSource, compsForView, latestCompDate, milesLabel, nextCompSort, perUnitOf, pickers, picksByComp, soldLabel, sortComps, yearOf } from '../lib/v63.js';
import { Button, Card, CardTitle, Empty, Field, InfoTip, OverlayTrigger } from '../components/Shell.jsx';
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

const PHONE_COMPS = 5;

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
  const [previewPicks, setPreviewPicks] = useState([]);
  const [view, setView] = useState('all'); // 'all' or a picker's uid; only changes what this screen shows
  const [phoneAll, setPhoneAll] = useState(false); // phone list shows the first few comps until asked for all
  const [addOpen, setAddOpen] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendStatus, setSendStatus] = useState('');
  const [showPreviewMsg, setShowPreviewMsg] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState({ key: null, dir: 'asc', key2: null, dir2: 'asc' }); // only changes this screen's order
  const sortBy = (key, shiftKey = false) => setSort((s) => nextCompSort(s, key, shiftKey));

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

  const units = 10;
  const noi = base ? operating({ ...base, units }).noi : null;
  const allComps = [...(savedComps || []), ...localComps];
  const shownComps = sortComps(allComps, sort.key, sort.dir, sort.key2, sort.dir2);
  const selectable = allComps.filter((c) => !c.local);
  const canSelectRows = canPick || Boolean(preview);
  const myUid = canPick ? me.uid : '__preview__';
  const effectivePicks = canPick ? picks : previewPicks.map((id) => ({ comp_id: id, picker_uid: '__preview__', picker_role: role, picker_name: 'You' }));
  const people = canSelectRows ? pickers(effectivePicks, myUid, (r) => roleLabel[r] || r) : [];
  const viewOn = people.some((p) => p.uid === view) ? view : 'all';
  const viewComps = compsForView(allComps, effectivePicks, viewOn);
  const inView = (c) => viewOn === 'all' || viewComps.includes(c);
  const calc = arvEstimate(viewComps, units, noi, cap);
  const valueFor = (uid) => arvEstimate(compsForView(allComps, effectivePicks, uid), units, noi, cap).market;
  const canAdd = validComp(draft);
  const dirty = !owner && (localComps.length > 0 || cap !== savedCap);
  const autoPerUnit = perUnitOf(draft.sale_price, draft.units);
  const autoYear = yearOf(draft.sale_date);
  const myPick = (c) => (canPick
    ? picks.find((p) => p.comp_id === c.id && p.picker_uid === me?.uid)
    : previewPicks.includes(c.id));
  const selectedCount = selectable.filter((c) => Boolean(myPick(c))).length;
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
    if (!canSelectRows || c.local || pending) return;
    if (!canPick) {
      setPreviewPicks((prev) => (prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id]));
      return;
    }
    setPending(true);
    try {
      const mine = myPick(c);
      const { error } = mine
        ? await supabase.from('commercial_comp_picks').delete().eq('id', mine.id)
        : await supabase.from('commercial_comp_picks').insert({ deal_id: deal.id, comp_id: c.id, picker_uid: me.uid, picker_role: role, picker_name: me.name || '' });
      setStatus(error ? 'Your selection did not save. Try again.' : mine ? 'Deselected.' : 'Selected.');
      if (!error) setRefresh((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  const selectAllPicks = async () => {
    if (!canSelectRows || pending || !selectable.length) return;
    const missing = selectable.filter((c) => !myPick(c));
    if (!canPick) {
      setPreviewPicks(selectable.map((c) => c.id));
      return;
    }
    if (!missing.length) return;
    setPending(true);
    try {
      const rowsToInsert = missing.map((c) => ({ deal_id: deal.id, comp_id: c.id, picker_uid: me.uid, picker_role: role, picker_name: me.name || '' }));
      const { error } = await supabase.from('commercial_comp_picks').insert(rowsToInsert);
      setStatus(error ? 'Could not select all. Try again.' : `Selected ${selectable.length}.`);
      if (!error) setRefresh((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  const clearAllPicks = async () => {
    if (!canSelectRows || pending) return;
    if (!canPick) {
      setPreviewPicks([]);
      return;
    }
    const mineIds = picks.filter((p) => p.picker_uid === me.uid).map((p) => p.id);
    if (!mineIds.length) return;
    setPending(true);
    try {
      const { error } = await supabase.from('commercial_comp_picks').delete().in('id', mineIds);
      setStatus(error ? 'Could not clear selections. Try again.' : 'Cleared.');
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

  const PickBox = ({ c }) => (canSelectRows && !c.local ? (
    <label className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        aria-label={`Select ${c.address}`}
        checked={Boolean(myPick(c))}
        disabled={pending}
        onChange={() => void togglePick(c)}
        className="h-5 w-5 rounded border-line accent-ink"
      />
    </label>
  ) : null);
  const sortName = (k) => COMP_SORTS.find(([x]) => x === k)?.[1] || k;
  const sortArrow = (k) => {
    if (sort.key === k) return sort.key2 ? `1 ${sort.dir === 'asc' ? '↑' : '↓'}` : (sort.dir === 'asc' ? '↑' : '↓');
    if (sort.key2 === k) return `2 ${sort.dir2 === 'asc' ? '↑' : '↓'}`;
    return '↕';
  };
  const meta = (c) => [c.city, milesLabel(c.distance_mi)].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5 pb-20">
      <Card>
        <CardTitle>
          What it’s worth
        </CardTitle>
        {loadErr && <p role="alert" className="mb-3 text-sm text-red-700">{loadErr}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-ink p-5 text-white">
            <p className="text-xs uppercase tracking-[0.16em] text-warm">Value by comps</p>
            <p className="mt-1 font-display text-3xl font-semibold sm:text-4xl">
              <OverlayTrigger label="How value by comps is figured" lines={[calc.avg !== null ? `${money(calc.avg)} average per unit × ${units} units` : viewOn === 'all' ? `Add comps below to value ${units} units` : 'No picks yet. Tap Pick on the comps you trust.']}>{money(calc.market)}</OverlayTrigger>
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">Value by income</p>
            <p className="mt-1 font-display text-3xl font-semibold sm:text-4xl">
              <OverlayTrigger label="How value by income is figured" lines={[noi !== null ? `${money(noi)} yearly NOI ÷ ${cap}% cap rate` : 'Enter rent in the deal model for NOI']}>{money(calc.income)}</OverlayTrigger>
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
            <p className="mb-1 text-xs text-ink-soft">Units</p>
            <p className="py-1 text-sm font-medium">10 units</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle aside={<div className="flex items-center gap-2"><span className="text-sm text-ink-soft">{allComps.length}</span>{latestCompDate(savedComps) && <InfoTip label="Comp list updated" lines={[`Comp list last updated ${checkedLabel(latestCompDate(savedComps))}`]} />}</div>}>Comparable sales</CardTitle>
        {status && <p role="status" className="mb-3 text-sm text-ink-soft">{status}</p>}
        {savedComps === null ? (
          <Empty>Loading…</Empty>
        ) : allComps.length === 0 ? (
          <Empty>No comps entered yet.</Empty>
        ) : (
          <>
            {canSelectRows && selectable.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-paper px-3 py-2 text-sm">
                <span className="font-medium text-ink">{selectedCount} of {selectable.length} selected</span>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={pending || selectedCount === selectable.length} onClick={() => void selectAllPicks()}
                    className="min-h-[40px] rounded-full border border-line bg-white px-3 py-1 text-xs font-medium hover:border-ink disabled:opacity-50">
                    Select all
                  </button>
                  <button type="button" disabled={pending || selectedCount === 0} onClick={() => void clearAllPicks()}
                    className="min-h-[40px] rounded-full border border-line bg-white px-3 py-1 text-xs font-medium hover:border-ink disabled:opacity-50">
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Phone: primary + secondary sort pickers, then one card per comp. */}
            <div className="mb-3 space-y-2 md:hidden">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="comp-sort" className="text-sm text-ink-soft">Sort by</label>
                <select id="comp-sort" value={sort.key || ''} onChange={(e) => setSort((s) => nextCompSort({ key: null, dir: 'asc', key2: s.key2 === e.target.value ? null : s.key2, dir2: s.dir2 }, e.target.value || null, false))}
                  className="min-h-[40px] rounded-full border border-line bg-white px-3 text-sm">
                  <option value="">As entered</option>
                  {COMP_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {sort.key && <button type="button" onClick={() => sortBy(sort.key, false)} className="min-h-[40px] rounded-full border border-line bg-white px-3 text-sm">{sort.dir === 'asc' ? 'Low to high ↑' : 'High to low ↓'}</button>}
              </div>
              {sort.key && (
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="comp-sort-2" className="text-sm text-ink-soft">Then by</label>
                  <select id="comp-sort-2" value={sort.key2 || ''} onChange={(e) => {
                    const k2 = e.target.value || null;
                    setSort((s) => k2 ? { ...s, key2: k2, dir2: ['sale_price', 'per_unit', 'sale_date', 'units'].includes(k2) ? 'desc' : 'asc' } : { ...s, key2: null, dir2: 'asc' });
                  }}
                    className="min-h-[40px] rounded-full border border-line bg-white px-3 text-sm">
                    <option value="">None</option>
                    {COMP_SORTS.filter(([k]) => k !== sort.key).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {sort.key2 && <button type="button" onClick={() => sortBy(sort.key2, true)} className="min-h-[40px] rounded-full border border-line bg-white px-3 text-sm">{sort.dir2 === 'asc' ? 'Low to high ↑' : 'High to low ↓'}</button>}
                </div>
              )}
            </div>
            <ul className="space-y-3 md:hidden">
              {(phoneAll ? shownComps : shownComps.slice(0, PHONE_COMPS)).map((c) => (
                <li key={c.id} className={`space-y-3 rounded-2xl border border-line bg-white p-4 ${inView(c) ? '' : 'opacity-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <PickBox c={c} />
                      <p className="text-base font-semibold break-words">{c.address}{c.local && <span className="ml-1.5 rounded-full bg-warm-soft px-2 py-0.5 text-xs font-medium">what-if</span>}</p>
                      {meta(c) && <InfoTip label={`Where ${c.address} is`} lines={[meta(c)]} />}
                    </div>
                  </div>
                  <CompFacts c={c} />
                  {role === 'owner' && pickedBy[c.id] && <p className="text-sm"><span className="font-medium">Picked by:</span> {pickedBy[c.id].join(', ')}</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    {compSource(c) && <InfoTip label={`Source for ${c.address}`} lines={[compSource(c)]} />}
                    {(owner || c.local) && <button type="button" disabled={pending} onClick={() => removeComp(c)} className="inline-flex min-h-[40px] items-center px-2 text-sm text-ink-soft underline hover:text-red-700">Remove</button>}
                  </div>
                </li>
              ))}
            </ul>
            {shownComps.length > PHONE_COMPS && (
              <button type="button" onClick={() => setPhoneAll((v) => !v)} className="mt-3 min-h-[44px] w-full rounded-full border border-line bg-white px-4 text-sm font-medium hover:border-ink md:hidden">
                {phoneAll ? 'Show fewer' : `Show all ${shownComps.length} comps`}
              </button>
            )}
            {/* Desktop: a roomy table. */}
            <div className="hidden md:block">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                <div className="flex items-center gap-2">
                  <span>{sort.key ? `Sorted by ${sortName(sort.key)} (${sort.dir})${sort.key2 ? `, then ${sortName(sort.key2)} (${sort.dir2})` : ''}` : 'Sorted as entered'}</span>
                  <InfoTip label="Multi-column sort" lines={['Click a column to sort. Hold Shift and click another column to add a second sort.']} />
                </div>
                {sort.key && (
                  <button type="button" onClick={() => setSort({ key: null, dir: 'asc', key2: null, dir2: 'asc' })} className="inline-flex min-h-[40px] items-center underline hover:text-ink">
                    Clear sort
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-left text-base">
                  <thead>
                    <tr className="text-sm text-ink-soft">
                      {canSelectRows && <th className="border-b border-line px-2 py-2 font-medium"><span className="sr-only">Select</span></th>}
                      {COMP_SORTS.map(([k, h]) => {
                        const isSorted = sort.key === k || sort.key2 === k;
                        const ariaSort = sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                        return (
                          <th key={k} className="border-b border-line px-1 py-2 font-medium" aria-sort={ariaSort}>
                            <button type="button" onClick={(e) => sortBy(k, e.shiftKey)} className={`inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 hover:bg-warm-soft ${isSorted ? 'font-semibold text-ink' : ''}`}>
                              {h}<span aria-hidden="true" className="text-xs">{sortArrow(k)}</span>
                            </button>
                          </th>
                        );
                      })}
                      <th className="border-b border-line px-3 py-3 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownComps.map((c) => (
                      <tr key={c.id} className={`align-top ${inView(c) ? '' : 'opacity-50'}`}>
                        {canSelectRows && <td className="border-b border-line px-2 py-4"><PickBox c={c} /></td>}
                        <td className="border-b border-line px-3 py-4">
                          <div className="flex items-start gap-2">
                            <p className="font-semibold">{c.address}{c.local && <span className="ml-1.5 rounded-full bg-warm-soft px-2 py-0.5 text-xs font-medium">what-if</span>}</p>
                            {c.city && <InfoTip label={`City for ${c.address}`} lines={[c.city]} />}
                          </div>
                          {role === 'owner' && pickedBy[c.id] && <p className="mt-1 text-sm"><span className="font-medium">Picked by:</span> {pickedBy[c.id].join(', ')}</p>}
                        </td>
                        <td className="border-b border-line px-3 py-4 font-semibold">{c.units}</td>
                        <td className="border-b border-line px-3 py-4 font-semibold">{money(+c.sale_price)}</td>
                        <td className="border-b border-line px-3 py-4 font-semibold">{money(pricePerUnit(c))}</td>
                        <td className="border-b border-line px-3 py-4 font-semibold">{soldLabel(c.sale_date) || 'Not found'}</td>
                        <td className="border-b border-line px-3 py-4">{milesLabel(c.distance_mi) || '—'}</td>
                        <td className="border-b border-line px-3 py-4 text-sm text-ink-soft">
                          {compSource(c) ? <InfoTip label={`Source for ${c.address}`} lines={[compSource(c)]} /> : '—'}
                        </td>
                        <td className="border-b border-line px-3 py-4">
                          {(owner || c.local) && <button type="button" disabled={pending} onClick={() => removeComp(c)} className="inline-flex min-h-[40px] items-center px-2 text-sm text-ink-soft underline hover:text-red-700">Remove</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card>
        <button
          type="button"
          aria-expanded={addOpen}
          data-comps-add-toggle
          onClick={() => setAddOpen((v) => !v)}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
        >
          <span className="font-display text-xl font-semibold text-ink">{owner ? 'Add a comp' : 'Try a comp (what-if)'}</span>
          <span aria-hidden="true" className="text-sm text-ink-soft">{addOpen ? '▴' : '▾'}</span>
        </button>
        {addOpen && (
          <form onSubmit={addComp} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
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
        )}
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
