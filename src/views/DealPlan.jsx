import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase.js';
import { SITE_KIND, canAccessDealPlan } from '../lib/site.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useHashRoute } from '../lib/useHashRoute.js';
import { monthlyPlan, rentStrategy, derivations, normalizePlan } from '../lib/dealplan.js';
import { money } from '../lib/dealmath.js';
import { AirbnbSwitch } from '../components/Switches.jsx';
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
    const width = Math.min(336, window.innerWidth - 24);
    setPosition({ width, left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
      ...(r.bottom < window.innerHeight - 260 ? { top: r.bottom + 6 } : { bottom: Math.max(12, window.innerHeight - r.top + 6) }) });
  };
  const close = () => { if (!pinned) timer.current = setTimeout(() => setPosition(null), 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
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
      className="fixed z-50 max-h-60 overflow-y-auto break-words rounded-xl border border-line bg-ink p-3 text-xs text-white shadow-xl">
      {details.map((line, i) => <div className="py-1.5 first:pt-0 last:pb-0" key={i}>{line}</div>)}
    </div>, document.body)}
  </>;
}

const stageNames = { vacant: 'Fixing up', partial: 'Filling up', full: 'Full', after: 'After the refinance' };
const stageColors = { vacant: 'bg-amber-50', partial: 'bg-orange-50', full: 'bg-emerald-50', after: 'bg-sky-50' };
const tone = (value) => value < 0 ? 'text-red-700' : 'text-ink';

