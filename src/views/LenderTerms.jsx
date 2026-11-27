import { DictatedField } from '../components/Dictation.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { lenderBoard } from '../lib/v63.js';
import { Card, CardTitle, Button, Empty } from '../components/Shell.jsx';
import { BASE_DEFAULTS, money } from '../lib/dealmath.js';
import { buildLenderPackage, LENDER_LENSES } from '../lib/lenderModel.js';
import { sendToOwner } from '../components/Messages.jsx';

export const LENDER_PROGRAMS = {
  bridge: { label: 'Bridge' },
  private: { label: 'Private' },
  dscr: { label: 'DSCR' },
};

const LENDER_BOARD_LABELS = {
  ...LENDER_PROGRAMS,
  both: { label: 'Bridge & DSCR' },
  hard: { label: 'Hard money' },
  traditional: { label: 'Traditional' },
};

export const LENDER_FIELDS = [
  { key: 'ltc', label: 'LTC (% of cost)', programs: ['bridge'], inputType: 'number', unit: '%', step: 5, min: 0, max: 100, placeholder: 'e.g. 90' },
  { key: 'ltv', label: 'Max LTV (% of value)', programs: ['bridge', 'dscr'], inputType: 'number', unit: '%', step: 5, min: 0, max: 100, placeholder: 'e.g. 75' },
  { key: 'participation', label: 'Your participation', programs: ['private'], inputType: 'number', unit: '$', step: 5000, min: 0, placeholder: 'e.g. 50000' },
  { key: 'rate', label: 'Interest rate', programs: ['bridge', 'private', 'dscr'], inputType: 'number', unit: '%', step: 0.25, min: 0, max: 30, placeholder: 'e.g. 11.5' },
  { key: 'points', label: 'Origination points', programs: ['bridge', 'private', 'dscr'], inputType: 'number', unit: 'pts', step: 0.25, min: 0, max: 10, placeholder: 'e.g. 1' },
  { key: 'processing', label: 'Processing fee', programs: ['bridge'], inputType: 'number', unit: '$', step: 100, min: 0, placeholder: 'e.g. 1295' },
  {
    key: 'term',
    label: 'Loan term',
    programs: ['bridge', 'private', 'dscr'],
    inputType: 'choice',
    choicesByProgram: {
      bridge: ['6 months', '12 months', '18 months', '24 months'],
      private: ['6 months', '12 months', '18 months', '24 months'],
      dscr: ['5 years', '10 years', '20 years', '30 years'],
    },
  },
  {
    key: 'deferred_interest',
    label: 'Deferred interest',
    programs: ['bridge', 'private'],
    inputType: 'choice',
    choices: ['None', '1 month', '2 months', '3 months', '6 months'],
  },
  {
    key: 'rehab_draws',
    label: 'Rehab draws',
    programs: ['bridge'],
    inputType: 'choice',
    choices: ['In draws', 'At closing', 'No rehab funding'],
  },
  {
    key: 'dscr',
    label: 'Minimum DSCR',
    programs: ['dscr'],
    inputType: 'choice',
    choices: ['1.00x', '1.10x', '1.15x', '1.20x', '1.25x'],
  },
  {
    key: 'seasoning',
    label: 'Seasoning',
    programs: ['dscr'],
    inputType: 'choice',
    choices: ['None', '3 months', '6 months', '12 months'],
  },
];

export const EXTENSION_COUNTS = ['None', '1', '2', '3'];
export const EXTENSION_MONTHS = ['3 mo', '6 mo'];
export const EXTENSION_FEES = ['0%', '0.25%', '0.5%', '1%'];

export const COLLATERAL_QUESTION = {
  key: 'both_parcels',
  label: 'Both parcels (23 & 27 Charlotte)',
  prompt: 'Do you need both parcels, 23 and 27 Charlotte, as collateral?',
  choices: ['Yes', 'No'],
};

export const OPTIONAL_FIELDS = [
  { key: 'guarantee', label: 'Guarantee requirements', choices: ['Full recourse', 'Limited / carve-out', 'Non-recourse'] },
  { key: 'prepayment', label: 'Prepayment penalty', choices: ['None', '3-2-1', '5-4-3-2-1', 'Yield maintenance'] },
  { key: 'lockout', label: 'Lockout', choices: ['None', '3 months', '6 months', '12 months'] },
];

