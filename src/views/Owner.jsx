import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when, roleLabel } from '../lib/format.js';
import { Card, CardTitle, Button, Field, Empty, Tabs } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import Files from '../components/Files.jsx';
import Photos from '../components/Photos.jsx';
import Offers from './Offers.jsx';
import { AlertsCard } from '../components/Pulse.jsx';
import Dashboard from './Dashboard.jsx';
import LoanPosition from '../components/LoanPosition.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['offers', 'Offers'],
  ['photos', 'Photos'],
  ['messages', 'Messages'],
  ['files', 'Files'],
  ['seller-page', 'Seller page'],
  ['settings', 'Settings'],
];
const PREVIEWS = [['seller', 'Seller'], ['realtor', 'Realtor'], ['reviewer', 'Reviewer'], ['lender', 'Lender'], ['viewer', 'Viewer']];
const ALERTED = ['realtor', 'reviewer', 'lender'];

const topic = () => 'ogdeal-' + crypto.randomUUID().replaceAll('-', '');

function People({ deal }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ email: '', role: 'realtor', display_name: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const link = window.location.origin + window.location.pathname;
  const load = () => supabase.from('commercial_members').select('*').eq('deal_id', deal.id).order('created_at').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [deal.id]);

  const add = async (e) => {
    e.preventDefault();
    setErr('');
    const row = { deal_id: deal.id, email: f.email.trim().toLowerCase(), role: f.role, display_name: f.display_name.trim() || null, ntfy_topic: ALERTED.includes(f.role) ? topic() : null };
    const { error } = await supabase.from('commercial_members').upsert({ ...row, status: 'active' }, { onConflict: 'deal_id,email' });
    if (error) return setErr(error.message);
    setDone(`${row.email} can sign in now as ${roleLabel[row.role].toLowerCase()}. Send them the site link.`);
    setF({ email: '', role: 'realtor', display_name: '' });
    load();
  };
  const setStatus = async (r, status) => { await supabase.from('commercial_members').update({ status }).eq('id', r.id); load(); };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardTitle>People</CardTitle>
        {!rows ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>Only you so far.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{r.display_name || r.email} <span className="ml-1 rounded-full bg-warm-soft px-2 py-0.5 text-xs">{roleLabel[r.role]}</span></p>
                  <p className="text-xs text-ink-soft">{r.email} · {r.status === 'active' ? 'Has access' : 'Access removed'}</p>
                  {r.ntfy_topic && r.status === 'active' && <p className="mt-1 text-xs text-ink-soft">Alert topic: <code className="select-all">{r.ntfy_topic}</code></p>}
                </div>
                {r.status === 'active'
                  ? <Button kind="secondary" onClick={() => setStatus(r, 'revoked')}>Remove access</Button>
                  : <Button kind="secondary" onClick={() => setStatus(r, 'active')}>Restore</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardTitle>Invite someone</CardTitle>
        <form onSubmit={add} className="space-y-3">
          <Field type="email" required placeholder="Their email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Field placeholder="Name (optional)" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          <select className="w-full rounded-xl border border-line bg-white px-3 py-2" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="realtor">Realtor: deal, offers, photos, messages, files</option>
            <option value="seller">Seller: the seller page only</option>
            <option value="reviewer">Reviewer: offers and files you share</option>
            <option value="lender">Lender: offers and files you share</option>
            <option value="viewer">Viewer: photos and shared files, read-only</option>
          </select>
          {err && <p className="text-sm text-red-700">{err}</p>}
          <Button type="submit" className="w-full">Invite</Button>
          {done && <p className="text-sm text-green-800">{done}</p>}
          <button type="button" onClick={() => { navigator.clipboard?.writeText(link); setDone('Site link copied.'); }}
            className="w-full rounded-xl border border-line px-3 py-2 text-sm hover:border-ink">Copy site link</button>
          <p className="text-xs text-ink-soft">Nothing is emailed. They sign in with this exact email at the site link you send them, and see only their role’s page.</p>
        </form>
      </Card>
    </div>
  );
}

