import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { supabase, configured } from './lib/supabase.js';
import { useHashRoute } from './lib/useHashRoute.js';
import { SITE_KIND, siteRules, requestAccessAllowed, openViewerAllowed } from './lib/site.js';
import {
  POPUP_QUERY_PARAM,
  clearPopupSignInFlow,
  deliverPopupSession,
  isPopupSignInFlow,
  isValidSessionMessage,
  markPopupSignInFlow,
} from './lib/frameAuth.js';
import SignIn from './views/SignIn.jsx';
import Home from './views/Home.jsx';
import DealRoom from './views/DealRoom.jsx';
import Join from './views/Join.jsx';
import RequestAccess from './views/RequestAccess.jsx';
import Shell, { Button, Card, Empty } from './components/Shell.jsx';

const OpenViewer =
  import.meta.env.VITE_SITE_KIND === 'seller' || import.meta.env.VITE_SITE_KIND === 'owner'
    ? null
    : lazy(() => import('./views/OpenViewer.jsx'));

const rules = siteRules(SITE_KIND);

export default function App({ framedOwner = false }) {
  const route = useHashRoute();
  const [session, setSession] = useState(undefined);
  const [isOwner, setIsOwner] = useState(undefined);
  const popupRef = useRef(null);

  useEffect(() => {
    if (!configured) return;
    if (!framedOwner && SITE_KIND === 'owner') markPopupSignInFlow(window);
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      const back = localStorage.getItem('returnTo');
      if (s && back) { localStorage.removeItem('returnTo'); window.location.hash = back; }
    });
    return () => data.subscription.unsubscribe();
  }, [framedOwner]);

  useEffect(() => {
    if (!configured || !framedOwner) return;
    const onMessage = (event) => {
      if (!isValidSessionMessage(event, window.location.origin, popupRef.current)) return;
      popupRef.current = null;
      supabase.auth.setSession({
        access_token: event.data.access_token,
        refresh_token: event.data.refresh_token,
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [framedOwner]);

  useEffect(() => {
    if (!configured || framedOwner || SITE_KIND !== 'owner') return;
    if (!session || !window.opener || !isPopupSignInFlow(window)) return;
    clearPopupSignInFlow(window);
    deliverPopupSession(session, window);
  }, [framedOwner, session]);

  // Owner or not decides which site may show anything. Checked before any page loads its data.
  useEffect(() => {
    if (!session) { setIsOwner(undefined); return; }
    supabase.from('commercial_owners').select('email').then(({ data }) => setIsOwner((data || []).length > 0));
  }, [session?.user?.id]);

  if (!configured) return <Shell><p className="text-ink-soft">This site isn't connected to its database yet.</p></Shell>;
  if (route.name === 'open-viewer') {
    if (!openViewerAllowed(SITE_KIND) || !OpenViewer) return <Closed text="Open the link you were sent." />;
    return (
      <Suspense fallback={<Shell><p className="text-ink-soft">Loading…</p></Shell>}>
        <OpenViewer slug={route.slug} token={route.token} tab={route.tab} />
      </Suspense>
    );
  }
  if (session === undefined) return <Shell><p className="text-ink-soft">Loading…</p></Shell>;
  if (!session) {
    if (framedOwner) {
      const openPopup = () => {
        const target = `${window.location.origin}${window.location.pathname}?${POPUP_QUERY_PARAM}=1`;
        popupRef.current = window.open(target, 'og-owner-signin', 'popup=yes,width=500,height=640');
      };
      return (
        <Shell>
          <div className="mx-auto max-w-xs pt-12">
            <Card className="flex justify-center">
              <Button onClick={openPopup}>Sign in</Button>
            </Card>
          </div>
        </Shell>
      );
    }
    return <SignIn canRequestAccess={rules.guestsAllowed && requestAccessAllowed(SITE_KIND) && route.name !== 'join'} requestingAccess={route.name === 'request-access' && rules.guestsAllowed && requestAccessAllowed(SITE_KIND)} />;
  }
  if (isOwner === undefined) return <Shell session={session}><p className="text-ink-soft">Loading…</p></Shell>;
  if (isOwner && !rules.ownerAllowed) return <Closed session={session} text="You’re signed in as the buyer. Your page opens only at your private address." />;
  if (!isOwner && !rules.guestsAllowed) return <Closed session={session} text="There’s nothing here for this email." />;
  if (!isOwner && rules.guestsAllowed && requestAccessAllowed(SITE_KIND) && route.name === 'request-access') return <RequestAccess key={session.user.id} session={session} />;
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
