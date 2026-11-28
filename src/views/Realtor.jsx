import { Suspense, lazy, useEffect, useState } from 'react';
import Walkthrough from './Walkthrough.jsx';
import Tenants from './Tenants.jsx';
import Comps from './Comps.jsx';
import { Card, CardTitle, Empty, JumpNav, useSectionScroll } from '../components/Shell.jsx';
import { InPagePanel, OverviewActionButtons } from '../components/OverlaySheet.jsx';
import { useSheetBadges } from '../lib/sheetBadges.js';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import Files, { useUploads } from '../components/Files.jsx';
import Photos, { Cover, useDealGallery } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import Activity from '../components/Activity.jsx';
import { SellerPulse, AlertsCard } from '../components/Pulse.jsx';
import SellerOffer, { useSellerOffer } from '../components/SellerOffer.jsx';
import { WorkBoard } from '../components/DealWorkspace.jsx';
import { WhatIfNumbers } from '../components/Switches.jsx';
import { useDealModel } from '../lib/useDealModel.js';
import { supabase } from '../lib/supabase.js';
import { money } from '../lib/dealmath.js';
import { SITE_KIND, canAccessCityRecords } from '../lib/site.js';

export { SellerPulse, AlertsCard };

const CityRecords = lazy(() => import('./CityRecords.jsx'));

