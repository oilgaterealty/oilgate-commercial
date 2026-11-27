import { useEffect, useState } from 'react';
import Walkthrough from './Walkthrough.jsx';
import Tenants from './Tenants.jsx';
import Comps from './Comps.jsx';
import { Card, CardTitle, JumpNav, useSectionScroll } from '../components/Shell.jsx';
import Messages, { InboxSummary, sendToOwner } from '../components/Messages.jsx';
import Files, { useUploads } from '../components/Files.jsx';
import Photos, { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import Activity from '../components/Activity.jsx';
import { SellerPulse, AlertsCard } from '../components/Pulse.jsx';
import SellerOffer, { useSellerOffer } from '../components/SellerOffer.jsx';
import { WorkBoard } from '../components/DealWorkspace.jsx';
import { WhatIfNumbers } from '../components/Switches.jsx';
import { supabase } from '../lib/supabase.js';
import { money } from '../lib/dealmath.js';

export { SellerPulse, AlertsCard };

const INTEREST = { interested: 'Seller wants to talk', questions: 'Seller has questions', not_now: 'Seller: not right now' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const SECTIONS = [
  ['overview', 'Overview'],
  ['tasks', 'Tasks'],
  ['offers', 'The offer'],
  ['what-if', 'What-if'],
  ['walkthrough', 'Walkthrough'],
  ['photos', 'Photos'],
  ['comps', 'Comps'],
  ['files', 'Files'],
  ['messages', 'Messages'],
  ['activity', 'Recent activity'],
];

function RealtorOverview({ deal, root, onJump }) {
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
        <CardTitle aside={<a href={`${root}/offers`} onClick={(e) => { e.preventDefault(); onJump('offers', root); }} className="inline-flex min-h-[40px] items-center text-sm underline">Open the offer</a>}>Overview</CardTitle>
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
            <dd className="mt-1 font-display text-xl font-semibold">{base ? money(+(summary?.stepBudgets?.total || summary?.guide?.costSummary?.total || base.rehab || 0)) : '…'}</dd>
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

// One scrollable working page for the realtor: no saving buyer numbers, no invites, no settings, tenants hidden.
// "readable" lifts small text to phone-friendly sizes (see index.css).
export default function Realtor({ deal, me, member, preview, tab }) {
  const root = preview ? `#/d/${deal.slug}/view/realtor` : `#/d/${deal.slug}`;
  const { activeSection, jumpTo } = useSectionScroll(tab, SECTIONS, { seller: 'activity' });

  return (
    <div className="readable">
      <div className="space-y-8 pb-20">
        <JumpNav sections={SECTIONS} active={activeSection} onJump={jumpTo} base={root} preview={preview} />

      <section id="sec-overview" data-section="overview" className="scroll-mt-20">
        <RealtorOverview deal={deal} root={root} onJump={jumpTo} />
      </section>

      <section id="sec-tasks" data-section="tasks" className="scroll-mt-20 space-y-4">
        <WorkBoard deal={deal} me={me} role="realtor" preview={preview} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SellerPulse deal={deal} />
          <InboxSummary deal={deal} me={me} role="realtor" preview={preview} />
        </div>
      </section>

      <section id="sec-offers" data-section="offers" className="scroll-mt-20">
        <SellerOffer deal={deal} preview={preview} canInvite onAsk={(q) => sendToOwner(deal, me, 'realtor', q, 'Offer question')} />
      </section>

      <section id="sec-what-if" data-section="what-if" className="scroll-mt-20">
        <WhatIfNumbers deal={deal} me={me} role="realtor" preview={preview} />
      </section>

      <section id="sec-walkthrough" data-section="walkthrough" className="scroll-mt-20">
        <Walkthrough deal={deal} me={me} role="realtor" preview={preview} />
      </section>

      <section id="sec-photos" data-section="photos" className="scroll-mt-20 space-y-5">
        <UnitGallery deal={deal} me={me} role="realtor" preview={preview} />
        <Photos deal={deal} role="realtor" me={me} preview={preview} />
      </section>

      {tab === 'tenants' && <Tenants deal={deal} me={me} role="realtor" preview={preview} />}

      <section id="sec-comps" data-section="comps" className="scroll-mt-20">
        <Comps deal={deal} me={me} role="realtor" preview={preview} />
      </section>

      <section id="sec-files" data-section="files" className="scroll-mt-20">
        <Files deal={deal} role="realtor" me={me} title="Documents and files" canShare allowShare preview={preview} />
      </section>

      <section id="sec-messages" data-section="messages" className="scroll-mt-20">
        <Messages deal={deal} me={me} role="realtor" preview={preview} />
      </section>

      <section id="sec-activity" data-section="activity" className="scroll-mt-20 grid gap-6 lg:grid-cols-[1fr_340px]">
        <Activity deal={deal} mode="realtor-seller" preview={preview} title="Recent activity" empty="The seller hasn’t signed in or done anything yet." />
        <div className="space-y-6">
          <SellerPulse deal={deal} />
          {!preview && <AlertsCard topic={member?.ntfy_topic} who="You get a push when someone messages you or the seller does something here." />}
        </div>
      </section>
      </div>
    </div>
  );
}
