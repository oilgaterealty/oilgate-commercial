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
  { key: 'ltv', label: 'Max LTV (% of value)', programs: ['dscr'], inputType: 'number', unit: '%', step: 5, min: 0, max: 100, presets: [75, 80], placeholder: 'e.g. 75' },
  { key: 'participation', label: 'Your participation', programs: ['private'], inputType: 'number', unit: '$', step: 5000, min: 0, placeholder: 'e.g. 50000' },
  { key: 'dscr', label: 'Minimum DSCR', programs: ['dscr'], inputType: 'choice', choices: ['1.00x', '1.10x', '1.15x', '1.20x', '1.25x'] },
  { key: 'rate', label: 'Interest rate', programs: ['bridge', 'private', 'dscr'], inputType: 'number', unit: '%', step: 0.25, min: 0, max: 30, placeholder: 'e.g. 10' },
  { key: 'points', label: 'Origination points', programs: ['bridge'], inputType: 'number', unit: 'pts', step: 0.25, min: 0, max: 10, placeholder: 'e.g. 1' },
  { key: 'processing', label: 'Processing fee', programs: ['bridge'], inputType: 'number', unit: '$', step: 100, min: 0, placeholder: 'e.g. 1295' },
  { key: 'amortization', label: 'Amortization', programs: ['dscr'], inputType: 'choice', choices: ['20 years', '25 years', '30 years'] },
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
    programs: ['bridge'],
    inputType: 'choice',
    choices: ['None', '1 month', '2 months', '3 months', '6 months'],
  },
  {
    key: 'rehab_draws',
    label: 'Rehab draws',
    programs: ['bridge'],
    inputType: 'choice',
    choices: ['In draws (non-Dutch)', 'In draws (Dutch)', 'At closing', 'No rehab funding'],
  },
  {
    key: 'lien_position',
    label: 'Lien position',
    programs: ['private'],
    inputType: 'choice',
    choices: ['First-lien pooled', 'First-lien sole', 'Second-lien'],
  },
  {
    key: 'prepayment',
    label: 'Prepayment penalty',
    programs: ['dscr'],
    inputType: 'choice',
    choices: ['None', '3-2-1', '5-4-3-2-1', 'Yield maintenance'],
  },
  {
    key: 'refi_fees',
    label: 'Refi fees',
    programs: ['dscr'],
    inputType: 'text',
    placeholder: 'e.g. $5,000 flat + 2%',
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

// Single-source asks derived per program tab. Each tab shows only its own lender's ask.
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
      ...(hasBridge ? { ltc: `100% LTC · Loan ${money(pkg.totalLoan)} · $0 down` } : { ltc: '100% LTC · $0 down' }),
      rate: `${pkg.ratePct}% IO · non-Dutch · ${money(pkg.initialMonthlyInterest)}/mo at close`,
      points: `${pkg.pointsPct} ${pointsWord} · rolled into the loan · Fee ${money(pkg.points)}`,
      processing: `${money(pkg.processing)} · rolled into the loan`,
      term: `${pkg.termMonths} months`,
      deferred_interest: pkg.deferredMonths > 0 ? `${pkg.deferredMonths} months · rolled into the loan (due at payoff)` : 'None',
      rehab_draws: pkg.repairs > 0 ? `Repairs ${money(pkg.repairs)} in draws (non-Dutch)` : 'In draws (non-Dutch)',
    };
  } else if (program === 'private') {
    byKey = {
      participation: pkg.privatePool.totalFunds > 0
        ? `Min ${money(pkg.minParticipation)} · Pool ${money(pkg.privatePool.totalFunds)}`
        : `Min ${money(pkg.minParticipation)}`,
      rate: `${pkg.privatePool.ratePct}% · no points`,
      term: `${pkg.privatePool.termMonths} months`,
      lien_position: 'First-lien pooled',
    };
  } else if (program === 'dscr') {
    byKey = {
      ltv: pkg.value > 0 && pkg.refiCheck.newLoan > 0
        ? `${pkg.refiCheck.refiLtv}% LTV · Value ${money(pkg.value)} · Loan ${money(pkg.refiCheck.newLoan)}`
        : `${pkg.refiCheck.refiLtv}% LTV`,
      dscr: `${refiDscr}x`,
      rate: `${refiRate}%`,
      amortization: `${refiYears} years`,
      term: `${refiYears} years`,
      prepayment: 'None',
      refi_fees: pkg.refiCheck.newLoan > 0
        ? `${money(pkg.refiCheck.refiFeesFlat)} flat + ${pkg.refiCheck.refiFeesPct}% · Fee ${money(pkg.refiCheck.refiFeesTotal)}`
        : `${money(pkg.refiCheck.refiFeesFlat)} flat + ${pkg.refiCheck.refiFeesPct}%`,
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
                <h3 className="text-lg font-semibold">
                  {r.company_name}
                  {r.terms?._contact && r.terms._contact !== r.company_name ? `, ${r.terms._contact}` : ''}
                  {r.lender_uid === me?.uid ? ' (you)' : ''}
                </h3>
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

export function resolveLenderIdentity(me, member = null, preview = false) {
  if (preview || me?.email === '__preview__') {
    return { name: '', company: '', hasRecordCompany: false };
  }
  const name = String(member?.display_name || me?.name || me?.email || '').trim();
  const company = String(member?.company || me?.company || '').trim();
  return { name, company, hasRecordCompany: company.length > 0 };
}

export function initialLenderName(me, preview, member = null) {
  return resolveLenderIdentity(me, member, preview).name;
}

export function isShortAsk(label, ask) {
  const l = String(label || '').trim();
  const a = String(ask || '').trim();
  return a.length > 0 && a.length <= 18 && (l.length + a.length) <= 34;
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

export function isTermsFormComplete({ fields, values }) {
  return fields.every((f) => String(values?.[f.label] || '').trim().length > 0);
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
  const storedCompany = cleanCompany || cleanName || 'Lender';
  const answered = {};
  for (const f of fields) {
    const formatted = formatFieldOutput(f, values?.[f.label]);
    if (formatted) answered[f.label] = formatted;
  }
  const extSummary = program === 'bridge' ? formatExtensionSummary(extensions) : '';
  if (extSummary) answered.Extensions = extSummary;
  const bothParcels = String(values?.[COLLATERAL_QUESTION.label] || '').trim();
  if (bothParcels) answered[COLLATERAL_QUESTION.label] = bothParcels;
  for (const opt of OPTIONAL_FIELDS) {
    if (program === 'dscr' && opt.key === 'prepayment') continue;
    const val = String(values?.[opt.label] || '').trim();
    if (val) answered[opt.label] = val;
  }
  const extraNotes = String(values?.Questions || '').trim();
  const terms = {
    ...(existingTerms || {}),
    [program]: answered,
    ...(cleanName ? { _contact: cleanName } : {}),
  };
  const upsertRow = {
    deal_id: dealId,
    lender_uid: lenderUid,
    company_name: storedCompany,
    lender_type: program,
    terms,
    updated_at: nowIso,
  };
  const bodyLines = [...Object.entries(answered), ...(extraNotes ? [['Questions', extraNotes]] : [])]
    .map(([k, v]) => `${k}: ${v}`);
  const progLabel = LENDER_PROGRAMS[program]?.label || program;
  const who = cleanCompany && cleanName && cleanCompany !== cleanName
    ? `${cleanCompany}, ${cleanName}`
    : cleanCompany || cleanName || 'Lender';
  const body = `${who} · ${progLabel}\n${bodyLines.join('\n')}`;
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
    if (isShortAsk(field.label, ask)) {
      return (
        <div
          data-ask-card={field.key}
          data-ask-layout="inline"
          className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-ink">
              {field.label} <span aria-hidden="true" className="text-red-700">*</span>
            </span>
            <span className="text-sm font-semibold text-ink tabular-nums">{ask}</span>
          </div>
          <button
            type="button"
            aria-label={`Change ${field.label}`}
            onClick={() => onOpenCounter(field)}
            className="min-h-[34px] shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink hover:border-ink"
          >
            Change
          </button>
        </div>
      );
    }
    return (
      <div
        data-ask-card={field.key}
        data-ask-layout="stacked"
        className="flex items-center justify-between gap-2.5 rounded-xl border border-line bg-paper px-3 py-2"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-sm font-medium text-ink">
            {field.label} <span aria-hidden="true" className="text-red-700">*</span>
          </span>
          <div className="text-sm font-semibold leading-snug text-ink break-words whitespace-normal">{ask}</div>
        </div>
        <button
          type="button"
          aria-label={`Change ${field.label}`}
          onClick={() => onOpenCounter(field)}
          className="min-h-[34px] shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink hover:border-ink"
        >
          Change
        </button>
      </div>
    );
  }

  const val = value || '';
  const choices = fieldChoices(field, program);
  return (
    <div className="rounded-xl border border-ink/30 bg-white px-3 py-2.5 space-y-2">
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
      ) : field.inputType === 'text' ? (
        <input
          id={`lt-${field.key}`}
          type="text"
          required
          aria-label={field.label}
          disabled={preview}
          placeholder={field.placeholder || ''}
          value={val}
          onChange={(e) => onChange(field.label, e.target.value, ask ? field.key : undefined)}
          className="min-h-[42px] w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-ink"
        />
      ) : (
        <div className="space-y-2">
          {Array.isArray(field.presets) && field.presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${field.label} quick options`}>
              {field.presets.map((preset) => {
                const presetStr = String(preset);
                const active = String(val).trim() === presetStr;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={preview}
                    onClick={() => onChange(field.label, presetStr, ask ? field.key : undefined)}
                    className={`min-h-[36px] rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active
                        ? 'border-ink bg-ink text-white'
                        : 'border-line bg-white text-ink hover:border-ink'
                    } disabled:opacity-60`}
                  >
                    {preset}{field.unit || ''}
                  </button>
                );
              })}
            </div>
          )}
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
        </div>
      )}
    </div>
  );
}

export default function LenderTerms({
  deal,
  me,
  member = null,
  preview,
  guide = null,
  base = null,
  offer = null,
  lenderLens = null,
  onLensChange = null,
  hideProgramTabs = false,
}) {
  const identity = resolveLenderIdentity(me, member, preview);
  const controlledProgram = lenderLens && LENDER_PROGRAMS[LENDER_LENSES[lenderLens]?.program]
    ? LENDER_LENSES[lenderLens].program
    : null;
  const [internalProgram, setInternalProgram] = useState(() => controlledProgram || 'bridge');
  const [savedType, setSavedType] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [editing, setEditing] = useState({});
  const [ext, setExt] = useState({ count: '', months: '3 mo', fee: '0.5%' });
  const [company, setCompany] = useState(() => identity.company);
  const [name, setName] = useState(() => identity.name);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (identity.name) setName((cur) => cur || identity.name);
    if (identity.hasRecordCompany) setCompany(identity.company);
  }, [identity.name, identity.company, identity.hasRecordCompany]);

  const isControlled = typeof onLensChange === 'function' && Boolean(controlledProgram);
  const program = isControlled ? controlledProgram : internalProgram;

  const selectProgram = (nextProg) => {
    setStatus('');
    if (isControlled) onLensChange(nextProg);
    else setInternalProgram(nextProg);
  };

  useEffect(() => {
    if (!isControlled && !savedType && controlledProgram) {
      setInternalProgram(controlledProgram);
    }
  }, [isControlled, controlledProgram, savedType]);

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
      const recordName = identity.name || data.terms?._contact || '';
      if (data.company_name && !identity.hasRecordCompany && data.company_name !== recordName) {
        setCompany(data.company_name);
      }
      if (data.terms?._contact) setName(data.terms._contact);
      if (LENDER_PROGRAMS[data.lender_type]) {
        setSavedType(data.lender_type);
        if (!isControlled) setInternalProgram(data.lender_type);
      }
      setDrafts(data.terms || {});
    });
  }, [deal.id, me?.uid, preview, isControlled, identity.hasRecordCompany, identity.name]);

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

  const allAnswered = isTermsFormComplete({ fields, values });

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
    ? `${money(pkg.privatePool.totalFunds)} pool · ${money(pkg.minParticipation)} min`
    : program === 'dscr'
      ? `${pkg.refiCheck.refiLtv}% LTV · Value ${money(pkg.value)} · Loan ${money(pkg.refiCheck.newLoan)}`
      : `${money(pkg.totalLoan)} · 100% LTC`;

  const visibleOptionalFields = OPTIONAL_FIELDS.filter((opt) => !(program === 'dscr' && opt.key === 'prepayment'));

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>{LENDER_PROGRAMS[program].label} terms</CardTitle>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {!hideProgramTabs && (
            <div role="tablist" aria-label="Loan program" className="inline-flex rounded-xl border border-line bg-paper p-1">
              {Object.entries(LENDER_PROGRAMS).map(([k, x]) => {
                const active = k === program;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => selectProgram(k)}
                    className={`min-h-[40px] rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                      active ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {x.label}
                  </button>
                );
              })}
            </div>
          )}
          <span className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink">
            23 &amp; 27 Charlotte · {pkg.units} units · {summaryBadge}
          </span>
        </div>

        <div role="tabpanel">
          <form onSubmit={send} className="space-y-4">
            {/* Group 1: Optional company only when member record has no company */}
            {!identity.hasRecordCompany && (
              <label className="block text-sm font-medium text-ink">
                Company (optional)
                <input
                  autoComplete="organization"
                  disabled={preview}
                  maxLength={160}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company or lender name"
                  className="mt-1 min-h-[42px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-ink"
                />
              </label>
            )}

            {/* Group 2: Loan terms (program-specific asks, 1-tap Change) */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Loan terms</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.map((f) => {
                  const ask = asks[f.label] || '';
                  const countering = isTermCountering(f, ask, progDraft, progEditing);
                  return (
                    <LenderTermField
                      key={`${program}:${f.key}`}
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

            {/* Group 3: Extensions (Bridge only) */}
            {program === 'bridge' && (
              <div className="rounded-xl border border-line bg-paper p-3 space-y-2.5">
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
            <div className="rounded-xl border border-line bg-paper p-3 space-y-3">
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
              <div className={`grid gap-3 ${visibleOptionalFields.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
                {visibleOptionalFields.map((opt) => (
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
