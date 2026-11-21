import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Field, Button, Empty } from './Shell.jsx';

function LinkedText({ text }) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all underline">{part}</a> : part);
}

export function UnitNote() {
  return <p className="rounded-xl border border-line bg-warm-soft px-4 py-3 text-sm">Potential for a 10th unit ? must be seen/verified first. <strong>Underwriting stays on nine units.</strong></p>;
}

// Separate, explicitly shared working material. Never pulls private owner notes or offers.
export function WorkBoard({ deal, role, me, preview, kind = 'task', title = 'Open questions and tasks' }) {
  const [rows, setRows] = useState(null);
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('realtor');
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
    const r = await supabase.from('commercial_work_items').insert({ deal_id: deal.id, kind, body: body.trim(), author_email: me.email, author_role: role, audience: role === 'owner' ? (audience === 'owner' ? [] : [audience]) : [role] });
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
    {rows === null ? <Empty>Loading…</Empty> : !rows.length ? <Empty>{kind === 'research' ? 'No research shared yet. The owner can publish relevant findings here.' : kind === 'update' ? 'No updates yet.' : 'No open items yet. Add a question or next step below.'}</Empty> : <ul className="divide-y divide-line">{rows.map(r => <li key={r.id} className="flex gap-3 py-3 text-sm">
      {kind === 'task' && <input type="checkbox" aria-label={`Complete ${r.body}`} checked={r.done} disabled={Boolean(pending) || preview || (role !== 'owner' && r.author_role !== 'owner' && r.author_email !== me.email)} onChange={() => toggle(r)} />}
      <div className="min-w-0"><p className={`whitespace-pre-wrap ${r.done ? 'line-through text-ink-soft' : ''}`}><LinkedText text={r.body} /></p><p className="mt-1 text-xs text-ink-soft">{r.author_email === me.email ? 'You' : 'Shared with you'}{role === 'owner' ? ` · ${r.audience.join(', ') || 'Owner only'}` : ''}</p></div>
    </li>)}</ul>}
    {!preview && (role === 'owner' || kind !== 'research') && <form onSubmit={add} className="mt-4 space-y-2">
      <textarea aria-label={`New ${kind}`} required maxLength={4000} value={body} onChange={e => setBody(e.target.value)} placeholder={kind === 'task' ? 'A question or next step…' : `Add ${kind}…`} className="w-full rounded-xl border border-line px-3 py-2" />
      <div className="flex flex-wrap gap-2">{role === 'owner' && <select aria-label="Share with role" value={audience} onChange={e => setAudience(e.target.value)} className="rounded-xl border border-line px-3 py-2">{['owner', 'realtor', 'reviewer', 'lender'].map(r => <option key={r} value={r}>{r === 'owner' ? 'Owner only' : r}</option>)}</select>}<Button type="submit" disabled={!body.trim()}>Add {kind}</Button></div>
      <p className="text-xs text-ink-soft">{role === 'owner' ? 'Only the selected role and owner can read this.' : 'Shared with the owner. Other roles cannot see your entries.'}</p>
    </form>}
  </Card>;
}

const BIA_FIELDS = [['condition', 'Building condition / repairs'], ['rent_roll', 'Rent roll / occupancy'], ['comparables', 'Comparable sales / rents'], ['valuation', 'Broker opinion of value'], ['risks', 'Risks / due diligence'], ['recommendation', 'Recommendation / next steps']];
export function BiaSheet({ deal, me, preview }) {
  const [data, setData] = useState({});
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (preview) return;
    setLoaded(false);
    supabase.from('commercial_bia').select('answers').eq('deal_id', deal.id).eq('author_email', me.email).maybeSingle().then(r => { if (r.error) setStatus('Could not load your sheet. Refresh to try again.'); else { setData(r.data?.answers || {}); setLoaded(true); } });
  }, [deal.id, me.email, preview]);
  const save = async e => {
    e.preventDefault(); if (preview || !loaded) return;
    const r = await supabase.from('commercial_bia').upsert({ deal_id: deal.id, author_email: me.email, answers: data, updated_at: new Date().toISOString() });
    setStatus(r.error ? 'Not saved. Your text is still here; try again.' : 'Saved. The owner can read your BIA sheet.');
  };
  return <Card><CardTitle>BIA · Broker investment analysis</CardTitle>{!loaded && !preview && !status && <Empty>Loading your sheet…</Empty>}<form onSubmit={save} className="space-y-4">{BIA_FIELDS.map(([k, label]) => <label key={k} className="block text-sm font-medium">{label}<textarea aria-label={label} disabled={preview || !loaded} maxLength={4000} rows={3} value={data[k] || ''} onChange={e => setData({ ...data, [k]: e.target.value })} className="mt-1 w-full rounded-xl border border-line px-3 py-2 font-normal" /></label>)}<Button type="submit" disabled={preview || !loaded}>Save BIA sheet</Button><p role="status" className="text-sm">{status}</p></form></Card>;
}