const INTEREST = { interested: 'Seller wants to talk', questions: 'Seller has questions', not_now: 'Seller: not right now' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const SECTIONS = [
  ['overview', 'Overview'],
  ['offers', 'The offer'],
  ['walkthrough', 'Walkthrough'],
];

const PANEL_ALIASES = {
  photos: 'photos',
  files: 'documents',
  documents: 'documents',
  messages: 'messages',
  'city-records': 'city-records',
  comps: 'comps',
  activity: 'activity',
  seller: 'activity',
};
const PANEL_TITLES = {
  photos: 'Photos by unit',
  documents: 'Documents',
  messages: 'Messages',
  'city-records': 'City records',
  comps: 'Comps',
  activity: 'Recent activity',
};

function RealtorOverview({ deal, me, preview, root, onJump, onOpenPanel, offerState }) {
  const [rows] = useUploads(deal);
  const gallery = useDealGallery(deal, 'realtor', preview, { externalRows: rows });
  const docs = (rows || []).filter((r) => r.kind === 'document');
  const { docBadge, msgBadge } = useSheetBadges({ deal, me, role: 'realtor', preview, docs });
  const { row, summary } = offerState;
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

  const leadHeadline = summary?.title || (row?.name ? row.name.replace(/^[A-Z]\s*:\s*/, '') : 'Not shared yet');
  const statusText = INTEREST[interest] || cap(deal.status);
  const nextStep = nextTask || summary?.steps?.[0]?.title || 'Share the offer with the seller';
  const planTotal = +(summary?.stepBudgets?.total || summary?.guide?.costSummary?.total || 0);
  const shownRehab = planTotal > 0 ? money(planTotal) : (base ? money(+(base.rehab || 0)) : '…');

  return (
    <div className="space-y-4">
      <Cover items={gallery.items} compact onOpenUnitGallery={() => onOpenPanel('photos')} />
      <OverviewActionButtons
        showDocuments
        showMessages
        showCityRecords={canAccessCityRecords(SITE_KIND, 'realtor', preview)}
        showComps
        docCount={docBadge}
        msgCount={msgBadge}
        onOpenDocuments={() => onOpenPanel('documents')}
        onOpenMessages={() => onOpenPanel('messages')}
        onOpenCityRecords={() => onOpenPanel('city-records')}
        onOpenComps={() => onOpenPanel('comps')}
      />
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
            <dd className="mt-1 font-display text-xl font-semibold">{shownRehab}</dd>
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
      <WorkBoard deal={deal} me={me} role="realtor" preview={preview} compactLimit={3} />
      <Activity
        deal={deal}
        mode="realtor-seller"
        preview={preview}
        title="Latest"
        empty="The seller hasn’t signed in or done anything yet."
        compactLimit={3}
        onSeeAll={() => onOpenPanel('activity')}
      />
    </div>
  );
}

// Consolidated 3-tab realtor workspace: Overview (with Tasks, Latest 3, & tool buttons), The offer, Walkthrough.
// "readable" lifts small text to phone-friendly sizes (see index.css).
export default function Realtor({ deal, me, member, preview, tab }) {
  const root = preview ? `#/d/${deal.slug}/view/realtor` : `#/d/${deal.slug}`;
  const [panel, setPanel] = useState(() => PANEL_ALIASES[tab] || null);
  const [whatIfOpen, setWhatIfOpen] = useState(() => tab === 'what-if');
  const { activeSection, jumpTo: scrollJumpTo } = useSectionScroll(tab, SECTIONS, {
    tasks: 'overview',
    'what-if': 'offers',
    ...Object.fromEntries(Object.keys(PANEL_ALIASES).map((k) => [k, 'overview'])),
  });
  const fetchedOfferState = useSellerOffer(deal);
  const model = useDealModel(deal, { owner: false, onlyShared: preview ? 'realtor' : undefined });
  const offerState = model.liveSummary
    ? { loaded: true, row: model.offers?.[0] || fetchedOfferState.row || null, summary: model.liveSummary }
    : fetchedOfferState;
  const planRepairBudget = +(offerState.summary?.stepBudgets?.total || offerState.summary?.guide?.costSummary?.total || 0);

  useEffect(() => {
    setPanel(PANEL_ALIASES[tab] || null);
    if (tab === 'what-if') setWhatIfOpen(true);
  }, [tab]);

  const jumpTo = (k, base) => {
    setPanel(null);
    scrollJumpTo(k, base);
  };

  const openPanel = (kind) => {
    const clean = PANEL_ALIASES[kind] || kind;
    setPanel(clean);
    const next = `${root}/${clean === 'documents' ? 'files' : clean}`;
    if (typeof window !== 'undefined' && window.location.hash !== next) {
      window.location.hash = next;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const closePanel = () => {
    setPanel(null);
    if (typeof window !== 'undefined' && window.location.hash !== root) {
      window.location.hash = root;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const navActive = panel ? 'overview' : activeSection;

  return (
    <div className="readable">
      <div className="space-y-6 pb-20">
        <JumpNav sections={SECTIONS} active={navActive} onJump={jumpTo} base={root} preview={preview} />

        <InPagePanel open={Boolean(panel)} kind={panel || 'panel'} title={PANEL_TITLES[panel] || ''} onClose={closePanel}>
          {panel === 'photos' && (
            <div className="space-y-5">
              <UnitGallery deal={deal} me={me} role="realtor" preview={preview} />
              <Photos deal={deal} role="realtor" me={me} preview={preview} />
            </div>
          )}
          {panel === 'documents' && (
            <Files deal={deal} role="realtor" me={me} title="Documents and files" canShare allowShare preview={preview} />
          )}
          {panel === 'messages' && (
            <Messages deal={deal} me={me} role="realtor" preview={preview} />
          )}
          {panel === 'city-records' && canAccessCityRecords(SITE_KIND, 'realtor', preview) && (
            <Suspense fallback={<Empty>Loading…</Empty>}>
              <CityRecords deal={deal} role="realtor" preview={preview} />
            </Suspense>
          )}
          {panel === 'comps' && (
            <Comps deal={deal} me={me} role="realtor" preview={preview} />
          )}
          {panel === 'activity' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              <Activity deal={deal} mode="realtor-seller" preview={preview} title="Recent activity" empty="The seller hasn’t signed in or done anything yet." />
              <div className="space-y-6">
                <SellerPulse deal={deal} />
                {!preview && <AlertsCard topic={member?.ntfy_topic} who="You get a push when someone messages you or the seller does something here." />}
              </div>
            </div>
          )}
        </InPagePanel>

        {!panel && (
          <>
            <section id="sec-overview" data-section="overview" className="scroll-mt-20">
              <RealtorOverview deal={deal} me={me} preview={preview} root={root} onJump={jumpTo} onOpenPanel={openPanel} offerState={offerState} />
            </section>

            <section id="sec-offers" data-section="offers" className="scroll-mt-20 space-y-5">
              <SellerOffer deal={deal} preview={preview} canInvite offerState={offerState} onAsk={(q) => sendToOwner(deal, me, 'realtor', q, 'Offer question')} />
              <Card>
                <button
                  type="button"
                  aria-expanded={whatIfOpen}
                  data-realtor-whatif-toggle
                  onClick={() => setWhatIfOpen((v) => !v)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
                >
                  <span className="font-display text-xl font-semibold text-ink">What-if numbers</span>
                  <span aria-hidden="true" className="text-sm text-ink-soft">{whatIfOpen ? '▴' : '▾'}</span>
                </button>
                {whatIfOpen && (
                  <div className="mt-4 border-t border-line pt-4">
                    <WhatIfNumbers deal={deal} me={me} role="realtor" preview={preview} planRepairBudget={planRepairBudget} />
                  </div>
                )}
              </Card>
            </section>

            <section id="sec-walkthrough" data-section="walkthrough" className="scroll-mt-20">
              <Walkthrough deal={deal} me={me} role="realtor" preview={preview} />
            </section>
          </>
        )}

        {tab === 'tenants' && <Tenants deal={deal} me={me} role="realtor" preview={preview} />}
      </div>
    </div>
  );
}
