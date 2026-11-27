import { DictatedField } from '../components/Dictation.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { lenderBoard } from '../lib/v63.js';
import { Card, CardTitle, Button, Empty } from '../components/Shell.jsx';
import { money } from '../lib/dealmath.js';
import { sendToOwner } from '../components/Messages.jsx';

export const LENDER_PROGRAMS = {
  bridge: { label: 'Bridge / Hard money / Private' },
  dscr: { label: 'Commercial DSCR' },
  both: { label: 'Both' },
};

const LENDER_BOARD_LABELS = {
  ...LENDER_PROGRAMS,
  private: { label: 'Private money' },
  hard: { label: 'Hard money' },
  traditional: { label: 'Traditional' },
};

// All 13 lender criteria fields; each displayed question is required.
export const LENDER_QUESTIONS = [
  { key: 'purchase_advances', label: 'Purchase advances and LTV/LTC caps', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. Max 75% LTV / 85% LTC' },
  { key: 'rehab_draws', label: 'Rehab holdbacks and draw process', programs: ['bridge', 'both'], placeholder: 'e.g. 100% rehab funded in arrears after inspection' },
  { key: 'rates_fees', label: 'Interest rate, origination points and fees', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. 10.5% IO, 1.5 pts, $1,500 underwriting' },
  { key: 'term_extensions', label: 'Loan term and extension options', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. 12 mo + two 3-mo extensions at 0.5 pt' },
  { key: 'coverage_income', label: 'Debt coverage (DSCR) and qualifying income', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. Min 1.20x DSCR on market or in-place leases' },
  { key: 'occupancy_seasoning', label: 'Occupancy and title/rehab seasoning', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. 90% occupied, 6 months title seasoning' },
  { key: 'str_income', label: 'Furnished / short-term rental income treatment', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. 75% of 12-mo history or long-term lease cap' },
  { key: 'refinance_limits', label: 'Refinance limits, cash-out caps and reserves', programs: ['dscr', 'both'], placeholder: 'e.g. Max 75% LTV rate/term, 6 mo PITIA reserves' },
  { key: 'seller_seconds', label: 'Seller seconds / subordinate financing rules', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. Allowed up to 85% CLTV with standstill' },
  { key: 'legal_units_code', label: 'Legal unit count and city code requirements', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. Appraisal + CO/rental registration for 9 or 10 units' },
  { key: 'both_parcels', label: 'Both-parcel collateral (6801234 and 6807893)', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. Both parcels on one blanket deed of trust' },
  { key: 'prepayment', label: 'Prepayment penalties and lockouts', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. None on bridge; 3-2-1 stepdown on DSCR' },
  { key: 'recourse', label: 'Recourse and guarantor requirements', programs: ['bridge', 'dscr', 'both'], placeholder: 'e.g. Full recourse or non-recourse with bad-boy carveouts' },
];

export const questionsForProgram = (program) => LENDER_QUESTIONS.filter((q) => q.programs.includes(program));

// The buyer's wanted terms, filled in from the plan numbers only. The lender can change any of them.
// Fields the plan says nothing about (prepayment, recourse, seller seconds, both parcels) stay blank for the lender.
export function wantedTerms(program, guide, base) {
  const rf = guide?.refi || {};
  const rc = rf.renoCompare || null;
  const budget = +(guide?.costSummary?.total ?? 0);
  const closing = +(rf.closingInLoan ?? 0);
  const ltv = rf.ltvShownPct || base?.refiLtv;
  const units = 10;
  const repair = budget > 0 ? {
    purchase_advances: `Repairs only: ${money(budget + closing)} (${money(budget)} repair budget plus ${money(closing)} closing). The seller finances the purchase.`,
    rehab_draws: `${money(budget)} repair budget, drawn as the work is done`,
    ...(rc ? { rates_fees: `${rc.regularRate}% interest only, ${rc.regularPointsPct} points` } : {}),
  } : {};
  const refi = {
    ...(ltv ? { purchase_advances: `${ltv}% of value at the refinance` } : {}),
    ...(base?.refiRate ? { rates_fees: `${base.refiRate}%` } : {}),
    ...(base?.refiYears ? { term_extensions: `${base.refiYears}-year loan` } : {}),
    ...(base?.refiDscr ? { coverage_income: `${base.refiDscr}x DSCR at full occupancy` } : {}),
    occupancy_seasoning: `Refinance once all ${units} units are rented`,
    ...(ltv ? { refinance_limits: `${ltv}% of value; pays off both seller notes` } : {}),
  };
  const shared = { str_income: +(base?.strUnits ?? 0) > 0 ? '' : 'Not applicable', legal_units_code: `${units} units` };
  let byKey;
  if (program === 'bridge') byKey = { ...repair, ...shared };
  else if (program === 'dscr') byKey = { ...refi, ...shared };
  else byKey = {
    ...repair, ...refi, ...shared,
    ...(repair.purchase_advances && refi.purchase_advances ? { purchase_advances: `Repair loan: ${repair.purchase_advances} Refinance: ${refi.purchase_advances}.` } : {}),
    ...(repair.rates_fees && refi.rates_fees ? { rates_fees: `Repair loan: ${repair.rates_fees}. Refinance: ${refi.rates_fees}.` } : {}),
  };
  const out = {};
  for (const q of questionsForProgram(program)) if (byKey[q.key]) out[q.label] = byKey[q.key];
  return out;
}
const termTypes = (terms) => Object.entries(terms || {}).filter(([k]) => !k.startsWith('_'));

// Owner reads every lender by company; each lender reads only their own submission.
export function LenderBoard({ deal, me, refresh = 0, role = 'lender' }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    supabase.from('commercial_lender_terms').select('*').eq('deal_id', deal.id).then(({ data, error }) => {
      if (!live) return;
      const list = error ? [] : lenderBoard(data);
      setRows(role === 'owner' ? list : list.filter((r) => r.lender_uid === me?.uid));
    });
    return () => { live = false; };
  }, [deal.id, refresh, role, me?.uid]);

  return (
    <Card>
      <CardTitle>{role === 'owner' ? 'Terms from every lender' : 'Your submitted terms'}</CardTitle>
      {rows === null ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No terms submitted yet.</Empty> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">{r.company_name}{r.terms?._contact ? `, ${r.terms._contact}` : ''}{r.lender_uid === me?.uid ? ' (you)' : ''}</h3>
                <span className="text-sm text-ink" title={when(r.updated_at || r.created_at)}>{LENDER_BOARD_LABELS[r.lender_type]?.label || ''}</span>
              </div>
              {termTypes(r.terms).map(([type, fields]) => (
                <div key={type} className="mt-3">
                  {termTypes(r.terms).length > 1 && <p className="text-sm font-semibold">{LENDER_BOARD_LABELS[type]?.label || type}</p>}
                  <dl className="mt-1 space-y-1">
                    {Object.entries(fields || {}).filter(([, v]) => String(v || '').trim()).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 text-base">
                        <dt className="text-ink-soft">{k}</dt>
                        <dd className="font-medium break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function initialLenderName(me, preview) {
  return preview || me?.email === '__preview__' ? '' : (me?.name || '');
}

export function resolveTermValues(asks, progDraft) {
  return { ...(asks || {}), ...(progDraft || {}) };
}

export function isTermCountering(question, ask, progDraft, progEditing) {
  if (!ask) return false;
  if (progEditing?.[question.key]) return true;
  return Boolean(
    progDraft &&
    Object.prototype.hasOwnProperty.call(progDraft, question.label) &&
    progDraft[question.label] !== ask,
  );
}

export function openTermCounter(drafts, editing, program, question) {
  return {
    drafts: {
      ...(drafts || {}),
      [program]: { ...(drafts?.[program] || {}), [question.label]: '' },
    },
    editing: {
      ...(editing || {}),
      [program]: { ...(editing?.[program] || {}), [question.key]: true },
    },
  };
}

export function restoreTermAsk(drafts, editing, program, question) {
  const nextProgDraft = { ...(drafts?.[program] || {}) };
  delete nextProgDraft[question.label];
  const nextProgEditing = { ...(editing?.[program] || {}) };
  delete nextProgEditing[question.key];
  return {
    drafts: { ...(drafts || {}), [program]: nextProgDraft },
    editing: { ...(editing || {}), [program]: nextProgEditing },
  };
}

export function setTermAnswer(drafts, editing, program, label, value, questionKey) {
  const nextDrafts = {
    ...(drafts || {}),
    [program]: { ...(drafts?.[program] || {}), [label]: value },
  };
  const nextEditing = questionKey
    ? { ...(editing || {}), [program]: { ...(editing?.[program] || {}), [questionKey]: true } }
    : editing;
  return { drafts: nextDrafts, editing: nextEditing };
}

export function isTermsFormComplete({ company, name, questions, values }) {
  return (
    Boolean(String(company || '').trim()) &&
    Boolean(String(name || '').trim()) &&
    questions.every((q) => String(values?.[q.label] || '').trim().length > 0)
  );
}

export function buildTermsSubmission({ dealId, lenderUid, company, name, program, questions, values, existingTerms, nowIso = new Date().toISOString() }) {
  const cleanCompany = String(company || '').trim();
  const cleanName = String(name || '').trim();
  const answered = Object.fromEntries(questions.map((q) => [q.label, String(values?.[q.label] || '').trim()]));
  const extraNotes = String(values?.Questions || '').trim();
  const terms = { ...(existingTerms || {}), [program]: answered, _contact: cleanName };
  const upsertRow = {
    deal_id: dealId,
    lender_uid: lenderUid,
    company_name: cleanCompany,
    lender_type: program,
    terms,
    updated_at: nowIso,
  };
  const bodyLines = [...Object.entries(answered), ...(extraNotes ? [['Questions', extraNotes]] : [])]
    .map(([k, v]) => `${k}: ${v}`);
  const body = `${cleanCompany}, ${cleanName} · ${LENDER_PROGRAMS[program].label}\n${bodyLines.join('\n')}`;
  return { answered, terms, upsertRow, body };
}

export function LenderTermField({ question, ask, value, countering, preview, onOpenCounter, onRestoreAsk, onChange }) {
  if (ask && !countering) {
    return (
      <div data-ask-card={question.key} className="rounded-xl border border-line bg-paper p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-medium text-ink">
            {question.label} <span aria-hidden="true" className="text-red-700">*</span>
          </span>
          <button
            type="button"
            aria-label={`Change ${question.label}`}
            onClick={() => onOpenCounter(question)}
            className="min-h-[36px] shrink-0 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink hover:border-ink"
          >
            Change
          </button>
        </div>
        <p className="text-base leading-snug text-ink break-words whitespace-normal">{ask}</p>
      </div>
    );
  }

  const val = value || '';
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`lt-${question.key}`} className="min-w-[160px] flex-1 text-sm font-medium">
          {question.label} <span aria-hidden="true" className="text-red-700">*</span>
        </label>
        {ask && (
          <button
            type="button"
            onClick={() => onRestoreAsk(question)}
            className="min-h-[40px] shrink-0 px-1 text-xs font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
          >
            Use ours
          </button>
        )}
      </div>
      <DictatedField
        id={`lt-${question.key}`}
        required
        aria-label={question.label}
        disabled={preview}
        maxLength={300}
        placeholder={ask || question.placeholder}
        value={val}
        onChange={(e) => onChange(question.label, e.target.value, ask ? question.key : undefined)}
        className="w-full rounded-xl border border-line bg-white px-3 py-2"
      />
    </div>
  );
}

export default function LenderTerms({ deal, me, preview, guide = null, base = null }) {
  const [program, setProgram] = useState('bridge');
  const [drafts, setDrafts] = useState({});
  const [editing, setEditing] = useState({});
  const [company, setCompany] = useState('');
  const [name, setName] = useState(() => initialLenderName(me, preview));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [refresh, setRefresh] = useState(0);

  const questions = questionsForProgram(program);
  const asks = wantedTerms(program, guide, base);
  const progDraft = drafts[program] || {};
  const progEditing = editing[program] || {};
  const values = resolveTermValues(asks, progDraft);

  useEffect(() => {
    if (preview || !me?.uid) return;
    supabase.from('commercial_lender_terms').select('*').eq('deal_id', deal.id).eq('lender_uid', me.uid).maybeSingle().then(({ data }) => {
      if (!data) return;
      setMine(data);
      setCompany(data.company_name || '');
      if (data.terms?._contact) setName(data.terms._contact);
      if (LENDER_PROGRAMS[data.lender_type]) setProgram(data.lender_type);
      setDrafts(data.terms || {});
    });
  }, [deal.id, me?.uid, preview]);

  const setAnswer = (label, value, questionKey) => {
    setDrafts((prev) => setTermAnswer(prev, null, program, label, value).drafts);
    if (questionKey) {
      setEditing((prev) => ({
        ...prev,
        [program]: { ...(prev[program] || {}), [questionKey]: true },
      }));
    }
  };

  const openCounter = (question) => {
    const next = openTermCounter(drafts, editing, program, question);
    setDrafts(next.drafts);
    setEditing(next.editing);
    if (!preview && typeof document !== 'undefined') {
      requestAnimationFrame(() => document.getElementById(`lt-${question.key}`)?.focus());
    }
  };

  const restoreAsk = (question) => {
    const next = restoreTermAsk(drafts, editing, program, question);
    setDrafts(next.drafts);
    setEditing(next.editing);
  };

  const allAnswered = isTermsFormComplete({ company, name, questions, values });

  const send = async (e) => {
    e.preventDefault();
    if (preview || busy || !allAnswered) return;
    setBusy(true);
    try {
      const { upsertRow, body } = buildTermsSubmission({
        dealId: deal.id,
        lenderUid: me.uid,
        company,
        name,
        program,
        questions,
        values,
        existingTerms: mine?.terms,
      });
      const saved = await supabase.from('commercial_lender_terms').upsert(
        upsertRow,
        { onConflict: 'deal_id,lender_uid' },
      ).select().maybeSingle();
      if (saved.data) setMine(saved.data);
      const error = await sendToOwner(deal, me, 'lender', body, LENDER_PROGRAMS[program].label);
      setStatus(saved.error && error ? 'Not sent. Try again.'
        : saved.error ? 'Message sent, but terms did not save. Try again.'
        : error ? 'Terms saved, but message did not send. Try again.'
        : 'Saved and sent to the buyer.');
      setRefresh((n) => n + 1);
    } catch {
      setStatus('Not sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Your terms</CardTitle>
        <label className="mb-4 block text-sm font-medium">
          Company name
          <input
            required
            autoComplete="organization"
            disabled={preview}
            maxLength={160}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company or lender name"
            className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2"
          />
        </label>
        <label className="mb-4 block text-sm font-medium">
          Your name
          <input
            required
            autoComplete="name"
            disabled={preview}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2"
          />
        </label>
        <div role="tablist" aria-label="Loan program" className="mb-4 flex flex-wrap gap-2">
          {Object.entries(LENDER_PROGRAMS).map(([k, x]) => (
            <Button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === program}
              kind={k === program ? 'primary' : 'secondary'}
              onClick={() => { setProgram(k); setStatus(''); }}
            >
              {x.label}
            </Button>
          ))}
        </div>
        <div role="tabpanel">
          <form onSubmit={send} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {questions.map((q) => {
                const ask = asks[q.label] || '';
                const countering = isTermCountering(q, ask, progDraft, progEditing);
                return (
                  <LenderTermField
                    key={q.key}
                    question={q}
                    ask={ask}
                    value={values[q.label] || ''}
                    countering={countering}
                    preview={preview}
                    onOpenCounter={openCounter}
                    onRestoreAsk={restoreAsk}
                    onChange={setAnswer}
                  />
                );
              })}
            </div>
            <label className="block text-sm">
              Questions or document requests (optional)
              <DictatedField
                as="textarea"
                aria-label="Questions or document requests"
                disabled={preview}
                value={values.Questions || ''}
                maxLength={1000}
                onChange={(e) => setAnswer('Questions', e.target.value)}
                className="mt-1 w-full rounded-xl border border-line p-3"
              />
            </label>
            <Button type="submit" disabled={preview || busy || !allAnswered}>
              Send terms to the buyer
            </Button>
            <p role="status" className="text-sm">{status}</p>
          </form>
        </div>
      </Card>
      <LenderBoard deal={deal} me={me} refresh={refresh} role="lender" />
    </div>
  );
}
