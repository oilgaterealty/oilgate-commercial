import { DictatedField } from './Dictation.jsx';
import { useEffect, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase.js';
import { when, bytes, roleLabel } from '../lib/format.js';
import { Card, CardTitle, Button, Empty, InfoTip } from './Shell.jsx';
import PhotoViewer, { ThumbOverlay } from './PhotoViewer.jsx';
import { seenByLabel } from '../lib/v63.js';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';
const MAX = 20 * 1024 * 1024;

export function useUploads(deal) {
  const [rows, setRows] = useState(null);
  const load = async () => {
    const { data } = await supabase.from('commercial_uploads').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false });
    const list = data || [];
    if (list.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(list.map((r) => r.storage_path), 3600);
      const map = Object.fromEntries((signed || []).map((s) => [s.path, s.signedUrl]));
      list.forEach((r) => { r.url = map[r.storage_path]; });
    }
    setRows(list);
  };
  useEffect(() => {
    load();
    const sub = supabase.channel(`${Math.random().toString(36).slice(2, 8)}-u-${deal.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commercial_uploads', filter: `deal_id=eq.${deal.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [deal.id]);
  return [rows, load];
}

export function Uploader({ deal, role, me, onDone, label = 'Upload files', allowShare, preview, accept = ACCEPT, hint }) {
  const [busy, setBusy] = useState('');
  const [share, setShare] = useState(false);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);

  const pick = async (e) => {
    if (preview || uploading) return;
    const files = [...e.target.files];
    e.target.value = '';
    setUploading(true);
    const failures = [];
    let saved = 0;
    try {
    for (const f of files) {
      if (f.size > MAX || f.size === 0) { failures.push(`${f.name}: choose a nonempty file under 20 MB.`); continue; }
      setBusy(`Uploading ${f.name}…`);
      const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
      const path = `${deal.id}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) { failures.push(`${f.name}: upload failed. Check your connection and retry.`); continue; }
      const { error } = await supabase.from('commercial_uploads').insert({
        deal_id: deal.id, storage_path: path, file_name: f.name.slice(0, 200), mime: f.type || 'application/octet-stream',
        size_bytes: f.size, kind: f.type.startsWith('image/') ? 'photo' : 'document',
        visibility: allowShare && share ? 'seller' : 'team', note: note.slice(0, 500), uploaded_by_email: me.email, uploaded_by_role: role,
      });
      if (error) { failures.push(`${f.name}: file record could not save. Please retry.`); continue; }
      saved++;
    }
    if (!failures.length) setNote('');
    await onDone?.();
    } catch { failures.push('Connection interrupted. Please retry unsaved files.'); }
    finally { setUploading(false); setBusy([saved ? `${saved} file${saved === 1 ? '' : 's'} uploaded.` : '', ...failures].filter(Boolean).join(' ')); }
  };

  return (
    <div className={`space-y-3 rounded-xl border border-dashed border-line bg-paper p-4 ${preview ? 'pointer-events-none opacity-70' : ''}`}>
      <DictatedField value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Add a note (optional)"
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink" />
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft">
          {uploading ? 'Uploading…' : label}<input aria-label={label} type="file" multiple accept={accept} className="sr-only" disabled={preview || uploading} onChange={pick} />
        </label>
        {allowShare && (
          <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="h-5 w-5 rounded border-line accent-ink" /> Seller can see
          </label>
        )}
      </div>
      {preview && <p className="text-sm">Read-only preview. Member sign-in is required to upload.</p>}
      {busy && <p role="status" className="text-sm text-ink">{busy}</p>}
      {hint && <InfoTip label="Upload tips" lines={[hint]} />}
    </div>
  );
}

const AUD = [['realtor', 'Realtor'], ['reviewer', 'Reviewer'], ['lender', 'Lender'], ['viewer', 'Viewer']];

export function toggleAudience(r, k) {
  const current = Array.isArray(r?.audience) ? r.audience : [];
  return { audience: current.includes(k) ? current.filter((x) => x !== k) : [...current, k] };
}

export async function setUpload(r, patch, onChange, onError, client = supabase) {
  try {
    const { error } = await client.from('commercial_uploads').update(patch).eq('id', r.id);
    if (error) {
      const msg = `Could not save sharing change${error.message ? `: ${error.message}` : '.'}`;
      if (onError) onError(msg, error);
      else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(msg);
      return { ok: false, error: msg };
    }
    onError?.('');
    await onChange?.();
    return { ok: true, error: '' };
  } catch (err) {
    const msg = `Could not save sharing change${err?.message ? `: ${err.message}` : '.'}`;
    if (onError) onError(msg, err);
    else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(msg);
    return { ok: false, error: msg };
  }
}

// Share toggles for one uploaded photo, as overlay / viewer buttons. Same updates as ShareChips:
// "Seller" for anyone who can share; "Realtor" and "Lender" only for the owner.
export function uploadShareButtons(r, owner, onChange, onError) {
  const list = [{ key: 'seller', icon: 'S', label: 'Share with seller', pressed: r.visibility === 'seller', onClick: () => void setUpload(r, { visibility: r.visibility === 'seller' ? 'team' : 'seller' }, onChange, onError) }];
  if (owner) list.push({ key: 'realtor', icon: 'R', label: 'Share with realtor', pressed: (r.audience || []).includes('realtor'), onClick: () => void setUpload(r, toggleAudience(r, 'realtor'), onChange, onError) });
  if (owner) list.push({ key: 'lender', icon: 'L', label: 'Share with lender', pressed: (r.audience || []).includes('lender'), onClick: () => void setUpload(r, toggleAudience(r, 'lender'), onChange, onError) });
  return list;
}

export function ShareChips({ r, onChange, owner }) {
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = async (patch) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await setUpload(r, patch, onChange, (msg) => setSaveError(msg));
    } finally {
      setSaving(false);
    }
  };
  const chip = (on, label, fn) => (
    <button key={label} type="button" disabled={saving} aria-pressed={on} onClick={fn}
      className={`min-h-[40px] rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${on ? 'bg-good/10 text-good' : 'bg-warm-soft text-ink-soft'}`}>{on ? '✓ ' : ''}{label}</button>
  );
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {chip(r.visibility === 'seller', 'Seller', () => set({ visibility: r.visibility === 'seller' ? 'team' : 'seller' }))}
        {owner && AUD.map(([k, l]) => chip((r.audience || []).includes(k), l, () => set(toggleAudience(r, k))))}
      </div>
      {saveError && <p role="alert" className="text-xs font-medium text-red-700">{saveError}</p>}
    </div>
  );
}

export function FileList({ rows, canShare, owner, onChange }) {
  const [view, setView] = useState(null);
  if (!rows) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>Nothing uploaded yet.</Empty>;
  const remove = async (r) => {
    if (!window.confirm(`Delete ${r.file_name}?`)) return;
    if (r.storage_path) {
      const { error } = await supabase.storage.from(BUCKET).remove([r.storage_path]);
      if (error) { window.alert(`${r.file_name} could not be deleted. Try again.`); return; }
    }
    const { error } = await supabase.from('commercial_uploads').delete().eq('id', r.id);
    if (error) window.alert(`${r.file_name} was only partly deleted. Try again.`);
    onChange?.();
  };
  // Photos open in the in-app viewer; documents (PDF, Word, Excel) still open in a new tab.
  const pics = rows.filter((r) => r.kind === 'photo' && r.url);
  const open = (r) => setView(pics.indexOf(r));
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
          {r.kind === 'photo' && r.url
            ? <button type="button" onClick={() => open(r)} aria-label={`Open ${r.file_name}`} className="shrink-0 cursor-zoom-in"><img src={r.url} alt="" className="h-12 w-12 rounded-lg object-cover" /></button>
            : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-warm-soft text-xs font-medium">DOC</span>}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {r.kind === 'photo' && r.url
              ? <button type="button" onClick={() => open(r)} className="block min-w-0 max-w-full truncate text-left text-sm font-medium hover:underline">{r.file_name}</button>
              : <a href={r.url} target="_blank" rel="noreferrer" className="block min-w-0 break-words text-sm font-medium underline-offset-2 hover:underline">{r.file_name}</a>}
            <InfoTip label={`Details for ${r.file_name}`} lines={[
              `${r.kind === 'photo' ? 'Photo' : 'Document'} · from ${roleLabel[r.uploaded_by_role] || 'the team'} · ${when(r.created_at)} · ${bytes(r.size_bytes)}`,
              r.note,
              (canShare || owner) ? seenByLabel(r) : null,
            ]} />
          </div>
          {canShare && <ShareChips r={r} owner={owner} onChange={onChange} />}
          {owner && <button onClick={() => remove(r)} className="inline-flex min-h-[40px] items-center px-1.5 text-xs text-ink-soft hover:text-red-700">Delete</button>}
        </li>
      ))}
      <PhotoViewer items={pics.map((r) => ({ url: r.url, alt: r.note || r.file_name }))} index={view} onIndex={setView} />
    </ul>
  );
}

export function PhotoGrid({ rows }) {
  const photos = (rows || []).filter((r) => r.kind === 'photo' && r.url);
  const [view, setView] = useState(null);
  if (!photos.length) return <Empty>Photos will appear here.</Empty>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p, j) => (
        <div key={p.id} className="overflow-hidden rounded-xl border border-line">
          <div className="group relative overflow-hidden">
            <button type="button" onClick={() => setView(j)} aria-label={`Open ${p.note || 'photo'}`} className="block w-full cursor-zoom-in text-left">
              <img src={p.url} alt={p.note || 'Property photo'} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" />
            </button>
            <ThumbOverlay buttons={[{ key: 'open', icon: '⤢', label: 'Open', onClick: () => setView(j) }]} />
          </div>
          {p.note && <div className="flex justify-end px-2 py-1.5"><InfoTip label="Photo note" lines={[p.note]} /></div>}
        </div>
      ))}
      <PhotoViewer items={photos.map((p) => ({ url: p.url, alt: p.note || 'Property photo' }))} index={view} onIndex={setView} />
    </div>
  );
}

export default function Files({ deal, role, me, title = 'Files', canShare, allowShare, readOnly, preview, only }) {
  const [rows, load] = useUploads(deal);
  const list = rows && (only ? rows.filter((r) => r.kind === only) : rows);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {!readOnly && <Uploader deal={deal} role={role} me={me} onDone={load} allowShare={allowShare} preview={preview} />}
      <div className="mt-4"><FileList rows={list} canShare={canShare && !preview} owner={role === 'owner' && !preview} onChange={load} /></div>
    </Card>
  );
}
