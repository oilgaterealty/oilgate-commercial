import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { roleLabel } from '../lib/format.js';
import Shell, { Card, Empty, PropertyHead } from '../components/Shell.jsx';
import Owner from './Owner.jsx';
import Realtor from './Realtor.jsx';
import Seller from './Seller.jsx';
import Reviewer from './Reviewer.jsx';
import Lender from './Lender.jsx';

const PREVIEWABLE = ['seller', 'realtor', 'reviewer', 'lender', 'viewer'];

function Page({ role, ...p }) {
  if (role === 'owner') return <Owner {...p} />;
  if (role === 'realtor') return <Realtor {...p} />;
  if (role === 'seller') return <Seller {...p} />;
  if (role === 'lender') return <Lender {...p} />;
  return <Reviewer {...p} role={role} />; // reviewer, viewer, guest
}

export default function DealRoom({ slug, tab, sub, session }) {
  const [state, setState] = useState({ loading: true });
  const viewing = tab === 'view';

  useEffect(() => {
    (async () => {
      const [{ data: role }, { data: deal }] = await Promise.all([
        supabase.rpc('commercial_my_role', { p_slug: slug }),
        supabase.from('commercial_deals').select('*').eq('slug', slug).maybeSingle(),
      ]);
      const { data: member } = await supabase.from('commercial_members').select('display_name,ntfy_topic,role').eq('deal_id', deal?.id ?? '00000000-0000-0000-0000-000000000000').eq('email', session.user.email.toLowerCase()).maybeSingle();
      setState({ loading: false, role, deal, member });
      if (deal && role && role !== 'owner') supabase.rpc('commercial_log_view', { p_slug: slug });
    })();
  }, [slug, session.user.email, viewing]);

  const me = { email: session.user.email.toLowerCase(), name: state.member?.display_name || (state.role === 'owner' ? 'LaVante' : '') };

  if (state.loading) return <Shell session={session}><Empty>Loading…</Empty></Shell>;
  if (!state.deal || !state.role) {
    return (
      <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">No access yet</h1>}>
        <Card><Empty>This email ({session.user.email}) hasn’t been added to this property. Ask the person who invited you to add it, then refresh.</Empty></Card>
      </Shell>
    );
  }

  // Full-screen "see as" for the owner: the exact page that role gets, with nothing sendable.
  if (viewing && state.role === 'owner' && PREVIEWABLE.includes(sub)) {
    const innerTab = (window.location.hash.split('/')[5] || '').split('?')[0];
    return (
      <div className="min-h-screen">
        <div className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-ink px-4 py-1.5 text-xs text-white">
          <span>Seeing it as the {roleLabel[sub].toLowerCase()}. Nothing can be sent from here.</span>
          {PREVIEWABLE.filter((r) => r !== sub).map((r) => <a key={r} href={`#/d/${slug}/view/${r}`} className="underline-offset-2 opacity-70 hover:underline hover:opacity-100">{roleLabel[r]}</a>)}
          <a href={`#/d/${slug}`} className="rounded-full bg-white px-3 py-0.5 font-medium text-ink">Exit</a>
        </div>
        <Shell head={<PropertyHead deal={state.deal} />} wide={sub === 'seller'}>
          <Page role={sub} deal={state.deal} me={{ email: '__preview__', name: 'Preview' }} preview tab={innerTab} />
        </Shell>
      </div>
    );
  }

  return (
    <Shell session={session} role={roleLabel[state.role]} head={<PropertyHead deal={state.deal} />} wide={state.role === 'seller' || state.role === 'owner'}>
      <Page role={state.role} deal={state.deal} me={me} member={state.member} session={session} tab={tab} />
    </Shell>
  );
}
