import { useEffect, useMemo, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase.js';
import { ROOMS, unitCount, v5Access } from '../lib/leaseUp.js';
import { when, roleLabel } from '../lib/format.js';
import { Button, Card, CardTitle, Empty } from '../components/Shell.jsx';
import { DictationMic } from '../components/Dictation.jsx';

const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
const MAX_BYTES = 20 * 1024 * 1024;
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const voiceExt = (type) => (type?.includes('mp4') ? 'm4a' : type?.includes('ogg') ? 'ogg' : type?.includes('wav') ? 'wav' : 'webm');
const storagePathFor = (dealId, uid, ext) => `commercial-v5/${dealId}/walkthrough/${uid}/${crypto.randomUUID()}.${ext}`;
const roomLabel = (key) => ROOMS.find(([k]) => k === key)?.[1] || key;
const authorTag = (row) => {
  const role = roleLabel[row.author_role] || row.author_role;
  return row.author_name && row.author_name.toLowerCase() !== role.toLowerCase()
    ? `${row.author_name} (${role})`
    : role;
};

function useSignedUrls(paths) {
  const [urls, setUrls] = useState({});
  const key = JSON.stringify(paths);
  useEffect(() => {
    let active = true;
    const list = JSON.parse(key);
    if (!list.length) { setUrls({}); return; }
    const load = () => supabase.storage.from(BUCKET).createSignedUrls(list, 900).then(({ data }) => {
      if (active) setUrls(Object.fromEntries((data || []).map((r) => [r.path, r.signedUrl])));
    });
    void load();
    const t = setInterval(load, 13 * 60_000);
    return () => { active = false; clearInterval(t); };
  }, [key]);
  return urls;
}

export default function Walkthrough({ deal, me, role, preview }) {
  const access = v5Access(role);
  const edit = access.editWalkthrough && !preview;
  const [units, setUnits] = useState(9);
  const [selectedUnit, setSelectedUnit] = useState(1);
  const [selectedRoom, setSelectedRoom] = useState(ROOMS[0][0]);
  const [photos, setPhotos] = useState(null);
  const [notes, setNotes] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [noteDraft, setNoteDraft] = useState(null); // { text, audio }
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!access.walkthrough) return;
    let live = true;
    Promise.all([
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('commercial_walkthrough_photos').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
      supabase.from('commercial_walkthrough_notes').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
    ]).then(([m, p, n]) => {
      if (!live) return;
      setUnits(unitCount(m.data?.base?.units));
      setPhotos(p.data || []);
      setNotes(n.data || []);
      setLoadErr(p.error || n.error ? 'Walkthrough could not load. Refresh to try again.' : '');
    });
    return () => { live = false; };
  }, [deal.id, access.walkthrough, refresh]);

  const unit = Math.min(selectedUnit, units);
  const roomPhotos = useMemo(
    () => (photos || []).filter((x) => x.unit_number === unit && x.room === selectedRoom),
    [photos, unit, selectedRoom]
  );
  const roomNotes = useMemo(
    () => (notes || []).filter((x) => x.unit_number === unit && x.room === selectedRoom),
    [notes, unit, selectedRoom]
  );

  const signedPaths = useMemo(
    () => [...roomPhotos.map((p) => p.storage_path), ...roomNotes.map((n) => n.storage_path).filter(Boolean)],
    [roomPhotos, roomNotes]
  );
  const urls = useSignedUrls(signedPaths);

  const counts = useMemo(() => {
    const map = {};
    for (const p of photos || []) {
      const k = `${p.unit_number}:${p.room}`;
      map[k] = map[k] || { p: 0, n: 0 };
      map[k].p++;
    }
    for (const n of notes || []) {
      const k = `${n.unit_number}:${n.room}`;
      map[k] = map[k] || { p: 0, n: 0 };
      map[k].n++;
    }
    return map;
  }, [photos, notes]);

  if (!access.walkthrough) return null;

  const totalRooms = units * ROOMS.length;
  const startedRooms = range(units).reduce(
    (sum, u) => sum + ROOMS.filter(([r]) => (counts[`${u}:${r}`]?.p || 0) + (counts[`${u}:${r}`]?.n || 0) > 0).length,
    0
  );

  const uploadPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!edit || !files.length || busy) return;
    setBusy(true);
    setStatus('');
    let saved = 0;
    const errs = [];
    try {
      for (const f of files) {
        const extFromName = (f.name || '').split('.').pop()?.toLowerCase();
        const ext = PHOTO_EXT[f.type] || (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(extFromName) ? extFromName : null);
        if (!ext || !f.size || f.size > MAX_BYTES) {
          errs.push('Use JPEG, PNG, WebP or HEIC under 20 MB.');
          continue;
        }
        const path = storagePathFor(deal.id, me.uid, ext === 'jpeg' ? 'jpg' : ext);
        const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg' });
        if (up.error) { errs.push('A photo could not upload.'); continue; }
        const ins = await supabase.from('commercial_walkthrough_photos').insert({
          deal_id: deal.id,
          unit_number: unit,
          room: selectedRoom,
          storage_path: path,
          author_uid: me.uid,
          author_role: role,
          author_name: me.name || roleLabel[role],
        });
        if (ins.error) {
          await supabase.storage.from(BUCKET).remove([path]);
          errs.push('A photo record could not save.');
          continue;
        }
        saved++;
      }
    } catch {
      errs.push('Upload interrupted.');
    } finally {
      setBusy(false);
      setRefresh((x) => x + 1);
      setStatus([saved ? `${saved} photo${saved === 1 ? '' : 's'} saved.` : '', ...new Set(errs)].filter(Boolean).join(' '));
    }
  };

  const removePhoto = async (p) => {
    if (!edit || busy || !window.confirm('Remove this photo?')) return;
    setBusy(true);
    setStatus('');
    try {
      await supabase.storage.from(BUCKET).remove([p.storage_path]);
      const { error } = await supabase.from('commercial_walkthrough_photos').delete().eq('id', p.id).eq('deal_id', deal.id);
      setStatus(error ? 'Photo could not be removed.' : 'Photo removed.');
    } catch {
      setStatus('Photo could not be removed.');
    } finally {
      setBusy(false);
      setRefresh((x) => x + 1);
    }
  };

  const saveVoiceNote = async () => {
    if (!edit || busy || !noteDraft?.text?.trim()) return;
    setBusy(true);
    setStatus('');
    let uploadedPath = null;
    try {
      if (noteDraft.audio && noteDraft.audio.size > 0 && noteDraft.audio.size <= MAX_BYTES) {
        const path = storagePathFor(deal.id, me.uid, voiceExt(noteDraft.audio.type));
        const up = await supabase.storage.from(BUCKET).upload(path, noteDraft.audio, {
          contentType: (noteDraft.audio.type || 'audio/webm').split(';')[0],
        });
        if (!up.error) uploadedPath = path;
      }
      const { error } = await supabase.from('commercial_walkthrough_notes').insert({
        deal_id: deal.id,
        unit_number: unit,
        room: selectedRoom,
        raw_transcript: noteDraft.text.trim(),
        storage_path: uploadedPath,
        author_uid: me.uid,
        author_role: role,
        author_name: me.name || roleLabel[role],
      });
      if (error) {
        if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath]);
        setStatus('Voice note could not save. Try again.');
        return;
      }
      setNoteDraft(null);
      setStatus('Voice note saved.');
      setRefresh((x) => x + 1);
    } catch {
      setStatus('Voice note could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeNote = async (n) => {
    if (!edit || busy || !window.confirm('Remove this voice note?')) return;
    setBusy(true);
    setStatus('');
    try {
      if (n.storage_path) await supabase.storage.from(BUCKET).remove([n.storage_path]);
      const { error } = await supabase.from('commercial_walkthrough_notes').delete().eq('id', n.id).eq('deal_id', deal.id);
      setStatus(error ? 'Voice note could not be removed.' : 'Voice note removed.');
    } catch {
      setStatus('Voice note could not be removed.');
    } finally {
      setBusy(false);
      setRefresh((x) => x + 1);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="!p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-semibold">Walkthrough inventory</h2>
          <p className="text-xs text-ink-soft">
            {startedRooms}/{totalRooms} rooms · {(photos || []).length} photos · {(notes || []).length} voice notes
          </p>
        </div>
        {loadErr && <p role="alert" className="mb-3 text-sm text-red-700">{loadErr}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] border-separate border-spacing-1 text-left text-xs">
            <thead>
              <tr>
                <th className="w-16 px-2 py-1 font-medium text-ink-soft">Unit</th>
                {ROOMS.map(([r, label]) => (
                  <th key={r} className="px-2 py-1 font-medium text-ink-soft">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {range(units).map((u) => (
                <tr key={u}>
                  <th className="px-2 py-1 font-semibold text-ink">Unit {u}</th>
                  {ROOMS.map(([r, label]) => {
                    const c = counts[`${u}:${r}`] || { p: 0, n: 0 };
                    const active = u === unit && r === selectedRoom;
                    const empty = c.p === 0 && c.n === 0;
                    return (
                      <td key={r}>
                        <button
                          type="button"
                          aria-label={`Unit ${u} ${label}: ${c.p} photos, ${c.n} voice notes`}
                          aria-pressed={active}
                          onClick={() => { setSelectedUnit(u); setSelectedRoom(r); setNoteDraft(null); setStatus(''); }}
                          className={`w-full rounded-lg border px-2 py-1.5 text-center transition ${
                            active
                              ? 'border-ink bg-ink font-medium text-white'
                              : empty
                                ? 'border-dashed border-line bg-paper text-ink-soft hover:border-ink'
                                : 'border-line bg-warm-soft/70 font-medium text-ink hover:border-ink'
                          }`}
                        >
                          {empty ? '—' : `${c.p}p · ${c.n}n`}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle aside={<span className="text-xs text-ink-soft">Photos and voice notes only · owner + realtor</span>}>
          Unit {unit} — {roomLabel(selectedRoom)}
        </CardTitle>
        {preview && <p className="mb-3 text-xs text-ink-soft">Preview mode. Adding photos and voice notes works on a real sign-in.</p>}
        {status && <p role="status" className="mb-3 text-sm text-ink-soft">{status}</p>}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Photos ({roomPhotos.length})</h3>
              {edit && (
                <div className="flex flex-wrap gap-2">
                  <label className="cursor-pointer rounded-xl bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-soft">
                    Take photo
                    <input
                      aria-label={`Take photo for Unit ${unit} ${roomLabel(selectedRoom)}`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={busy}
                      onChange={uploadPhotos}
                      className="sr-only"
                    />
                  </label>
                  <label className="cursor-pointer rounded-xl border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-warm-soft">
                    Upload photos
                    <input
                      aria-label={`Upload photos for Unit ${unit} ${roomLabel(selectedRoom)}`}
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={busy}
                      onChange={uploadPhotos}
                      className="sr-only"
                    />
                  </label>
                </div>
              )}
            </div>
            {photos === null ? (
              <Empty>Loading…</Empty>
            ) : roomPhotos.length === 0 ? (
              <Empty>No photos for this room yet.</Empty>
            ) : (
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {roomPhotos.map((p, i) => (
                  <li key={p.id} className="overflow-hidden rounded-xl border border-line bg-white">
                    {urls[p.storage_path] ? (
                      <a href={urls[p.storage_path]} target="_blank" rel="noreferrer">
                        <img
                          src={urls[p.storage_path]}
                          alt={`Unit ${unit} ${roomLabel(selectedRoom)} photo ${i + 1}`}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover"
                        />
                      </a>
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-paper text-xs text-ink-soft">Loading…</div>
                    )}
                    <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs text-ink-soft">
                      <span className="truncate">{authorTag(p)}</span>
                      {edit && (role === 'owner' || p.author_uid === me.uid) && (
                        <button type="button" disabled={busy} onClick={() => removePhoto(p)} className="shrink-0 underline hover:text-red-700">
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Voice notes ({roomNotes.length})</h3>
              {edit && (
                <div className="flex flex-wrap items-center gap-2">
                  <DictationMic
                    label={`Unit ${unit} ${roomLabel(selectedRoom)} voice note`}
                    buttonText="Record voice note"
                    disabled={busy}
                    onText={(text, audio) => {
                      setNoteDraft({ text, audio });
                      setStatus('');
                    }}
                  />
                </div>
              )}
            </div>

            {edit && noteDraft && (
              <div className="space-y-2 rounded-xl border border-warm bg-paper p-3">
                <p className="text-xs font-medium text-ink">Raw transcript (edit if needed, then save)</p>
                <textarea
                  aria-label="Voice note transcript"
                  rows={3}
                  maxLength={12000}
                  value={noteDraft.text}
                  onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busy || !noteDraft.text.trim()} onClick={saveVoiceNote}>Save voice note</Button>
                  <Button type="button" kind="secondary" disabled={busy} onClick={() => setNoteDraft(null)}>Discard</Button>
                </div>
              </div>
            )}

            {notes === null ? (
              <Empty>Loading…</Empty>
            ) : roomNotes.length === 0 ? (
              <Empty>No voice notes for this room yet.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {roomNotes.map((n) => (
                  <li key={n.id} className="space-y-2 rounded-xl border border-line bg-paper p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                      <span className="font-medium text-ink">{authorTag(n)} · {when(n.created_at)}</span>
                      {edit && (role === 'owner' || n.author_uid === me.uid) && (
                        <button type="button" disabled={busy} onClick={() => removeNote(n)} className="underline hover:text-red-700">
                          Remove
                        </button>
                      )}
                    </div>
                    {n.storage_path && urls[n.storage_path] && (
                      <audio src={urls[n.storage_path]} controls preload="none" className="h-9 w-full" aria-label="Voice note audio" />
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm">{n.raw_transcript}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
