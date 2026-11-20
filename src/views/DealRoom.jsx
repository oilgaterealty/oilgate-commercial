import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { roleLabel } from '../lib/format.js';
import Shell, { Card, Empty } from '../components/Shell.jsx';
import Owner from './Owner.jsx';
import Realtor from './Realtor.jsx';
import Seller from './Seller.jsx';

export default function DealRoom({ slug, tab, session }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    (async () => {
      const [{ data: role }, { data: deal }] = await Promise.all([
        supabase.rpc('my_role', { p_slug: slug }),
        supabase.from('deals').select('*').eq('slug', slug).maybeSingle(),
      ]);
      const { data: member } = await supabase.from('deal_members').select('display_name,ntfy_topic,role').eq('deal_id', deal?.id ?? '00000000-0000-0000-0000-000000000000').eq('email', session.user.email.toLowerCase()).maybeSingle();
      setState({ loading: false, role, deal, member });
      if (deal && role && role !== 'owner') supabase.rpc('log_view', { p_slug: slug });
    })();
  }, [slug, session.user.email]);

  const me = { email: session.user.email.toLowerCase(), name: state.member?.display_name || (state.role === 'owner' ? 'LaVante' : '') };

  if (state.loading) return <Shell session={session}><Empty>Loading…</Empty></Shell>;
  if (!state.deal || !state.role) {
    return (
      <Shell session={session} title="No access yet">
        <Card><Empty>This email ({session.user.email}) hasn’t been added to this property. Ask the person who invited you to add it, then refresh.</Empty></Card>
      </Shell>
    );
  }

  const props = { deal: state.deal, me, member: state.member, session, tab };
  return (
    <Shell session={session} role={roleLabel[state.role]}>
      {state.role === 'owner' && <Owner {...props} />}
      {(state.role === 'realtor' || state.role === 'guest') && <Realtor {...props} role={state.role} />}
      {state.role === 'seller' && <Seller {...props} />}
      {state.role === 'lender' && <Card><Empty>Lender pages are coming soon.</Empty></Card>}
    </Shell>
  );
}
