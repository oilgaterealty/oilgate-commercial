import { useEffect, useMemo, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase.js';
import { money } from '../lib/dealmath.js';
import { WALK_SPACES, WALK_UNITS, spaceLabel, ROOMS, AREA_ROOMS } from '../lib/leaseUp.js';
import { when } from '../lib/format.js';
import { authorLabel } from '../lib/people.js';
import { visibleUnitNotes, canWriteUnitNotes } from '../lib/v63.js';
import { SITE_KIND, canAccessDealPlan } from '../lib/site.js';
import { Button, Card, Empty, InfoTip } from './Shell.jsx';
import PhotoViewer, { ThumbOverlay } from './PhotoViewer.jsx';
import { DictatedField } from './Dictation.jsx';
import { WALK_SHARES, saveWalkShare, walkShareButtons } from '../lib/walkShare.js';

// Owner-only dynamic import so public and seller builds never query or bundle readiness.
const loadReadinessLib =
  import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller'
    ? null
    : () => Promise.all([import('../lib/readiness.js'), import('./ReadinessBadge.jsx')]);

const roomName = (k) => [...ROOMS, ...AREA_ROOMS].find(([x]) => x === k)?.[1] || k;

function useSigned(paths) {
  const [urls, setUrls] = useState({});
  const key = JSON.stringify(paths);
  useEffect(() => {
    let live = true;
    const list = JSON.parse(key);
    if (!list.length) { setUrls({}); return undefined; }
    supabase.storage.from(BUCKET).createSignedUrls(list, 3600).then(({ data }) => {
      if (live) setUrls(Object.fromEntries((data || []).filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl])));
    });
    return () => { live = false; };
  }, [key]);
  return urls;
}

// Under each video: its three still frames and what was said, made on the phone after the video saved.
export function VideoExtras({ video }) {
  const frames = Array.isArray(video?.frame_paths) ? video.frame_paths : [];
  const urls = useSigned(frames);
  const [open, setOpen] = useState(null);
  const status = video?.transcript_status;
  if (!frames.length && !video?.transcript && !status) return null;
  const shown = frames.filter((p) => urls[p]);
  return (
    <div className="space-y-2">
      {shown.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5" aria-label="Still frames from this video">
          {shown.map((p, i) => (
            <button key={p} type="button" onClick={() => setOpen(i)} className="cursor-zoom-in overflow-hidden rounded-lg">
              <img src={urls[p]} alt={['Start', 'Middle', 'End'][i] || 'Frame'} loading="lazy" className="aspect-video w-full object-cover" />
            </button>
          ))}
          <PhotoViewer items={shown.map((p, i) => ({ url: urls[p], alt: `${['Start', 'Middle', 'End'][i] || 'Frame'} of video` }))} index={open} onIndex={setOpen} />
        </div>
      )}
      {video?.transcript ? (
        <details className="rounded-lg bg-paper px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">View transcript</summary>
          <p className="mt-1 whitespace-pre-wrap">{video.transcript}</p>
        </details>
      ) : status === 'failed' ? (
        <p className="text-sm text-ink-soft">Transcript unavailable.</p>
      ) : null}
    </div>
  );
}

