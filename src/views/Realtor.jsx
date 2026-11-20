import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { Card, CardTitle, Empty, Tabs } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import Files from '../components/Files.jsx';
import Photos from '../components/Photos.jsx';
import Activity from '../components/Activity.jsx';

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

const TABS = [['messages', 'Messages'], ['photos', 'Photos'], ['files', 'Files'], ['seller', 'Seller activity']];

export default function Realtor({ deal, me, member, preview, tab }) {
  const active = TABS.find(([k]) => k === tab)?.[0] || 'messages';
  return (
    <div>
      <Tabs tabs={TABS} active={active} base={preview ? `#/d/${deal.slug}/view/realtor` : `#/d/${deal.slug}`} />
      {active === 'messages' && <Messages deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'photos' && <Photos deal={deal} role="realtor" me={me} preview={preview} />}
      {active === 'files' && <Files deal={deal} role="realtor" me={me} title="Photos and documents" canShare allowShare preview={preview} />}
      {active === 'seller' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Activity deal={deal} title="What the seller has done" kinds={['view', 'interest', 'upload']} />
          <div className="space-y-6">
            <SellerPulse deal={deal} />
            {!preview && <AlertsCard topic={member?.ntfy_topic} who="You’ll get a push when someone messages you or the seller does something here." />}
          </div>
        </div>
      )}
    </div>
  );
}