export function DealPlanView({ result, base, offers, selected, onSelect, setBase }) {
  const explanations = derivations(result);
  const explain = (...titles) => explanations.filter(([title]) => titles.includes(title)).map(([title, text]) => `${title}: ${text}`);
  const sources = Object.entries(result.plan.sources).map(([key, value]) => `${key}: ${String(value)}`);
  const sellerDetails = explain('Seller payment', ...explanations.filter(([title]) => title.startsWith('Seller') && title !== 'Seller payment').map(([title]) => title));
  const runningDetails = [...sources, base.taxesSource && `Taxes: ${base.taxesSource}`,
    `Management ${result.operating.b.mgmtPct}%; fixed expenses are annual taxes, insurance, utilities, admin and turns divided by 12; Airbnb costs are per active unit.`];
  const strategy = rentStrategy(base, result.plan);
  const { exit, totals, eligibility } = result;
  const planUnits = +base.units >= 10 ? 10 : 9;
  const unit10Rehab = base.tenthUnitRepair ?? result.operating.b.tenthUnitRepair;
  const eligibilityText = !eligibility ? '' : eligibility.status === 'not_stabilized'
    ? `Not stabilized until month ${eligibility.stabilizedMonth}`
    : eligibility.status === 'seasoning_short'
      ? `Short on seasoning (${eligibility.monthsStabilizedAtRefi}/${eligibility.seasoningRequired} mo)`
      : eligibility.status === 'eligible'
        ? 'Confirmed'
        : 'Pending lender underwriting';
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2" aria-label="Plan options">
        {offers.map((offer) => <button key={offer.id} type="button" aria-pressed={offer.id === selected.id}
          onClick={() => onSelect(offer)} className={`min-h-10 rounded-full border px-4 py-2 text-sm ${offer.id === selected.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>{offer.name}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-line bg-white p-0.5" role="group" aria-label="Plan unit count">
          {[[9, '9 units (as-is)'], [10, '10 units (after rehab)']].map(([u, lbl]) => (
            <button key={u} type="button" aria-pressed={planUnits === u} onClick={() => setBase({ ...base, units: u })}
              className={`min-h-9 rounded-full px-3 py-1 text-xs font-medium transition ${planUnits === u ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'}`}>{lbl}</button>
          ))}
        </div>
        {planUnits === 10 && (
          <label className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-xs text-ink-soft">
            <span>Unit 10 rehab</span>
            <input type="number" min={0} step={1000} aria-label="Unit 10 rehab estimate" value={unit10Rehab}
              onChange={(e) => setBase({ ...base, tenthUnitRepair: e.target.value === '' ? 0 : +e.target.value })}
              className="w-20 rounded border border-line px-1.5 py-0.5 text-right text-xs font-semibold text-ink outline-none focus:border-ink" />
          </label>
        )}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {result.stages.filter((stage) => stage.from !== null).map((stage) => <Card key={stage.key} className="!p-3">
        <h2 className="font-display text-lg font-semibold">{stageNames[stage.key]}</h2>
        <div className="flex flex-wrap justify-between gap-x-2 text-xs text-ink-soft">
          <span>{stage.from === stage.to ? `Month ${stage.from}` : `Months ${stage.from}–${stage.to}`}</span>
          <span>{stage.renting} of {result.units.length}</span>
        </div>
        <PlanOverlay className="mt-3 block font-display text-xl font-semibold" label={`${stageNames[stage.key]} seller payment details`}
          lines={[...sellerDetails, stage.key === 'full' && explain('Rent once full').join(' '), stage.sellerGap !== null && `Seller after their own loan: ${money(stage.sellerGap)}/mo`, ...sources]}>
          Seller gets {money(stage.seller)}/mo
        </PlanOverlay>
        <PlanOverlay className={`mt-1 block text-sm font-medium ${tone(stage.keeps)}`} lines={stage.key === 'full' ? explain('Rent once full') : [`Rent ${money(stage.collected)} less operating expenses, reserves, seller, bank and interest.`, ...explain('Bank payment')]}>
          You keep {money(stage.keeps)}/mo
        </PlanOverlay>
      </Card>)}
    </div>
    {exit && <Card className="!p-4">
      <h2 className="font-display text-xl font-semibold"><PlanOverlay lines={explain('Refinance', 'Lender eligibility')}>Expected refinance (Month {exit.month}): {money(exit.loan)}</PlanOverlay></h2>
      <div className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2"><span>Seller paid</span><PlanOverlay lines={explain('Buy price', 'Buyout', 'Seller payment')}>{money(exit.sellerPayoff)}</PlanOverlay></div>
        <div className="flex justify-between gap-2"><span>Short-term loan paid off</span><PlanOverlay lines={explain('Short-term lender')}>{money(exit.lenderPayoff)}</PlanOverlay></div>
        <div className="flex justify-between gap-2"><span>Closing</span><PlanOverlay lines={explain('Refinance')}>{money(exit.closing)}</PlanOverlay></div>
        <div className={`flex justify-between gap-2 font-semibold ${tone(exit.left)}`}><span>{exit.left < 0 ? 'You bring' : 'Left for you'}</span><PlanOverlay lines={explain('Refinance', 'Buyer cash')}>{exit.left > 0 ? '+' : ''}{money(exit.left)}</PlanOverlay></div>
        <div className="flex justify-between gap-2"><span>Lender eligibility</span><PlanOverlay lines={explain('Lender eligibility')}>{eligibilityText}</PlanOverlay></div>
        {result.units.length >= 10 && (
          <div className="flex justify-between gap-2"><span>ARV basis</span><PlanOverlay lines={explain('10-unit ARV case')}>Stabilized 10 units (pending approvals)</PlanOverlay></div>
        )}
      </div>
      <div className="mt-3 rounded-xl bg-warm-soft p-3 text-sm font-semibold"><PlanOverlay lines={explain('Refinance', 'Buy price', 'Buyout')}>Most the seller can get at the refinance with $0 from you: {money(exit.maxSellerPayoff)}</PlanOverlay></div>
    </Card>}
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      {[
        ['Seller gets in total', totals.sellerTotal, explain('Seller payment', 'Buy price', 'Buyout')],
        ['Your cash in', totals.buyerCashTotal, explain('Buyer cash', 'Refinance', 'Bank payment')],
        ['Short-term loan at its peak', totals.peakLender, explain('Short-term lender')],
        ['Loan interest + points', totals.interestTotal + totals.pointsTotal, explain('Short-term lender')],
        ['One-time costs', totals.oneTimeTotal, result.items.map((item) => `${item.label}: ${money(item.cost)}`)],
      ].map(([label, value, lines]) => <div key={label} className="rounded-xl border border-line bg-white p-3">
        <div className="text-xs font-medium text-ink-soft">{label}</div>
        <PlanOverlay className="mt-1 font-display text-xl font-semibold" lines={lines}>{money(value)}</PlanOverlay>
      </div>)}
    </div>
    <Card className="!p-0">
      <div className="overflow-x-auto rounded-2xl" tabIndex={0} role="region" aria-label="Month-by-month cash flow">
        <table className="w-full min-w-[1240px] border-collapse text-right text-xs tabular-nums">
          <thead className="bg-ink text-white"><tr>
            {['Month', 'Units renting', 'Rent in', 'Running costs', 'Seller', 'Bank', 'Loan interest', 'One-time costs', 'Paid by', 'You keep', 'Running total'].map((label, i) => <th scope="col" key={label} className={`px-3 py-3 ${i === 0 ? 'sticky left-0 z-10 bg-ink text-left' : ''}`}>
              {label === 'Running costs' ? <PlanOverlay lines={runningDetails}>{label}</PlanOverlay> : label}
            </th>)}
          </tr></thead>
          <tbody>{result.rows.map((row) => <tr key={row.month} className={`${stageColors[row.stage]} border-t border-line ${row.refi ? 'font-semibold ring-2 ring-inset ring-ink' : ''}`}>
            <th scope="row" className={`sticky left-0 z-10 px-3 py-3 text-left ${stageColors[row.stage]}`}><PlanOverlay lines={row.refi ? explain('Refinance') : []}>{row.month}{row.refi ? ' ↗' : ''}</PlanOverlay></th>
            <td className="px-3 py-2"><PlanOverlay label={`Month ${row.month} renting units`} lines={[row.rentingIds.length ? row.rentingIds.map((id) => `Unit ${id}`).join(', ') : 'No units renting', ...sources]}>
              {row.renting} of {row.total}<span className="ml-1 inline-flex flex-wrap gap-1">{row.newIds.map((id) => <span key={id} className="rounded bg-white/80 px-1.5 py-0.5">+{id}</span>)}</span>
            </PlanOverlay></td>
            <td className="px-3 py-2">{money(row.collected)}</td>
            <td className="px-3 py-2"><PlanOverlay lines={[`Management ${money(row.mgmt)}; fixed ${money(row.fixed)}; Airbnb ${money(row.strCosts)}`, ...runningDetails]}>{money(row.mgmt + row.fixed + row.strCosts)}</PlanOverlay></td>
            <td className="px-3 py-2"><PlanOverlay lines={sellerDetails}>{money(row.seller)}</PlanOverlay></td>
            <td className="px-3 py-2">{money(row.bank)}</td>
            <td className="px-3 py-2">{money(row.interest)}</td>
            <td className="px-3 py-2"><PlanOverlay label={`Month ${row.month} one-time costs`} lines={row.costs.map((cost) => `${cost.label} · ${cost.group}: ${money(cost.amount)}`)}>{money(row.costTotal)}</PlanOverlay></td>
            <td className="px-3 py-2">{row.fromPool > 0 && <span className="block">seller’s money {money(row.fromPool)}</span>}{row.draw > 0 && <span className="block">loan {money(row.draw)}</span>}{!row.fromPool && !row.draw && '—'}</td>
            <td className={`px-3 py-2 ${tone(row.keeps)}`}>{money(row.keeps)}</td>
            <td className={`px-3 py-2 ${tone(row.cumulative)}`}>{money(row.cumulative)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </Card>
    <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
      <Card className="!p-4">
        <CardTitle>Renting strategy</CardTitle>
        <AirbnbSwitch base={base} setBase={setBase} />
        <div className="mt-3 overflow-x-auto"><table className="w-full text-right text-sm tabular-nums">
          <thead><tr>{['Option', 'Rent', 'Collected', 'Net per unit/mo'].map((label) => <th key={label} scope="col" className="px-2 py-2 first:text-left text-xs text-ink-soft">{label}</th>)}</tr></thead>
          <tbody>{strategy.options.map((option) => <tr key={option.key} className={option.key === strategy.best?.key ? 'bg-warm-soft font-semibold' : 'border-t border-line'}>
            <th scope="row" className="px-2 py-2 text-left"><PlanOverlay lines={[...sources, base.strSource && option.mode === 'str' && String(base.strSource), `Rent ${money(option.rent)}, collected after vacancy and fees ${money(option.collected)}, net after management and unit costs ${money(option.net)}/mo.`]}>{option.label}</PlanOverlay></th>
            <td className="px-2 py-2">{money(option.rent)}</td><td className="px-2 py-2">{money(option.collected)}</td><td className={`px-2 py-2 ${tone(option.net)}`}>{money(option.net)}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>
      <Card className="!p-4"><CardTitle>Lease-up order</CardTitle>
        <div className="flex flex-wrap gap-2">{result.units.map((unit) => <PlanOverlay key={unit.id} lines={[...sources, unit.note, `Ready week ${unit.ready}; rent-ready work ${money(unit.rehab)}.`]}
          className={`rounded-full border px-3 py-2 text-xs ${unit.mode === 'str' ? 'border-ink bg-warm-soft' : 'border-line bg-paper'}`}>
          Unit {unit.id} · month {unit.startMonth} · {money(unit.rent)}{unit.mode === 'str' ? ' · Airbnb' : ''}
        </PlanOverlay>)}</div>
      </Card>
    </div>
  </div>;
}

function LoadedDealPlan({ deal }) {
  const model = useDealModel(deal, { owner: true });
  const route = useHashRoute();
  const [chosen, setChosen] = useState(null);
  const [state, setState] = useState({ slug: null, plan: null, status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ slug: deal.slug, plan: null, status: 'loading' });
    (async () => {
      try {
        const { data: row, error } = await supabase.from('commercial_settings').select('value').eq('key', `deal_plan:${deal.slug}`).maybeSingle();
        if (alive) setState({ slug: deal.slug, plan: row ? normalizePlan(row.value) : null, status: error ? 'error' : 'ready' });
      } catch {
        if (alive) setState({ slug: deal.slug, plan: null, status: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [deal.slug]);
  if (state.slug !== deal.slug || state.status === 'loading') return <Card><Empty>Loading…</Empty></Card>;
  if (state.status === 'error' || model.error) return <Card><Empty>Plan unavailable</Empty></Card>;
  if (!state.plan) return <Card><Empty>No plan yet</Empty></Card>;
  if (model.offers === null) return <Card><Empty>Loading…</Empty></Card>;
  const structure = route.sub || 'master_lease';
  const selected = model.offers.find((offer) => offer.id === chosen && offer.structure === structure)
    || model.offers.find((offer) => offer.structure === structure) || model.offers[0];
  if (!selected) return <Card><Empty>No offers yet</Empty></Card>;
  const result = monthlyPlan(selected.structure, selected.inputs, model.base, state.plan);
  return <DealPlanView key={selected.id} result={result} base={model.base} offers={model.offers} selected={selected} setBase={model.setBase}
    onSelect={(offer) => { setChosen(offer.id); window.location.hash = `#/d/${deal.slug}/plans/${offer.structure}`; }} />;
}

export default function DealPlan({ deal, role, preview = false }) {
  if (!canAccessDealPlan(SITE_KIND, role, preview)) return null;
  return <LoadedDealPlan key={deal.id} deal={deal} />;
}
