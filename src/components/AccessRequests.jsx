import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { roleLabel, when } from '../lib/format.js';
import { Button, Card, CardTitle, Empty } from './Shell.jsx';

const roles = ['reviewer', 'lender', 'viewer', 'realtor', 'seller', 'lead_guest'];

export default function AccessRequests({ dealId, onApproved }) {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function load() {
    const { data, error } = await supabase.from('commercial_access_requests')
      .select('id,email,requested_role,created_at').eq('deal_id', dealId).eq('status', 'pending').order('created_at');
    setRows(data || []);
    setSelected((cur) => { const next = { ...cur }; for (const r of data || []) if (!next[r.id] && roles.includes(r.requested_role)) next[r.id] = r.requested_role; return next; });
    if (error) setStatus('Couldn’t load access requests.');
  }
  useEffect(() => { load(); }, [dealId]);

  async function decide(row, approve) {
    const role = approve ? selected[row.id] : null;
    if (busy || (approve && !roles.includes(role))) return;
    setBusy(true);
    setStatus('');
    const { data, error } = await supabase.rpc('commercial_decide_access_request', {
      p_request: row.id, p_approve: approve, p_role: role,
    });
    if (error) {
      setStatus('Couldn’t save this decision. Try again.');
    } else {
      setStatus(data === 'approved' ? `Approved as ${roleLabel[role]}.`
        : data === 'denied' ? 'Request denied.'
          : 'This request is no longer pending or the account already has an access record.');
      if (data === 'approved' || data === 'superseded') onApproved?.();
      await load();
    }
    setBusy(false);
  }

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Access requests</CardTitle>
      <p className="text-sm text-ink-soft" role="status">{status}</p>
      {rows === null ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>No pending requests.</Empty> : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="break-all font-medium">{row.email}</p>
                <p className="text-xs text-ink-soft">
                  {row.requested_role ? `Requested: ${roleLabel[row.requested_role] || row.requested_role} · ` : ''}
                  {when(row.created_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label={`Role for ${row.email}`} className="rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  value={selected[row.id] || ''} disabled={busy}
                  onChange={(e) => setSelected({ ...selected, [row.id]: e.target.value })}>
                  <option value="">Choose a role</option>
                  {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
                <Button type="button" disabled={busy || !selected[row.id]} onClick={() => decide(row, true)}>Approve</Button>
                <Button type="button" kind="secondary" disabled={busy} onClick={() => decide(row, false)}>Deny</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
