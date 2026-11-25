import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Shell, { Button, Card } from '../components/Shell.jsx';

const REQUEST_ROLES = [
  ['seller', 'Seller'],
  ['lender', 'Lender'],
  ['realtor', 'Realtor'],
  ['reviewer', 'Reviewer'],
  ['lead_guest', 'Lead guest (deal overview & lead offer)'],
  ['viewer', 'Viewer'],
];

const messages = {
  pending: 'Request sent. The owner will review it. Come back here to check its status.',
  denied: 'The owner did not approve this request.',
  blocked: 'This account has no access. Contact the person who shared this page if you need help.',
  existing: 'You already have access to Charlotte.',
  error: 'Access requests aren’t available right now. Try again in a moment.',
};

export default function RequestAccess({ session }) {
  const [status, setStatus] = useState();
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    supabase.rpc('commercial_request_charlotte_access', { p_submit: false, p_requested_role: null }).then(({ data, error }) => {
      if (current) setStatus(error ? 'error' : data);
    });
    return () => { current = false; };
  }, []);

  async function submit(e) {
    e?.preventDefault();
    if (!role || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('commercial_request_charlotte_access', {
      p_submit: true,
      p_requested_role: role,
    });
    setStatus(error ? 'error' : data);
    setBusy(false);
  }

  return (
    <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">Request access</h1>}>
      <Card className="max-w-md space-y-3">
        <p className="font-medium">Charlotte deal site</p>
        {status === 'ready' && (
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-medium">
              Which role are you requesting?
              <select
                required
                aria-label="Which role are you requesting?"
                value={role}
                disabled={busy}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
              >
                <option value="">Choose a role</option>
                {REQUEST_ROLES.map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy || !role}>{busy ? 'Sending…' : 'Request access'}</Button>
          </form>
        )}
        <p className="text-sm text-ink-soft" role="status">{status ? messages[status] : 'Checking access…'}</p>
        {status === 'existing' && <a href="#/d/charlotte" className="text-sm font-medium underline">Open Charlotte</a>}
      </Card>
    </Shell>
  );
}