export const fieldsForProgram = (program) => LENDER_FIELDS.filter((f) => f.programs.includes(program));

export function fieldChoices(field, program) {
  if (!field) return [];
  return field.choicesByProgram?.[program] || field.choices || [];
}

export function formatExtensionSummary({ count, months, fee } = {}) {
  const c = String(count || '').trim();
  if (!c) return '';
  if (c === 'None') return 'None';
  const m = String(months || '').trim() || '3 mo';
  const f = String(fee || '').trim() || '0%';
  return `${c} × ${m} at ${f}`;
}

function formatFieldOutput(field, raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (field?.inputType === 'number' && /^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (field.unit === '$') return money(n);
    if (field.unit === '%') return `${s}%`;
    if (field.unit === 'pts') return `${s} ${n === 1 ? 'point' : 'points'}`;
  }
  return s;
}

// Single-source asks derived from the Plan 1A / DSCR model. Every default can be countered with one tap.
export function wantedTerms(program, guide, base, offer = null) {
  const pkg = buildLenderPackage({ base, offer, guide, lens: program });
  const pointsWord = pkg.pointsPct === 1 ? 'point' : 'points';
  const refiRate = base?.refiRate ?? BASE_DEFAULTS.refiRate;
  const refiYears = base?.refiYears ?? BASE_DEFAULTS.refiYears;
  const refiDscr = base?.refiDscr ?? BASE_DEFAULTS.refiDscr;
  const hasBridge = pkg.purchase > 0 || pkg.repairs > 0 || pkg.totalLoan > 0;

  let byKey = {};
  if (program === 'bridge') {
    byKey = {
      ...(hasBridge ? { ltc: `100% LTC ($0 down · ${money(pkg.totalLoan)})` } : {}),
      ...(pkg.value > 0 && pkg.ltvPct > 0 ? { ltv: `${Math.round(pkg.ltvPct)}% LTV (${money(pkg.value)})` } : {}),
      rate: `${pkg.ratePct}% IO (${money(pkg.monthlyInterest)}/mo)`,
      points: `${pkg.pointsPct} ${pointsWord} (${money(pkg.points)})`,
      processing: money(pkg.processing),
      term: `${pkg.termMonths} months`,
      deferred_interest: pkg.deferredMonths > 0 ? `${pkg.deferredMonths} months (${money(pkg.deferredInterest)})` : 'None',
      ...(pkg.repairs > 0 ? { rehab_draws: `${money(pkg.repairs)} in draws` } : {}),
    };
  } else if (program === 'private') {
    byKey = {
      participation: hasBridge
        ? `${money(pkg.minParticipation)} min (of ${money(pkg.totalLoan)} pool)`
        : `${money(pkg.minParticipation)} min`,
      rate: `${pkg.ratePct}% IO`,
      points: `${pkg.pointsPct} ${pointsWord} (${money(pkg.points)})`,
      term: `${pkg.termMonths} months`,
      deferred_interest: pkg.deferredMonths > 0 ? `${pkg.deferredMonths} months (${money(pkg.deferredInterest)})` : 'None',
    };
  } else if (program === 'dscr') {
    byKey = {
      ltv: pkg.refiCheck.newLoan > 0
        ? `${pkg.refiCheck.refiLtv}% LTV (${money(pkg.refiCheck.newLoan)})`
        : `${pkg.refiCheck.refiLtv}% LTV`,
      rate: `${refiRate}%`,
      points: `${pkg.refiCheck.refiFeesPct}%`,
      term: `${refiYears} years`,
      dscr: `${refiDscr}x`,
      seasoning: `Once all ${pkg.units} units are rented`,
    };
  }

  const out = {};
  for (const f of fieldsForProgram(program)) {
    if (byKey[f.key]) out[f.label] = byKey[f.key];
  }
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

export function isTermCountering(field, ask, progDraft, progEditing) {
  if (!ask) return false;
  if (progEditing?.[field.key]) return true;
  return Boolean(
    progDraft &&
    Object.prototype.hasOwnProperty.call(progDraft, field.label) &&
    progDraft[field.label] !== ask,
  );
}

export function openTermCounter(drafts, editing, program, field) {
  return {
    drafts: {
      ...(drafts || {}),
      [program]: { ...(drafts?.[program] || {}), [field.label]: '' },
    },
    editing: {
      ...(editing || {}),
      [program]: { ...(editing?.[program] || {}), [field.key]: true },
    },
  };
}

export function restoreTermAsk(drafts, editing, program, field) {
  const nextProgDraft = { ...(drafts?.[program] || {}) };
  delete nextProgDraft[field.label];
  const nextProgEditing = { ...(editing?.[program] || {}) };
  delete nextProgEditing[field.key];
  return {
    drafts: { ...(drafts || {}), [program]: nextProgDraft },
    editing: { ...(editing || {}), [program]: nextProgEditing },
  };
}

export function setTermAnswer(drafts, editing, program, label, value, fieldKey) {
  const nextDrafts = {
    ...(drafts || {}),
    [program]: { ...(drafts?.[program] || {}), [label]: value },
  };
  const nextEditing = fieldKey
    ? { ...(editing || {}), [program]: { ...(editing?.[program] || {}), [fieldKey]: true } }
    : editing;
  return { drafts: nextDrafts, editing: nextEditing };
}

export function isTermsFormComplete({ company, name, fields, values }) {
  return (
    Boolean(String(company || '').trim()) &&
    Boolean(String(name || '').trim()) &&
    fields.every((f) => String(values?.[f.label] || '').trim().length > 0)
  );
}

export function buildTermsSubmission({
  dealId,
  lenderUid,
  company,
  name,
  program,
  fields,
  values,
  extensions,
  existingTerms,
  nowIso = new Date().toISOString(),
}) {
  const cleanCompany = String(company || '').trim();
  const cleanName = String(name || '').trim();
  const answered = {};
  for (const f of fields) {
    const formatted = formatFieldOutput(f, values?.[f.label]);
    if (formatted) answered[f.label] = formatted;
  }
  const extSummary = program === 'dscr' ? '' : formatExtensionSummary(extensions);
  if (extSummary) answered.Extensions = extSummary;
  const bothParcels = String(values?.[COLLATERAL_QUESTION.label] || '').trim();
  if (bothParcels) answered[COLLATERAL_QUESTION.label] = bothParcels;
  for (const opt of OPTIONAL_FIELDS) {
    const val = String(values?.[opt.label] || '').trim();
    if (val) answered[opt.label] = val;
  }
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
  const progLabel = LENDER_PROGRAMS[program]?.label || program;
  const body = `${cleanCompany}, ${cleanName} · ${progLabel}\n${bodyLines.join('\n')}`;
  return { answered, terms, upsertRow, body };
}

function ChoicePills({ label, choices, value, preview, onSelect }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {choices.map((choice) => {
        const active = value === choice;
        return (
          <button
            key={choice}
            type="button"
            disabled={preview}
            onClick={() => onSelect(active ? '' : choice)}
            className={`min-h-[40px] rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              active
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-white text-ink hover:border-ink'
            } disabled:opacity-60`}
          >
            {choice}
          </button>
        );
      })}
    </div>
  );
}