function SellerEditor({ deal, onSaved }) {
  const [c, setC] = useState(deal.seller_content || {});
  const [saved, setSaved] = useState('');
  const setRow = (key, i, field, v) => setC({ ...c, [key]: c[key].map((r, j) => (j === i ? { ...r, [field]: v } : r)) });
  const addRow = (key) => setC({ ...c, [key]: [...(c[key] || []), { label: '', value: '' }] });
  const delRow = (key, i) => setC({ ...c, [key]: c[key].filter((_, j) => j !== i) });
  const save = async () => {
    const clean = { ...c, options: (c.options || []).map((o) => ({ ...o, steps: (o.steps || []).map((x) => x.trim()).filter(Boolean), you_get: (o.you_get || []).filter((r) => r.label) })) };
    const { data, error } = await supabase.from('commercial_deals').update({ seller_content: clean }).eq('id', deal.id).select().single();
    setSaved(error ? error.message : 'Saved. The seller sees this now.');
    if (data) onSaved(data);
  };
  const block = (key, title) => (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {(c[key] || []).map((r, i) => (
        <div key={i} className="mb-2 flex gap-2">
          <Field value={r.label} placeholder="Line" onChange={(e) => setRow(key, i, 'label', e.target.value)} />
          <Field value={r.value} placeholder="Detail" onChange={(e) => setRow(key, i, 'value', e.target.value)} />
          <Button kind="secondary" onClick={() => delRow(key, i)}>×</Button>
        </div>
      ))}
      <Button kind="secondary" onClick={() => addRow(key)}>Add a line</Button>
    </div>
  );
  return (
    <Card>
      <CardTitle>What the seller reads</CardTitle>
      <p className="-mt-2 mb-4 text-sm text-ink-soft">The seller sees only what’s on this card, plus photos you mark for the seller. Keep every line true. Your offers math never shows here. <a className="underline" href={`#/d/${deal.slug}/view/seller`}>See it full screen</a></p>
      <div className="space-y-4">
        <Field value={c.headline || ''} placeholder="Headline" onChange={(e) => setC({ ...c, headline: e.target.value })} />
        <textarea className="min-h-24 w-full rounded-xl border border-line bg-white px-3 py-2" value={c.intro || ''} placeholder="Intro" onChange={(e) => setC({ ...c, intro: e.target.value })} />
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <p className="text-sm font-medium">The options the seller can pick from</p>
          <Field value={c.options_title || ''} placeholder="Section title, e.g. Three ways we could do this" onChange={(e) => setC({ ...c, options_title: e.target.value })} />
          <textarea className="min-h-16 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={c.options_note || ''} placeholder="Note shown above the options" onChange={(e) => setC({ ...c, options_note: e.target.value })} />
          <div className="grid gap-4 lg:grid-cols-3">
            {(c.options || []).map((o, i) => {
              const set = (p) => setC({ ...c, options: c.options.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <div key={i} className="space-y-2 rounded-xl bg-paper p-3">
                  <div className="flex gap-2"><Field className="!w-14" value={o.key} onChange={(e) => set({ key: e.target.value.slice(0, 3) })} /><Field value={o.title} placeholder="Title" onChange={(e) => set({ title: e.target.value })} /></div>
                  <Field value={o.tagline || ''} placeholder="One line" onChange={(e) => set({ tagline: e.target.value })} />
                  <textarea className="min-h-24 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={(o.steps || []).join('\n')} placeholder="How it works, one step per line" onChange={(e) => set({ steps: e.target.value.split('\n') })} />
                  <textarea className="min-h-20 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={(o.you_get || []).map((r) => `${r.label} | ${r.value}`).join('\n')} placeholder="What they get: label | value, one per line"
                    onChange={(e) => set({ you_get: e.target.value.split('\n').map((l) => { const [label, ...v] = l.split('|'); return { label: (label || '').trim(), value: v.join('|').trim() }; }) })} />
                  <textarea className="min-h-16 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={o.ask || ''} placeholder="What we’d ask of them" onChange={(e) => set({ ask: e.target.value })} />
                  <textarea className="min-h-16 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={o.watch || ''} placeholder="Worth knowing" onChange={(e) => set({ watch: e.target.value })} />
                  <Button kind="secondary" onClick={() => setC({ ...c, options: c.options.filter((_, j) => j !== i) })}>Remove option</Button>
                </div>
              );
            })}
          </div>
          <Button kind="secondary" onClick={() => setC({ ...c, options: [...(c.options || []), { key: String.fromCharCode(65 + (c.options || []).length), title: '', tagline: '', steps: [], you_get: [] }] })}>Add an option</Button>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {block('carry_now', 'What you carry now')}
          {block('with_us', 'What you’d have with us')}
        </div>
        <div className="flex items-center gap-3"><Button onClick={save}>Save</Button><span className="text-sm text-ink-soft">{saved}</span></div>
      </div>
    </Card>
  );
}

function Settings({ deal, onSaved }) {
  const [folder, setFolder] = useState('');
  const [d, setD] = useState({ title: deal.title, address: deal.address, status: deal.status });
  const [msg, setMsg] = useState('');
  useEffect(() => { supabase.from('commercial_deal_private').select('drive_folder_id').eq('deal_id', deal.id).maybeSingle().then(({ data }) => setFolder(data?.drive_folder_id || '')); }, [deal.id]);
  const save = async () => {
    const id = (folder.match(/folders\/([A-Za-z0-9_-]+)/) || [])[1] || folder.trim();
    const a = await supabase.from('commercial_deals').update(d).eq('id', deal.id).select().single();
    const b = id ? await supabase.from('commercial_deal_private').upsert({ deal_id: deal.id, drive_folder_id: id, updated_at: new Date().toISOString() }) : { error: null };
    setMsg(a.error?.message || b.error?.message || 'Saved.');
    if (a.data) onSaved(a.data);
  };
  return (
    <Card>
      <CardTitle>Property settings</CardTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <Field value={d.title} placeholder="Name" onChange={(e) => setD({ ...d, title: e.target.value })} />
        <Field value={d.address} placeholder="Address" onChange={(e) => setD({ ...d, address: e.target.value })} />
        <Field value={folder} placeholder="Google Drive folder link" onChange={(e) => setFolder(e.target.value)} />
        <select className="rounded-xl border border-line bg-white px-3 py-2" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>
          <option value="active">Active</option><option value="closed">Closed</option><option value="archived">Archived</option>
        </select>
      </div>
      <p className="mt-3 text-xs text-ink-soft">The Drive folder is only visible to you. Page address: #/d/{deal.slug}</p>
      <div className="mt-4 flex items-center gap-3"><Button onClick={save}>Save</Button><span className="text-sm text-ink-soft">{msg}</span></div>
    </Card>
  );
}

function Notes({ deal, me }) {
  const [rows, setRows] = useState([]);
  const [body, setBody] = useState('');
  const load = () => supabase.from('commercial_owner_notes').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }).then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [deal.id]);
  const add = async (e) => { e.preventDefault(); if (!body.trim()) return; await supabase.from('commercial_owner_notes').insert({ deal_id: deal.id, body: body.trim() }); setBody(''); load(); };
  return (
    <Card>
      <CardTitle>Your private notes</CardTitle>
      <form onSubmit={add} className="mb-4 flex gap-2"><Field value={body} placeholder="Only you see these" onChange={(e) => setBody(e.target.value)} /><Button type="submit">Add</Button></form>
      {rows.length === 0 ? <Empty>No notes yet.</Empty> : rows.map((n) => <p key={n.id} className="border-t border-line py-2 text-sm">{n.body} <span className="text-xs text-ink-soft">· {when(n.created_at)}</span></p>)}
    </Card>
  );
}

