import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Button, Card, CardTitle, Empty, Field } from './Shell.jsx';
import { PUBLIC_SITE } from '../lib/site.js';
import { ExecutionPlanCard, LeadOfferCard, SellerProtectionsCard } from './LeadOfferCard.jsx';

export const coveredLabelOf = (structure) => (structure === 'wrap' ? 'Covered?' : 'Your costs covered');

export function useSellerOffer(deal) {
  const [row, setRow] = useState(undefined);
  useEffect(() => {
    let live = true;
    supabase.rpc('commercial_get_seller_offer', { p_deal: deal.id })
      .then(({ data }) => { if (live) setRow((Array.isArray(data) ? data[0] : data) || null); });
    return () => { live = false; };
  }, [deal.id]);
  const raw = row?.seller_summary;
  const summary = raw && ((Array.isArray(raw.sellerTable) && raw.sellerTable.length > 0) || (Array.isArray(raw.terms) && raw.terms.length > 0)) ? raw : null;
  return { loaded: row !== undefined, row, summary };
}

// The realtor gives the seller access to the seller page that already exists. The seller signs in there with this email.
export function InviteSeller({ deal, preview, inline = false, onInvited }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    if (preview || busy || !name.trim() || !email.trim()) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const { data, error: err } = await supabase.rpc('commercial_realtor_invite_seller', { p_deal: deal.id, p_name: name.trim(), p_email: email.trim() });
      if (err) { setError(err.message || 'Invite did not go through. Try again.'); return; }
      setStatus(data === 'already'
        ? `${name.trim()} already has the seller page.`
        : `${name.trim()} can now sign in at the seller page with ${email.trim().toLowerCase()}.`);
      setName('');
      setEmail('');
      onInvited?.();
    } catch {
      setError('Invite did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(PUBLIC_SITE); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  const content = (
    <>
      <form onSubmit={send} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-sm">Seller’s name<Field required maxLength={120} disabled={preview || busy} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
        <label className="text-sm">Seller’s email<Field required type="email" maxLength={254} disabled={preview || busy} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
        <Button type="submit" disabled={preview || busy || !name.trim() || !email.trim()}>{busy ? 'Inviting…' : 'Invite'}</Button>
      </form>
      {inline && (
        <div className="mt-3">
          <Button type="button" kind="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy seller page link'}</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {status && <p role="status" className="mt-3 text-sm">{status}</p>}
    </>
  );
  if (inline) {
    return <div className="mt-4 border-t border-line pt-4">{content}</div>;
  }
  return (
    <Card>
      <CardTitle aside={<Button type="button" kind="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy seller page link'}</Button>}>Invite the seller</CardTitle>
      {content}
    </Card>
  );
}

// The one offer the seller sees, with its steps. Shown to the seller and the realtor. No buyer numbers.
export default function SellerOffer({ deal, preview, onAsk, canInvite = false, offerState = null }) {
  const fetched = useSellerOffer(deal);
  const { loaded, row, summary } = offerState || fetched;
  if (!loaded) return null;
  const c = deal.seller_content || {};
  const invite = canInvite ? <InviteSeller deal={deal} preview={preview} /> : null;
  if (!summary) return <div className="space-y-5"><Card><CardTitle>The offer</CardTitle><Empty>No offer yet.</Empty></Card><SellerProtectionsCard content={c} />{invite}</div>;
  return (
    <div className="space-y-5">
      {invite}
      <LeadOfferCard deal={deal} content={c} summary={summary} preview={preview} sellerOnly coveredLabel={coveredLabelOf(row?.structure)} onAsk={onAsk} />
      <SellerProtectionsCard content={c} />
      <ExecutionPlanCard content={c} summary={summary} sellerOnly />
    </div>
  );
}
