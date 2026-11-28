import { buyerName } from '../lib/people.js';
import { DictatedField } from '../components/Dictation.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useDealModel } from '../lib/useDealModel.js';
import { SendWhatIf } from '../components/Switches.jsx';
import CostSummary from '../components/CostSummary.jsx';
import UnitsRentedGuide, { isUnitsGuide } from '../components/UnitsRentedGuide.jsx';
import { BASE_DEFAULTS, BASE_FIELDS, STRUCTURES, buildLeadStory, applyGuideRefi, sharedRefiStory, evaluate, grade, money, pct, syncOpexOverride, valueSummary } from '../lib/dealmath.js';
import { Card, Button, Badge, Empty, InfoTip, OverlayTrigger } from '../components/Shell.jsx';
import { plain } from '../lib/plain.js';
import { breakEvenCount } from '../lib/occupancy.js';
import { SITE_KIND, canAccessDealPlan } from '../lib/site.js';

// Owner-only dynamic import so public and seller builds never bundle dealplan or deal_plan data.
const loadPlanLib =
  import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller'
    ? null
    : () => import('../lib/dealplan.js');

const stepFor = (unit, label) => (unit === '%' ? 0.25 : unit === 'x' ? 0.05 : unit === 'n' ? 1 : /\/ mo/.test(label) ? 25 : 1000);

function NumberRow({ label, unit, value, onChange, changed, locked }) {
  if (unit === 'bool') {
    const checked = Boolean(value);
    if (locked) {
      return (
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-sm text-ink-soft">{label}</span>
          <span className="text-sm font-medium">{checked ? 'On' : 'Off'}</span>
        </div>
      );
    }
    return (
      <label className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3 py-2">
        <span className={`text-sm ${changed ? 'font-medium text-ink' : 'text-ink-soft'}`}>{label}</span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 rounded border-line accent-ink" />
      </label>
    );
  }
  const step = stepFor(unit, label);
  const v = value ?? '';
  if (locked) {
    const shown = unit === '$' ? money(+v) : unit === '%' ? `${v}%` : unit === 'x' ? `${v}x` : v;
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className="flex items-center gap-2 text-sm font-medium" title={`From the property's records. Only ${buyerName()} can change it.`}>{shown}<span className="rounded-full bg-warm-soft px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-soft">Locked</span></span>
      </div>
    );
  }
  const bump = (d) => onChange(Math.round((+v + d * step) * 100) / 100);
  return (
    <label className="flex min-h-[40px] items-center justify-between gap-2 py-1.5">
      <span className={`text-sm ${changed ? 'font-medium text-ink' : 'text-ink-soft'}`}>{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => bump(-1)} className="h-10 w-10 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">−</button>
        <span className="relative">
          {unit === '$' && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>}
          <input type="number" inputMode={unit === 'n' ? 'numeric' : 'decimal'} value={v} step={step} onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)}
            className={`h-10 w-24 rounded-lg border border-line bg-white text-right text-sm outline-none focus:border-ink sm:w-28 ${unit === '$' ? 'pl-5 pr-2' : 'px-2'}`} />
        </span>
        <span className="w-4 text-xs text-ink-soft">{unit === '%' ? '%' : unit === 'x' ? 'x' : ''}</span>
        <button type="button" onClick={() => bump(1)} className="h-10 w-10 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">+</button>
      </span>
    </label>
  );
}

function Metric({ label, value, tone, overlay }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs uppercase tracking-wider text-ink-soft">{label}</p>
      <div className="mt-1 font-display text-2xl font-semibold">
        <OverlayTrigger lines={overlay}>{value}</OverlayTrigger>
      </div>
      {tone && tone !== 'none' && (
        <div className="mt-1"><Badge tone={tone}>{{ pass: 'Passes', close: 'Close', fail: 'Fails' }[tone]}</Badge></div>
      )}
    </div>
  );
}

