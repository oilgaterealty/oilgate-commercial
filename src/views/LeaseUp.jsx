import { useEffect, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase.js';
import { ROOMS, STAGES, arvEstimate, leaseAccess, stageMove, unitCount, validComp } from '../lib/leaseUp.js';
import { money, operating } from '../lib/dealmath.js';
import { Button, Card, CardTitle, Empty, Field } from '../components/Shell.jsx';
import { DictatedField, DictationMic } from '../components/Dictation.jsx';
import { sendToOwner } from '../components/Messages.jsx';

const LABELS = { pipeline: 'Pipeline', leads: 'Leads', walkthrough: 'Walkthrough', realtor: 'Realtor photos & notes', strategy: 'Strategy ideas', comps: 'Comps / ARV' };
const TXT = 'w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink';
const SELECT = 'rounded-xl border border-line bg-white px-3 py-2 text-sm';
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const blankLead = { name: '', contact: '', notes: '' };
const blankComp = { address: '', units: '', sale_price: '' };
const PHOTOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const voiceExt = (type) => type?.includes('mp4') ? 'm4a' : type?.includes('ogg') ? 'ogg' : type?.includes('wav') ? 'wav' : 'webm';
const getFilePath = (dealId, uid, kind, ext) => `commercial-lease-up/${dealId}/${kind}/${uid}/${crypto.randomUUID()}.${ext}`;
const fileStore = () => supabase.storage.from(BUCKET);

function useRecords(table, dealId, build) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let q = supabase.from(table).select('*').eq('deal_id', dealId);
    if (build) q = build(q);
    Promise.resolve(q).then(({ data, error }) => {
      if (!active) return;
      setData(data || []);
      setError(error ? 'This section could not load. Check that migration 0009 is applied, then refresh.' : '');
    });
    return () => { active = false; };
  }, [table, dealId, refresh]);
  return { data, error, reload: () => setRefresh((n) => n + 1) };
}

function RecordStatus({ pending, error, status }) {
  return error ? <p role="alert" className="my-2 text-sm text-red-700">{error}</p> :
    <p role="status" className="my-1 text-sm text-ink-soft">{pending ? 'Saving…' : status}</p>;
}

function LeadForm({ lead = blankLead, disabled, save, cancel }) {
  const [draft, setDraft] = useState(lead);
  const edit = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });
  return <form className="space-y-2" onSubmit={(e) => {
    e.preventDefault();
    save(Object.fromEntries(Object.keys(blankLead).map((k) => [k, draft[k].trim()])));
  }}>
    <div className="grid gap-2 sm:grid-cols-2">
      <label>Name<Field required disabled={disabled} aria-label="Lead name" maxLength={140} value={draft.name} onChange={edit('name')} /></label>
      <label>Contact<Field disabled={disabled} aria-label="Lead contact" maxLength={200} value={draft.contact} onChange={edit('contact')} /></label>
    </div>
    <label className="block">Notes<DictatedField as="textarea" disabled={disabled} aria-label="Lead notes" rows={2} className={TXT} maxLength={4000} value={draft.notes} onChange={edit('notes')} /></label>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={disabled || !draft.name.trim()}>{lead.id ? 'Save lead' : 'Add lead'}</Button>
      {cancel && <Button type="button" kind="secondary" onClick={cancel}>Cancel</Button>}</div>
  </form>;
}

