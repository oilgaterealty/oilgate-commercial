import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Empty } from './Shell.jsx';
import { ExecutionPlanCard, LeadOfferCard } from './LeadOfferCard.jsx';

export const coveredLabelOf = (structure) => (structure === 'wrap' ? 'Your note covered' : 'Your costs covered');

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

// The one offer the seller sees, with its steps. Shown to the seller and the realtor. No buyer numbers.
export default function SellerOffer({ deal, preview, onAsk }) {
  const { loaded, row, summary } = useSellerOffer(deal);
  if (!loaded) return null;
  if (!summary) return <Card><CardTitle>The offer</CardTitle><Empty>No offer yet.</Empty></Card>;
  const c = deal.seller_content || {};
  return (
    <div className="space-y-5">
      <LeadOfferCard deal={deal} content={c} summary={summary} preview={preview} sellerOnly coveredLabel={coveredLabelOf(row?.structure)} onAsk={onAsk} />
      <ExecutionPlanCard content={c} summary={summary} sellerOnly />
    </div>
  );
}
