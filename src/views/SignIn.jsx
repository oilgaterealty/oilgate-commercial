import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Shell, { Card, Button, Field, InfoTip } from '../components/Shell.jsx';
import RoleChoice from '../components/RoleChoice.jsx';
import { readRequestRole, saveRequestRole } from '../lib/requestRoles.js';
import { appendLensToHash, normalizeLenderLens, readLensFromLocation, readStoredLenderLens, saveStoredLenderLens } from '../lib/lenderLens.js';

import { SITE_KIND } from '../lib/site.js';
import { POPUP_QUERY_PARAM, isPopupSignInFlow } from '../lib/frameAuth.js';

const redirect = (lens = '') => {
  const base = window.location.origin + window.location.pathname;
  const params = new URLSearchParams();
  if (SITE_KIND === 'owner' && isPopupSignInFlow(window)) params.set(POPUP_QUERY_PARAM, '1');
  const cleanLens = normalizeLenderLens(lens);
  if (cleanLens) params.set('lens', cleanLens);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
};
const remember = (lens = '') => {
  if (window.location.hash.length > 2) localStorage.setItem('returnTo', window.location.hash);
  if (lens) saveStoredLenderLens(lens);
};

export default function SignIn({ canRequestAccess, requestingAccess, urlLens = '' }) {
  const activeLens = normalizeLenderLens(urlLens)
    || (typeof window !== 'undefined' ? readLensFromLocation(window.location.hash, window.location.search) : '')
    || readStoredLenderLens();
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');
  const [role, setRole] = useState(() => {
    if (!requestingAccess) return '';
    const stored = readRequestRole();
    if (stored) return stored;
    return activeLens ? 'lender' : '';
  });
  const blocked = requestingAccess && !role;

  useEffect(() => {
    if (requestingAccess && activeLens && !readRequestRole()) {
      setRole((cur) => cur || 'lender');
      saveRequestRole('lender');
    }
  }, [requestingAccess, activeLens]);

  const pick = (r) => { setRole(r); saveRequestRole(r); };

  const google = async () => {
    if (blocked) return;
    if (requestingAccess && role) saveRequestRole(role);
    remember(activeLens);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect(activeLens) } });
    if (error) setState('Google sign-in isn’t available yet. Use the email link below.');
  };
  const link = async (e) => {
    e.preventDefault();
    if (blocked) return;
    if (requestingAccess && role) saveRequestRole(role);
    remember(activeLens);
    setState('Sending…');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect(activeLens), shouldCreateUser: true } });
    setState(error ? 'That link couldn’t be sent. Try again in a minute.' : 'Check your email for the link.');
  };

  const signInButtons = (
    <>
      <Button className="w-full" onClick={google} disabled={blocked}>
        {requestingAccess ? 'Send request with Google' : 'Continue with Google'}
      </Button>
      <div className="flex items-center gap-3 text-xs text-ink-soft"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
      <form onSubmit={link} className="space-y-3">
        <Field type="email" required placeholder="you@email.com" value={email} disabled={blocked} onChange={(e) => setEmail(e.target.value)} />
        <Button kind="secondary" className="w-full" type="submit" disabled={blocked}>
          {requestingAccess ? 'Email me a link to send it' : 'Email me a sign-in link'}
        </Button>
      </form>
      {state && <p role="status" className="text-sm text-ink">{state}</p>}
    </>
  );

  if (requestingAccess) {
    return (
      <Shell>
        <div className="mx-auto max-w-md pt-6">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl font-semibold tracking-tight">Request access</h1>
            <InfoTip label="How to request access" lines={['Pick your role, then verify your email.']} />
          </div>
          <Card className="mt-6 space-y-5">
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">1. Your role</h2>
              <RoleChoice value={role} onChange={pick} />
            </section>
            <section className={`space-y-4 transition ${blocked ? 'opacity-50' : ''}`}>
              <h2 className="text-sm font-semibold text-ink">2. Verify your email and send</h2>
              {signInButtons}
            </section>
          </Card>
          <a className="mt-3 inline-flex text-sm font-medium underline-offset-2 hover:underline" href={appendLensToHash('#/', activeLens)}>Back to sign in</a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md pt-6">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Welcome</h1>
          <InfoTip label="Signing in" lines={['Sign in to see the property page you were invited to.']} />
        </div>
        <Card className="mt-6 space-y-4">{signInButtons}</Card>
        {canRequestAccess && <a className="mt-3 inline-flex rounded-xl border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-warm-soft" href={appendLensToHash('#/request-access', activeLens)}>Request access</a>}
      </div>
    </Shell>
  );
}