function Leads({ deal, section, units, edit }) {
  const { data: leads, error, reload } = useRecords('commercial_tenant_leads', deal.id, (q) => q.order('created_at', { ascending: false }));
  const [pending, setPending] = useState(false);
  const [writeStatus, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [addKey, reset] = useState(0);
  const [moving, setMoving] = useState(null);
  const [unit, setUnit] = useState('');
  const save = async (row, id) => {
    if (!edit || pending) return;
    setPending(true); setStatus('');
    try {
      const q = supabase.from('commercial_tenant_leads');
      const result = id ? await q.update(row).eq('deal_id', deal.id).eq('id', id).select('id').maybeSingle() :
        await q.insert({ ...row, deal_id: deal.id }).select('id').maybeSingle();
      if (result.error || !result.data) {
        setStatus(result.error?.code === '23505' ? 'That unit already has a tenant. Refresh and choose another.' : 'Not saved. Check your access, connection and the unit switch.');
        reload(); return;
      }
      setEditing(null); setMoving(null); setUnit(''); setStatus(id ? 'Saved.' : 'Lead added.'); reset((n) => n + 1); reload();
    } catch { setStatus('Could not save. Try again.'); }
    finally { setPending(false); }
  };
  const occupied = (except) => (leads || []).filter((x) => x.id !== except && x.stage === 'moved_in').map((x) => x.unit_number);
  const move = (row, stage, selectedUnit) => {
    if (stage === 'moved_in' && !selectedUnit) { setMoving(row.id); setUnit(''); return; }
    try { void save(stageMove(stage, selectedUnit, units, occupied(row.id)), row.id); }
    catch (e) { setStatus(e.message); }
  };
  const available = (row) => range(units).filter((n) => !occupied(row.id).includes(n));
  const cards = (rows) => rows.map((row) => <li key={row.id} className="min-w-0 rounded-xl border border-line bg-white p-3">
    <p className="break-words font-semibold">{row.name}{row.unit_number && <span className="ml-2 text-sm font-normal text-ink-soft">Unit {row.unit_number}</span>}</p>
    {section === 'leads' && <>
      {row.contact && <p className="break-words text-sm">{row.contact}</p>}
      {row.notes && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-soft">{row.notes}</p>}
      {editing === row.id ? <div className="mt-2"><LeadForm key={row.id} lead={row} disabled={pending} save={(v) => save(v, row.id)} cancel={() => setEditing(null)} /></div> :
        edit && <button type="button" className="mt-2 text-sm underline" onClick={() => setEditing(row.id)}>Edit lead</button>}
    </>}
    {section === 'pipeline' && edit && <div className="mt-2">
      <select aria-label={`Move ${row.name}`} className={`${SELECT} w-full`} value={moving === row.id ? 'moved_in' : row.stage} disabled={pending} onChange={(e) => {
        if (e.target.value !== 'moved_in') setMoving(null);
        move(row, e.target.value);
      }}>{STAGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
      {moving === row.id && <div className="mt-2 space-y-1">
        <label className="block text-sm">Assign unit<select className={`${SELECT} mt-1 block w-full`} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Choose a unit</option>{available(row).map((n) => <option key={n} value={n}>Unit {n}</option>)}</select></label>
        <div className="flex flex-wrap gap-1"><Button disabled={!unit || pending} onClick={() => move(row, 'moved_in', unit)}>Move in</Button><Button kind="secondary" onClick={() => setMoving(null)}>Cancel</Button></div>
      </div>}
    </div>}
  </li>);
  return <Card>
    <CardTitle>{section === 'leads' ? 'Leads' : 'Tenant pipeline'}</CardTitle>
    <RecordStatus pending={pending} error={error} status={writeStatus} />
    {leads === null ? <Empty>Loading…</Empty> : section === 'leads' ?
      <div className="space-y-3">{edit && !error && <LeadForm key={addKey} disabled={pending} save={save} />}{leads.length ? <ul className="grid gap-2 sm:grid-cols-2">{cards(leads)}</ul> : <Empty>No leads yet.</Empty>}</div> :
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">{STAGES.map(([key, label]) => {
        const list = leads.filter((l) => l.stage === key);
        return <section className="rounded-xl bg-paper p-2" key={key}><h3 className="mb-2 text-sm font-semibold">{label} <span className="font-normal text-ink-soft">({list.length})</span></h3><ul className="space-y-2">{cards(list)}</ul></section>;
      })}</div>}
  </Card>;
}

