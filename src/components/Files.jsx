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

export function Uploader({ deal, role, me, onDone, label = 'Upload files', allowShare }) {
  const [busy, setBusy] = useState('');
  const [share, setShare] = useState(false);
  const [note, setNote] = useState('');

  const pick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      if (f.size > MAX) { setBusy(`${f.name} is over 20 MB.`); continue; }
      setBusy(`Uploading ${f.name}…`);
      const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
      const path = `${deal.id}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) { setBusy(`${f.name} didn’t upload. Try again.`); continue; }
      const { error } = await supabase.from('commercial_uploads').insert({
        deal_id: deal.id, storage_path: path, file_name: f.name.slice(0, 200), mime: f.type || 'application/octet-stream',
        size_bytes: f.size, kind: f.type.startsWith('image/') ? 'photo' : 'document',
        visibility: allowShare && share ? 'seller' : 'team', note: note.slice(0, 500), uploaded_by_email: me.email, uploaded_by_role: role,
      });
      if (error) { setBusy(`${f.name} didn’t save. Try again.`); continue; }
      setBusy('');
    }
    setNote('');
    onDone?.();
  };

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-line bg-paper p-4">
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Add a note (optional)"
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink" />
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft">
          {label}<input type="file" multiple accept={ACCEPT} className="hidden" onChange={pick} />
        </label>
        {allowShare && (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Show to seller
          </label>
        )}
      </div>
      {busy && <p className="text-sm text-ink-soft">{busy}</p>}
    </div>
  );
}

export function FileList({ rows, canShare, onChange }) {
  if (!rows) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>Nothing uploaded yet.</Empty>;
  const toggle = async (r) => {
    await supabase.from('commercial_uploads').update({ visibility: r.visibility === 'seller' ? 'team' : 'seller' }).eq('id', r.id);
    onChange?.();
  };
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3">
          {r.kind === 'photo' && r.url
            ? <img src={r.url} alt="" className="h-12 w-12 rounded-lg object-cover" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-warm-soft text-xs font-medium">DOC</span>}
          <div className="min-w-0 flex-1">
            <a href={r.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">{r.file_name}</a>
            <p className="text-xs text-ink-soft">{roleLabel[r.uploaded_by_role]} · {when(r.created_at)} · {bytes(r.size_bytes)}{r.note ? ` · ${r.note}` : ''}</p>
          </div>
          {canShare && (
            <button onClick={() => toggle(r)} className={`rounded-full px-3 py-1 text-xs font-medium ${r.visibility === 'seller' ? 'bg-good/10 text-good' : 'bg-warm-soft text-ink-soft'}`}>
              {r.visibility === 'seller' ? 'Seller can see' : 'Team only'}
            </button>
          )}
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

export default function Files({ deal, role, me, title = 'Files', canShare, allowShare, readOnly }) {
  const [rows, load] = useUploads(deal);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {!readOnly && <Uploader deal={deal} role={role} me={me} onDone={load} allowShare={allowShare} />}
      <div className="mt-4"><FileList rows={rows} canShare={canShare} onChange={load} /></div>
    </Card>
  );
}
