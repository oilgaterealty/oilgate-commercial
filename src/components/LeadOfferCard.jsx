import { useState } from 'react';
import { Button, Card, CardTitle, OverlayTrigger } from './Shell.jsx';

export const CHARLOTTE_PARCELS = '6801234 and 6807893';

export const DEFAULT_LEAD_OFFER = {
  price: '',
  buyer_takes_on: 'Day-to-day property operations, rehab coordination, leasing, rent collection, and permanent financing in the buyer’s name.',
  seller_contributes_receives: 'Seller funds the agreed rehab scope and receives the purchase price agreed upfront for both parcels (6801234 and 6807893) at closing.',
  payment_source: 'Collected rents during operations are intended to cover the existing mortgage payment and operating expenses.',
  closing_timing: 'Purchase of both parcels (6801234 and 6807893) closes once documented rent collections support commercial financing in the buyer’s name.',
  timeline_slip: 'Written milestone dates and extension terms are agreed upfront before signing if lease-up or financing takes longer.',
  lender_condition: 'If the existing Fahey loan or rent assignment stays in place during operations, written lender clearance is required before proceeding. Financing is not implied or guaranteed.',
};

export const DEFAULT_EXECUTION_PLAN = [
  {
    key: 'ready',
    title: 'Getting the property ready',
    detail: 'Buyer coordinates the agreed unit-by-unit rehab scope and contractors so vacant units reach rent-ready condition.',
  },
  {
    key: 'leasing',
    title: 'Leasing and collecting rent',
    detail: 'Buyer markets vacant units, screens applicants, executes leases, and manages monthly rent collection.',
  },
  {
    key: 'updates',
    title: 'Keeping you updated',
    detail: 'Progress, leasing status, and collection updates are posted directly on this deal page and shared in Messages.',
  },
  {
    key: 'closing',
    title: 'Getting to closing',
    detail: 'Buyer compiles documented rent collections and operating records to support commercial financing and close on both parcels (6801234 and 6807893).',
  },
];

export function normalizeLeadOffer(content = {}) {
  const raw = content?.lead && typeof content.lead === 'object' ? content.lead : {};
  return {
    price: String(raw.price || '').trim(),
    buyer_takes_on: String(raw.buyer_takes_on || '').trim() || DEFAULT_LEAD_OFFER.buyer_takes_on,
    seller_contributes_receives: String(raw.seller_contributes_receives || '').trim() || DEFAULT_LEAD_OFFER.seller_contributes_receives,
    payment_source: String(raw.payment_source || '').trim() || DEFAULT_LEAD_OFFER.payment_source,
    closing_timing: String(raw.closing_timing || '').trim() || DEFAULT_LEAD_OFFER.closing_timing,
    timeline_slip: String(raw.timeline_slip || '').trim() || DEFAULT_LEAD_OFFER.timeline_slip,
    lender_condition: String(raw.lender_condition || '').trim() || DEFAULT_LEAD_OFFER.lender_condition,
  };
}

export function normalizeExecutionSteps(content = {}) {
  if (Array.isArray(content?.execution_steps)) {
    const steps = content.execution_steps
      .map((step, i) => ({
        key: `step-${i}`,
        title: String(step?.title || '').trim(),
        detail: String(step?.detail || '').trim(),
        items: Array.isArray(step?.items) ? step.items.map((x) => String(x || '').trim()).filter(Boolean) : [],
      }))
      .filter((step) => step.title && (step.detail || step.items.length));
    if (steps.length) return steps;
  }
  const raw = content?.execution && typeof content.execution === 'object' ? content.execution : {};
  return DEFAULT_EXECUTION_PLAN.map((step) => ({
    ...step,
    detail: String(raw[step.key] || '').trim() || step.detail,
    items: [],
  }));
}

export function validProofItems(content = {}) {
  if (!Array.isArray(content?.execution_proof)) return [];
  return content.execution_proof
    .map((item) => ({
      title: String(item?.title || '').trim(),
      detail: String(item?.detail || '').trim(),
    }))
    .filter((item) => item.title || item.detail);
}