function useSigned(paths) {
  const [urls, setUrls] = useState({});
  const lookup = JSON.stringify(paths);
  useEffect(() => {
    let active = true;
    const list = JSON.parse(lookup);
    if (!list.length) { setUrls({}); return; }
    const sign = () => fileStore().createSignedUrls(list, 900).then(({ data }) => {
      if (active) setUrls(Object.fromEntries((data || []).map((r) => [r.path, r.signedUrl])));
    });
    void sign();
    const timer = setInterval(sign, 14 * 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [lookup]);
  return urls;
}

function MediaPhotos({ deal, uid, role, edit, kind, unit = null, room = null }) {
  const { data, error, reload } = useRecords('commercial_lease_photos', deal.id, (q) => {
    q = q.eq('kind', kind);
    if (kind === 'walkthrough') q = q.eq('unit_number', unit).eq('room', room);
    return q.order('created_at');
  });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const photos = data || [];
  const urls = useSigned(photos.map((r) => r.storage_path));
  const addPhotos = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!edit || !files.length || busy) return;
    setBusy(true); setStatus('');
    let saved = 0;
    const errors = [];
    try {
      for (const f of files) {
        const ext = PHOTOS[f.type];
        if (!ext || !f.size || f.size > 20 * 1024 * 1024) { errors.push('Use JPEG, PNG or WebP under 20 MB.'); continue; }
        const storage_path = getFilePath(deal.id, uid, kind, ext);
        const uploaded = await fileStore().upload(storage_path, f, { contentType: f.type });
        if (uploaded.error) { errors.push('A photo could not upload.'); continue; }
        const inserted = await supabase.from('commercial_lease_photos').insert({ deal_id: deal.id, kind, storage_path, unit_number: unit, room });
        if (inserted.error) { await fileStore().remove([storage_path]); errors.push('A photo could not be saved.'); continue; }
        saved++;
      }
    } catch { errors.push('Upload interrupted.'); }
    finally {
      reload(); setBusy(false);
      setStatus([saved ? `${saved} photo${saved === 1 ? '' : 's'} saved.` : '', ...new Set(errors)].filter(Boolean).join(' '));
    }
  };
  const remove = async (p) => {
    if (!edit || !window.confirm('Remove this photo?')) return;
    setBusy(true); setStatus('');
    try {
      const result = await fileStore().remove([p.storage_path]);
      if (result.error) { setStatus('Photo could not be removed.'); return; }
      const { error } = await supabase.from('commercial_lease_photos').delete().eq('deal_id', deal.id).eq('id', p.id);
      setStatus(error ? 'File was removed, but its record still needs cleanup.' : 'Photo removed.');
    } catch { setStatus('Photo could not be removed.'); }
    finally { reload(); setBusy(false); }
  };
  return <div className="space-y-2">
    <h3 className="font-medium">Photos</h3>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {edit && !error && <label className="block text-sm">Add photos<input type="file" accept={Object.keys(PHOTOS).join(',')} multiple disabled={busy} onChange={addPhotos} className="mt-1 block w-full text-sm" /></label>}
    {photos.length ? <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{photos.map((p, i) => <li key={p.id} className="min-w-0 rounded-xl border border-line p-1">
      {urls[p.storage_path] && <a href={urls[p.storage_path]} target="_blank" rel="noreferrer"><img src={urls[p.storage_path]} alt={`Photo ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" /></a>}
      {edit && (role === 'owner' || uid === p.author_uid) && <button type="button" disabled={busy} className="px-1 py-1 text-xs underline" onClick={() => remove(p)}>Remove photo {i + 1}</button>}
    </li>)}</ul> : <Empty>{data === null ? 'Loading…' : 'No photos yet.'}</Empty>}
    <p role="status" className="text-sm text-ink-soft">{busy ? 'Working…' : status}</p>
  </div>;
}

function WalkthroughRoom({ deal, uid, role, edit, unit, room }) {
  const { data, error, reload } = useRecords('commercial_walkthrough_voice', deal.id, (q) => q.eq('unit_number', unit).eq('room', room));
  const record = data?.[0];
  const urls = useSigned(record ? [record.storage_path] : []);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState(null);
  const save = async () => {
    if (!draft || !edit || pending) return;
    setPending(true); setStatus('');
    const storage_path = getFilePath(deal.id, uid, 'walkthrough', voiceExt(draft.audio.type));
    try {
      const uploaded = await fileStore().upload(storage_path, draft.audio, { contentType: draft.audio.type.split(';')[0] });
      if (uploaded.error) { setStatus('Voice note could not upload.'); return; }
      const { error } = await supabase.from('commercial_walkthrough_voice').upsert({
        deal_id: deal.id, unit_number: unit, room, storage_path, raw_transcript: draft.text,
      }, { onConflict: 'deal_id,unit_number,room' });
      if (error) { await fileStore().remove([storage_path]); setStatus('Voice note could not save.'); return; }
      if (record && (role === 'owner' || record.storage_path.split('/')[3] === uid)) {
        await fileStore().remove([record.storage_path]);
      }
      setDraft(null); setStatus('Voice note and raw transcript saved.'); reload();
    } catch { setStatus('Voice note could not save. Try again.'); }
    finally { setPending(false); }
  };
  return <div className="grid gap-4 sm:grid-cols-2">
    <MediaPhotos deal={deal} uid={uid} role={role} edit={edit} kind="walkthrough" unit={unit} room={room} />
    <div className="space-y-2">
      <h3 className="font-medium">Voice note</h3>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!record && <Empty>{data === null ? 'Loading…' : 'No voice note yet.'}</Empty>}
      {record && <>
        {urls[record.storage_path] && <audio src={urls[record.storage_path]} controls preload="none" className="w-full" aria-label="Saved voice note" />}
        <details><summary className="cursor-pointer text-sm font-medium">Raw transcript</summary><p className="mt-1 whitespace-pre-wrap break-words text-sm">{record.raw_transcript}</p></details>
      </>}
      {edit && !error && <div className="flex flex-wrap items-center gap-2 text-sm">
        <DictationMic label={record ? 'replacement voice note' : 'voice note'} disabled={pending || data === null} onText={(text, audio) => {
          setDraft({ text, audio }); setStatus('');
        }} />
        <span>{record ? 'Record a replacement' : 'Record up to one minute'}</span>
      </div>}
      {edit && draft && <div className="space-y-2 rounded-xl bg-paper p-3">
        <p className="text-xs font-medium">Raw transcript, not yet saved</p><p className="whitespace-pre-wrap break-words text-sm">{draft.text}</p>
        <div className="flex flex-wrap gap-2"><Button disabled={pending} onClick={save}>Save voice note</Button><Button disabled={pending} kind="secondary" onClick={() => setDraft(null)}>Discard</Button></div>
      </div>}
      <RecordStatus pending={pending} status={status} />
    </div>
  </div>;
}

function Walkthrough({ deal, uid, role, edit, units }) {
  const [chosen, setUnit] = useState(1);
  const [room, setRoom] = useState(ROOMS[0][0]);
  const unit = Math.min(chosen, units);
  return <Card><CardTitle>Unit walkthrough</CardTitle>
    <label className="mb-3 flex items-center gap-2 text-sm">Unit<select value={unit} className={SELECT} onChange={(e) => setUnit(+e.target.value)}>{range(units).map((n) => <option key={n} value={n}>Unit {n}</option>)}</select></label>
    <nav className="mb-4 flex flex-wrap gap-1" aria-label="Rooms">{ROOMS.map(([r, l]) => <Button key={r} kind={r === room ? 'primary' : 'secondary'} aria-pressed={r === room} onClick={() => setRoom(r)}>{l}</Button>)}</nav>
    <WalkthroughRoom key={`${unit}-${room}`} deal={deal} uid={uid} role={role} edit={edit} unit={unit} room={room} />
  </Card>;
}

function Notes({ deal, table, title, edit, empty, preview }) {
  // A role preview uses the owner's actual login. Never fetch another person's private realtor notes there.
  if (preview) return <Card><CardTitle>{title}</CardTitle><Empty>Private notes appear here on a real sign-in.</Empty></Card>;
  return <RealNotes deal={deal} table={table} title={title} edit={edit} empty={empty} />;
}
function RealNotes({ deal, table, title, edit, empty }) {
  const { data, error, reload } = useRecords(table, deal.id, (q) => q.order('created_at', { ascending: false }));
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!edit || pending || !value.trim()) return;
    setPending(true); setStatus('');
    try {
      const q = supabase.from(table);
      const r = editing ? await q.update({ body: value.trim() }).eq('deal_id', deal.id).eq('id', editing).select('id').maybeSingle() : await q.insert({ deal_id: deal.id, body: value.trim() }).select('id').maybeSingle();
      if (r.error || !r.data) { setStatus('Not saved. Check your connection.'); return; }
      setValue(''); setEditing(null); setStatus('Saved.'); reload();
    } catch { setStatus('Not saved. Try again.'); }
    finally { setPending(false); }
  };
  return <Card><CardTitle>{title}</CardTitle>
    {edit && !error && <form onSubmit={save} className="space-y-2">
      <DictatedField as="textarea" aria-label={title} maxLength={4000} className={TXT} rows={3} value={value} onChange={(e) => setValue(e.target.value)} required />
      <div className="flex gap-2"><Button type="submit" disabled={pending || !value.trim()}>{editing ? 'Save changes' : 'Add card'}</Button>
        {editing && <Button type="button" kind="secondary" onClick={() => { setValue(''); setEditing(null); }}>Cancel</Button>}</div>
    </form>}
    <RecordStatus pending={pending} status={status} error={error} />
    {data?.length ? <ul className="grid gap-2 sm:grid-cols-2">{data.map((row) => <li key={row.id} className="rounded-xl border border-line p-3">
      <p className="whitespace-pre-wrap break-words text-sm">{row.body}</p>{edit && <button type="button" className="mt-2 text-xs underline" onClick={() => { setValue(row.body); setEditing(row.id); }}>Edit card</button>}
    </li>)}</ul> : <Empty>{data === null ? 'Loading…' : empty}</Empty>}
  </Card>;
}

function RealtorMedia({ deal, uid, role, preview, edit }) {
  return <div className="grid gap-3 lg:grid-cols-2">
    {preview ? <Card><CardTitle>Photos</CardTitle><Empty>Private photos appear here on a real sign-in.</Empty></Card> : <Card><MediaPhotos deal={deal} uid={uid} role={role} edit={edit} kind="realtor" /></Card>}
    <Notes deal={deal} table="commercial_realtor_notes" title="Realtor notes" edit={edit} empty="No notes yet." preview={preview} />
  </div>;
}

function Comps({ deal, me, role, owner, preview, base }) {
  const { data: saved, error, reload } = useRecords('commercial_comps', deal.id, (q) => q.order('created_at'));
  const [draft, setDraft] = useState(blankComp);
  const [mine, setMine] = useState([]);
  const [annual, setAnnual] = useState(null);
  const [overrideUnits, setUnits] = useState(null);
  const [cap, setCap] = useState('9');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const units = overrideUnits || unitCount(base?.units);
  const modelNoi = base && +base.rent > 0 ? operating({ ...base, units }).noi : null;
  const noi = annual ?? modelNoi;
  const calc = arvEstimate([...(saved || []), ...mine], units, noi, cap);
  const valid = validComp(draft);
  const savedChanged = overrideUnits !== null || annual !== null || cap !== '9';
  const edit = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });
  const add = async (e) => {
    e.preventDefault();
    if (!valid || pending || error) return;
    const row = { address: draft.address.trim(), units: +draft.units, sale_price: +draft.sale_price };
    if (!owner) { setMine((x) => [...x, { ...row, id: crypto.randomUUID(), local: true }]); setDraft(blankComp); return; }
    setPending(true); setStatus('');
    try {
      const { error } = await supabase.from('commercial_comps').insert({ deal_id: deal.id, ...row });
      if (error) { setStatus('Comp could not save.'); return; }
      setDraft(blankComp); reload(); setStatus('Comp saved.');
    } catch { setStatus('Comp could not save.'); }
    finally { setPending(false); }
  };
  const remove = async (r) => {
    if (r.local) { setMine((l) => l.filter((x) => x.id !== r.id)); return; }
    if (!owner || !window.confirm('Remove this comp?')) return;
    setPending(true);
    try {
      const { data, error } = await supabase.from('commercial_comps').delete().eq('deal_id', deal.id).eq('id', r.id).select('id').maybeSingle();
      setStatus(error || !data ? 'Comp could not be removed.' : 'Comp removed.'); reload();
    } catch { setStatus('Comp could not be removed.'); }
    finally { setPending(false); }
  };
  const send = async () => {
    if (preview || owner || pending || !(mine.length || savedChanged)) return;
    setPending(true); setStatus('');
    try {
      const lines = mine.map((r) => `- ${r.address}: ${r.units} units, ${money(r.sale_price)}`);
      const body = ['Comps / ARV what-if (not saved):', ...lines, `Units: ${units}; annual NOI: ${money(noi === '' ? null : +noi)}; cap rate: ${cap}%.`, `Average comp price per unit: ${money(calc.avg)}. Comp value: ${money(calc.market)}. Income value: ${money(calc.income)}.`].join('\n');
      if (body.length > 4000) { setStatus('Remove some local comps before sending.'); return; }
      const problem = await sendToOwner(deal, me, role, body, 'Comps / ARV what-if');
      setStatus(problem ? 'Not sent. Try again.' : 'Sent to LaVante. No what-if entries were saved.');
    } catch { setStatus('Not sent. Try again.'); }
    finally { setPending(false); }
  };
  return <Card><CardTitle>Comps / ARV calculator</CardTitle>
    <p className="mb-3 text-sm text-ink-soft">{owner ? 'Comp sales you add are shared with the realtor and reviewers. Calculator inputs do not change the deal model.' : 'Saved sales are read-only. Your entries stay here unless you send a what-if to LaVante.'}</p>
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-sm">Building units<select className={`${SELECT} mt-1 block w-full`} value={units} onChange={(e) => setUnits(+e.target.value === unitCount(base?.units) ? null : +e.target.value)}><option value="9">9 units</option><option value="10">10 units</option></select></label>
      <label className="text-sm">Annual NOI<Field type="number" aria-label="Annual NOI" className="mt-1" step="0.01" value={noi ?? ''} onChange={(e) => setAnnual(e.target.value)} /></label>
      <label className="text-sm">Cap rate<select className={`${SELECT} mt-1 block w-full`} value={cap} onChange={(e) => setCap(e.target.value)}>{['8','8.25','8.5','8.75','9','9.25','9.5','9.75','10'].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
    </div>
    <div className="my-3 grid grid-cols-2 gap-2"><div className="rounded-xl bg-paper p-3"><p className="text-sm">Sales comps</p><strong className="font-display text-xl">{money(calc.market)}</strong><p className="text-xs text-ink-soft">{money(calc.avg)} average per unit × {units}</p></div><div className="rounded-xl bg-paper p-3"><p className="text-sm">Income value</p><strong className="font-display text-xl">{money(calc.income)}</strong><p className="text-xs text-ink-soft">Annual NOI ÷ {cap}%</p></div></div>
    <form onSubmit={add} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
      <label className="text-sm">Address<Field required aria-label="Comp address" maxLength={240} value={draft.address} onChange={edit('address')} /></label>
      <label className="text-sm">Units<Field required type="number" aria-label="Comp units" min="1" max="10000" step="1" value={draft.units} onChange={edit('units')} /></label>
      <label className="text-sm">Sale price<Field required type="number" aria-label="Comp sale price" min="0.01" step="0.01" value={draft.sale_price} onChange={edit('sale_price')} /></label>
      <Button type="submit" disabled={!valid || pending || Boolean(error)}>{owner ? 'Save comp' : 'Add what-if comp'}</Button>
    </form>
    <ul className="mt-3 divide-y divide-line">{[...(saved || []), ...mine].map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><div className="break-words"><b>{r.address}</b> · {r.units} units · {money(+r.sale_price)} {r.local && '(what-if)'}</div>{(owner || r.local) && <button className="underline" disabled={pending} type="button" onClick={() => remove(r)}>Remove</button>}</li>)}</ul>
    {!owner && (mine.length || savedChanged) ? <Button type="button" disabled={preview || pending} onClick={send}>Send to LaVante</Button> : null}
    <RecordStatus pending={pending} status={status} error={error} />
  </Card>;
}

export default function LeaseUp({ deal, me, role, preview }) {
  const access = leaseAccess(role, deal.slug);
  const [section, setSection] = useState('pipeline');
  const [base, setBase] = useState(undefined);
  useEffect(() => {
    if (!access.pipeline) return;
    let live = true;
    supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle()
      .then(({ data }) => { if (live) setBase(data?.base || {}); });
    return () => { live = false; };
  }, [deal.id, access.pipeline]);
  if (!access.pipeline) return null;
  const edit = access.editTenants && !preview;
  const units = unitCount(base?.units);
  return <div className="space-y-3">
    <nav aria-label="Lease-up sections" className="flex flex-wrap gap-1">{Object.entries(LABELS).filter(([k]) => access[k]).map(([key, label]) => <Button type="button" key={key} kind={key === section ? 'primary' : 'secondary'} aria-pressed={key === section} onClick={() => setSection(key)}>{label}</Button>)}</nav>
    {base === undefined ? <Empty>Loading lease-up…</Empty> : <>
      {access[section] && (section === 'leads' || section === 'pipeline') && <Leads key={section} deal={deal} section={section} edit={edit} units={units} />}
      {section === 'walkthrough' && access.walkthrough && <Walkthrough deal={deal} uid={me.uid} role={role} edit={edit} units={units} />}
      {section === 'realtor' && access.realtor && <RealtorMedia deal={deal} uid={me.uid} role={role} preview={preview} edit={edit} />}
      {section === 'strategy' && access.strategy && <Notes deal={deal} table="commercial_strategy_ideas" title="Strategy ideas" edit={!preview} empty="No cards yet." preview={preview} />}
      {section === 'comps' && access.comps && <Comps deal={deal} role={role} me={me} owner={access.saveComps && !preview} preview={preview} base={base} />}
    </>}
  </div>;
}
