import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Shell, { Card, Button, Field } from '../components/Shell.jsx';

const redirect = () => window.location.origin + window.location.pathname;
const remember = () => { if (window.location.hash.length > 2) localStorage.setItem('returnTo', window.location.hash); };

export default function SignIn({ canRequestAccess, requestingAccess }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');

  const google = async () => {
    remember();
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect() } });
    if (error) setState('Google sign-in isn’t available yet. Use the email link below.');
  };
  const link = async (e) => {
    e.preventDefault();
    remember();
    setState('Sending…');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect(), shouldCreateUser: true } });
    setState(error ? 'That link couldn’t be sent. Try again in a minute.' : 'Check your email for a sign-in link.');
  };

  return (
    <Shell>
      <div className="mx-auto max-w-md pt-6">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Welcome</h1>
        <p className="mt-2 text-ink-soft">{requestingAccess ? 'Sign in to verify your email before requesting access to Charlotte.' : 'Sign in to see the property page you were invited to.'}</p>
        <Card className="mt-6 space-y-4">
          <Button className="w-full" onClick={google}>Continue with Google</Button>
          <div className="flex items-center gap-3 text-xs text-ink-soft"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <form onSubmit={link} className="space-y-3">
            <Field type="email" required placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button kind="secondary" className="w-full" type="submit">Email me a sign-in link</Button>
          </form>
          {state && <p className="text-sm text-ink-soft">{state}</p>}
        </Card>
        {canRequestAccess && !requestingAccess && <a className="mt-3 inline-flex rounded-xl border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-warm-soft" href="#/request-access">Request access</a>}
      </div>
    </Shell>
  );
}
