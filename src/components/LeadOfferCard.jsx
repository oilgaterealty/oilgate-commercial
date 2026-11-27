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

const fmtDollars = (v) => (Number.isFinite(+v) ? (+v < 0 ? '−$' : '$') + Math.round(Math.abs(+v)).toLocaleString('en-US') : '—');

const DOLLAR_TOKEN = '\\$\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s*[kKmM])?(?:\\s*\\/\\s*(?:mo|yr|unit))?';
const DOLLAR_RANGE = `${DOLLAR_TOKEN}(?:\\s*(?:to|–|—|-)\\s*${DOLLAR_TOKEN})?`;
const DOLLAR_QUALIFIER = '(?:(?:likely|about|around|roughly|approx\\.?|approximately|up\\s+to|budget|cost)\\s*:?\\s*|~\\s*)?';
const DOLLAR_PARENS_RE = new RegExp(`\\(\\s*${DOLLAR_QUALIFIER}${DOLLAR_RANGE}\\s*\\)`, 'gi');
const DOLLAR_PHRASE_RE = new RegExp(`${DOLLAR_QUALIFIER}${DOLLAR_RANGE}`, 'gi');

export function stripHardcodedDollars(text) {
  const raw = String(text || '').trim();
  if (!raw || !raw.includes('$')) return raw;
  let cleaned = raw
    .replace(DOLLAR_PARENS_RE, '')
    .replace(DOLLAR_PHRASE_RE, '')
    .replace(/\(\s*[,;:\-–—\s]*\)/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*(?=[,.;:])/g, '')
    .replace(/^\s*[,;:\-–—]+\s*/, '')
    .replace(/\s*[,;:\-–—]+\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^[a-z]/.test(cleaned) && !/^[a-z]/.test(raw)) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

export function resolveStepBudgets(source) {
  if (!source || typeof source !== 'object') return null;
  const direct = source.stepBudgets || source.guide?.costSummary?.stepBudgets || source.costSummary?.stepBudgets;
  if (direct && typeof direct === 'object' && typeof direct.units === 'number') {
    return {
      units: Math.max(0, +direct.units || 0),
      security: Math.max(0, +direct.security || 0),
      safetyRecords: Math.max(0, +direct.safetyRecords || 0),
      total: Math.max(0, +direct.total || 0),
    };
  }
  if (Array.isArray(source.units) || Array.isArray(source.costs)) {
    const units = (Array.isArray(source.units) ? source.units : []).reduce((s, u) => s + Math.max(0, +u?.rehab || 0), 0);
    const costs = Array.isArray(source.costs) ? source.costs : [];
    const sumGroups = (...groups) => costs
      .filter((c) => groups.includes(String(c?.group || '').toLowerCase()) && (+c?.cost || 0) > 0)
      .reduce((s, c) => s + (+c.cost || 0), 0);
    const security = sumGroups('security');
    const safetyRecords = sumGroups('diligence', 'permits');
    const allCosts = costs.reduce((s, c) => s + Math.max(0, +c?.cost || 0), 0);
    const contingency = Math.max(0, +source.contingency || 0);
    return { units, security, safetyRecords, total: units + allCosts + contingency };
  }
  return null;
}

export function classifyExecutionStep(step = {}) {
  const title = String(step?.title || '');
  const body = `${String(step?.detail || '')} ${(Array.isArray(step?.items) ? step.items : []).join(' ')}`;
  const match = (text) => {
    if (/\b(secur\w*|cameras?|locks?|lighting|access control)\b/i.test(text)) return 'security';
    if (/\b(safety|records?|diligence|permits?|check the building|inspect\w*|zoning|registration)\b/i.test(text)) return 'safety_records';
    if (/\b(fix|rehab|repair|renovat\w*)\b.*\bunits?\b|\bunits?\b.*\b(fix|rehab|repair|renovat\w*)\b|\bfix[- ]?up\b|\brenovation\b|\brehab\b|\brepairs?\b|\bgetting the property ready\b/i.test(text)) return 'fix_units';
    return null;
  };
  return match(title) || match(body);
}

export function normalizeExecutionSteps(content = {}, planOrBudgets = null) {
  const budgets = resolveStepBudgets(planOrBudgets);
  if (Array.isArray(content?.execution_steps)) {
    const steps = content.execution_steps
      .map((step, i) => {
        const title = String(step?.title || '').trim();
        const rawDetail = String(step?.detail || '').trim();
        const rawItems = Array.isArray(step?.items) ? step.items.map((x) => String(x || '').trim()).filter(Boolean) : [];
        const cleanDetail = stripHardcodedDollars(rawDetail);
        const items = rawItems.map(stripHardcodedDollars).filter(Boolean);
        const category = classifyExecutionStep({ title, detail: rawDetail, items: rawItems });
        const planAmount = category === 'fix_units'
          ? budgets?.units
          : category === 'security'
            ? budgets?.security
            : category === 'safety_records'
              ? budgets?.safetyRecords
              : null;
        const detail = Number.isFinite(planAmount) && planAmount > 0
          ? (cleanDetail ? `${fmtDollars(planAmount)}. ${cleanDetail}` : fmtDollars(planAmount))
          : cleanDetail;
        const hadContent = Boolean(rawDetail || rawItems.length);
        return {
          key: `step-${i}`,
          title,
          detail,
          items,
          _hadContent: hadContent,
        };
      })
      .filter((step) => step.title && (step.detail || step.items.length || step._hadContent))
      .map(({ _hadContent, ...step }) => step);
    if (steps.length) return steps;
  }
  const raw = content?.execution && typeof content.execution === 'object' ? content.execution : {};
  return DEFAULT_EXECUTION_PLAN.map((step) => ({
    ...step,
    detail: stripHardcodedDollars(String(raw[step.key] || '').trim()) || step.detail,
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

export const coveredWord = (c) => (c === 'yes' ? 'covered' : c);

// Single plain-English offer card shown to the seller. Never renders multiple options.
export function LeadOfferCard({ deal, content, summary, preview, onAsk, sellerOnly = false, coveredLabel = 'Your costs covered' }) {
  const lead = normalizeLeadOffer(content);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');

  const hasSellerTable = Boolean(summary && Array.isArray(summary.sellerTable) && summary.sellerTable.length > 0);
  const hasSummary = Boolean(summary && Array.isArray(summary.terms) && summary.terms.length > 0);
  const firstCoveredUnits = hasSellerTable ? (summary.sellerTable.find((r) => r.covered === 'yes')?.units ?? null) : null;
  // Seller financing rows also show the note payment and the holding bills.
  const hasCosts = hasSellerTable && summary.sellerTable.some((r) => Number.isFinite(+r.note) && r.note !== null && r.note !== undefined);
  const billsFromRent = Boolean(summary?.billsFromRent);
  const twoNotes = Boolean(summary?.renoFromSeller);
  const rows = hasSummary
    ? summary.terms.map((t) => ({
        label: String(t?.label || '').trim(),
        value: String(t?.value || '').trim(),
        overlay: t?.overlay ? (Array.isArray(t.overlay) ? t.overlay : String(t.overlay).split('\n').filter(Boolean)) : [],
      })).filter((t) => t.label || t.value)
    : [
        { label: 'Parcels included', value: `Both parcels: ${CHARLOTTE_PARCELS}`, overlay: [] },
        { label: 'Purchase price', value: lead.price || 'To be agreed upfront in writing', overlay: [] },
        { label: 'What the buyer takes on', value: lead.buyer_takes_on, overlay: [] },
        { label: 'What you contribute and receive', value: lead.seller_contributes_receives, overlay: [] },
        { label: 'Where payments come from', value: lead.payment_source, overlay: [] },
        { label: 'When the purchase happens', value: lead.closing_timing, overlay: [] },
        { label: 'If the timeline slips', value: lead.timeline_slip, overlay: [] },
        { label: 'Lender clearance condition', value: lead.lender_condition, overlay: [] },
      ];

  const cleanTitle = (hasSummary || hasSellerTable) && summary?.title
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
      <CardTitle>{cleanTitle ? `The offer: ${cleanTitle}` : 'The offer'}</CardTitle>
      {hasSellerTable ? (
        <div className="space-y-4">
          {hasSummary && rows.length > 0 && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {rows.map((row) => (
                <div key={row.label} className="rounded-2xl bg-paper p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{row.label}</dt>
                  <dd className="mt-1 text-sm font-semibold leading-snug text-ink">
                    {row.overlay.length > 0 && OverlayTrigger
                      ? <OverlayTrigger lines={row.overlay}>{row.value}</OverlayTrigger>
                      : row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} role="region" aria-label="Units rented">
            <table className="w-full border-collapse text-right text-sm tabular-nums">
              <thead className="bg-ink text-xs text-white">
                <tr>
                  <th scope="col" className="px-3 py-2.5 text-left">Units rented</th>
                  <th scope="col" className="px-3 py-2.5">Rent in</th>
                  {hasCosts && <th scope="col" className="px-3 py-2.5">{twoNotes ? 'Your note payments' : 'Your note payment'}</th>}
                  {hasCosts && <th scope="col" className="px-3 py-2.5">{billsFromRent ? 'Bills added to your payoff' : 'Taxes, insurance, utilities (buyer pays)'}</th>}
                  <th scope="col" className="px-3 py-2.5 text-center">{coveredLabel}</th>
                </tr>
              </thead>
              <tbody>
                {summary.sellerTable.map((row) => {
                  const isFirstYes = firstCoveredUnits !== null && row.units === firstCoveredUnits;
                  return (
                    <tr key={row.units} className={`border-t border-line ${isFirstYes ? 'bg-emerald-50 font-semibold' : 'bg-white'}`}>
                      <th scope="row" className="px-3 py-2 text-left">{row.units}</th>
                      <td className="px-3 py-2">{fmtDollars(row.rentIn)}</td>
                      {hasCosts && <td className="px-3 py-2">{row.noteWaits > 0 && OverlayTrigger ? <OverlayTrigger lines={[`Paid from rent: ${fmtDollars(row.note)}`, `${fmtDollars(row.noteWaits)} is added to your payoff`]}>{fmtDollars(row.note)}</OverlayTrigger> : fmtDollars(row.note)}</td>}
                      {hasCosts && (
                        <td className="px-3 py-2">
                          {Array.isArray(row.billsLines) && row.billsLines.length > 0 && OverlayTrigger
                            ? <OverlayTrigger lines={row.billsLines}>{fmtDollars(row.bills)}</OverlayTrigger>
                            : fmtDollars(row.bills)}
                        </td>
                      )}
                      <td className={`px-3 py-2 text-center ${row.covered === 'yes' ? 'text-good font-semibold' : row.covered === 'partly' ? 'text-amber-800' : 'text-ink-soft'}`}>
                        {coveredWord(row.covered)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {summary.refiLine && (
            <div className="rounded-2xl bg-paper p-3.5 text-sm font-medium text-ink">
              {summary.refiLine}
            </div>
          )}
        </div>
      ) : sellerOnly && !hasSummary ? null : (
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
      )}
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
          {sent && <p role="status" className="text-sm text-ink">{sent}</p>}
        </div>
      )}
    </Card>
  );
}

// "The plan" right below the offer; verified proof renders ONLY when owner-approved entries exist.
export function ExecutionPlanCard({ content, summary, sellerOnly = false, plan = null, stepBudgets = null }) {
  const hasSummarySteps = Boolean(summary && Array.isArray(summary.steps) && summary.steps.length > 0);
  if (sellerOnly && !hasSummarySteps) return null;
  const toLines = (v) => (Array.isArray(v) ? v : v ? String(v).split('\n') : []).map((x) => String(x || '').trim()).filter(Boolean);
  const steps = hasSummarySteps
    ? summary.steps.map((s, i) => ({
        key: `sum-${i}`,
        title: String(s?.title || '').trim(),
        detail: String(s?.detail || '').trim(),
        overlay: toLines(s?.overlay),
        items: [],
      })).filter((s) => s.title)
    : normalizeExecutionSteps(content, stepBudgets || plan || summary).map((s) => ({ ...s, overlay: [] }));
  const proof = validProofItems(content);
  return (
    <Card>
      <CardTitle>The plan</CardTitle>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.key} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold leading-snug text-ink">{s.title}</h3>
              {s.detail && (
                <p className="text-sm leading-relaxed text-ink">
                  {s.overlay.length > 0 && OverlayTrigger
                    ? <OverlayTrigger lines={s.overlay}>{s.detail}</OverlayTrigger>
                    : s.detail}
                </p>
              )}
              {s.items.length > 0 && (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                  {s.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      {proof.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-3 font-display text-lg font-semibold">Verified track record</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {proof.map((item, idx) => (
              <li key={idx} className="rounded-2xl border border-line bg-white p-3.5">
                {item.title
                  ? <div className="text-sm font-semibold text-ink"><OverlayTrigger lines={[item.detail]}>{item.title}</OverlayTrigger></div>
                  : item.detail && <div className="text-sm text-ink">{item.detail}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