export function Results({ r }) {
  const fmt = (v, u) => (u === '$' ? money(v) : u === '$/mo' ? (v === null ? 'Needs their loan payment' : money(v) + '/mo') : u === 'mo' ? (Number.isFinite(v) ? `${Math.ceil(v)} months` : 'Never at this credit') : v);
  const keepLabel = r.keepMonthly < 0 ? 'Short each month' : 'Left over each month after every bill';
  const keepValue = r.keepMonthly < 0 ? `${money(-r.keepMonthly)}/mo` : `${money(r.keepMonthly)}/mo`;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label={keepLabel} value={keepValue} tone={grade('keep', r.keepMonthly)}
          overlay={[r.operating.b.units ? `${money(r.keepMonthly / r.operating.b.units)} per unit/mo across ${r.operating.b.units} units.` : null]} />
        <Metric label="Seller gets / mo" value={r.sellerMonthly === null ? 'At closing' : money(r.sellerMonthly)}
          overlay={[r.sellerMonthly === null ? 'Paid in full at closing.' : r.sellerNet !== null ? `${money(r.sellerNet)} after their own loan payment.` : 'Before their own loan payment.']} />
        <Metric label="Rent covers the payment" value={Number.isFinite(r.dscr) ? r.dscr.toFixed(2) + 'x' : 'No payment'} tone={grade('dscr', r.dscr)}
          overlay={['Target 1.20x or more.']} />
        <Metric label="Yearly return on cash in" value={r.cashOnCash === null ? 'No cash in' : pct(r.cashOnCash, 1)} tone={r.cashOnCash === null ? 'none' : grade('cashOnCash', r.cashOnCash)}
          overlay={[r.cashIn > 0 ? `${money(r.cashIn)} cash in. Target 8–12%.` : 'No cash in upfront.']} />
        <Metric label="Total cost vs value" value={pct(r.allInPct)} tone={grade('allInPct', r.allInPct)}
          overlay={[`${money(r.allIn)} of ${money(r.operating.b.value)}. Target 75% or less.`]} />
        <Metric label="Rented units to break even" value={pct(r.breakEven)} tone={grade('breakEven', r.breakEven)}
          overlay={[`${breakEvenCount(r)}. Target 85% or less.`]} />
      </div>
      {r.extra.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white px-4">
          {r.extra.map(([l, v, u]) => <li key={l} className="flex justify-between gap-3 py-2 text-sm"><span className="text-ink-soft">{l}</span><span className="font-medium">{fmt(v, u)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

function BuildingNumbers({ base, setBase, o, owner = false, comps }) {
  const [open, setOpen] = useState(false);
  const val = valueSummary({ base: { ...o.b, ...base }, noi: o.noi, units: o.b.units, comps });
  const buildingOverlay = [
    ...val.incomeOverlay,
    `Yearly NOI: ${money(o.noi)} · Cap rate: ${pct(o.capRate, 1)} · Refinance loan: ${money(o.refiLoan)} (${o.refiLimitedBy === 'DSCR' ? 'rent-limited' : 'value-limited'}), nets ${money(o.refiNet)}.`,
    ...(val.compsLine ? [val.compsLine, ...(val.compsOverlay || [])] : []),
  ];
  const activeRefiLtv = +(base.refiLtv ?? BASE_DEFAULTS.refiLtv);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Building numbers</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {owner && (
            <div className="inline-flex rounded-full border border-line bg-paper p-0.5" role="group" aria-label="Refinance LTV">
              {[75, 80].map((ltv) => {
                const active = activeRefiLtv === ltv;
                return (
                  <button
                    key={ltv}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setBase({ ...base, refiLtv: ltv })}
                    className={`min-h-[34px] rounded-full px-3 py-1 text-xs font-semibold transition ${
                      active ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {ltv}% LTV
                  </button>
                );
              })}
            </div>
          )}
          <OverlayTrigger lines={buildingOverlay} className="font-semibold text-ink">{val.incomeLine}</OverlayTrigger>
          <InfoTip label="How value is figured" lines={buildingOverlay} />
        </div>
      </div>
      <div className="mt-3 border-t border-line pt-2.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-1 py-1 text-left text-sm font-medium text-ink hover:bg-warm-soft/60">
          <span>Assumptions</span>
          <span aria-hidden="true" className="text-ink-soft">{open ? '▴' : '▾'}</span>
        </button>
        {open && (
          <div className="mt-3 grid gap-x-8 md:grid-cols-2">
            {BASE_FIELDS.map(([k, l, u]) => (
              <NumberRow key={k} label={l} unit={u} value={base[k] ?? BASE_DEFAULTS[k]} changed={base[k] !== undefined && base[k] !== BASE_DEFAULTS[k]}
                onChange={(v) => {
                  const next = syncOpexOverride ? syncOpexOverride(base, k, v) : { ...base, [k]: v };
                  setBase(k === 'value' ? { ...next, _valueOverride: true } : next);
                }} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// Pills and figures never show a month guess: "1st Unit 9 · month 1" reads "1st Unit 9",
// "$5,000 (month 12 refi)" reads "$5,000". The refinance happens when all 10 units are rented.
const noMonth = (s) => (typeof s === 'string' ? s.replace(/\s*·\s*months?\s+\d+(\s*[–-]\s*\d+)?/gi, '').replace(/\s*\(month \d+ refi\)/gi, '') : s);

export const letterOf =(o, i) => (/^([A-Z])\s*:/.exec(o.name)?.[1]) || String.fromCharCode(65 + i);
export const titleOf = (o) => o.name.replace(/^[A-Z]\s*:\s*/, '');

function StoryLines({ lines }) {
  return (
    <div className="space-y-1 text-sm">
      {lines.map((line, idx) => {
        const toneCls = line.tone === 'pass' ? 'text-good font-semibold' : line.tone === 'fail' ? 'text-red-700 font-semibold' : '';
        if (line.big) {
          return (
            <div key={idx} className={`pt-1 font-display text-2xl font-semibold leading-tight ${toneCls}`}>
              <OverlayTrigger lines={line.overlay}>{line.label}</OverlayTrigger>
            </div>
          );
        }
        if (line.value) {
          return (
            <div key={idx} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-ink-soft">{line.label}</span>
              <OverlayTrigger lines={line.overlay} className={`font-semibold text-right ${toneCls || 'text-ink'}`}>{line.value}</OverlayTrigger>
            </div>
          );
        }
        return (
          <div key={idx} className={toneCls || 'text-ink'}>
            <OverlayTrigger lines={line.overlay}>{line.label}</OverlayTrigger>
          </div>
        );
      })}
    </div>
  );
}

// Each offer reads as its units-rented table and refinance plan. All math and estimates live in tap/hover overlays.
export function OptionCard({ o, i, story, planHref, hideUnitsTable = false, shared = false }) {
  const hasUnitsGuide = !hideUnitsTable && isUnitsGuide(story?.unitsGuide);
  const h = story?.headline;
  const primaryHeadlines = h ? [h.moneyIn, h.cashOut].filter(Boolean) : [];
  const secondaryHeadlines = h ? [h.sellerTotal, h.maxSellerAtRefi].filter(Boolean) : [];
  return (
    <div className="rounded-3xl border-2 border-ink bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg text-white">{letterOf(o, i)}</span>
          {o.is_lead && <span className="rounded-full bg-good/10 px-2.5 py-0.5 text-xs font-semibold text-good">Lead offer</span>}
        </div>
        {planHref && <a href={planHref} className="inline-flex min-h-[40px] items-center text-sm font-medium underline">Plans</a>}
      </div>
      <h3 className="mt-3 font-display text-2xl font-semibold leading-tight">{titleOf(o)}</h3>

      {hasUnitsGuide ? (
        <UnitsRentedGuide guide={story.unitsGuide} className="mt-4" shared={shared} />
      ) : (
        <>
          {story.costSummary && <CostSummary summary={story.costSummary} className="mt-4" />}

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {primaryHeadlines.map((item) => (
              <div key={item.label} className="rounded-2xl bg-paper p-3.5">
                <div className="text-xs text-ink-soft">{item.label}</div>
                <div className={`mt-1 font-display text-2xl font-semibold leading-tight ${item.positive === true ? 'text-good' : item.positive === false ? 'text-red-700' : 'text-ink'}`}>
                  <OverlayTrigger lines={item.overlay}>{noMonth(item.value)}</OverlayTrigger>
                </div>
              </div>
            ))}
            {secondaryHeadlines.map((item) => (
              <div key={item.label} className="rounded-2xl bg-paper p-3">
                <div className="text-xs text-ink-soft">{item.label}</div>
                <div className="mt-1 font-display text-xl font-semibold leading-tight text-ink">
                  <OverlayTrigger lines={item.overlay}>{noMonth(item.value)}</OverlayTrigger>
                </div>
              </div>
            ))}
          </div>

          <ol className="mt-4 space-y-3 border-t border-line pt-4">
            {story.steps.map((step) => (
              <li key={step.num} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{step.num}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{step.title}</span>
                  </div>
                  {step.pills && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {step.pills.map((pill, idx) => (
                        <OverlayTrigger key={idx} lines={pill.overlay} className="rounded-full border border-line bg-paper px-2.5 py-1 text-xs font-medium text-ink">
                          {noMonth(pill.label)}
                        </OverlayTrigger>
                      ))}
                    </div>
                  )}
                  {step.lines && <StoryLines lines={step.lines} />}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export function OptionTable({ offers, stories, planHrefOf }) {
  const hasUnitsGuide = offers.some((o) => isUnitsGuide(stories[o.id]?.unitsGuide));
  if (hasUnitsGuide) {
    const g = (o) => stories[o.id]?.unitsGuide;
    const rows = [
      ['Cost summary', (o) => g(o)?.costSummary ? <CostSummary summary={g(o).costSummary} /> : '—'],
      ['Seller covered at', (o) => {
        const ug = g(o);
        return ug ? (ug.sellerCoveredAt !== null ? `${ug.sellerCoveredAt} units` : 'Not covered') : '—';
      }],
      ['You break even at', (o) => {
        const ug = g(o);
        return ug ? (ug.breakEvenUnits !== null ? `${ug.breakEvenUnits} units` : 'Above 10') : '—';
      }],
      ['Value', (o) => {
        const r = g(o)?.refi;
        return r ? <OverlayTrigger lines={r.estimatedValueOverlay} className="font-semibold">{money(r.estimatedValue)}</OverlayTrigger> : '—';
      }],
      ['Loan at refi', (o) => {
        const r = g(o)?.refi;
        return r ? <OverlayTrigger lines={r.loanOverlay} className="font-semibold">{money(r.loan)} ({r.ltvShownPct}%)</OverlayTrigger> : '—';
      }],
      ['In hand after fees and reserve', (o) => {
        const r = g(o)?.refi;
        return r ? <OverlayTrigger lines={r.inHandOverlay} className="font-semibold">{money(r.inHand)}</OverlayTrigger> : '—';
      }],
      ['Seller paid off', (o) => {
        const r = g(o)?.refi;
        return r ? <OverlayTrigger lines={r.sellerPayoffOverlay} className="font-semibold">{r.sellerPayoffText}</OverlayTrigger> : '—';
      }],
      ['Repair loan paid off', (o) => {
        const r = g(o)?.refi;
        if (r?.renoFromSeller) return <OverlayTrigger lines={r.repairLoanOverlay} className="font-semibold">{money(r.renoNotePrincipal)} seller note</OverlayTrigger>;
        return r ? <OverlayTrigger lines={r.repairLoanOverlay} className="font-semibold">{money(r.repairLoanPayoff)} unused · {money(r.repairLoanPayoffContUsed)} all used</OverlayTrigger> : '—';
      }],
      ['Left for you', (o) => {
        const r = g(o)?.refi;
        if (!r) return '—';
        if (r.renoFromSeller) return <div className="font-display text-lg font-semibold"><OverlayTrigger lines={r.leftForYouOverlay} className={r.leftForYou >= 0 ? 'text-good' : 'text-red-700'}>{money(r.leftForYou)}</OverlayTrigger></div>;
        return (
          <div className="space-y-1 font-display text-lg font-semibold">
            <div><OverlayTrigger lines={r.leftForYouOverlay} className={r.leftForYou >= 0 ? 'text-good' : 'text-red-700'}>{money(r.leftForYou)} unused</OverlayTrigger></div>
            <div><OverlayTrigger lines={r.leftForYouContUsedOverlay} className={r.leftForYouContUsed >= 0 ? 'text-good' : 'text-red-700'}>{money(r.leftForYouContUsed)} all used</OverlayTrigger></div>
          </div>
        );
      }],
    ];
    return (
      <div className="comparison-scroll" tabIndex={0} aria-label="Options side by side; scroll sideways">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Compare</th>
              {offers.map((o, i) => (
                <th key={o.id}>
                  <div>Option {letterOf(o, i)}{o.is_lead ? ' ★' : ''}</div>
                  <div>{titleOf(o)}</div>
                  {planHrefOf?.(o) && <a href={planHrefOf(o)} className="mt-1 inline-block text-xs font-normal underline">Plans</a>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map(([label, f]) => <tr key={label}><th>{label}</th>{offers.map((o) => <td key={o.id}>{f(o)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }

  const stepNums = [1, 2, 3, 4, 5, 6, 7];
  const stepLabels = {
    1: '1. Take over',
    2: '2. Rehab',
    3: '3. Holding cost / mo',
    4: '4. Lease-up',
    5: '5. Full',
    6: '6. Refinance',
    7: '7. After',
  };
  const renderStep = (story, num) => {
    const step = story.steps.find((s) => s.num === num);
    if (!step) return '—';
    return (
      <div className="space-y-1.5">
        {step.pills && (
          <div className="flex flex-wrap gap-1">
            {step.pills.map((pill, idx) => (
              <OverlayTrigger key={idx} lines={pill.overlay} className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs">
                {noMonth(pill.label)}
              </OverlayTrigger>
            ))}
          </div>
        )}
        {step.lines && <StoryLines lines={step.lines} />}
      </div>
    );
  };
  const hasCostSummary = offers.some((o) => Boolean(stories[o.id]?.costSummary));
  const rows = [
    ...(hasCostSummary ? [['Cost summary', (o) => <CostSummary summary={stories[o.id].costSummary} />]] : []),
    ['Your money in', (o) => <OverlayTrigger lines={stories[o.id].headline.moneyIn.overlay} className="font-display text-lg font-semibold">{stories[o.id].headline.moneyIn.value}</OverlayTrigger>],
    ['Cash out at refinance', (o) => {
      const c = stories[o.id].headline.cashOut;
      return <OverlayTrigger lines={c.overlay} className={`font-display text-lg font-semibold ${c.positive === true ? 'text-good' : c.positive === false ? 'text-red-700' : ''}`}>{c.value}</OverlayTrigger>;
    }],
    ['Seller gets in total', (o) => <OverlayTrigger lines={stories[o.id].headline.sellerTotal.overlay} className="font-display text-lg font-semibold">{stories[o.id].headline.sellerTotal.value}</OverlayTrigger>],
    ['Most the seller can get at refi with $0 from you', (o) => <OverlayTrigger lines={stories[o.id].headline.maxSellerAtRefi.overlay} className="font-display text-lg font-semibold">{stories[o.id].headline.maxSellerAtRefi.value}</OverlayTrigger>],
    ...stepNums.map((num) => [stepLabels[num], (o) => renderStep(stories[o.id], num)]),
  ];
  return (
    <div className="comparison-scroll" tabIndex={0} aria-label="Options side by side; scroll sideways">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Compare</th>
            {offers.map((o, i) => (
              <th key={o.id}>
                <div>Option {letterOf(o, i)}{o.is_lead ? ' ★' : ''}</div>
                <div>{titleOf(o)}</div>
                {planHrefOf?.(o) && <a href={planHrefOf(o)} className="mt-1 inline-block text-xs font-normal underline">Plans</a>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(([label, f]) => <tr key={label}><th>{label}</th>{offers.map((o) => <td key={o.id}>{f(o)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Owner: saves. Everyone else (realtor, reviewer, lender): terms and switches are a what-if they can send to the buyer.
export default function Offers({ deal, canSave, onlyShared, me, role, preview, leadGuide: leadGuideProp }) {
  const owner = !!canSave;
  const model = useDealModel(deal, { owner, onlyShared });
  const { offers, setOffers, base, setBase: saveBase, later, saved } = model;
  const [active, setActive] = useState(null);
  // Owner opens on the short comparison table; everyone else opens on the lead offer.
  const [view, setView] = useState(owner ? 'table' : 'cards');
  const [leadErr, setLeadErr] = useState('');
  const [planState, setPlanState] = useState({ lib: null, plan: null });
  const [comps, setComps] = useState([]);
  const [fetchedLeadGuide, setFetchedLeadGuide] = useState(null);
  const syncedLeadRef = useRef(false);
  const canPlan = Boolean(owner && !onlyShared && canAccessDealPlan(SITE_KIND, role, preview) && loadPlanLib);
  const canComps = Boolean(owner || role === 'realtor' || role === 'reviewer');

  useEffect(() => {
    if (owner || leadGuideProp !== undefined) return () => {};
    let alive = true;
    supabase.rpc('commercial_get_lead_guide', { p_deal: deal.id }).then(({ data }) => {
      if (!alive) return;
      const raw = Array.isArray(data) ? data[0] : data;
      const g = raw?.guide || raw || null;
      setFetchedLeadGuide(isUnitsGuide(g) ? g : null);
    });
    return () => { alive = false; };
  }, [deal.id, owner, leadGuideProp]);

  useEffect(() => {
    let alive = true;
    if (!loadPlanLib || !canPlan) {
      setPlanState({ lib: null, plan: null });
      return () => { alive = false; };
    }
    (async () => {
      try {
        const lib = await loadPlanLib();
        const plan = await lib.loadDealPlan(supabase, deal.slug);
        if (alive) setPlanState({ lib, plan });
      } catch {
        if (alive) setPlanState({ lib: null, plan: null });
      }
    })();
    return () => { alive = false; };
  }, [deal.slug, canPlan]);

  useEffect(() => {
    let alive = true;
    if (!canComps) return () => { alive = false; };
    supabase.from('commercial_comps').select('units,sale_price').eq('deal_id', deal.id).then(({ data }) => {
      if (alive && data) setComps(data);
    });
    return () => { alive = false; };
  }, [deal.id, canComps]);

  const computeSellerSummary = (offer, nextInputs, nextBase, force = false) => {
    if (!owner || !canPlan || !planState.lib || !planState.plan) return undefined;
    return planState.lib.offerSellerSummary({ ...offer, inputs: nextInputs }, nextBase, planState.plan, comps, force);
  };

  // Ensure the lead offer gets a fresh seller_summary.guide (and unlocked seller_summary terms) once deal_plan loads.
  useEffect(() => {
    if (syncedLeadRef.current || !owner || !canPlan || !planState.lib || !planState.plan || !offers?.length) return;
    const lead = offers.find((x) => x.is_lead);
    if (!lead) { syncedLeadRef.current = true; return; }
    syncedLeadRef.current = true;
    const planTotal = planState.lib.overallRepairBudget(planState.plan);
    const syncBase = planTotal > 0 ? { ...base, rehab: planTotal } : base;
    const summary = computeSellerSummary(lead, lead.inputs, syncBase, false);
    if (summary && JSON.stringify(summary) !== JSON.stringify(lead.seller_summary)) {
      setOffers((list) => list.map((x) => (x.id === lead.id ? { ...x, seller_summary: summary } : x)));
      void supabase.from('commercial_offers').update({ seller_summary: summary, updated_at: new Date().toISOString() }).eq('id', lead.id);
    }
  }, [owner, canPlan, planState, offers, base, comps]);

  const patch = (id, p) => {
    const existing = (offers || []).find((o) => o.id === id);
    const nextPatch = { ...p };
    if (owner && existing && 'inputs' in p && !('seller_summary' in p)) {
      const summary = computeSellerSummary(existing, p.inputs, base, false);
      if (summary) nextPatch.seller_summary = summary;
    }
    setOffers((list) => list.map((o) => (o.id === id ? { ...o, ...nextPatch } : o)));
    later(id, () => supabase.from('commercial_offers').update({ ...nextPatch, updated_at: new Date().toISOString() }).eq('id', id));
  };

  const setBase = (nextBase) => {
    saveBase(nextBase);
    if (owner && canPlan && planState.lib && planState.plan && offers?.length) {
      const updates = [];
      setOffers((list) => list.map((o) => {
        const summary = computeSellerSummary(o, o.inputs, nextBase, false);
        if (!summary) return o;
        updates.push([o.id, summary]);
        return { ...o, seller_summary: summary };
      }));
      for (const [id, summary] of updates) {
        later(`summary-${id}`, () => supabase.from('commercial_offers').update({ seller_summary: summary, updated_at: new Date().toISOString() }).eq('id', id));
      }
    }
  };

  const add = async (structure, from) => {
    const row = { deal_id: deal.id, structure, name: from ? from.name + ' (copy)' : STRUCTURES[structure].label, inputs: from ? from.inputs : {}, sort: (offers?.length || 0) + 1 };
    if (!owner) { const local = { ...row, id: crypto.randomUUID() }; setOffers([...offers, local]); return setActive(local.id); }
    const { data } = await supabase.from('commercial_offers').insert(row).select().single();
    if (data) { setOffers([...offers, data]); setActive(data.id); }
  };
  const remove = async (o) => {
    if (!window.confirm(`Delete “${o.name}”?`)) return;
    if (owner) await supabase.from('commercial_offers').delete().eq('id', o.id);
    const rest = offers.filter((x) => x.id !== o.id);
    setOffers(rest);
    setActive(rest[0]?.id || null);
  };
  const setLead = async (o) => {
    if (!owner || !o?.id) return;
    const { error } = await supabase.rpc('commercial_set_lead_offer', { p_deal: deal.id, p_offer: o.id });
    setLeadErr(error ? error.message : '');
    if (!error) {
      const nextSummary = computeSellerSummary(o, o.inputs, base, false);
      setOffers((list) => list.map((x) => (x.id === o.id ? { ...x, is_lead: true, ...(nextSummary ? { seller_summary: nextSummary } : {}) } : { ...x, is_lead: false })));
      if (nextSummary) {
        await supabase.from('commercial_offers').update({ seller_summary: nextSummary, updated_at: new Date().toISOString() }).eq('id', o.id);
      }
    }
  };

  const sortedOffers = useMemo(() => [...(offers || [])].sort((a, b) => (b.is_lead ? 1 : 0) - (a.is_lead ? 1 : 0)), [offers]);
  const planRehab = loadPlanLib && canPlan && planState.lib && planState.plan ? planState.lib.overallRepairBudget(planState.plan) : 0;
  const planOpex = loadPlanLib && canPlan && planState.plan?.opex ? planState.plan.opex : null;
  const guideOpex = (leadGuideProp?.opex || fetchedLeadGuide?.opex || null);
  const resolvedOpex = planOpex || guideOpex || base?.opex || null;
  const effectiveBase = {
    ...base,
    ...(planRehab > 0 ? { rehab: planRehab } : {}),
    ...(resolvedOpex ? { opex: resolvedOpex } : {}),
  };
  const evals = useMemo(() => Object.fromEntries((sortedOffers || []).map((o) => [o.id, evaluate(o.structure, o.inputs, effectiveBase)])), [sortedOffers, effectiveBase]);
  const useStaticGuide = owner || !model.touched;
  const stories = useMemo(() => Object.fromEntries((sortedOffers || []).map((o) => {
    if (loadPlanLib && canPlan && planState.lib && planState.plan) {
      return [o.id, planState.lib.offerPlanStory(o, effectiveBase, planState.plan, comps)];
    }
    const baseStory = buildLeadStory(o.structure, evals[o.id], { base: effectiveBase, comps });
    if (useStaticGuide) {
      const g = (leadGuideProp && isUnitsGuide(leadGuideProp) ? leadGuideProp : null)
        || (fetchedLeadGuide && isUnitsGuide(fetchedLeadGuide) ? fetchedLeadGuide : null)
        || (isUnitsGuide(o.seller_summary?.guide) ? o.seller_summary.guide : null);
      if (g) {
        if (g.refi) Object.assign(baseStory, applyGuideRefi(baseStory, g.refi, g));
        baseStory.unitsGuide = g;
        if (g.costSummary) baseStory.costSummary = g.costSummary;
        else if (g.cost?.length) baseStory.costSummary = { heading: g.costHeading, headingOverlay: g.costHeadingOverlay || [], lines: g.cost };
      } else if (o.seller_summary?.guide?.cost?.length) {
        const guide = o.seller_summary.guide;
        baseStory.costSummary = { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost };
      }
    }
    if (!owner) Object.assign(baseStory, sharedRefiStory(baseStory, { loanOption: role === 'reviewer' }));
    return [o.id, baseStory];
  })), [sortedOffers, evals, base, comps, canPlan, planState, leadGuideProp, fetchedLeadGuide, useStaticGuide]);

  if (offers === null) return <Empty>Loading…</Empty>;
  const cur = sortedOffers.find((o) => o.id === active) || sortedOffers[0];
  const r = cur && evals[cur.id];
  const o = evaluate('cash', {}, effectiveBase).operating;
  const showEdit = view === 'edit';
  const planHrefOf = (x) => (role === 'owner' && !onlyShared && canAccessDealPlan(SITE_KIND, role, preview) ? `#/d/${deal.slug}/plans/${x.structure}` : null);

  return (
    <div className="space-y-5">
      {model.error && <p role="alert" className="text-sm text-red-700">{model.error}</p>}
      {!owner && <SendWhatIf deal={deal} me={me} role={role} preview={preview} model={model} />}
      <div className="flex flex-wrap items-center gap-2" aria-label="Offer layout">
        {owner && <Button kind={view === 'table' ? 'primary' : 'secondary'} onClick={() => setView('table')} aria-pressed={view === 'table'}>Table view</Button>}
        <Button kind={view === 'cards' ? 'primary' : 'secondary'} onClick={() => setView('cards')} aria-pressed={view === 'cards'}>{owner ? 'Card view' : 'Lead offer'}</Button>
        <Button kind={showEdit ? 'primary' : 'secondary'} onClick={() => setView('edit')} aria-pressed={showEdit}>{owner ? 'Edit terms' : 'Try different terms'}</Button>
        {owner && sortedOffers.length > 0 && (
          <label className="flex min-h-[40px] items-center gap-2 rounded-full border border-ink bg-white py-1 pl-4 pr-1 text-sm font-semibold">
            Lead offer
            <select aria-label="Lead offer" value={sortedOffers.find((x) => x.is_lead)?.id || ''}
              onChange={(e) => { const x = sortedOffers.find((y) => y.id === e.target.value); if (x) void setLead(x); }}
              className="min-h-[36px] rounded-full border border-line bg-white px-3 py-1 text-sm font-normal">
              <option value="" disabled>Pick one</option>
              {sortedOffers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        {owner && saved && saved !== 'Saved' && <span role="status" className="ml-auto text-sm text-ink">{saved}</span>}
      </div>
      {leadErr && <p role="alert" className="text-sm text-red-700">{leadErr}</p>}
      {!sortedOffers.length && <Card><Empty>{owner ? 'Add an offer to start.' : 'No lead offer has been shared with you yet.'}</Empty></Card>}
      {owner && offers.length > 0 && view === 'table' && <OptionTable offers={sortedOffers} stories={stories} planHrefOf={planHrefOf} />}
      {offers.length > 0 && (view === 'cards' || (!owner && view === 'table')) && (
        <div className={owner ? 'grid items-start gap-4 lg:grid-cols-2' : 'max-w-xl'}>
          {(owner ? sortedOffers : sortedOffers.slice(0, 1)).map((x, i) => (
            <OptionCard key={x.id} o={x} i={i} story={stories[x.id]} planHref={planHrefOf(x)} hideUnitsTable={role === 'reviewer'} shared={!owner} />
          ))}
        </div>
      )}

      {showEdit && (
        <>
          {owner && (
            <div className="flex flex-wrap items-center gap-2">
              {sortedOffers.map((x) => (
                <button key={x.id} onClick={() => setActive(x.id)} aria-pressed={cur?.id === x.id}
                  className={`min-h-[40px] rounded-full border px-4 py-1.5 text-sm ${cur?.id === x.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>
                  {x.is_lead ? '★ ' : ''}{x.name} <span className={cur?.id === x.id ? 'text-white/70' : 'text-ink-soft'}>· {stories[x.id]?.headline?.cashOut?.value || money(evals[x.id].keepMonthly)}</span>
                </button>
              ))}
              <select aria-label="Add an option" value="" onChange={(e) => e.target.value && add(e.target.value)} className="min-h-[40px] rounded-full border border-dashed border-line bg-white px-3 py-1.5 text-sm">
                <option value="">+ Add an offer</option>
                {Object.entries(STRUCTURES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </div>
          )}
          {cur && (
            <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
              <Card>
                {owner
                  ? <DictatedField aria-label="Offer name" value={cur.name} onChange={(e) => patch(cur.id, { name: e.target.value.slice(0, 80) || cur.name })}
                      className="mb-1 w-full rounded-lg border border-transparent px-1 font-display text-xl font-semibold outline-none hover:border-line focus:border-ink" />
                  : <h3 className="mb-1 px-1 font-display text-xl font-semibold">{cur.name}</h3>}
                <div className="mb-3 px-1">
                  <InfoTip label="How this offer works" lines={[...plain(cur.structure, r).lines, `Worth knowing: ${plain(cur.structure, r).risk}.`]} />
                </div>
                {STRUCTURES[cur.structure].fields.map(([k, l, u]) => {
                  const d = STRUCTURES[cur.structure].defaults[k];
                  const v = cur.inputs?.[k];
                  return <NumberRow key={k} label={l} unit={u} value={v ?? d} changed={v !== undefined && v !== d}
                    onChange={(nv) => patch(cur.id, { inputs: { ...cur.inputs, [k]: nv } })} />;
                })}
                {owner && cur.structure !== 'cash' && !STRUCTURES[cur.structure].fields.some(([k]) => k === 'shortCarry') && (
                  <NumberRow label="Short months paid by the repair loan ($)" unit="$"
                    value={cur.inputs?.shortCarry ?? 0} changed={Boolean(cur.inputs?.shortCarry)}
                    onChange={(nv) => patch(cur.id, { inputs: { ...cur.inputs, shortCarry: nv } })} />
                )}
                {owner && (
                  <>
                    <DictatedField as="textarea" aria-label="Notes on this offer" value={cur.note || ''} onChange={(e) => patch(cur.id, { note: e.target.value.slice(0, 2000) })} placeholder="Notes on this offer"
                      className="mt-3 min-h-20 w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button kind="secondary" onClick={() => add(cur.structure, cur)}>Duplicate</Button>
                      <Button kind="secondary" onClick={() => remove(cur)}>Delete</Button>
                      {cur.is_lead
                        ? <span className="self-center rounded-full bg-good/10 px-3 py-1 text-xs font-semibold text-good">Lead offer</span>
                        : <Button kind="secondary" onClick={() => void setLead(cur)}>Set as lead offer</Button>}
                      {base.planOffer === cur.id
                        ? <span className="self-center text-sm font-medium text-good">Lenders see this as the plan</span>
                        : <Button kind="secondary" onClick={() => setBase({ ...base, planOffer: cur.id })}>Show lenders this as the plan</Button>}
                    </div>
                    <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
                      <p className="font-medium">Who can see the lead offer</p>
                      {'share_realtor' in cur && <label className="flex min-h-[40px] cursor-pointer items-center gap-2"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" checked={cur.share_realtor} onChange={(e) => patch(cur.id, { share_realtor: e.target.checked })} /> Realtor</label>}
                      <label className="flex min-h-[40px] cursor-pointer items-center gap-2"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" checked={cur.share_reviewer} onChange={(e) => patch(cur.id, { share_reviewer: e.target.checked })} /> Reviewer</label>
                      <label className="flex min-h-[40px] cursor-pointer items-center gap-2"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" checked={cur.share_lender} onChange={(e) => patch(cur.id, { share_lender: e.target.checked })} /> Lender</label>
                    </div>
                  </>
                )}
              </Card>
              <div className="space-y-5">
                <Results r={r} />
                <div className="flex justify-end">
                  <InfoTip label="Underwriting benchmarks" lines={['Targets: 1.20x+ DSCR, 85% or fewer units to break even, 8–12% cash-on-cash, 75% or less total cost vs value after repairs.']} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <BuildingNumbers base={effectiveBase} setBase={setBase} o={o} owner={owner} comps={comps} />
    </div>
  );
}
