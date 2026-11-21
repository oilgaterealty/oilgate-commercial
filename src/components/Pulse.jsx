import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { Card, CardTitle, Empty } from './Shell.jsx';

const INTEREST = { interested: 'Wants to talk', questions: 'Has questions first', not_now: 'Not right now' };

export function SellerPulse({ deal }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { supabase.from('commercial_interest').select('*').eq('deal_id', deal.id).then(({ data }) => setRows(data || [])); }, [deal.id]);
  return (
    <Card>
      <CardTitle>Seller interest</CardTitle>
      {rows.length === 0 ? <Empty>The seller hasn’t picked an answer yet.</Empty> : rows.map((r) => (
        <p key={r.email} className="text-sm">
          <span className="font-medium">{INTEREST[r.level]}</span>{r.favorite_option ? <span> · likes option {r.favorite_option}</span> : null}
          <span className="text-ink-soft"> · {when(r.updated_at)}</span>
        </p>
      ))}
    </Card>
  );
}

export function AlertsCard({ topic, who }) {
  return (
    <Card>
      <CardTitle>Phone alerts</CardTitle>
      {topic ? (
        <div className="space-y-2 text-sm">
          <p>Install the free ntfy app, tap +, and subscribe to this topic:</p>
          <code className="block select-all rounded-lg bg-warm-soft px-3 py-2 text-xs">{topic}</code>
          <p className="text-ink-soft">{who} Keep the topic private: anyone with it can read the alerts.</p>
        </div>
      ) : <Empty>Alerts aren’t set up for you yet.</Empty>}
    </Card>
  );
}
