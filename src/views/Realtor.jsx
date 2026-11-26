import { useEffect, useState } from 'react';
import Walkthrough from './Walkthrough.jsx';
import Tenants from './Tenants.jsx';
import Comps from './Comps.jsx';
import { Card, CardTitle, Tabs } from '../components/Shell.jsx';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import Files, { useUploads } from '../components/Files.jsx';
import Photos, { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import Activity from '../components/Activity.jsx';
import { SellerPulse, AlertsCard } from '../components/Pulse.jsx';
import SellerOffer, { useSellerOffer } from '../components/SellerOffer.jsx';
import { supabase } from '../lib/supabase.js';
import { money } from '../lib/dealmath.js';

export { SellerPulse, AlertsCard };

const INTEREST = { interested: 'Seller wants to talk', questions: 'Seller has questions', not_now: 'Seller: not right now' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const TABS = [
  ['overview', 'Overview'],
  ['offers', 'The offer'],
  ['walkthrough', 'Walkthrough'],
  ['photos', 'Photos'],
  ['comps', 'Comps'],
  ['messages', 'Messages'],
  ['files', 'Files'],
  ['activity', 'Recent activity'],
];

function RealtorOverview({ deal, root }) {
  const [rows] = useUploads(deal);
  const { row, summary } = useSellerOffer(deal);
  const [base, setBase] = useState(null);
  const [interest, setInterest] = useState(null);
  const [nextTask, setNextTask] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('commercial_interest').select('level').eq('deal_id', deal.id).order('updated_at', { ascending: false }).limit(1),
      supabase.from('commercial_work_items').select('body,done').eq('deal_id', deal.id).eq('kind', 'task').eq('done', false).order('created_at', { ascending: false }).limit(1),
    ]).then(([m, i, t]) => {
      if (!live) return;
      setBase(m.data?.base || {});
      setInterest(i.data?.[0]?.level || null);
      setNextTask(t.data?.[0]?.body || null);
    });
    return () => { live = false; };
  }, [deal.id]);

  const photos = photosOf(rows || []);
  const leadHeadline = summary?.title || (row?.name ? row.name.replace(/^[A-Z]\s*:\s*/, '') : 'Not shared yet');
  const statusText = INTEREST[interest] || cap(deal.status);
  const nextStep = nextTask || summary?.steps?.[0]?.title || 'Share the offer with the seller';

  return (
    <div className="space-y-4">
      <Cover rows={photos} compact />
      <Card>
        <CardTitle aside={<a href={`${root}/offers`} className="text-sm underline">Open the offer</a>}>Overview</CardTitle>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-2 rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Address</dt>
            <dd className="mt-1 font-semibold text-ink">{deal.address || deal.title}</dd>
          </div>
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Units</dt>
            <dd className="mt-1 font-display text-xl font-semibold">10</dd>
          </div>
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Repair budget</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{base ? money(+(base.rehab || 0)) : '…'}</dd>
          </div>
          <div className="rounded-2xl bg-ink p-3 text-white">
            <dt className="text-xs text-warm">Lead offer</dt>
            <dd className="mt-1 font-semibold leading-snug">{leadHeadline}</dd>
          </div>
          <div className="rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Status</dt>
            <dd className="mt-1 font-semibold">{statusText}</dd>
          </div>
          <div className="col-span-2 sm:col-span-3 rounded-2xl bg-paper p-3">
            <dt className="text-xs text-ink-soft">Next step</dt>
            <dd className="mt-1 font-medium text-ink">{nextStep}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

// Close to the buyer's page, minus his powers: no saving numbers, no invites, no settings.
// "readable" lifts small text to phone-friendly sizes (see index.css).
export default function Realtor({ deal, me, member, preview, tab }) {
  const active = tab === 'tenants' ? 'tenants' : (TABS.find(([k]) => k === tab)?.[0] || 'overview');
  const root = preview ? `#/d/${deal.slug}/view/realtor` : `#/d/${deal.slug}`;
  return (
    <div className="readable">
      <Tabs tabs={TABS} active={active} base={root} />
      {active === 'overview' && <RealtorOverview deal={deal} root={root} />}
      {active === 'offers' && <SellerOffer deal={deal} preview={preview} canInvite onAsk={(q) => sendToOwner(deal, me, 'realtor', q, 'Offer question')} />}
      {active === 'walkthrough' && <Walkthrough deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'photos' && (
        <div className="space-y-5">
          <UnitGallery deal={deal} me={me} role="realtor" preview={preview} />
          <Photos deal={deal} role="realtor" me={me} preview={preview} />
        </div>
      )}
      {active === 'tenants' && <Tenants deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'comps' && <Comps deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'messages' && <Messages deal={deal} me={me} role="realtor" preview={preview} />}
      {active === 'files' && <Files deal={deal} role="realtor" me={me} title="Documents and files" canShare allowShare preview={preview} />}
      {active === 'activity' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr_340px]">
          <Activity deal={deal} title="What the seller has done" actors={['seller']} empty="The seller hasn’t opened or done anything yet." />
          <Activity deal={deal} title="What the buyer has done" actors={['owner']} empty="Nothing from the buyer’s side yet." />
          <div className="space-y-6">
            <SellerPulse deal={deal} />
            {!preview && <AlertsCard topic={member?.ntfy_topic} who="You get a push when someone messages you or the seller does something here." />}
          </div>
        </div>
      )}
    </div>
  );
}
