import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase.js';
import { SITE_KIND, canAccessDealPlan } from '../lib/site.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useHashRoute } from '../lib/useHashRoute.js';
import { OPTION_E_OVERLAY, buildCostSummary, buildLeadGuide, monthlyPlan, offerSellerSummary, derivations, normalizePlan, ordinal, overallRepairBudget } from '../lib/dealplan.js';
import { money, sellerLoanText, valueSummary } from '../lib/dealmath.js';
import { loadReadinessMap } from '../lib/readiness.js';
import CostSummary from '../components/CostSummary.jsx';
import UnitsRentedGuide from '../components/UnitsRentedGuide.jsx';
import ReadinessBadge from '../components/ReadinessBadge.jsx';
import { Card, CardTitle, Empty } from '../components/Shell.jsx';

// Portals keep the month table's overlays outside its horizontal scroll area.
export function PlanOverlay({ children, lines = [], label, className = '' }) {
  const id = useId();
  const trigger = useRef(null), popup = useRef(null), timer = useRef(null);
  const [position, setPosition] = useState(null);
  const [pinned, setPinned] = useState(false);
  const open = () => {
    clearTimeout(timer.current);
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(480, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 12));
    setPosition({ width, left, top: r.bottom + window.scrollY + 6 });
  };
  const close = () => { if (!pinned) timer.current = setTimeout(() => setPosition(null), 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!position || !popup.current || !trigger.current) return;
    const h = popup.current.offsetHeight;
    const r = trigger.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const wantTop = h > spaceBelow && spaceAbove > spaceBelow
      ? Math.max(12, r.top + window.scrollY - h - 6)
      : r.bottom + window.scrollY + 6;
    if (Math.abs(wantTop - position.top) > 1) setPosition((prev) => (prev ? { ...prev, top: wantTop } : prev));
  }, [position]);
  useEffect(() => {
    if (!position) return;
    const outside = (e) => {
      if (!trigger.current?.contains(e.target) && !popup.current?.contains(e.target)) {
        setPinned(false); setPosition(null);
      }
    };
    const escape = (e) => { if (e.key === 'Escape') { setPinned(false); setPosition(null); } };
    const dismiss = () => { setPinned(false); setPosition(null); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
    };
  }, [position]);
  const details = lines.filter(Boolean);
  if (!details.length) return <span className={className}>{children}</span>;
  return <>
    <button ref={trigger} type="button" aria-label={label} aria-expanded={!!position} aria-describedby={position ? id : undefined}
      className={`rounded text-left decoration-dotted underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink ${className}`}
      onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}
      onClick={() => { if (pinned) { setPinned(false); setPosition(null); } else { open(); setPinned(true); } }}>
      {children}
    </button>
    {position && createPortal(<div ref={popup} id={id} role="tooltip" style={position}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={close}
      className="absolute z-50 break-words rounded-xl border border-line bg-ink p-3 text-xs text-white shadow-xl">
      {details.map((line, i) => <div className="py-1.5 first:pt-0 last:pb-0" key={i}>{line}</div>)}
    </div>, document.body)}
  </>;
}

const stageNames = { vacant: 'Fixing up', partial: 'Filling up', full: 'Full', after: 'After the refinance' };
const stageColors = { vacant: 'bg-amber-50', partial: 'bg-orange-50', full: 'bg-emerald-50', after: 'bg-sky-50' };
const tone = (value) => value < 0 ? 'text-red-700' : 'text-ink';