// Single plain-English offer card shown to the seller (and lead_guest). Never renders multiple options.
export function LeadOfferCard({ deal, content, summary, preview, onAsk }) {
  const lead = normalizeLeadOffer(content);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');

  const hasSummary = Boolean(summary && Array.isArray(summary.terms) && summary.terms.length > 0);
  const rows = hasSummary
    ? summary.terms.map((t) => ({
        label: String(t?.label || '').trim(),
        value: String(t?.value || '').trim(),
        overlay: t?.overlay ? (Array.isArray(t.overlay) ? t.overlay : String(t.overlay).split('\n').filter(Boolean)) : [],
      })).filter((t) => t.label || t.value)
    : [
        { label: 'Parcels included', value: `Both parcels: ${CHARLOTTE_PARCELS}`, overlay: [] },
        { label: 'Purchase price', value: lead.price || 'To be agreed upfront in writing', overlay: [] },
        { label: 'What I take on', value: lead.buyer_takes_on, overlay: [] },
        { label: 'What you contribute and receive', value: lead.seller_contributes_receives, overlay: [] },
        { label: 'Where payments come from', value: lead.payment_source, overlay: [] },
        { label: 'When the purchase happens', value: lead.closing_timing, overlay: [] },
        { label: 'If the timeline slips', value: lead.timeline_slip, overlay: [] },
        { label: 'Lender clearance condition', value: lead.lender_condition, overlay: [] },
      ];

  const cleanTitle = hasSummary && summary.title
    ? String(summary.title).replace(/^(Option\s+)?[A-Z]\s*:\s*/i, '').trim()
    : '';

  const sendQuestion = async (e) => {
    e.preventDefault();
    if (!onAsk || !question.trim() || preview || busy) return;
    setBusy(true);
    try {
      const err = await onAsk(question.trim());
      setSent(err ? 'Could not send. Please try again.' : 'Sent. You’ll see our answer in Messages below.');
      if (!err) {
        setQuestion('');
        setAsking(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-2 border-ink">
      <CardTitle
        aside={
          preview && !hasSummary && !lead.price ? (
            <a href={`#/d/${deal.slug}/seller-page`} className="text-sm font-medium underline">
              Pick lead terms in Seller page
            </a>
          ) : null
        }
      >
        {cleanTitle ? `The offer — ${cleanTitle}` : 'The offer'}
      </CardTitle>
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[220px_1fr] sm:gap-4">
            <dt className="text-sm font-semibold text-ink">{row.label}</dt>
            <dd className="text-sm leading-relaxed text-ink">
              {row.overlay.length > 0 && OverlayTrigger
                ? <OverlayTrigger lines={row.overlay}>{row.value}</OverlayTrigger>
                : row.value}
            </dd>
          </div>
        ))}
      </dl>
      {onAsk && (
        <div className="mt-5 space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" kind="secondary" disabled={preview} onClick={() => setAsking((v) => !v)}>
              {asking ? 'Close question' : 'Ask a question about this offer'}
            </Button>
          </div>
          {asking && (
            <form onSubmit={sendQuestion} className="space-y-2">
              <textarea
                rows={3}
                maxLength={4000}
                aria-label="Your question about the offer"
                placeholder="Ask anything about how this offer works…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              />
              <Button type="submit" disabled={busy || !question.trim()}>
                {busy ? 'Sending…' : 'Send question'}
              </Button>
            </form>
          )}
          {sent && <p role="status" className="text-sm text-ink-soft">{sent}</p>}
        </div>
      )}
    </Card>
  );
}

// "How I'll get this done" right below the offer; verified proof renders ONLY when owner-approved entries exist.
export function ExecutionPlanCard({ content, summary }) {
  const hasSummarySteps = Boolean(summary && Array.isArray(summary.steps) && summary.steps.length > 0);
  const steps = hasSummarySteps
    ? summary.steps.map((s, i) => ({
        key: `sum-${i}`,
        title: String(s?.title || '').trim(),
        when: String(s?.when || '').trim(),
        detail: String(s?.detail || '').trim(),
        items: [],
      })).filter((s) => s.title)
    : normalizeExecutionSteps(content);
  const proof = validProofItems(content);
  return (
    <Card>
      <CardTitle>How I’ll get this done</CardTitle>
      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.key} className="rounded-2xl bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="font-display text-lg font-semibold leading-snug">{s.title}</h3>
              </div>
              {s.when && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-ink-soft">{s.when}</span>}
            </div>
            {s.detail && <p className="mt-2 text-sm leading-relaxed text-ink">{s.detail}</p>}
            {s.items.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                {s.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {proof.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-3 font-display text-lg font-semibold">Verified track record</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {proof.map((item, idx) => (
              <li key={idx} className="rounded-2xl border border-line bg-white p-3.5">
                {item.title && <p className="text-sm font-semibold text-ink">{item.title}</p>}
                {item.detail && <p className="mt-1 text-sm text-ink-soft">{item.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
