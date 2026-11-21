import { useEffect, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase.js';
import { when, bytes, roleLabel } from '../lib/format.js';
import { Card, CardTitle, Button, Empty } from './Shell.jsx';

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
    const sub = supabase.channel(`u-${deal.id}`)
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
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Add a note (optional)"
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink" />
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft">
          {uploading ? 'Uploading…' : label}<input aria-label={label} type="file" multiple accept={accept} className="sr-only" disabled={preview || uploading} onChange={pick} />
        </label>
        {allowShare && (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Seller can see
          </label>
        )}
      </div>
      {preview && <p className="text-sm">Read-only preview. Member sign-in is required to upload.</p>}
      {busy && <p role="status" className="text-sm text-ink-soft">{busy}</p>}
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

const AUD = [['reviewer', 'Reviewer'], ['lender', 'Lender'], ['viewer', 'Viewer']];

export function ShareChips({ r, onChange, owner }) {
  const set = async (patch) => { await supabase.from('commercial_uploads').update(patch).eq('id', r.id); onChange?.(); };
  const chip = (on, label, fn) => (
    <button key={label} onClick={fn} className={`rounded-full px-2.5 py-1 text-xs font-medium ${on ? 'bg-good/10 text-good' : 'bg-warm-soft text-ink-soft'}`}>{on ? '✓ ' : ''}{label}</button>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {chip(r.visibility === 'seller', 'Seller', () => set({ visibility: r.visibility === 'seller' ? 'team' : 'seller' }))}
      {owner && AUD.map(([k, l]) => chip((r.audience || []).includes(k), l, () => set({ audience: (r.audience || []).includes(k) ? r.audience.filter((x) => x !== k) : [...(r.audience || []), k] })))}
    </div>
  );
}

export function FileList({ rows, canShare, owner, onChange }) {
  if (!rows) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>Nothing uploaded yet.</Empty>;
  const remove = async (r) => {
    if (!window.confirm(`Delete ${r.file_name}?`)) return;
    await supabase.from('commercial_uploads').delete().eq('id', r.id);
    onChange?.();
  };
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
          {r.kind === 'photo' && r.url
            ? <img src={r.url} alt="" className="h-12 w-12 rounded-lg object-cover" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-warm-soft text-xs font-medium">DOC</span>}
          <div className="min-w-0 flex-1">
            <a href={r.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">{r.file_name}</a>
            <p className="text-xs text-ink-soft">{roleLabel[r.uploaded_by_role]} · {when(r.created_at)} · {bytes(r.size_bytes)}{r.note ? ` · ${r.note}` : ''}</p>
          </div>
          {canShare && <ShareChips r={r} owner={owner} onChange={onChange} />}
          {owner && <button onClick={() => remove(r)} className="text-xs text-ink-soft hover:text-red-700">Delete</button>}
        </li>
      ))}
    </ul>
  );
}

export function PhotoGrid({ rows }) {
  const photos = (rows || []).filter((r) => r.kind === 'photo' && r.url);
  if (!photos.length) return <Empty>Photos will appear here.</Empty>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p) => (
        <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-xl border border-line">
          <img src={p.url} alt={p.note || 'Property photo'} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" />
          {p.note && <p className="px-3 py-2 text-xs text-ink-soft">{p.note}</p>}
        </a>
      ))}
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
