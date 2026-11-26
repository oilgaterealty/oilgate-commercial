import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Shell, { Button, Card } from '../components/Shell.jsx';
import RoleChoice from '../components/RoleChoice.jsx';
import { clearRequestRole, readRequestRole, saveRequestRole } from '../lib/requestRoles.js';

const messages = {
  pending: 'Request sent.',
  denied: 'Not approved.',
  blocked: 'This account has no access.',
  existing: 'You already have access.',
  error: 'Try again in a moment.',
};

export default function RequestAccess({ session }) {
  const [status, setStatus] = useState();
  const [role, setRole] = useState(() => readRequestRole());
  const [busy, setBusy] = useState(false);
  const autoSent = useRef(false);

  async function send(r) {
    if (!r || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('commercial_request_charlotte_access', { p_submit: true, p_requested_role: r });
    setStatus(error ? 'error' : data);
    if (!error) clearRequestRole();
    setBusy(false);
  }

  useEffect(() => {
    let current = true;
    supabase.rpc('commercial_request_charlotte_access', { p_submit: false, p_requested_role: null }).then(({ data, error }) => {
      if (!current) return;
      const next = error ? 'error' : data;
      setStatus(next);
      const stored = readRequestRole();
      if (next === 'ready' && stored && !autoSent.current) {
        autoSent.current = true;
        void send(stored);
      } else if (next !== 'ready') {
        clearRequestRole();
      }
    });
    return () => { current = false; };
  }, []);

  const pick = (r) => { setRole(r); saveRequestRole(r); };

  return (
    <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">Request access</h1>}>
      <Card className="max-w-md space-y-3">
        {status === 'ready' && !busy && (
          <form onSubmit={(e) => { e.preventDefault(); void send(role); }} className="space-y-3">
            <RoleChoice value={role} onChange={pick} disabled={busy} />
            <Button type="submit" disabled={busy || !role}>Request access</Button>
          </form>
        )}
        <p className="text-sm font-medium text-ink" role="status">{busy ? 'Sending…' : status && status !== 'ready' ? messages[status] : !status ? 'Checking…' : ''}</p>
        {status === 'existing' && <a href="#/d/charlotte" className="text-sm font-medium underline">Open Charlotte</a>}
      </Card>
    </Shell>
  );
}