// Unit notes: owner, realtor and reviewer write their own; lenders read the owner's one-line overview.
function UnitNotes({ deal, me, role, unit, preview }) {
  const [rows, setRows] = useState(null);
  const [body, setBody] = useState('');
  const [overview, setOverview] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  const owner = role === 'owner';
  useEffect(() => {
    let live = true;
    supabase.from('commercial_unit_notes').select('*').eq('deal_id', deal.id).eq('unit_number', unit).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!live) return;
        const list = visibleUnitNotes(role, preview ? '' : me?.uid, data);
        setRows(error ? [] : list);
        setOverview(list.find((x) => x.kind === 'lender_overview')?.body || '');
      });
    return () => { live = false; };
  }, [deal.id, unit, n, role, me?.uid, preview]);

  const lenderLine = (rows || []).find((x) => x.kind === 'lender_overview');
  const notes = (rows || []).filter((x) => x.kind === 'note');
  const canWrite = canWriteUnitNotes(role) && !preview && Boolean(me?.uid);

  const add = async (e) => {
    e.preventDefault();
    if (!canWrite || busy || !body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('commercial_unit_notes').insert({ deal_id: deal.id, unit_number: unit, kind: 'note', body: body.trim(), author_uid: me.uid, author_role: role, author_name: me.name || '' });
    setBusy(false);
    setStatus(error ? 'Note not saved. Try again.' : 'Note saved.');
    if (!error) { setBody(''); setN((x) => x + 1); }
  };
  const saveOverview = async () => {
    if (!owner || preview || busy) return;
    setBusy(true);
    const text = overview.trim();
    let error = null;
    if (lenderLine && text) error = (await supabase.from('commercial_unit_notes').update({ body: text, updated_at: new Date().toISOString() }).eq('id', lenderLine.id)).error;
    else if (lenderLine && !text) error = (await supabase.from('commercial_unit_notes').delete().eq('id', lenderLine.id)).error;
    else if (text) error = (await supabase.from('commercial_unit_notes').insert({ deal_id: deal.id, unit_number: unit, kind: 'lender_overview', body: text, author_uid: me.uid, author_role: 'owner', author_name: me.name || '' })).error;
    setBusy(false);
    setStatus(error ? 'Lender overview not saved.' : 'Lender overview saved.');
    if (!error) setN((x) => x + 1);
  };
  const remove = async (row) => {
    if (busy || !window.confirm('Delete this note?')) return;
    setBusy(true);
    const { error } = await supabase.from('commercial_unit_notes').delete().eq('id', row.id);
    setBusy(false);
    setStatus(error ? 'Could not delete.' : 'Note deleted.');
    if (!error) setN((x) => x + 1);
  };

  if (role === 'lender') {
    return lenderLine ? <p className="rounded-xl bg-warm-soft px-4 py-3 text-base"><span className="font-semibold">Overview: </span>{lenderLine.body}</p> : null;
  }
  if (!canWriteUnitNotes(role)) return null;
  return (
    <div className="space-y-3 rounded-2xl bg-paper p-4">
      <h3 className="text-lg font-semibold">Notes on {spaceLabel(unit)}</h3>
      {owner && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">One line for lenders
            <input value={overview} disabled={preview} maxLength={300} onChange={(e) => setOverview(e.target.value)} placeholder="e.g. Rented, updated kitchen, new water heater"
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2" />
          </label>
          <Button type="button" kind="secondary" disabled={preview || busy} onClick={saveOverview}>Save lender line</Button>
        </div>
      )}
      {rows === null ? <Empty>Loading…</Empty> : notes.length === 0 ? <Empty>No notes on this unit yet.</Empty> : (
        <ul className="space-y-2">
          {notes.map((x) => (
            <li key={x.id} className="rounded-xl bg-white px-3 py-2">
              <p className="whitespace-pre-wrap text-base">{x.body}</p>
              <p className="mt-1 flex flex-wrap justify-between gap-2 text-sm text-ink-soft">
                <InfoTip label="Who wrote this and when" lines={[`${authorLabel(x)} · ${when(x.created_at)}`]} />
                {!preview && (owner || x.author_uid === me?.uid) && <button type="button" onClick={() => remove(x)} className="underline hover:text-red-700">Delete</button>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={add} className="space-y-2">
          <DictatedField as="textarea" rows={2} aria-label={`Note on ${spaceLabel(unit)}`} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="What you noticed in this unit…" className="w-full rounded-xl border border-line bg-white px-3 py-2" />
          <Button type="submit" disabled={busy || !body.trim()}>Add note</Button>
        </form>
      )}
      {status && <p role="status" className="text-sm text-ink-soft">{status}</p>}
    </div>
  );
}

export function UnitSummary({ unit, summary }) {
  if (!summary) return null;
  const status = summary.occupied ? 'Rented' : 'Vacant';
  const note = String(summary.note || '').trim();
  return (
    <div className="mt-4 rounded-xl bg-paper px-3.5 py-2.5 text-sm text-ink">
      <div className="font-medium">
        Unit {summary.id || unit} · Repair budget: {money(summary.repairs)} · {status}
      </div>
      {note && <div className="mt-0.5 text-ink-soft">{note}</div>}
    </div>
  );
}

// Walkthrough photos and videos, one unit or space at a time. The owner shares each one here the same way as in the Walkthrough.
export default function UnitGallery({ deal, me, role, preview, unitSummaries = null, snapshotPhotos = null }) {
  const [photos, setPhotos] = useState(snapshotPhotos);
  const [videos, setVideos] = useState(snapshotPhotos !== null ? [] : null);
  const [unit, setUnit] = useState(1);
  const [view, setView] = useState(null);
  const [err, setErr] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const canShare = role === 'owner' && !preview;
  const [readinessState, setReadinessState] = useState({ lib: null, Badge: null, map: {} });
  const canReadiness = Boolean(loadReadinessLib && role === 'owner' && !preview && canAccessDealPlan(SITE_KIND, role, preview));

  useEffect(() => {
    if (snapshotPhotos !== null) {
      setPhotos(snapshotPhotos);
      setVideos([]);
      setErr('');
      return undefined;
    }
    let live = true;
    Promise.all([
      supabase.from('commercial_walkthrough_photos').select(`id,unit_number,room,storage_path,author_role,author_name,created_at${role === 'owner' ? ',share_seller,share_lender' : ''}`).eq('deal_id', deal.id).order('created_at'),
      supabase.from('commercial_walkthrough_videos').select('*').eq('deal_id', deal.id).order('created_at'),
    ]).then(([p, v]) => {
      if (!live) return;
      setPhotos(p.data || []);
      setVideos(v.data || []);
      setErr(p.error || v.error ? 'Photos could not load. Refresh to try again.' : '');
    });
    return () => { live = false; };
  }, [deal.id, snapshotPhotos]);

  useEffect(() => {
    let live = true;
    if (!canReadiness || !loadReadinessLib) return () => { live = false; };
    loadReadinessLib().then(async ([lib, mod]) => {
      const map = await lib.loadReadinessMap(supabase, deal.id);
      if (live) setReadinessState({ lib, Badge: mod.default, map });
    }).catch(() => {});
    return () => { live = false; };
  }, [deal.id, canReadiness]);

  const updateReadiness = async (unitNumber, label) => {
    if (!canReadiness || !readinessState.lib || !me?.uid) return;
    const { data, error } = await readinessState.lib.saveUnitReadiness(supabase, {
      dealId: deal.id,
      unitNumber,
      label,
      existingRow: readinessState.map[unitNumber],
      uid: me.uid,
      name: me.name,
    });
    if (!error && data) {
      setReadinessState((prev) => ({ ...prev, map: { ...prev.map, [unitNumber]: data } }));
    }
  };

  const toggleShare = async (row, field, kind = 'photo') => {
    if (!canShare || shareBusy || !row) return;
    const next = !row[field];
    const setRows = kind === 'video' ? setVideos : setPhotos;
    setShareBusy(true);
    setRows((rows) => (rows || []).map((x) => (x.id === row.id ? { ...x, [field]: next } : x)));
    const error = await saveWalkShare(supabase, deal.id, row, field, next, kind);
    if (error) {
      setRows((rows) => (rows || []).map((x) => (x.id === row.id ? { ...x, [field]: !next } : x)));
      setErr('Sharing did not save. Try again.');
    }
    setShareBusy(false);
  };
  const shareBoxes = (row, kind) => (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 py-1.5 text-xs">
      {WALK_SHARES.map(([field, , , label]) => (
        <label key={field} className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" disabled={shareBusy} checked={Boolean(row[field])} onChange={() => void toggleShare(row, field, kind)} />{label}</label>
      ))}
    </div>
  );

  const counts = useMemo(() => {
    const c = {};
    for (const x of [...(photos || []), ...(videos || [])]) c[x.unit_number] = (c[x.unit_number] || 0) + 1;
    return c;
  }, [photos, videos]);
  const unitPhotos = (photos || []).filter((p) => p.unit_number === unit);
  const unitVideos = (videos || []).filter((v) => v.unit_number === unit);
  const signedUrls = useSigned(snapshotPhotos === null ? [...unitPhotos.map((p) => p.storage_path), ...unitVideos.map((v) => v.storage_path)] : []);
  const urls = useMemo(() => {
    if (snapshotPhotos === null) return signedUrls;
    const map = {};
    for (const p of unitPhotos) if (p.url && p.storage_path) map[p.storage_path] = p.url;
    return map;
  }, [snapshotPhotos, signedUrls, unitPhotos]);
  const loaded = unitPhotos.filter((p) => urls[p.storage_path]);
  const rooms = [...new Set(loaded.map((p) => p.room))];
  // Viewer order matches the screen: room by room.
  const ready = rooms.flatMap((r) => loaded.filter((p) => p.room === r));

  useEffect(() => { setView(null); }, [unit]);
  const RBadge = readinessState.Badge;
  const unitSummary = unit <= WALK_UNITS && Array.isArray(unitSummaries)
    ? unitSummaries.find((s) => String(s?.id) === String(unit)) || null
    : null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold">Photos by unit</h2>
          {RBadge && unit <= WALK_UNITS && (
            <RBadge
              unitNumber={unit}
              label={readinessState.map[unit]?.body || 'Not entered'}
              editable
              onSave={updateReadiness}
            />
          )}
        </div>
        {err && <p role="alert" className="mb-3 text-sm text-red-700">{err}</p>}
        <nav aria-label="Units and spaces" className="nav-tabs -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1.5">
          {WALK_SPACES.map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${unit === u ? 'bg-ink text-white' : 'border border-line bg-white text-ink hover:border-ink'}`}>
              <span>{spaceLabel(u)}</span>
              {RBadge && u <= WALK_UNITS && readinessState.map[u]?.body && (
                <RBadge unitNumber={u} label={readinessState.map[u].body} compact />
              )}
              {counts[u] ? <span className={`rounded-full px-1.5 text-xs ${unit === u ? 'bg-white/20' : 'bg-warm-soft'}`}>{counts[u]}</span> : null}
            </button>
          ))}
        </nav>

        {photos === null ? <Empty>Loading…</Empty> : !unitPhotos.length && !unitVideos.length ? (
          <p className="rounded-xl bg-paper px-4 py-6 text-center text-base text-ink-soft">No photos or videos for {spaceLabel(unit)} yet.</p>
        ) : (
          <div className="space-y-5">
            {rooms.map((room) => (
              <section key={room}>
                <h3 className="mb-2 text-base font-semibold">{room === 'general' ? spaceLabel(unit) : roomName(room)}</h3>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {ready.filter((p) => p.room === room).map((p) => {
                    const j = ready.indexOf(p);
                    return (
                      <li key={p.id} className="overflow-hidden rounded-xl">
                        <div className="group relative">
                          <button type="button" onClick={() => setView(j)} aria-label={`Open photo ${j + 1}`} className="block w-full cursor-zoom-in">
                            <img src={urls[p.storage_path]} alt={`${spaceLabel(unit)} ${roomName(room)}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                          </button>
                          <ThumbOverlay buttons={[{ key: 'open', icon: '⤢', label: 'Open', onClick: () => setView(j) }, ...(canShare ? walkShareButtons(p, toggleShare, shareBusy) : [])]} />
                        </div>
                        {canShare && shareBoxes(p, 'photo')}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {unitVideos.length > 0 && (
              <section>
                <h3 className="mb-2 text-base font-semibold">Videos</h3>
                <ul className="grid gap-4 md:grid-cols-2">
                  {unitVideos.map((v) => (
                    <li key={v.id} className="space-y-2">
                      {urls[v.storage_path]
                        ? <video src={urls[v.storage_path]} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-black" />
                        : <div className="flex aspect-video items-center justify-center rounded-xl bg-paper text-sm text-ink-soft">Loading video…</div>}
                      <div className="flex items-center gap-2"><span className="text-sm text-ink">{roomName(v.room)}</span><InfoTip label="Video details" lines={[`${authorLabel(v)} · ${when(v.created_at)}`]} /></div>
                      {canShare && shareBoxes(v, 'video')}
                      <VideoExtras video={v} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        <PhotoViewer items={ready.map((p) => ({ url: urls[p.storage_path], alt: `${spaceLabel(unit)} ${roomName(p.room)}` }))} index={view} onIndex={setView}
          actions={canShare ? (_, j) => (ready[j] ? walkShareButtons(ready[j], toggleShare, shareBusy) : []) : undefined} />
        <UnitSummary unit={unit} summary={unitSummary} />
      </Card>
      {snapshotPhotos === null && <UnitNotes deal={deal} me={me} role={role} unit={unit} preview={preview} />}
    </div>
  );
}