function OwnerAlerts() {
  const [t, setT] = useState(null);
  useEffect(() => { supabase.from('commercial_settings').select('value').eq('key', 'owner_ntfy_topic').maybeSingle().then(({ data }) => setT(data?.value || '')); }, []);
  return <AlertsCard topic={t} who="You get a push for every view, message, upload and interest change on every property." />;
}

export default function Owner({ deal: initial, me, tab }) {
  const [deal, setDeal] = useState(initial);
  const active = TABS.find(([k]) => k === tab)?.[0] || 'overview';
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={TABS} active={active} base={`#/d/${deal.slug}`} />
        <div className="mb-5 flex flex-wrap items-center gap-1 text-sm">
          <span className="mr-1 text-ink-soft">See as</span>
          {PREVIEWS.map(([k, l]) => <a key={k} href={`#/d/${deal.slug}/view/${k}`} className="rounded-full border border-line bg-white px-3 py-1 hover:border-ink">{l}</a>)}
        </div>
      </div>

      {active === 'overview' && (
        <Dashboard deal={deal} me={me} role="owner" />
      )}
      {active === 'offers' && <Offers deal={deal} canSave me={me} role="owner" />}
      {active === 'photos' && <Photos deal={deal} role="owner" me={me} />}
      {active === 'messages' && <Messages deal={deal} me={me} role="owner" />}
      {active === 'files' && <Files deal={deal} role="owner" me={me} title="Every upload" canShare allowShare />}
      {active === 'seller-page' && <div className="space-y-5"><LoanPosition deal={deal} role="owner" /><SellerEditor deal={deal} onSaved={setDeal} /></div>}
      {active === 'settings' && <div className="space-y-6"><People deal={deal} /><div className="grid gap-6 lg:grid-cols-[1fr_360px]"><Settings deal={deal} onSaved={setDeal} /><OwnerAlerts /></div><Notes deal={deal} me={me} /></div>}
    </div>
  );
}
