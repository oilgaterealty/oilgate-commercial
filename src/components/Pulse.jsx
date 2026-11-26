import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { Card, CardTitle, Empty, InfoTip } from './Shell.jsx';

const INTEREST = { interested: 'Wants to talk', questions: 'Has questions first', not_now: 'Not right now' };

export function SellerPulse({ deal }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { supabase.from('commercial_interest').select('*').eq('deal_id', deal.id).then(({ data }) => setRows(data || [])); }, [deal.id]);
  return (
    <Card>
      <CardTitle>Seller interest</CardTitle>
      {rows.length === 0 ? <Empty>The seller hasn’t picked an answer yet.</Empty> : rows.map((r) => (
        <p key={r.email} className="text-sm" title={when(r.updated_at)}>
          <span className="font-medium">{INTEREST[r.level]}</span>{r.favorite_option ? <span> · likes option {r.favorite_option}</span> : null}
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
          <div className="flex items-center gap-2"><p>Install the free ntfy app, tap +, and subscribe to this topic:</p><InfoTip label="Phone alert tips" lines={[who, 'Keep the topic private: anyone with it can read the alerts.']} /></div>
          <code className="block select-all rounded-lg bg-warm-soft px-3 py-2 text-xs">{topic}</code>
        </div>
      ) : <Empty>Alerts aren’t set up for you yet.</Empty>}
    </Card>
  );
}
