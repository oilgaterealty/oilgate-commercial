import { DictatedField } from './Dictation.jsx';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when, roleLabel } from '../lib/format.js';
import { Card, CardTitle, Button, Empty } from './Shell.jsx';

// Finds (or opens) the person's own conversation with the owner and posts into it.
export async function sendToOwner(deal, me, role, body, topic) {
  const { data: id, error: opening } = await supabase.rpc('commercial_open_own_thread', { p_deal: deal.id });
  if (opening) return opening;
  const { error } = await supabase.from('commercial_messages').insert({ deal_id: deal.id, conversation_id: id, body, topic: topic || null, author_email: me.email, author_role: role, author_name: me.name || '' });
  return error;
}

const ROLE_ORDER = ['seller', 'realtor', 'reviewer', 'lender'];
const CAN_MESSAGE = ['owner', 'seller', 'realtor', 'reviewer', 'lender'];

// Which role a conversation belongs to, from the owner's side: the most private role in it wins.
function keyOf(conv, people) {
  const roles = conv.participants.map((e) => people.find((p) => p.email === e)?.role).filter(Boolean);
  for (const r of ['seller', 'lender', 'reviewer', 'realtor']) if (roles.includes(r)) return r;
  return null;
}

// The fixed rows everyone sees: one per role for LaVante, one or two for everyone else. Nobody gets added by hand.
export function useInbox(deal, me, role, preview) {
  const owner = role === 'owner';
  const [state, setState] = useState({ slots: null, error: '' });
  const load = async () => {
    if (preview) {
      const keys = owner ? ROLE_ORDER : role === 'realtor' ? ['owner', 'seller'] : ['owner'];
      return setState({ slots: keys.map((k) => ({ key: k, label: slotLabel(k, role), people: [], conv: null, last: null })), error: '' });
    }
    const [c, m, p] = await Promise.all([
      supabase.from('commercial_conversations').select('*').eq('deal_id', deal.id).order('last_message_at', { ascending: false }),
      supabase.from('commercial_messages').select('id,conversation_id,body,author_role,author_name,created_at,topic').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(300),
      owner ? supabase.from('commercial_members').select('email,display_name,role').eq('deal_id', deal.id).eq('status', 'active') : Promise.resolve({ data: [] }),
    ]);
    const convs = c.data || [];
    const people = p.data || [];
    const lastOf = (conv) => conv && (m.data || []).find((x) => x.conversation_id === conv.id);
    let slots;
    if (owner) {
      slots = ROLE_ORDER.map((k) => {
        const conv = convs.find((x) => keyOf(x, people) === k) || null;
        const mine = people.filter((x) => x.role === k);
        const emails = k === 'seller' ? [...mine, ...people.filter((x) => x.role === 'realtor')].map((x) => x.email) : k === 'lender' ? mine.slice(0, 1).map((x) => x.email) : mine.map((x) => x.email);
        return { key: k, label: roleLabel[k], people: mine, emails, conv, last: lastOf(conv) };
      });
    } else {
      const own = convs.find((x) => x.participants.length === 1 && x.participants[0] === me.email) || (role === 'seller' ? convs[0] : null) || null;
      slots = [{ key: 'owner', label: slotLabel('owner', role), people: [], conv: own, last: lastOf(own) }];
      if (role === 'realtor') {
        const seller = convs.find((x) => x !== own && x.participants.length > 1) || null;
        slots.push({ key: 'seller', label: slotLabel('seller', role), people: [], conv: seller, last: lastOf(seller) });
      }
    }
    setState({ slots, error: c.error || m.error ? 'Some messages could not load. Refresh to try again.' : '' });
  };
  useEffect(() => {
    load();
    if (preview) return;
    const sub = supabase.channel(`inbox-${deal.id}-${role}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_messages', filter: `deal_id=eq.${deal.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [deal.id, role, preview]);
  return { ...state, reload: load };
}

function slotLabel(k, role) {
  if (k === 'owner') return role === 'seller' ? 'LaVante and the realtor' : 'LaVante';
  if (k === 'seller' && role === 'realtor') return 'Seller and LaVante';
  return roleLabel[k];
}

function who(slot, owner) {
  if (!owner) return '';
  if (!slot.people.length) return `No ${roleLabel[slot.key].toLowerCase()} invited yet`;
  return slot.people.map((p) => p.display_name || p.email).join(', ');
}

// Compact block for the overview: the latest message from each role, with a Reply link.
export function InboxSummary({ deal, me, role, preview }) {
  const owner = role === 'owner';
  const { slots, error } = useInbox(deal, me, role, preview);
  const root = preview ? `#/d/${deal.slug}/view/${role}` : `#/d/${deal.slug}`;
  if (!CAN_MESSAGE.includes(role)) return null;
  return (
    <Card>
      <CardTitle aside={<a className="text-sm underline" href={`${root}/messages`}>All messages</a>}>{owner ? 'Messages by role' : 'Messages'}</CardTitle>
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      {slots === null ? <Empty>Loading…</Empty> : (
        <ul className="divide-y divide-line">
          {slots.map((s) => (
            <li key={s.key} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{s.label}</strong>
                <a className="text-sm underline" href={`${root}/messages?with=${s.key}`}>{s.last ? 'Reply' : 'Write'}</a>
              </div>
              {owner && <p className="text-xs text-ink-soft">{who(s, owner)}</p>}
              {s.last ? <><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm">{s.last.body}</p><p className="mt-0.5 text-xs text-ink-soft">{s.last.author_name || roleLabel[s.last.author_role]} · {when(s.last.created_at)}</p></> : <p className="mt-1 text-sm text-ink-soft">No messages yet.</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Thread({ deal, me, role, slot, preview, onSent }) {
  const owner = role === 'owner';
  const [rows, setRows] = useState([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef(null);
  const conv = slot.conv;
  const load = async () => {
    if (!conv) return setRows([]);
    const { data } = await supabase.from('commercial_messages').select('*').eq('conversation_id', conv.id).order('created_at');
    setRows(data || []);
  };
  useEffect(() => {
    load();
    if (!conv) return;
    const sub = supabase.channel(`c-${conv.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_messages', filter: `conversation_id=eq.${conv.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [conv?.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [rows.length]);

  const noOne = owner && !conv && !slot.people.length;
  const send = async (e) => {
    e.preventDefault();
    if (!body.trim() || busy || preview || noOne) return;
    setBusy(true);
    try {
      let error;
      if (conv) error = (await supabase.from('commercial_messages').insert({ deal_id: deal.id, conversation_id: conv.id, body: body.trim(), author_email: me.email, author_role: role, author_name: me.name || '' })).error;
      else if (owner) {
        const emails = slot.emails;
        const { data: made, error: e1 } = await supabase.from('commercial_conversations').insert({ deal_id: deal.id, participants: emails, created_by: me.email, title: '' }).select().single();
        error = e1 || (await supabase.from('commercial_messages').insert({ deal_id: deal.id, conversation_id: made.id, body: body.trim(), author_email: me.email, author_role: role, author_name: me.name || '' })).error;
      } else error = await sendToOwner(deal, me, role, body.trim());
      setError(error ? 'Message not sent. Your text is still here; try again.' : '');
      if (!error) { setBody(''); await load(); onSent?.(); }
    } catch { setError('Message not sent. Please try again.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="mb-3 border-b border-line pb-2">
        <h3 className="font-display text-lg font-semibold">{slot.label}</h3>
        {owner && <p className="text-xs text-ink-soft">{who(slot, owner)}</p>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {preview && <Empty>Preview. A real {role === 'owner' ? '' : roleLabel[role].toLowerCase() + ' '}sign-in sees the conversation here and can send.</Empty>}
        {!preview && rows.length === 0 && <Empty>{noOne ? `Invite a ${roleLabel[slot.key].toLowerCase()} under Settings and their messages land here.` : 'No messages yet. Say hello.'}</Empty>}
        {rows.map((m) => {
          const mine = m.author_email === me.email;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'bg-ink text-white' : 'bg-warm-soft'}`}>
                <p className={`mb-0.5 text-xs ${mine ? 'text-white/70' : 'text-ink-soft'}`}>{m.author_name || roleLabel[m.author_role]} · {when(m.created_at)}{m.topic ? ` · ${m.topic}` : ''}</p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="mt-4 flex gap-2">
        <DictatedField as="textarea" disabled={busy || preview || noOne} rows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={preview ? 'Sending works on a real sign-in' : 'Write a message'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
          className="min-h-[44px] flex-1 resize-y rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink disabled:bg-paper" />
        <Button type="submit" disabled={busy || preview || noOne || !body.trim()}>Send</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

// The Messages tab: the same fixed rows as the overview on the left, the open conversation on the right.
export default function Messages({ deal, me, role, preview }) {
  const owner = role === 'owner';
  const { slots, error, reload } = useInbox(deal, me, role, preview);
  const asked = new URLSearchParams(window.location.hash.split('?')[1] || '').get('with');
  const [open, setOpen] = useState(asked);
  if (!CAN_MESSAGE.includes(role)) return <Card><Empty>Messages aren’t part of this view.</Empty></Card>;
  const current = slots?.find((s) => s.key === open) || slots?.[0];
  return (
    <Card className="!p-0">
      {error && <p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
      <div className="grid min-h-[480px] md:grid-cols-[300px_1fr]">
        <aside className="border-b border-line p-4 md:border-b-0 md:border-r">
          <h2 className="mb-3 font-display text-xl font-semibold">{owner ? 'Messages by role' : 'Messages'}</h2>
          {slots === null ? <Empty>Loading…</Empty> : (
            <ul className="space-y-1">
              {slots.map((s) => (
                <li key={s.key}>
                  <button onClick={() => setOpen(s.key)} className={`w-full rounded-xl px-3 py-2 text-left text-sm ${current?.key === s.key ? 'bg-ink text-white' : 'hover:bg-warm-soft'}`}>
                    <span className="block font-medium">{s.label}</span>
                    <span className={`line-clamp-1 text-xs ${current?.key === s.key ? 'text-white/70' : 'text-ink-soft'}`}>{s.last ? s.last.body : owner ? who(s, owner) : 'No messages yet'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="p-4">{current ? <Thread key={current.key + (current.conv?.id || '')} deal={deal} me={me} role={role} slot={current} preview={preview} onSent={reload} /> : <Empty>Loading…</Empty>}</div>
      </div>
    </Card>
  );
}