export function LenderTermField({ field, program, ask, value, countering, preview, onOpenCounter, onRestoreAsk, onChange }) {
  if (ask && !countering) {
    return (
      <div data-ask-card={field.key} className="rounded-xl border border-line bg-paper p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-medium text-ink">
            {field.label} <span aria-hidden="true" className="text-red-700">*</span>
          </span>
          <button
            type="button"
            aria-label={`Change ${field.label}`}
            onClick={() => onOpenCounter(field)}
            className="min-h-[36px] shrink-0 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink hover:border-ink"
          >
            Change
          </button>
        </div>
        <div className="text-base font-medium leading-snug text-ink break-words whitespace-normal">{ask}</div>
      </div>
    );
  }

  const val = value || '';
  const choices = fieldChoices(field, program);
  return (
    <div className="rounded-xl border border-ink/30 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`lt-${field.key}`} className="min-w-[140px] flex-1 text-sm font-medium text-ink">
          {field.label} <span aria-hidden="true" className="text-red-700">*</span>
        </label>
        {ask && (
          <button
            type="button"
            onClick={() => onRestoreAsk(field)}
            className="min-h-[36px] shrink-0 px-1 text-xs font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
          >
            Use ours
          </button>
        )}
      </div>
      {field.inputType === 'choice' && choices.length > 0 ? (
        <div id={`lt-${field.key}`}>
          <ChoicePills
            label={field.label}
            choices={choices}
            value={val}
            preview={preview}
            onSelect={(next) => onChange(field.label, next, ask ? field.key : undefined)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            {field.unit === '$' && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">$</span>
            )}
            <input
              id={`lt-${field.key}`}
              type="number"
              inputMode="decimal"
              required
              min={field.min ?? 0}
              max={field.max}
              step={field.step ?? 'any'}
              aria-label={field.label}
              disabled={preview}
              placeholder={field.placeholder || ''}
              value={val}
              onChange={(e) => onChange(field.label, e.target.value, ask ? field.key : undefined)}
              className={`min-h-[42px] w-full rounded-xl border border-line bg-white text-sm outline-none focus:border-ink ${
                field.unit === '$' ? 'pl-7 pr-3' : 'px-3'
              }`}
            />
          </div>
          {field.unit && field.unit !== '$' && (
            <span className="shrink-0 text-sm font-medium text-ink-soft">{field.unit}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function LenderTerms({ deal, me, preview, guide = null, base = null, offer = null, lenderLens = null }) {
  const [program, setProgram] = useState(() => (lenderLens && LENDER_PROGRAMS[LENDER_LENSES[lenderLens]?.program] ? LENDER_LENSES[lenderLens].program : 'bridge'));
  const [savedType, setSavedType] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [editing, setEditing] = useState({});
  const [ext, setExt] = useState({ count: '', months: '3 mo', fee: '0.5%' });
  const [company, setCompany] = useState('');
  const [name, setName] = useState(() => initialLenderName(me, preview));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!savedType && lenderLens && LENDER_LENSES[lenderLens]?.program && LENDER_PROGRAMS[LENDER_LENSES[lenderLens].program]) {
      setProgram(LENDER_LENSES[lenderLens].program);
    }
  }, [lenderLens, savedType]);

  const pkg = buildLenderPackage({ base, offer, guide, lens: program });
  const fields = fieldsForProgram(program);
  const asks = wantedTerms(program, guide, base, offer);
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
      if (LENDER_PROGRAMS[data.lender_type]) {
        setSavedType(data.lender_type);
        setProgram(data.lender_type);
      }
      setDrafts(data.terms || {});
    });
  }, [deal.id, me?.uid, preview]);

  const setAnswer = (label, value, fieldKey) => {
    setDrafts((prev) => setTermAnswer(prev, null, program, label, value).drafts);
    if (fieldKey) {
      setEditing((prev) => ({
        ...prev,
        [program]: { ...(prev[program] || {}), [fieldKey]: true },
      }));
    }
  };

  const openCounter = (field) => {
    const next = openTermCounter(drafts, editing, program, field);
    setDrafts(next.drafts);
    setEditing(next.editing);
    if (!preview && typeof document !== 'undefined') {
      requestAnimationFrame(() => document.getElementById(`lt-${field.key}`)?.focus());
    }
  };

  const restoreAsk = (field) => {
    const next = restoreTermAsk(drafts, editing, program, field);
    setDrafts(next.drafts);
    setEditing(next.editing);
  };

  const allAnswered = isTermsFormComplete({ company, name, fields, values });

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
        fields,
        values,
        extensions: ext,
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

  const summaryBadge = program === 'private'
    ? `${money(pkg.totalLoan)} pool · ${money(pkg.minParticipation)} min`
    : program === 'dscr'
      ? `${money(pkg.refiCheck.newLoan)} takeout`
      : `${money(pkg.totalLoan)} ask`;

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Your terms</CardTitle>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Loan program" className="inline-flex rounded-xl border border-line bg-paper p-1">
            {Object.entries(LENDER_PROGRAMS).map(([k, x]) => {
              const active = k === program;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setProgram(k); setStatus(''); }}
                  className={`min-h-[40px] rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                    active ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {x.label}
                </button>
              );
            })}
          </div>
          <span className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink">
            23 &amp; 27 Charlotte · {pkg.units} units · {summaryBadge}
          </span>
        </div>

        <div role="tabpanel">
          <form onSubmit={send} className="space-y-5">
            {/* Group 1: Your info */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-ink">
                Company name <span aria-hidden="true" className="text-red-700">*</span>
                <input
                  required
                  autoComplete="organization"
                  disabled={preview}
                  maxLength={160}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company or lender name"
                  className="mt-1 min-h-[42px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-ink"
                />
              </label>
              <label className="block text-sm font-medium text-ink">
                Your name <span aria-hidden="true" className="text-red-700">*</span>
                <input
                  required
                  autoComplete="name"
                  disabled={preview}
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="mt-1 min-h-[42px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-ink"
                />
              </label>
            </div>

            {/* Group 2: Loan terms (our asks by default, 1-tap Change) */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Loan terms</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => {
                  const ask = asks[f.label] || '';
                  const countering = isTermCountering(f, ask, progDraft, progEditing);
                  return (
                    <LenderTermField
                      key={f.key}
                      field={f}
                      program={program}
                      ask={ask}
                      value={values[f.label] || ''}
                      countering={countering}
                      preview={preview}
                      onOpenCounter={openCounter}
                      onRestoreAsk={restoreAsk}
                      onChange={setAnswer}
                    />
                  );
                })}
              </div>
            </div>

            {/* Group 3: Extensions (Bridge & Private only) */}
            {program !== 'dscr' && (
              <div className="rounded-xl border border-line bg-paper p-3.5 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Extension options (optional)</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <div className="text-sm font-medium text-ink">Number of extensions</div>
                    <ChoicePills
                      label="Number of extensions"
                      choices={EXTENSION_COUNTS}
                      value={ext.count}
                      preview={preview}
                      onSelect={(next) => setExt((prev) => ({ ...prev, count: next }))}
                    />
                  </div>
                  {ext.count && ext.count !== 'None' && (
                    <>
                      <div className="space-y-1.5">
                        <div className="text-sm font-medium text-ink">Months each</div>
                        <ChoicePills
                          label="Months each"
                          choices={EXTENSION_MONTHS}
                          value={ext.months}
                          preview={preview}
                          onSelect={(next) => setExt((prev) => ({ ...prev, months: next || '3 mo' }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-sm font-medium text-ink">Fee per extension</div>
                        <ChoicePills
                          label="Fee per extension"
                          choices={EXTENSION_FEES}
                          value={ext.fee}
                          preview={preview}
                          onSelect={(next) => setExt((prev) => ({ ...prev, fee: next || '0%' }))}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Group 4: Collateral & Optional terms */}
            <div className="rounded-xl border border-line bg-paper p-3.5 space-y-3.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Collateral &amp; optional terms</div>
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-ink">{COLLATERAL_QUESTION.prompt}</div>
                <ChoicePills
                  label={COLLATERAL_QUESTION.prompt}
                  choices={COLLATERAL_QUESTION.choices}
                  value={values[COLLATERAL_QUESTION.label] || ''}
                  preview={preview}
                  onSelect={(next) => setAnswer(COLLATERAL_QUESTION.label, next)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {OPTIONAL_FIELDS.map((opt) => (
                  <div key={opt.key} className="space-y-1.5">
                    <div className="text-sm font-medium text-ink">{opt.label}</div>
                    <ChoicePills
                      label={opt.label}
                      choices={opt.choices}
                      value={values[opt.label] || ''}
                      preview={preview}
                      onSelect={(next) => setAnswer(opt.label, next)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <label className="block text-sm font-medium text-ink">
              Questions or document requests (optional)
              <DictatedField
                as="textarea"
                aria-label="Questions or document requests"
                disabled={preview}
                value={values.Questions || ''}
                maxLength={1000}
                onChange={(e) => setAnswer('Questions', e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-white p-3 font-normal"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={preview || busy || !allAnswered}>
                Send terms to the buyer
              </Button>
              <span role="status" className="text-sm text-ink">{status}</span>
            </div>
          </form>
        </div>
      </Card>
      <LenderBoard deal={deal} me={me} refresh={refresh} role="lender" />
    </div>
  );
}
