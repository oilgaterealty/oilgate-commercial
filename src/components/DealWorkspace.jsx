import { roleLabel } from '../lib/format.js';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Button, Empty } from './Shell.jsx';

// Who a new task is for, and which roles can read it. The owner always sees every task.
const FOR = [['owner', 'LaVante', []], ['shared', 'LaVante + realtor', ['realtor']], ['realtor', 'Realtor', ['realtor']], ['reviewer', 'Reviewer', ['reviewer']], ['lender', 'Lender', ['lender']]];

function LinkedText({ text }) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all underline">{part}</a> : part);
}

// Separate, explicitly shared working material. Never pulls private owner notes or offers.
export function WorkBoard({ deal, role, me, preview, kind = 'task', title = 'Tasks' }) {
  const [rows, setRows] = useState(null);
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState(kind === 'task' ? 'shared' : 'realtor');
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const load = async () => {
    const r = await supabase.from('commercial_work_items').select('*').eq('deal_id', deal.id).eq('kind', kind).order('created_at', { ascending: false });
    setError(r.error ? 'Working material is unavailable. Please refresh or contact the owner.' : '');
    setRows((r.data || []).filter(x => !preview || (x.audience.includes(role) && x.author_role === 'owner')));
  };
  useEffect(() => { load(); }, [deal.id, kind, role, preview]);
  const add = async e => {
    e.preventDefault();
    if (!body.trim() || preview) return;
    const pick = FOR.find(([k]) => k === audience);
    const row = { deal_id: deal.id, kind, body: body.trim(), author_email: me.email, author_role: role, audience: role === 'owner' ? pick[2] : [role] };
    if (kind === 'task') row.assignee = role === 'owner' ? pick[1] : roleLabel[role];
    let r = await supabase.from('commercial_work_items').insert(row);
    if (r.error && row.assignee) { delete row.assignee; r = await supabase.from('commercial_work_items').insert(row); }
    if (r.error) return setError('Could not save. Your text is still here; try again.');
    setBody(''); await load();
  };
  const toggle = async row => {
    if (pending) return;
    setPending(row.id);
    setRows(list => list.map(x => x.id === row.id ? { ...x, done: !row.done } : x));
    const r = await supabase.rpc('commercial_set_task_done', { p_id: row.id, p_done: !row.done });
    if (r.error) { setError('Could not update the task.'); setRows(list => list.map(x => x.id === row.id ? { ...x, done: row.done } : x)); }
    else setError('');
    setPending('');
  };
  return <Card><CardTitle>{title}</CardTitle>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {rows === null ? <Empty>Loading…</Empty> : !rows.length ? <Empty>{kind === 'research' ? 'No research shared yet. The owner can publish relevant findings here.' : kind === 'update' ? 'No updates yet.' : 'No tasks yet.'}</Empty> : <ul className="divide-y divide-line">{rows.map(r => <li key={r.id} className="flex gap-3 py-3 text-sm">
      {kind === 'task' && <input type="checkbox" aria-label={`Complete ${r.body}`} checked={r.done} disabled={Boolean(pending) || preview || (role !== 'owner' && r.author_role !== 'owner' && r.author_email !== me.email)} onChange={() => toggle(r)} />}
      <div className="min-w-0"><p className={`whitespace-pre-wrap ${r.done ? 'line-through text-ink-soft' : ''}`}><LinkedText text={r.body} /></p><p className="mt-1 text-xs text-ink-soft">{r.assignee ? `For ${r.assignee}` : r.author_email === me.email ? 'Added by you' : `Added by ${roleLabel[r.author_role] || 'the team'}`}{role === 'owner' && !r.assignee ? ` · seen by ${r.audience.join(', ') || 'only you'}` : ''}</p></div>
    </li>)}</ul>}
    {!preview && (role === 'owner' || kind !== 'research') && <form onSubmit={add} className="mt-4 space-y-2">
      <textarea aria-label={`New ${kind}`} required maxLength={4000} value={body} onChange={e => setBody(e.target.value)} placeholder={kind === 'task' ? 'A task or question…' : kind === 'update' ? 'An update…' : 'Research to share…'} className="w-full rounded-xl border border-line px-3 py-2" />
      <div className="flex flex-wrap gap-2">{role === 'owner' && <select aria-label={kind === 'task' ? 'Who it is for' : 'Share with'} value={audience} onChange={e => setAudience(e.target.value)} className="rounded-xl border border-line px-3 py-2">{FOR.filter(([k]) => kind === 'task' || k !== 'shared').map(([k, l]) => <option key={k} value={k}>{kind === 'task' ? `For ${l}` : k === 'owner' ? 'Only me' : `Share with ${l.toLowerCase()}`}</option>)}</select>}<Button type="submit" disabled={!body.trim()}>Add {kind}</Button></div>
      <p className="text-xs text-ink-soft">{role === 'owner' ? 'Only the people you pick and you can read this.' : 'Shared with LaVante. Other roles can’t see your entries.'}</p>
    </form>}
  </Card>;
}
