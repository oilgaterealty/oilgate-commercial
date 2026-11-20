import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { Card, CardTitle, Empty } from './Shell.jsx';

export default function Activity({ deal, title = 'Activity', kinds }) {
  const [rows, setRows] = useState(null);
  const load = async () => {
    let q = supabase.from('activity').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(60);
    if (kinds) q = q.in('kind', kinds);
    const { data } = await q;
    setRows(data || []);
  };
  useEffect(() => {
    load();
    const sub = supabase.channel(`a-${deal.id}-${(kinds || []).join()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter: `deal_id=eq.${deal.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [deal.id]);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {rows === null && <Empty>Loading…</Empty>}
      {rows?.length === 0 && <Empty>Nothing yet.</Empty>}
      <ol className="space-y-3">
        {rows?.map((a) => (
          <li key={a.id} className="flex gap-3 text-sm">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warm" />
            <div><p>{a.summary}</p><p className="text-xs text-ink-soft">{when(a.created_at)}</p></div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
