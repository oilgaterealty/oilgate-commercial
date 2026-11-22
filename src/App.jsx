import { useEffect, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';
import { useHashRoute } from './lib/useHashRoute.js';
import SignIn from './views/SignIn.jsx';
import Home from './views/Home.jsx';
import DealRoom from './views/DealRoom.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState(undefined);

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

  if (!configured) return <Shell><p className="text-ink-soft">This site isn't connected to its database yet.</p></Shell>;
  if (session === undefined) return <Shell><p className="text-ink-soft">Loading…</p></Shell>;
  if (!session) return <SignIn />;
  return route.name === 'deal'
    ? <DealRoom key={`${session.user.id}:${route.slug}`} slug={route.slug} tab={route.tab} sub={route.sub} session={session} />
    : <Home session={session} />;
}