export function DealPlanView({ result, base, offers, selected, onSelect, setBase, onChangeShortCarry, onSavePlan, comps = [], readiness = {} }) {
  const [showMonthly, setShowMonthly] = useState(false);
  const [editBudget, setEditBudget] = useState(false);
  const [draftPlan, setDraftPlan] = useState(() => normalizePlan(result.plan));
  const [budgetStatus, setBudgetStatus] = useState('');
  useEffect(() => { setDraftPlan(normalizePlan(result.plan)); }, [result.plan]);
  const explanations = derivations(result);
  const explain = (...titles) => explanations.filter(([title]) => titles.includes(title)).map(([title, text]) => `${title}: ${text}`);
  const sources = Object.entries(result.plan.sources).map(([key, value]) => `${key}: ${String(value)}`);
  const sellerDetails = explain('Seller payment', ...explanations.filter(([title]) => title.startsWith('Seller') && title !== 'Seller payment').map(([title]) => title));
  const runningDetails = [...sources, base.taxesSource && `Taxes: ${base.taxesSource}`,
    `Management ${result.operating.b.mgmtPct}%; fixed expenses are annual taxes, insurance and water and trash divided by 12.`];
  const { exit, totals, eligibility } = result;
  const val = valueSummary({ base: { ...result.operating.b, ...base }, noi: result.full.noi * 12, units: result.units.length || result.operating.b.units, comps });
  const unitsGuide = buildLeadGuide(base, result.plan, selected, comps);
  const shortCarry = selected?.inputs?.shortCarry ?? 0;
  const advancesStart = result.structure === 'master_lease' || result.structure === 'partnership'
    ? result.inputs.sellerAdvances
    : result.structure === 'seller_rehab'
      ? result.inputs.sellerFund
      : 0;
  const coverParts = [];
  if (advancesStart > 0 && result.rows.some((r) => r.fromPool > 0)) {
    coverParts.push(result.structure === 'seller_rehab' ? 'the seller’s rehab money' : 'the seller’s upfront money');
  }
  if (totals.peakLender > 0) coverParts.push('the rehab loan');
  const coveredBy = coverParts.length ? coverParts.join(' and ') : 'your cash';
  const fullSellerPay = result.structure === 'master_lease' ? result.inputs.payment : result.structure === 'partnership' ? result.inputs.stepUp : null;
  const eligibilityText = !eligibility ? '' : eligibility.status === 'not_stabilized'
    ? 'Not stabilized until all 10 units are rented'
    : eligibility.status === 'seasoning_short'
      ? 'Short on lender seasoning'
      : eligibility.status === 'eligible'
        ? 'Confirmed'
        : 'No lender has confirmed yet';
  const stageSellerLine = (stage) => {
    if (stage.key === 'after' && exit) return `Seller paid off at the refinance once all 10 units are rented (${money(exit.sellerPayoff)}).`;
    if (result.structure === 'seller_rehab') return `${OPTION_E_OVERLAY}`;
    if (fullSellerPay !== null) return `${money(fullSellerPay)} full payment × ${stage.renting} of ${result.units.length} units renting = ${money(stage.seller)}/mo.`;
    return null;
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2" aria-label="Plan options">
        {offers.map((offer) => <button key={offer.id} type="button" aria-pressed={offer.id === selected.id}
          onClick={() => onSelect(offer)} className={`min-h-10 rounded-full border px-4 py-2 text-sm ${offer.id === selected.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>{offer.name}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {setBase && (
          <div className="inline-flex rounded-full border border-line bg-white p-0.5" role="group" aria-label="Refinance LTV">
            {[75, 80].map((ltv) => {
              const active = +(base?.refiLtv ?? result?.operating?.b?.refiLtv ?? 75) === ltv;
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
        <label className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-xs text-ink-soft">
          <span>Short months paid by the repair loan ($)</span>
          <input type="number" inputMode="decimal" min={0} step={500} aria-label="Short months paid by the repair loan ($)" value={shortCarry}
            onChange={(e) => onChangeShortCarry?.(e.target.value === '' ? 0 : +e.target.value)}
            className="w-20 rounded border border-line px-1.5 py-0.5 text-right text-xs font-semibold text-ink outline-none focus:border-ink" />
        </label>
        {onSavePlan && (
          <button type="button" aria-expanded={editBudget} onClick={() => setEditBudget((v) => !v)}
            className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink hover:border-ink">
            {editBudget ? 'Hide repair budget' : 'Edit repair budget'}
          </button>
        )}
      </div>
    </div>

    {editBudget && onSavePlan && (
      <Card className="!p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Repair budget: {money(overallRepairBudget(draftPlan))}</h2>
          <div className="flex items-center gap-2">
            {budgetStatus && <span role="status" className="text-xs text-ink-soft">{budgetStatus}</span>}
            <button type="button" onClick={async () => {
              setBudgetStatus('Saving…');
              const err = await onSavePlan(draftPlan);
              setBudgetStatus(err ? 'Could not save. Try again.' : 'Saved.');
            }} className="rounded-xl bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-soft">
              Save repair budget
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {draftPlan.units.map((u, idx) => (
            <label key={u.id || idx} className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-xs">
              <span className="font-medium text-ink">Unit {u.id}</span>
              <input type="number" inputMode="decimal" min={0} step={500} aria-label={`Unit ${u.id} rehab`} value={u.rehab}
                onChange={(e) => {
                  const valNum = e.target.value === '' ? 0 : +e.target.value;
                  setDraftPlan((p) => ({ ...p, units: p.units.map((x, j) => (j === idx ? { ...x, rehab: valNum } : x)) }));
                }}
                className="w-24 rounded border border-line bg-white px-2 py-1 text-right text-sm font-semibold text-ink outline-none focus:border-ink" />
            </label>
          ))}
          {draftPlan.costs.map((c, idx) => (
            <label key={`${c.label}-${idx}`} className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-xs">
              <span className="font-medium text-ink">{c.label}</span>
              <input type="number" inputMode="decimal" min={0} step={500} aria-label={`${c.label} cost`} value={c.cost}
                onChange={(e) => {
                  const valNum = e.target.value === '' ? 0 : +e.target.value;
                  setDraftPlan((p) => ({ ...p, costs: p.costs.map((x, j) => (j === idx ? { ...x, cost: valNum } : x)) }));
                }}
                className="w-24 rounded border border-line bg-white px-2 py-1 text-right text-sm font-semibold text-ink outline-none focus:border-ink" />
            </label>
          ))}
          <label className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-xs">
            <span className="font-medium text-ink">Contingency</span>
            <input type="number" inputMode="decimal" min={0} step={500} aria-label="Repair contingency" value={draftPlan.contingency}
              onChange={(e) => setDraftPlan((p) => ({ ...p, contingency: e.target.value === '' ? 0 : +e.target.value }))}
              className="w-24 rounded border border-line bg-white px-2 py-1 text-right text-sm font-semibold text-ink outline-none focus:border-ink" />
          </label>
        </div>
      </Card>
    )}

    <UnitsRentedGuide guide={unitsGuide} Trigger={PlanOverlay} />

    <div className="pt-1">
      <button type="button" aria-expanded={showMonthly} onClick={() => setShowMonthly((v) => !v)}
        className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:border-ink">
        {showMonthly ? 'Hide step by step' : 'Step by step'}
      </button>
    </div>

    {showMonthly && (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {result.stages.filter((stage) => stage.from !== null).map((stage) => <Card key={stage.key} className="!p-3">
            <h2 className="font-display text-lg font-semibold">{stageNames[stage.key]}</h2>
            <div className="text-sm text-ink">{stage.renting} of {result.units.length} units renting</div>
            <PlanOverlay className="mt-3 block font-display text-xl font-semibold" label={`${stageNames[stage.key]} seller payment details`}
              lines={[stageSellerLine(stage), ...sellerDetails, stage.key === 'full' && explain('Rent once full').join(' '), stage.sellerGap !== null && `Seller after their own loan: ${money(stage.sellerGap)}/mo`, ...sources]}>
              Seller gets {money(stage.seller)}/mo
            </PlanOverlay>
            <PlanOverlay className={`mt-1 block text-sm font-medium ${tone(stage.keeps)}`} lines={stage.key === 'full' ? explain('Rent once full') : [`Rent ${money(stage.collected)} less operating expenses, reserves, seller, bank and interest.`, ...explain('Bank payment')]}>
              {stage.keeps < 0
                ? `Short ${money(-stage.keeps)} a month${stage.key === 'vacant' || stage.key === 'partial' ? ` while fixing up (covered by ${coveredBy})` : ''}`
                : `Left over each month after every bill: ${money(stage.keeps)}/mo`}
            </PlanOverlay>
          </Card>)}
        </div>
        {exit && <Card className="!p-4">
          <h2 className="font-display text-xl font-semibold"><PlanOverlay lines={explain('Refinance', 'Lender eligibility')}>Refinance when all 10 units are rented: {money(exit.loan)}</PlanOverlay></h2>
          <div className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2"><span>Seller paid</span><PlanOverlay lines={explain('Buy price', 'Buyout', 'Seller payment')}>{result.structure === 'seller_rehab' ? sellerLoanText(exit.sellerPayoff, false) : money(exit.sellerPayoff)}</PlanOverlay></div>
            <div className="flex justify-between gap-2"><span>Short-term loan paid off</span><PlanOverlay lines={explain('Short-term lender')}>{money(exit.lenderPayoff)}</PlanOverlay></div>
            <div className="flex justify-between gap-2"><span>Closing</span><PlanOverlay lines={explain('Refinance')}>{money(exit.closing)}</PlanOverlay></div>
            <div className={`flex justify-between gap-2 font-semibold ${tone(exit.left)}`}><span>{exit.left < 0 ? 'You bring' : 'You take home'}</span><PlanOverlay lines={explain('Refinance', 'Buyer cash')}>{exit.left > 0 ? '+' : ''}{money(exit.left)}</PlanOverlay></div>
            <div className="flex justify-between gap-2"><span>Lender status</span><PlanOverlay lines={explain('Lender eligibility')}>{eligibilityText}</PlanOverlay></div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <PlanOverlay className="font-medium" lines={[...val.incomeOverlay, ...explain('10-unit value'), ...(val.compsLine ? [val.compsLine, ...(val.compsOverlay || [])] : [])]}>{val.incomeLine}</PlanOverlay>
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-warm-soft p-3 text-sm font-semibold"><PlanOverlay lines={explain('Refinance', 'Buy price', 'Buyout')}>Most the seller can get at the refinance with $0 from you: {money(exit.maxSellerPayoff)}</PlanOverlay></div>
        </Card>}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {[
            ['Seller gets in total', totals.sellerTotal, explain('Seller payment', 'Buy price', 'Buyout')],
            ['Your cash in', totals.buyerCashTotal, explain('Buyer cash', 'Refinance', 'Bank payment')],
            ['Short-term loan at its peak', totals.peakLender, explain('Short-term lender')],
            ['Loan interest + points', totals.interestTotal + totals.pointsTotal, explain('Short-term lender')],
            ['One-time costs', totals.oneTimeTotal, result.items.filter((item) => item.cost > 0).map((item) => `${item.label}: ${money(item.cost)}`)],
          ].map(([label, value, lines]) => <div key={label} className="rounded-xl border border-line bg-white p-3">
            <div className="text-xs font-medium text-ink-soft">{label}</div>
            <PlanOverlay className="mt-1 font-display text-xl font-semibold" lines={lines}>{money(value)}</PlanOverlay>
          </div>)}
        </div>
        <Card className="!p-0">
          <div className="overflow-x-auto rounded-2xl" tabIndex={0} role="region" aria-label="Step-by-step cash flow">
            <table className="w-full min-w-[1240px] border-collapse text-right text-xs tabular-nums">
              <thead className="bg-ink text-white"><tr>
                {['Step', 'Units renting', 'Rent in', 'Running costs', 'Seller', 'Bank', 'Loan interest', 'One-time costs', 'Paid by', 'Left over', 'Running total'].map((label, i) => <th scope="col" key={label} className={`px-3 py-3 ${i === 0 ? 'sticky left-0 z-10 bg-ink text-left' : ''}`}>
                  {label === 'Running costs' ? <PlanOverlay lines={runningDetails}>{label}</PlanOverlay> : label === 'Left over' ? <PlanOverlay lines={['Left over each month after every bill.']}>{label}</PlanOverlay> : label}
                </th>)}
              </tr></thead>
              <tbody>{result.rows.map((row, step) => <tr key={row.month} className={`${stageColors[row.stage]} border-t border-line ${row.refi ? 'font-semibold ring-2 ring-inset ring-ink' : ''}`}>
                <th scope="row" className={`sticky left-0 z-10 px-3 py-3 text-left ${stageColors[row.stage]}`}><PlanOverlay lines={row.refi ? explain('Refinance') : []}>{step + 1}{row.refi ? ' ↗' : ''}</PlanOverlay></th>
                <td className="px-3 py-2"><PlanOverlay label={`Step ${step + 1} renting units`} lines={[row.rentingIds.length ? row.rentingIds.map((id) => `Unit ${id}`).join(', ') : 'No units renting', ...sources]}>
                  {row.renting} of {row.total}<span className="ml-1 inline-flex flex-wrap gap-1">{row.newIds.map((id) => <span key={id} className="rounded bg-white/80 px-1.5 py-0.5">+{id}</span>)}</span>
                </PlanOverlay></td>
                <td className="px-3 py-2">{money(row.collected)}</td>
                <td className="px-3 py-2"><PlanOverlay lines={[`Management ${money(row.mgmt)}; fixed ${money(row.fixed)}`, ...runningDetails]}>{money(row.mgmt + row.fixed)}</PlanOverlay></td>
                <td className="px-3 py-2"><PlanOverlay lines={sellerDetails}>{money(row.seller)}</PlanOverlay></td>
                <td className="px-3 py-2">{money(row.bank)}</td>
                <td className="px-3 py-2">{money(row.interest)}</td>
                <td className="px-3 py-2"><PlanOverlay label={`Step ${step + 1} one-time costs`} lines={row.costs.map((cost) => `${cost.label} · ${cost.group}: ${money(cost.amount)}`)}>{money(row.costTotal)}</PlanOverlay></td>
                <td className="px-3 py-2">{row.fromPool > 0 && <span className="block">seller’s money {money(row.fromPool)}</span>}{row.draw > 0 && <span className="block">loan {money(row.draw)}</span>}{!row.fromPool && !row.draw && '—'}</td>
                <td className={`px-3 py-2 ${tone(row.keeps)}`}>{money(row.keeps)}</td>
                <td className={`px-3 py-2 ${tone(row.cumulative)}`}>{money(row.cumulative)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card className="!p-4"><CardTitle>Lease-up order</CardTitle>
          <div className="flex flex-wrap gap-2">{result.units.map((unit, idx) => {
            const rLabel = readiness[Number(unit.id)]?.body;
            return (
              <PlanOverlay key={unit.id} lines={[...sources, unit.note, `Ready week ${unit.ready}; rent-ready work ${money(unit.rehab)}.`]}
                className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-2 text-xs">
                <span>{ordinal(idx + 1)} Unit {unit.id}</span>
                {rLabel && <ReadinessBadge unitNumber={Number(unit.id)} label={rLabel} compact />}
                <span>· {money(unit.rent)}</span>
              </PlanOverlay>
            );
          })}</div>
        </Card>
      </div>
    )}
  </div>;
}

function LoadedDealPlan({ deal }) {
  const model = useDealModel(deal, { owner: true });
  const route = useHashRoute();
  const [chosen, setChosen] = useState(null);
  const [picked, setPicked] = useState(null);
  const [state, setState] = useState({ slug: null, plan: null, comps: [], readiness: {}, status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ slug: deal.slug, plan: null, comps: [], readiness: {}, status: 'loading' });
    (async () => {
      try {
        const [{ data: row, error }, { data: compRows }, readiness] = await Promise.all([
          supabase.from('commercial_settings').select('value').eq('key', `deal_plan:${deal.slug}`).maybeSingle(),
          supabase.from('commercial_comps').select('units,sale_price').eq('deal_id', deal.id),
          loadReadinessMap(supabase, deal.id),
        ]);
        if (alive) setState({ slug: deal.slug, plan: row ? normalizePlan(row.value) : null, comps: compRows || [], readiness, status: error ? 'error' : 'ready' });
      } catch {
        if (alive) setState({ slug: deal.slug, plan: null, comps: [], readiness: {}, status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [deal.id, deal.slug]);
  if (state.slug !== deal.slug || state.status === 'loading') return <Card><Empty>Loading…</Empty></Card>;
  if (state.status === 'error' || model.error) return <Card><Empty>Plan unavailable</Empty></Card>;
  if (!state.plan) return <Card><Empty>No plan yet</Empty></Card>;
  if (model.offers === null) return <Card><Empty>Loading…</Empty></Card>;
  const structure = picked || route.sub || 'master_lease';
  const selected = model.offers.find((offer) => offer.id === chosen && offer.structure === structure)
    || model.offers.find((offer) => offer.structure === structure) || model.offers[0];
  if (!selected) return <Card><Empty>No offers yet</Empty></Card>;
  const planBase = { ...model.base, units: 10 };
  const result = monthlyPlan(selected.structure, selected.inputs, planBase, state.plan);
  const saveShortCarry = (val) => {
    const nextInputs = { ...selected.inputs, shortCarry: val };
    const nextSummary = offerSellerSummary({ ...selected, inputs: nextInputs }, planBase, state.plan, state.comps, false);
    model.setOffers((list) => list.map((o) => (o.id === selected.id ? { ...o, inputs: nextInputs, seller_summary: nextSummary } : o)));
    model.later(`short-${selected.id}`, () => supabase.from('commercial_offers').update({ inputs: nextInputs, seller_summary: nextSummary, updated_at: new Date().toISOString() }).eq('id', selected.id));
  };
  const handleSetBase = (nextBase, nextPlanOverride = state.plan) => {
    model.setBase(nextBase);
    const lead = model.offers.find((o) => o.is_lead) || selected;
    if (lead) {
      const nextSummary = offerSellerSummary(lead, { ...nextBase, units: 10 }, nextPlanOverride, state.comps, false);
      model.setOffers((list) => list.map((o) => (o.id === lead.id ? { ...o, seller_summary: nextSummary } : o)));
      model.later(`summary-${lead.id}`, () => supabase.from('commercial_offers').update({ seller_summary: nextSummary, updated_at: new Date().toISOString() }).eq('id', lead.id));
    }
  };
  const handleSavePlan = async (nextPlan) => {
    const clean = normalizePlan(nextPlan);
    const total = overallRepairBudget(clean);
    const { error } = await supabase.from('commercial_settings').upsert({
      key: `deal_plan:${deal.slug}`,
      value: clean,
      updated_at: new Date().toISOString(),
    });
    if (error) return error;
    setState((prev) => ({ ...prev, plan: clean }));
    handleSetBase({ ...model.base, rehab: total }, clean);
    return null;
  };
  return <DealPlanView key={selected.id} result={result} base={planBase} offers={model.offers} selected={selected} setBase={handleSetBase} onChangeShortCarry={saveShortCarry} onSavePlan={handleSavePlan} comps={state.comps} readiness={state.readiness}
    onSelect={(offer) => {
      // Switch offers in place: update the address without a page jump.
      setChosen(offer.id); setPicked(offer.structure);
      try { window.history.replaceState(null, '', `#/d/${deal.slug}/plans/${offer.structure}`); } catch {}
    }} />;
}

export default function DealPlan({ deal, role, preview = false }) {
  if (!canAccessDealPlan(SITE_KIND, role, preview)) return null;
  return <LoadedDealPlan key={deal.id} deal={deal} />;
}
