import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when, roleLabel } from '../lib/format.js';
import { Card, Button, Empty } from './Shell.jsx';

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Finds (or opens) the person's own conversation with the owner and posts into it.
export async function sendToOwner(deal, me, role, body, topic) {
  let { data: conv } = await supabase.from('commercial_conversations').select('id,participants').eq('deal_id', deal.id);
  let c = (conv || []).find((x) => sameSet(x.participants, [me.email]));
  if (!c) {
    const r = await supabase.from('commercial_conversations').insert({ deal_id: deal.id, participants: [me.email], created_by: me.email, title: '' }).select('id').single();
    if (r.error) return r.error;
    c = r.data;
  }
  const { error } = await supabase.from('commercial_messages').insert({ deal_id: deal.id, conversation_id: c.id, body, topic: topic || null, author_email: me.email, author_role: role, author_name: me.name || '' });
  return error;
}

function Thread({ deal, conv, me, role, readOnly }) {
  const [rows, setRows] = useState([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const load = async () => {
    const { data } = await supabase.from('commercial_messages').select('*').eq('conversation_id', conv.id).order('created_at');
    setRows(data || []);
  };
  useEffect(() => {
    load();
    const sub = supabase.channel(`c-${conv.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_messages', filter: `conversation_id=eq.${conv.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [conv.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [rows.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('commercial_messages').insert({ deal_id: deal.id, conversation_id: conv.id, body: body.trim(), author_email: me.email, author_role: role, author_name: me.name || '' });
    setBusy(false);
    if (!error) { setBody(''); load(); }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {rows.length === 0 && <Empty>No messages yet. Say hello.</Empty>}
        {rows.map((m) => {
          const mine = m.author_email === me.email;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'bg-ink text-white' : 'bg-warm-soft'}`}>
                <p className={`mb-0.5 text-xs ${mine ? 'text-white/70' : 'text-ink-soft'}`}>
                  {m.author_name || roleLabel[m.author_role]} · {when(m.created_at)}{m.topic ? ` · ${m.topic}` : ''}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {!readOnly && (
        <form onSubmit={send} className="mt-4 flex gap-2">
          <textarea rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
            className="min-h-[44px] flex-1 resize-y rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
          <Button type="submit" disabled={busy || !body.trim()}>Send</Button>
        </form>
      )}
    </div>
  );
}

// Inbox: a list of conversations on the left, the open one on the right.
// The owner picks one person or several for each conversation. Everyone else talks to the owner.
export default function Messages({ deal, me, role, preview }) {
  const owner = role === 'owner';
  const [convs, setConvs] = useState(null);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(null);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState([]);
  const [title, setTitle] = useState('');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    if (preview) return setConvs([]);
    const { data } = await supabase.from('commercial_conversations').select('*').eq('deal_id', deal.id).order('last_message_at', { ascending: false });
    setConvs(data || []);
    if (!open && data?.length) setOpen(data[0].id);
  };
  useEffect(() => {
    load();
    if (owner) supabase.from('commercial_members').select('email,display_name,role').eq('deal_id', deal.id).eq('status', 'active').order('role').then(({ data }) => setPeople(data || []));
    if (preview) return;
    const sub = supabase.channel(`cv-${deal.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commercial_conversations', filter: `deal_id=eq.${deal.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [deal.id]);

  const nameOf = (email) => {
    if (email === me.email) return 'You';
    const p = people.find((x) => x.email === email);
    return p ? `${p.display_name || p.email} (${roleLabel[p.role]})` : email;
  };
  const label = (c) => c.title || (owner ? c.participants.map(nameOf).join(', ') : 'You and LaVante');

  const start = async () => {
    setErr('');
    if (!pick.length) return setErr('Pick at least one person.');
    const existing = (convs || []).find((c) => sameSet(c.participants, pick) && !title);
    if (existing) { setOpen(existing.id); setPicking(false); setPick([]); return; }
    const { data, error } = await supabase.from('commercial_conversations').insert({ deal_id: deal.id, participants: pick, created_by: me.email, title: title.trim() }).select().single();
    if (error) return setErr('Couldn’t start that conversation.');
    setPicking(false); setPick([]); setTitle('');
    await load();
    setOpen(data.id);
  };

  const firstSend = async (e) => {
    e.preventDefault();
    if (!first.trim() || preview) return;
    const error = await sendToOwner(deal, me, role, first.trim());
    if (!error) { setFirst(''); load(); }
  };

  const current = (convs || []).find((c) => c.id === open);

  return (
    <Card className="!p-0">
      <div className="grid min-h-[480px] md:grid-cols-[280px_1fr]">
        <aside className="border-b border-line p-4 md:border-b-0 md:border-r">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Messages</h2>
            {owner && <Button kind="secondary" onClick={() => setPicking(!picking)}>{picking ? 'Cancel' : 'New'}</Button>}
          </div>
          {picking && (
            <div className="mb-4 space-y-2 rounded-xl border border-line bg-paper p-3">
              <p className="text-sm font-medium">Who is this conversation with?</p>
              {people.length === 0 && <Empty>Add people under Settings first.</Empty>}
              {people.map((p) => (
                <label key={p.email} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={pick.includes(p.email)} onChange={(e) => setPick(e.target.checked ? [...pick, p.email] : pick.filter((x) => x !== p.email))} />
                  <span>{p.display_name || p.email}</span><span className="text-xs text-ink-soft">{roleLabel[p.role]}</span>
                </label>
              ))}
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Name it (optional)"
                className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-ink" />
              {err && <p className="text-sm text-red-700">{err}</p>}
              <Button className="w-full" onClick={start}>Start</Button>
              <p className="text-xs text-ink-soft">Only the people you pick see this conversation.</p>
            </div>
          )}
          {convs === null && <Empty>Loading…</Empty>}
          {convs?.length === 0 && !picking && <Empty>{owner ? 'No conversations yet. Tap New and pick who to message.' : 'No messages yet.'}</Empty>}
          <ul className="space-y-1">
            {convs?.map((c) => (
              <li key={c.id}>
                <button onClick={() => setOpen(c.id)} className={`w-full rounded-xl px-3 py-2 text-left text-sm ${open === c.id ? 'bg-ink text-white' : 'hover:bg-warm-soft'}`}>
                  <span className="block truncate font-medium">{label(c)}</span>
                  <span className={`text-xs ${open === c.id ? 'text-white/70' : 'text-ink-soft'}`}>{when(c.last_message_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="p-4">
          {current ? <Thread key={current.id} deal={deal} conv={current} me={me} role={role} readOnly={preview || ['guest', 'viewer'].includes(role)} /> : owner ? (
            <Empty>Pick a conversation, or tap New.</Empty>
          ) : (
            <form onSubmit={firstSend} className="flex h-full flex-col justify-end gap-2">
              <Empty>Write to LaVante directly. Only LaVante sees it.</Empty>
              <textarea rows={3} maxLength={4000} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Write a message" disabled={preview}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
              <Button type="submit" disabled={preview || !first.trim()}>Send</Button>
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}
