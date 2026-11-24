import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Shell, { Button, Card } from '../components/Shell.jsx';

const messages = {
  pending: 'Request sent. The owner will review it. Come back here to check its status.',
  denied: 'The owner did not approve this request.',
  blocked: 'This account has no access. Contact the person who shared this page if you need help.',
  existing: 'You already have access to Charlotte.',
  error: 'Access requests aren’t available right now. Try again in a moment.',
};

export default function RequestAccess({ session }) {
  const [status, setStatus] = useState();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    supabase.rpc('commercial_request_charlotte_access', { p_submit: false }).then(({ data, error }) => {
      if (current) setStatus(error ? 'error' : data);
    });
    return () => { current = false; };
  }, []);

  async function submit() {
    setBusy(true);
    const { data, error } = await supabase.rpc('commercial_request_charlotte_access', { p_submit: true });
    setStatus(error ? 'error' : data);
    setBusy(false);
  }

  return (
    <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">Request access</h1>}>
      <Card className="max-w-md space-y-3">
        <p className="font-medium">Charlotte deal site</p>
        {status === 'ready' && <>
          <p className="text-sm text-ink-soft">Send a request for {session.user.email}. You won’t be able to see the deal unless the owner approves it.</p>
          <Button type="button" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Request access'}</Button>
        </>}
        <p className="text-sm text-ink-soft" role="status">{status ? messages[status] : 'Checking access…'}</p>
        {status === 'existing' && <a href="#/d/charlotte" className="text-sm font-medium underline">Open Charlotte</a>}
      </Card>
    </Shell>
  );
}
