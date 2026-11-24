import { useEffect, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';
import { useHashRoute } from './lib/useHashRoute.js';
import { SITE_KIND, siteRules } from './lib/site.js';
import SignIn from './views/SignIn.jsx';
import Home from './views/Home.jsx';
import DealRoom from './views/DealRoom.jsx';
import Join from './views/Join.jsx';
import Shell, { Card, Empty } from './components/Shell.jsx';

const rules = siteRules(SITE_KIND);

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState(undefined);
  const [isOwner, setIsOwner] = useState(undefined);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      const back = localStorage.getItem('returnTo');
      if (s && back) { localStorage.removeItem('returnTo'); window.location.hash = back; }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Owner or not decides which site may show anything. Checked before any page loads its data.
  useEffect(() => {
    if (!session) { setIsOwner(undefined); return; }
    supabase.from('commercial_owners').select('email').then(({ data }) => setIsOwner((data || []).length > 0));
  }, [session?.user?.id]);

  if (!configured) return <Shell><p className="text-ink-soft">This site isn't connected to its database yet.</p></Shell>;
  if (session === undefined) return <Shell><p className="text-ink-soft">Loading…</p></Shell>;
  if (!session) return <SignIn />;
  if (isOwner === undefined) return <Shell session={session}><p className="text-ink-soft">Loading…</p></Shell>;
  if (isOwner && !rules.ownerAllowed) return <Closed session={session} text="You’re signed in as the buyer. Your page opens only at your private address." />;
  if (!isOwner && !rules.guestsAllowed) return <Closed session={session} text="There’s nothing here for this email." />;
  if (route.name === 'join') return <Join token={route.token} session={session} />;
  return route.name === 'deal'
    ? <DealRoom key={`${session.user.id}:${route.slug}`} slug={route.slug} tab={route.tab} sub={route.sub} session={session} />
    : <Home session={session} />;
}

function Closed({ session, text }) {
  return (
    <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">Not here</h1>}>
      <Card><Empty>{text}</Empty></Card>
    </Shell>
  );
}
