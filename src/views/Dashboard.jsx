import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { operating, money, pct } from '../lib/dealmath.js';
import { Card, CardTitle, Empty, Button } from '../components/Shell.jsx';
import { useUploads, FileList } from '../components/Files.jsx';
import { UnitNote, WorkBoard } from '../components/DealWorkspace.jsx';
import { SellerPulse } from './Realtor.jsx';
import { when, roleLabel } from '../lib/format.js';

export default function Dashboard({ deal, me }) {
  const [rows] = useUploads(deal);
  const [messages, setMessages] = useState([]);
  const [base, setBase] = useState(null);
  const [bias, setBias] = useState([]);
  const [error, setError] = useState('');
  const [filePreview, setFilePreview] = useState(null);
  useEffect(() => {
    Promise.all([
      Promise.all(['seller', 'realtor', 'reviewer', 'lender', 'viewer'].map(role => supabase.from('commercial_messages').select('*').eq('deal_id', deal.id).eq('author_role', role).order('created_at', { ascending: false }).limit(1))),
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('commercial_bia').select('*').eq('deal_id', deal.id),
    ]).then(([m, b, sheets]) => {
      setMessages(m.flatMap(x => x.data || [])); setBase(b.data?.base || null); setBias(sheets.data || []);
      if (m.some(x => x.error) || b.error || sheets.error) setError('Some dashboard information could not load. Refresh to try again.');
    });
  }, [deal.id]);
  const o = base && operating({ ...base, units: 9 });
  const roles = ['seller', 'realtor', 'reviewer', 'lender', 'viewer'];
  return <div className="space-y-5"><UnitNote />{error && <p role="alert">{error}</p>}
    <Card><CardTitle>Deal at a glance</CardTitle><dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">{[['Status', deal.status], ['Underwritten units', '9'], ['Annual NOI', o ? money(o.noi) : 'Awaiting numbers'], ['Value used', o ? money(o.b.value) : 'Awaiting numbers'], ['Monthly rent / unit', o ? money(o.b.rent) : 'Awaiting numbers'], ['Cap rate', o ? pct(o.capRate, 1) : 'Awaiting numbers']].map(([l, v]) => <div key={l}><dt className="text-xs text-ink-soft">{l}</dt><dd className="mt-1 font-display text-xl font-semibold">{v}</dd></div>)}</dl><a className="mt-4 inline-block text-sm underline" href={`#/d/${deal.slug}/offers`}>Review all offer numbers</a></Card>
    <SellerPulse deal={deal} />
    <Card><CardTitle>Latest messages by role</CardTitle><ul className="divide-y divide-line">{roles.map(role => { const m = messages.find(x => x.author_role === role); return <li key={role} className="py-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{roleLabel[role]}</strong>{m && <a className="text-sm underline" href={`#/d/${deal.slug}/messages?thread=${m.conversation_id || ''}`}>Reply</a>}</div>{m ? <><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm">{m.body}</p><p className="mt-1 text-xs text-ink-soft">{when(m.created_at)}</p></> : <Empty>No messages yet.</Empty>}</li>; })}</ul></Card>
    <Card><CardTitle>Recent files</CardTitle><FileList rows={rows?.slice(0, 5)} /><div className="mt-2 flex flex-wrap gap-2">{rows?.slice(0, 5).filter(x => x.url && (x.kind === 'photo' || x.mime === 'application/pdf')).map(x => <Button key={x.id} kind="secondary" onClick={() => setFilePreview(x)}>Preview {x.file_name}</Button>)}</div>{filePreview && <div className="mt-4 rounded-xl border border-line p-3"><div className="mb-2 flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">{filePreview.file_name}</p><Button kind="secondary" onClick={() => setFilePreview(null)}>Close preview</Button></div>{filePreview.kind === 'photo' ? <img src={filePreview.url} alt={filePreview.note || filePreview.file_name} className="max-h-80 w-full object-contain" /> : <iframe title={`Preview ${filePreview.file_name}`} src={filePreview.url} className="h-96 w-full" />}</div>}<a className="mt-3 inline-block text-sm underline" href={`#/d/${deal.slug}/files`}>All files and uploads</a></Card>
    <WorkBoard deal={deal} me={me} role="owner" />
    <WorkBoard deal={deal} me={me} role="owner" kind="research" title="Research to share" />
    <WorkBoard deal={deal} me={me} role="owner" kind="update" title="Deal updates" />
    <Card><CardTitle>Realtor BIA sheets</CardTitle>{!bias.length ? <Empty>No BIA sheets submitted yet.</Empty> : bias.map(b => <div key={b.author_email} className="border-t border-line py-3"><p className="font-medium">{b.author_email}</p>{Object.entries(b.answers).map(([k, v]) => <p key={k} className="mt-2 whitespace-pre-wrap text-sm"><strong>{k.replaceAll('_', ' ')}:</strong> {v}</p>)}</div>)}</Card>
  </div>;
}
