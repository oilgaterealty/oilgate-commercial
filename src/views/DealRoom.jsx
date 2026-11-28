import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase.js';
import { roleLabel } from '../lib/format.js';
import { setDealNames, buyerName } from '../lib/people.js';
import { getLiveSellerSummary, subscribeDealStore } from '../lib/dealStore.js';
import Shell, { Card, Empty, PropertyHead } from '../components/Shell.jsx';
import { PUBLIC_SITE, SITE_KIND, roleAllowedHere } from '../lib/site.js';
import { normalizeLenderLens } from '../lib/lenderLens.js';

const Owner = import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller' ? null : lazy(() => import('./Owner.jsx'));
const Realtor = import.meta.env.VITE_SITE_KIND === 'seller' ? null : lazy(() => import('./Realtor.jsx'));
const Seller = import.meta.env.VITE_SITE_KIND === 'public' ? null : lazy(() => import('./Seller.jsx'));
const Lender = import.meta.env.VITE_SITE_KIND === 'seller' ? null : lazy(() => import('./Lender.jsx'));
const Reviewer = import.meta.env.VITE_SITE_KIND === 'seller' ? null : lazy(() => import('./Reviewer.jsx'));

const PREVIEWABLE = ['seller', 'realtor', 'reviewer', 'lender', 'viewer'];

function Page({ role, ...p }) {
  if (role === 'owner' && Owner) return <Owner {...p} />;
  if (role === 'realtor' && Realtor) return <Realtor {...p} />;
  if (role === 'seller' && Seller) return <Seller {...p} />;
  if (role === 'lender' && Lender) return <Lender {...p} />;
  if (Reviewer) return <Reviewer {...p} role={role} />; // reviewer, viewer, guest
  return null;
}

export default function DealRoom({ slug, tab, sub, session, urlLens = '' }) {
  const [state, setState] = useState({ loading: true });
  const viewing = tab === 'view';

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: role }, { data: deal }] = await Promise.all([
        supabase.rpc('commercial_my_role', { p_slug: slug }),
        supabase.from('commercial_deals').select('*').eq('slug', slug).maybeSingle(),
      ]);
      if (!alive) return;
      const { data: member } = await supabase.from('commercial_members').select('display_name,company,default_lens,ntfy_topic,role').eq('deal_id', deal?.id ?? '00000000-0000-0000-0000-000000000000').eq('email', session.user.email.toLowerCase()).maybeSingle();
      if (!alive) return;
      setState({ loading: false, role, deal, member });
      if (deal && role && role !== 'owner' && roleAllowedHere(SITE_KIND, role)) {
        try {
          await supabase.rpc('commercial_log_view', { p_slug: slug });
        } catch {
          // view logging is best-effort
        }
      }
    })();
    return () => { alive = false; };
  }, [slug, session.user.email, viewing]);

  const dealId = state.deal?.id;
  const liveSellerSummary = useSyncExternalStore(
    (cb) => (dealId ? subscribeDealStore(dealId, cb) : () => {}),
    () => (dealId ? getLiveSellerSummary(dealId) : null),
    () => (dealId ? getLiveSellerSummary(dealId) : null),
  );

  // Names follow who is looking: the seller (and "See as seller") never gets the buyer's name.
  setDealNames(state.deal, viewing && state.role === 'owner' && PREVIEWABLE.includes(sub) ? sub : state.role);
  const me = {
    uid: session.user.id,
    email: session.user.email.toLowerCase(),
    name: state.member?.display_name || (state.role === 'owner' && state.deal ? buyerName(state.deal) : ''),
    company: state.member?.company || '',
  };
  const cleanUrlLens = normalizeLenderLens(urlLens);
  const initialLens = cleanUrlLens || normalizeLenderLens(state.member?.default_lens) || 'bridge';

  if (state.loading) return <Shell session={session}><Empty>Loading…</Empty></Shell>;
  if (!state.deal || !state.role) {
    return (
      <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">No access yet</h1>}>
        <Card><Empty>This email ({session.user.email}) hasn’t been added to this property. Ask the person who invited you to add it, then refresh.</Empty></Card>
      </Shell>
    );
  }

  if (!roleAllowedHere(SITE_KIND, state.role)) {
    return (
      <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">Not here</h1>}>
        <Card><Empty>{state.role === 'seller' ? <>Your page is at <a className="underline" href={PUBLIC_SITE}>{PUBLIC_SITE.replace(/^https:\/\/|\/$/g, '')}</a>.</> : 'Open the private link you were sent.'}</Empty></Card>
      </Shell>
    );
  }

  // Full-screen "see as" for the owner: the exact page that role gets, with nothing sendable.
  if (viewing && state.role === 'owner' && PREVIEWABLE.includes(sub)) {
    const innerTab = (window.location.hash.split('/')[5] || '').split('?')[0];
    return (
      <div className="min-h-screen">
        <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-ink px-4 py-1.5 text-xs text-white">
          <span>Seeing it as the {roleLabel[sub].toLowerCase()}. Nothing can be sent from here.</span>
          {PREVIEWABLE.filter((r) => r !== sub).map((r) => <a key={r} href={`#/d/${slug}/view/${r}`} className="shrink-0 underline-offset-2 opacity-70 hover:underline hover:opacity-100">{roleLabel[r]}</a>)}
          <a href={`#/d/${slug}`} className="shrink-0 rounded-full bg-white px-3 py-0.5 font-medium text-ink">Exit</a>
        </div>
        <Shell head={<PropertyHead deal={state.deal} role={sub} />} wide={sub === 'seller'}>
          <Suspense fallback={<Empty>Loading…</Empty>}>
            <Page role={sub} deal={state.deal} me={{ email: '__preview__', name: 'Preview', company: '' }} preview tab={innerTab} initialLens={cleanUrlLens || 'bridge'} urlLens={cleanUrlLens} liveSummary={sub === 'seller' ? liveSellerSummary : null} />
          </Suspense>
        </Shell>
      </div>
    );
  }

  const settingsActive = tab === 'settings' || tab === 'people';
  const ownerHeaderAction = state.role === 'owner' ? (
    <a
      href={settingsActive ? `#/d/${state.deal.slug}` : `#/d/${state.deal.slug}/settings`}
      aria-label="Settings"
      aria-pressed={settingsActive}
      data-settings-gear="true"
      title="Settings"
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border transition ${
        settingsActive
          ? 'border-ink bg-ink text-white'
          : 'border-line bg-white text-ink hover:border-ink'
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="2.6" />
        <path d="M10 2.5v1.6M10 15.9v1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M2.5 10h1.6M15.9 10h1.6M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
      </svg>
    </a>
  ) : null;

  return (
    <Shell session={session} role={roleLabel[state.role]} head={<PropertyHead deal={state.deal} role={state.role} />} headerAction={ownerHeaderAction} wide={state.role === 'seller' || state.role === 'owner'}>
      <Suspense fallback={<Empty>Loading…</Empty>}>
        <Page role={state.role} deal={state.deal} me={me} member={state.member} session={session} tab={tab} initialLens={initialLens} urlLens={cleanUrlLens} />
      </Suspense>
    </Shell>
  );
}
