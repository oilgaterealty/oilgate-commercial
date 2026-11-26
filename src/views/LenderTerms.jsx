import { DictatedField } from '../components/Dictation.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { lenderBoard } from '../lib/v63.js';
import { Card, CardTitle, Button, Empty } from '../components/Shell.jsx';
import { sendToOwner } from '../components/Messages.jsx';

export const LENDER_PROGRAMS = {
  bridge: { label: 'Bridge / Hard money' },
  dscr: { label: 'Commercial DSCR' },
  both: { label: 'Both' },
};

const LENDER_BOARD_LABELS = {
  ...LENDER_PROGRAMS,
  private: { label: 'Private money' },
  hard: { label: 'Hard money' },
  traditional: { label: 'Traditional' },
};

// All 13 lender criteria fields; each displayed question is required and supports "Not applicable".
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
                <h3 className="text-lg font-semibold">{r.company_name}{r.lender_uid === me?.uid ? ' (you)' : ''}</h3>
                <span className="text-sm text-ink" title={when(r.updated_at || r.created_at)}>{LENDER_BOARD_LABELS[r.lender_type]?.label || ''}</span>
              </div>
              {Object.entries(r.terms || {}).map(([type, fields]) => (
                <div key={type} className="mt-3">
                  {Object.keys(r.terms).length > 1 && <p className="text-sm font-semibold">{LENDER_BOARD_LABELS[type]?.label || type}</p>}
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

export default function LenderTerms({ deal, me, preview }) {
  const [program, setProgram] = useState('bridge');
  const [drafts, setDrafts] = useState({});
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [refresh, setRefresh] = useState(0);

  const questions = questionsForProgram(program);
  const values = drafts[program] || {};

  useEffect(() => {
    if (preview || !me?.uid) return;
    supabase.from('commercial_lender_terms').select('*').eq('deal_id', deal.id).eq('lender_uid', me.uid).maybeSingle().then(({ data }) => {
      if (!data) return;
      setMine(data);
      setCompany(data.company_name || '');
      if (LENDER_PROGRAMS[data.lender_type]) setProgram(data.lender_type);
      setDrafts(data.terms || {});
    });
  }, [deal.id, me?.uid, preview]);

  const setAnswer = (label, value) => {
    setDrafts((prev) => ({
      ...prev,
      [program]: { ...(prev[program] || {}), [label]: value },
    }));
  };

  const allAnswered = Boolean(company.trim()) && questions.every((q) => String(values[q.label] || '').trim().length > 0);

  const send = async (e) => {
    e.preventDefault();
    if (preview || busy || !allAnswered) return;
    setBusy(true);
    try {
      const answered = Object.fromEntries(questions.map((q) => [q.label, String(values[q.label] || '').trim()]));
      const extraNotes = String(values.Questions || '').trim();
      const terms = { ...(mine?.terms || {}), [program]: answered };
      const saved = await supabase.from('commercial_lender_terms').upsert(
        { deal_id: deal.id, lender_uid: me.uid, company_name: company.trim(), lender_type: program, terms, updated_at: new Date().toISOString() },
        { onConflict: 'deal_id,lender_uid' },
      ).select().maybeSingle();
      if (saved.data) setMine(saved.data);
      const bodyLines = [...Object.entries(answered), ...(extraNotes ? [['Questions', extraNotes]] : [])]
        .map(([k, v]) => `${k}: ${v}`);
      const body = `${company.trim()} · ${LENDER_PROGRAMS[program].label}\n${bodyLines.join('\n')}`;
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
                const val = values[q.label] || '';
                const isNa = val.trim().toLowerCase() === 'not applicable';
                return (
                  <div key={q.key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`lt-${q.key}`} className="text-sm font-medium">
                        {q.label} <span aria-hidden="true" className="text-red-700">*</span>
                      </label>
                      <button
                        type="button"
                        disabled={preview}
                        aria-pressed={isNa}
                        onClick={() => setAnswer(q.label, isNa ? '' : 'Not applicable')}
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${isNa ? 'bg-ink text-white' : 'border border-line bg-paper text-ink-soft hover:border-ink'}`}
                      >
                        Not applicable
                      </button>
                    </div>
                    <DictatedField
                      id={`lt-${q.key}`}
                      required
                      aria-label={q.label}
                      disabled={preview}
                      maxLength={300}
                      placeholder={q.placeholder}
                      value={val}
                      onChange={(e) => setAnswer(q.label, e.target.value)}
                      className="w-full rounded-xl border border-line px-3 py-2"
                    />
                  </div>
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
