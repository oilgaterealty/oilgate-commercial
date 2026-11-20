import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when, roleLabel } from '../lib/format.js';
import { Card, CardTitle, Button, Empty } from './Shell.jsx';

export default function Thread({ deal, channel, role, me, title, hint, readOnly }) {
  const [rows, setRows] = useState([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  const load = async () => {
    const { data } = await supabase.from('commercial_messages').select('*').eq('deal_id', deal.id).eq('channel', channel).order('created_at');
    setRows(data || []);
  };
  useEffect(() => {
    load();
    const sub = supabase.channel(`m-${deal.id}-${channel}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_messages', filter: `deal_id=eq.${deal.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [deal.id, channel]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [rows.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('commercial_messages').insert({ deal_id: deal.id, channel, body: body.trim(), author_email: me.email, author_role: role, author_name: me.name || '' });
    setBusy(false);
    if (!error) { setBody(''); load(); }
  };

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {hint && <p className="-mt-2 mb-4 text-sm text-ink-soft">{hint}</p>}
      <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
        {rows.length === 0 && <Empty>No messages yet.</Empty>}
        {rows.map((m) => {
          const mine = m.author_email === me.email;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'bg-ink text-white' : 'bg-warm-soft'}`}>
                <p className={`mb-0.5 text-xs ${mine ? 'text-white/70' : 'text-ink-soft'}`}>{m.author_name || roleLabel[m.author_role]} · {when(m.created_at)}</p>
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
            className="min-h-[44px] flex-1 resize-y rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
          <Button type="submit" disabled={busy || !body.trim()}>Send</Button>
        </form>
      )}
    </Card>
  );
}
