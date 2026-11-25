import { useDealModel } from '../lib/useDealModel.js';
import { evaluate, money, pct } from '../lib/dealmath.js';
import { plain } from '../lib/plain.js';
import { useUploads } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import { Card, CardTitle, Empty, OverlayTrigger } from '../components/Shell.jsx';
import { CHARLOTTE_PARCELS, LeadOfferCard } from '../components/LeadOfferCard.jsx';

// Lead-offer-only guest view (e.g., Evan / BIA respondents): deal overview + the one lead offer only.
// No backups, no negotiation notes, no reviewer tabs, no underwriting controls.
export default function LeadGuest({ deal, preview }) {
  const [rows] = useUploads(deal);
  const { offers, base, error } = useDealModel(deal, { owner: false, onlyShared: preview ? 'lead_guest' : undefined });
  const photos = photosOf(
    preview
      ? (rows || []).filter((r) => r.kind === 'photo' && r.featured && (r.visibility === 'seller' || (r.audience || []).includes('viewer')))
      : rows || []
  );
  const leadOffer = offers?.[0] || null;
  const evalResult = leadOffer ? evaluate(leadOffer.structure, leadOffer.inputs, base) : null;
  const summary = evalResult ? plain(leadOffer.structure, evalResult) : null;

  return (
    <div className="readable space-y-6">
      <Cover rows={photos} compact />

      <Card>
        <CardTitle>Deal overview</CardTitle>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-soft">Property</dt>
            <dd className="font-semibold">{deal.address || deal.title}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Parcels included</dt>
            <dd className="font-semibold">{CHARLOTTE_PARCELS}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Units</dt>
            <dd className="font-semibold">
              {OverlayTrigger
                ? <OverlayTrigger lines={['The added unit needs its zoning certificate; the math runs on all 10 units.']}>10 units</OverlayTrigger>
                : '10 units'}
            </dd>
          </div>
        </dl>
      </Card>

      <LeadOfferCard deal={deal} content={deal.seller_content || {}} preview={preview} />

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {offers === null ? (
        <Empty>Loading…</Empty>
      ) : leadOffer && evalResult && summary ? (
        <Card>
          <CardTitle>{leadOffer.name}</CardTitle>
          <p className="mb-3 text-sm text-ink-soft">{summary.glance}</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-paper p-3">
              <dt className="text-xs text-ink-soft">Buyer cash in</dt>
              <dd className="mt-1 font-display text-xl font-semibold">{money(evalResult.cashIn)}</dd>
            </div>
            <div className="rounded-xl bg-paper p-3">
              <dt className="text-xs text-ink-soft">Seller monthly</dt>
              <dd className="mt-1 font-display text-xl font-semibold">
                {evalResult.sellerMonthly === null ? 'At closing' : money(evalResult.sellerMonthly)}
              </dd>
            </div>
            <div className="rounded-xl bg-paper p-3">
              <dt className="text-xs text-ink-soft">Rent coverage</dt>
              <dd className="mt-1 font-display text-xl font-semibold">
                {Number.isFinite(evalResult.dscr) ? `${evalResult.dscr.toFixed(2)}x` : 'No payment'}
              </dd>
            </div>
            <div className="rounded-xl bg-paper p-3">
              <dt className="text-xs text-ink-soft">Total cost vs estimated value</dt>
              <dd className="mt-1 font-display text-xl font-semibold">{pct(evalResult.allInPct)}</dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
