import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { Card, CardTitle, Empty } from '../components/Shell.jsx';
import Thread from '../components/Thread.jsx';
import Files from '../components/Files.jsx';
import Activity from '../components/Activity.jsx';

const INTEREST = { interested: 'Wants to talk', questions: 'Has questions first', not_now: 'Not right now' };

export function SellerPulse({ deal }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { supabase.from('seller_interest').select('*').eq('deal_id', deal.id).then(({ data }) => setRows(data || [])); }, [deal.id]);
  return (
    <Card>
      <CardTitle>Seller interest</CardTitle>
      {rows.length === 0 ? <Empty>The seller hasn’t picked an answer yet.</Empty> : rows.map((r) => (
        <p key={r.email} className="text-sm"><span className="font-medium">{INTEREST[r.level]}</span> <span className="text-ink-soft">· {when(r.updated_at)}</span></p>
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

export default function Realtor({ deal, me, member, role, preview }) {
  const guest = role === 'guest';
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.18em] text-warm">{deal.address}</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">{deal.title}</h1>
        <p className="mt-2 text-ink-soft">{guest ? 'Read-only view.' : 'Post photos and updates, and answer the seller here.'}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {!guest && <Thread deal={deal} channel="seller" role={role} me={me} title="Seller conversation" hint="The seller and our team see this thread." readOnly={preview} />}
          <Thread deal={deal} channel="team" role={role} me={me} title="Team updates" hint="Only our team sees this. The seller never does." readOnly={guest || preview} />
          {!guest && <Files deal={deal} role={role} me={me} title="Photos and documents" canShare={!preview} allowShare readOnly={preview} />}
        </div>
        <div className="space-y-6">
          {!guest && <SellerPulse deal={deal} />}
          <Activity deal={deal} title="Seller engagement" kinds={['view', 'interest', 'message', 'upload']} />
          {!guest && !preview && <AlertsCard topic={member?.ntfy_topic} who="You’ll get a push when the seller or owner does something here." />}
        </div>
      </div>
    </div>
  );
}
