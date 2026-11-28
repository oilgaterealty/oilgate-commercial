import { buyerName } from '../lib/people.js';
import { Suspense, lazy, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { evaluate, money, moneyCents, valueSummary } from '../lib/dealmath.js';
import { computePrivateReturn, buildFallbackRentValue, buildLenderPackage, LENDER_LENSES, parseLenderProtections } from '../lib/lenderModel.js';

const fmtCents = moneyCents || money;
import { effectiveMarketRange } from '../lib/rangeValue.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useUploads, FileList } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import CostSummary from '../components/CostSummary.jsx';
import { isUnitsGuide } from '../components/UnitsRentedGuide.jsx';
import RentValue, { isRentValue } from '../components/RentValue.jsx';
import LenderWhatIf from '../components/LenderWhatIf.jsx';
import { Card, CardTitle, Empty, JumpNav, OverlayTrigger, useSectionScroll } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import LenderTerms from './LenderTerms.jsx';

const CityRecords = lazy(() => import('./CityRecords.jsx'));

function Stat({ label, value, overlay }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold leading-tight tabular-nums">
        {overlay?.length ? <OverlayTrigger lines={overlay}>{value}</OverlayTrigger> : value}
      </dd>
    </div>
  );
}

function LedgerRows({ rows }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((row) => {
        const isTotal = row.emphasis === 'total';
        const isAccent = row.emphasis === 'accent';
        const valCls = row.tone === 'good'
          ? 'text-good'
          : row.tone === 'warn'
            ? 'text-amber-800'
            : 'text-ink';
        return (
          <div
            key={row.key}
            className={`flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0 ${
              isTotal ? 'border-t-2 border-ink/20 pt-3 font-semibold' : isAccent ? 'rounded-xl bg-warm-soft/70 px-3 py-2.5 my-1 font-semibold' : ''
            }`}
          >
            <dt className={`min-w-0 text-sm ${isTotal || isAccent ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{row.label}</dt>
            <dd className={`shrink-0 text-right tabular-nums ${isTotal ? 'font-display text-xl font-semibold' : 'text-sm font-semibold'} ${valCls}`}>
              <OverlayTrigger lines={row.overlay} className={valCls}>{row.display}</OverlayTrigger>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function PrivateReturnCard({ pkg }) {
  const min = Math.max(1000, pkg.minParticipation || 20000);
  const max = Math.max(min, Math.round(pkg.privatePool.totalFunds || min));
  const ratePct = pkg.privatePool.ratePct;
  const [amount, setAmount] = useState(min);

  useEffect(() => {
    setAmount((cur) => {
      if (!Number.isFinite(cur) || cur < min) return min;
      if (cur > max) return max;
      return cur;
    });
  }, [min, max]);

  const calc = typeof computePrivateReturn === 'function'
    ? computePrivateReturn(amount, ratePct)
    : { amount, ratePct, monthly: (amount * ratePct) / 100 / 12, perYearAtRate: (amount * ratePct) / 100, principalBack: amount };
  const mid = Math.max(min, Math.min(max, Math.round((min + max) / 2 / 5000) * 5000));

  return (
    <Card data-wb="private-return">
      <CardTitle
        aside={
          <OverlayTrigger
            lines={[
              `${ratePct}% a year, interest-only, paid monthly.`,
              'First payment after month 1. No prepayment penalty; loan can be paid off early.',
            ]}
            className="text-sm font-medium text-ink-soft"
          >
            {ratePct}% a year · IO
          </OverlayTrigger>
        }
      >
        Your return
      </CardTitle>

      <div className="rounded-2xl border border-line bg-paper p-3.5">
        <label htmlFor="private-return-slider" className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
          <span>Your participation</span>
          <span className="font-display text-xl font-semibold tabular-nums">{money(amount)}</span>
        </label>
        <input
          id="private-return-slider"
          type="range"
          min={min}
          max={max}
          step={5000}
          value={amount}
          onChange={(e) => setAmount(+e.target.value)}
          className="mt-2 w-full accent-ink"
        />
        <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-ink-soft">
          <button type="button" onClick={() => setAmount(min)} className="underline decoration-dotted underline-offset-4 hover:text-ink">
            {money(min)}
          </button>
          <button type="button" onClick={() => setAmount(mid)} className="underline decoration-dotted underline-offset-4 hover:text-ink">
            {money(mid)}
          </button>
          <button type="button" onClick={() => setAmount(max)} className="underline decoration-dotted underline-offset-4 hover:text-ink">
            {money(max)}
          </button>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3 tabular-nums">
        <div className="rounded-xl border border-line bg-paper p-3">
          <dt className="text-xs text-ink-soft">Monthly income</dt>
          <dd className="mt-1 font-display text-2xl font-semibold text-good">
            <OverlayTrigger
              lines={[
                `${money(amount)} × ${ratePct}% ÷ 12 = ${fmtCents(calc.monthly)} a month.`,
                'First payment after month 1.',
              ]}
              className="text-good"
            >
              {fmtCents(calc.monthly)}/mo
            </OverlayTrigger>
          </dd>
        </div>
        <div className="rounded-xl border border-line bg-paper p-3">
          <dt className="text-xs text-ink-soft">Per year at {ratePct}%</dt>
          <dd className="mt-1 font-display text-2xl font-semibold text-ink">
            <OverlayTrigger
              lines={[
                `${money(amount)} × ${ratePct}% a year = ${fmtCents(calc.perYearAtRate)}/yr annualized.`,
                'Loan can be paid off early with no prepayment penalty; 12 months is not guaranteed.',
              ]}
            >
              {fmtCents(calc.perYearAtRate)}/yr
            </OverlayTrigger>
          </dd>
        </div>
        <div className="rounded-xl border border-line bg-paper p-3">
          <dt className="text-xs text-ink-soft">Principal back at payoff</dt>
          <dd className="mt-1 font-display text-2xl font-semibold text-ink">
            <OverlayTrigger
              lines={[
                `Principal (${money(calc.principalBack)}) returned in full at payoff.`,
                'No prepayment penalty.',
              ]}
            >
              {money(calc.principalBack)}
            </OverlayTrigger>
          </dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 text-sm sm:grid-cols-3">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 sm:block">
          <dt className="text-xs text-ink-soft">Schedule</dt>
          <dd className="font-medium text-ink">First payment after month 1</dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 sm:block">
          <dt className="text-xs text-ink-soft">Rate &amp; structure</dt>
          <dd className="font-medium text-ink">{ratePct}% a year, interest-only</dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 sm:block">
          <dt className="text-xs text-ink-soft">Early payoff</dt>
          <dd className="font-medium text-ink">No prepayment penalty</dd>
        </div>
      </dl>
    </Card>
  );
}

const SECTIONS = [
  ['overview', 'Overview'],
  ['terms', 'Your terms'],
  ['plan', 'The plan'],
  ['what-if', 'What-if'],
  ['city-records', 'City records'],
  ['documents', 'Documents'],
  ['photos', 'Photos'],
  ['messages', 'Messages'],
];

const LENS_DRIVEN_SECTIONS = new Set(['overview', 'terms', 'plan', 'what-if']);

// The lender's one-page workspace with three strictly isolated tabs (Bridge, Private, DSCR) driving Overview, Your terms, The plan, and What-if.
export default function Lender({ deal, me, member = null, preview, tab, initialLens = 'bridge', urlLens = '', privateProtections = null }) {
  const root = preview ? `#/d/${deal.slug}/view/lender` : `#/d/${deal.slug}`;
  const { activeSection, jumpTo } = useSectionScroll(tab, SECTIONS, { offers: 'what-if' });
  const [lenderLens, setLenderLens] = useState(() => (LENDER_LENSES[initialLens] ? initialLens : 'bridge'));
  const [rows] = useUploads(deal);
  const visible = preview ? seenBy('lender', rows) : rows || [];
  const photos = photosOf(visible);
  const docs = visible.filter((r) => r.kind === 'document');
  const { offers, base, error } = useDealModel(deal, { owner: false, onlyShared: preview ? 'lender' : undefined });
  const [leadGuide, setLeadGuide] = useState(null);
  const [loadedProtections, setLoadedProtections] = useState([]);

  useEffect(() => {
    if (LENDER_LENSES[urlLens]) setLenderLens(urlLens);
  }, [urlLens]);

  useEffect(() => {
    let alive = true;
    supabase.rpc('commercial_get_lead_guide', { p_deal: deal.id }).then(({ data }) => {
      if (!alive) return;
      const raw = Array.isArray(data) ? data[0] : data;
      const g = raw?.guide || raw || null;
      setLeadGuide(isUnitsGuide(g) ? g : null);
    });
    return () => { alive = false; };
  }, [deal.id]);

  useEffect(() => {
    if (Array.isArray(privateProtections) || !deal?.slug) return;
    let alive = true;
    supabase
      .from('commercial_settings')
      .select('value')
      .eq('key', `lender_protections:${deal.slug}`)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setLoadedProtections(parseLenderProtections(data?.value));
      });
    return () => { alive = false; };
  }, [deal?.slug, privateProtections]);

  const protections = Array.isArray(privateProtections)
    ? parseLenderProtections(privateProtections)
    : loadedProtections;

  const b = { ...base, units: 10 };
  const plan = offers?.[0] || null;
  const rawGuide = isUnitsGuide(leadGuide) ? leadGuide : (isUnitsGuide(plan?.seller_summary?.guide) ? plan.seller_summary.guide : null);
  const opexSource = rawGuide?.opex || b?.opex || null;
  const effectiveBase = opexSource && !b?.opex ? { ...b, opex: opexSource } : b;
  const e = plan && evaluate(plan.structure, plan.inputs, effectiveBase);
  const o = e?.operating;
  const val = o ? valueSummary({ base: effectiveBase, noi: o.noi, units: 10 }) : null;
  const liftedRentValue = rawGuide?.rentValue
    ? { ...rawGuide.rentValue, marketRange: effectiveMarketRange(rawGuide.rentValue.marketRange, effectiveBase) }
    : null;
  const effectiveGuide = rawGuide
    ? { ...rawGuide, ...(liftedRentValue ? { rentValue: liftedRentValue } : {}) }
    : null;
  const guide = effectiveGuide || plan?.seller_summary?.guide || null;
  const guideCostSummary = guide?.costSummary || (guide?.cost?.length
    ? { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost }
    : null);

  const pkg = buildLenderPackage({
    base: effectiveBase,
    offer: plan,
    guide: effectiveGuide,
    valSummary: val,
    lens: lenderLens,
  });
  const fallbackRent = !isRentValue(effectiveGuide?.rentValue) ? buildFallbackRentValue(effectiveBase, pkg) : null;

  const heroFigure = lenderLens === 'dscr'
    ? money(pkg.refiCheck.newLoan)
    : lenderLens === 'private'
      ? money(pkg.privatePool.totalFunds)
      : money(pkg.totalLoan);
  const heroOverlay = lenderLens === 'dscr'
    ? pkg.dscrLoanRows.find((r) => r.key === 'loan')?.overlay || []
    : lenderLens === 'private'
      ? pkg.privateFundsRows.find((r) => r.key === 'total')?.overlay || []
      : pkg.loanAskRows.find((r) => r.key === 'total')?.overlay || [];

  const bridgePlanSteps = [
    {
      num: 1,
      title: 'Close',
      value: `${money(pkg.initialDrawn)} drawn · $0 down`,
      overlay: pkg.steps[0]?.overlay || [],
    },
    {
      num: 2,
      title: 'Repairs in draws',
      value: money(pkg.repairs),
      overlay: guideCostSummary?.lines?.length
        ? guideCostSummary.lines.map((l) => l.label).filter(Boolean)
        : pkg.steps[1]?.overlay || [],
    },
    {
      num: 3,
      title: `Lease-up (${pkg.deferredMonths}-mo deferred)`,
      value: `${money(pkg.deferredInterest)} due at payoff`,
      overlay: pkg.steps[2]?.overlay || [],
    },
    {
      num: 4,
      title: 'Exit',
      value: 'Paid off by refinance after lease-up',
      overlay: ['Paid off by refinance after lease-up.'],
    },
  ];

  const privatePlanSteps = [
    {
      num: 1,
      title: 'Pool closes',
      value: money(pkg.privatePool.totalFunds),
      overlay: pkg.steps[0]?.overlay || [],
    },
    {
      num: 2,
      title: 'First payment after month 1',
      value: `${pkg.privatePool.ratePct}% a year · ${fmtCents(pkg.privatePool.monthlyInterest)}/mo`,
      overlay: pkg.privateFundsRows.find((r) => r.key === 'interest')?.overlay || [],
    },
    {
      num: 3,
      title: `Minimum participation (${money(pkg.minParticipation)})`,
      value: `${fmtCents(pkg.privatePool.minMonthlyReturn)}/mo`,
      overlay: pkg.privatePoolRows.find((r) => r.key === 'minParticipation')?.overlay || [],
    },
    {
      num: 4,
      title: 'Payoff',
      value: 'Principal back · No prepayment penalty',
      overlay: pkg.privatePoolRows.find((r) => r.key === 'payoff')?.overlay || [],
    },
  ];

  const dscrPlanSteps = [
    {
      num: 1,
      title: 'Stabilized value',
      value: money(pkg.value),
      overlay: pkg.steps[0]?.overlay || [],
    },
    {
      num: 2,
      title: `Takeout loan (${pkg.refiCheck.refiLtv}% LTV)`,
      value: money(pkg.refiCheck.newLoan),
      overlay: pkg.steps[1]?.overlay || [],
    },
    {
      num: 3,
      title: 'Pays off bridge',
      value: money(pkg.refiCheck.bridgePayoff),
      overlay: pkg.steps[2]?.overlay || [],
    },
    {
      num: 4,
      title: `${pkg.refiCheck.refiYears}-year term at ${pkg.refiCheck.refiRate}%`,
      value: `${money(pkg.refiCheck.refiPayment)}/mo P&I`,
      overlay: pkg.steps[3]?.overlay || [],
    },
  ];

  return (
    <div className="space-y-6 pb-20" data-active-tab={lenderLens}>
      <JumpNav sections={SECTIONS} active={activeSection} onJump={jumpTo} base={root} preview={preview} />

      {LENS_DRIVEN_SECTIONS.has(activeSection) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/15 bg-white p-2.5 shadow-sm">
          <div role="tablist" aria-label="Lender type" className="inline-flex flex-wrap gap-1 rounded-xl bg-paper p-1">
            {Object.values(LENDER_LENSES).map((item) => {
              const active = item.key === lenderLens;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setLenderLens(item.key)}
                  className={`min-h-[44px] rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                    active ? 'bg-ink text-white shadow-sm' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <span className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink">
            {pkg.units} units · {pkg.lens.title}
          </span>
        </div>
      )}

      <section id="sec-overview" data-section="overview" className="scroll-mt-20 space-y-5">
        <Cover rows={photos} compact />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
          <>
            {/* 1. Top card ask for the selected lender tab */}
            <section data-wb="hero" className="rounded-2xl border border-ink border-t-2 border-t-warm bg-ink p-5 text-white sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full border border-warm/40 bg-warm/15 px-3 py-1 text-xs font-medium tracking-wide text-warm-soft">
                  {pkg.lens.label} · {pkg.units} units
                </span>
              </div>

              <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-end">
                <div className="min-w-0">
                  <h2 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-4xl">
                    {pkg.lens.title}
                  </h2>
                  <div className="mt-1.5 text-base font-normal text-warm-soft">
                    {pkg.lens.lead}
                  </div>
                </div>

                <div className="min-w-0 border-t border-white/15 pt-4 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
                  <div className="text-xs uppercase tracking-[0.14em] text-warm-soft/80">{pkg.lens.heroLabel}</div>
                  <div className="mt-1 font-display text-4xl font-semibold tracking-tight tabular-nums text-white sm:text-5xl">
                    <OverlayTrigger lines={heroOverlay} className="text-white">{heroFigure}</OverlayTrigger>
                  </div>
                </div>
              </div>

              {lenderLens === 'private' ? (
                <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-4 tabular-nums">
                  <div>
                    <dt className="text-xs text-white/65">Rate</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.privatePoolRows[0]?.overlay || []} className="text-white">
                        {pkg.privatePool.ratePct}%
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Minimum share</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.privatePoolRows[1]?.overlay || []} className="text-white">
                        {money(pkg.minParticipation)}
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Monthly income (min)</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.privatePoolRows.find((r) => r.key === 'minParticipation')?.overlay || []} className="text-white">
                        {fmtCents(pkg.privatePool.minMonthlyReturn)}/mo
                      </OverlayTrigger>
                    </dd>
                  </div>
                </dl>
              ) : lenderLens === 'dscr' ? (
                <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-4 tabular-nums">
                  <div>
                    <dt className="text-xs text-white/65">Stabilized value</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.dscrLoanRows[0]?.overlay || []} className="text-white">
                        {money(pkg.value)}
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Rate &amp; term</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.dscrLoanRows[4]?.overlay || []} className="text-white">
                        {pkg.refiCheck.refiRate}% · {pkg.refiCheck.refiYears}-yr
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Minimum DSCR</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.dscrLoanRows[5]?.overlay || []} className="text-white">
                        {pkg.refiCheck.refiDscr}x
                      </OverlayTrigger>
                    </dd>
                  </div>
                </dl>
              ) : (
                <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-4 tabular-nums">
                  <div>
                    <dt className="text-xs text-white/65">Cash down</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">{money(pkg.downPayment)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Rate (non-Dutch)</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.loanAskRows.find((r) => r.key === 'interest')?.overlay || []} className="text-white">
                        {pkg.ratePct}% IO
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Term</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.bridgeTermsRows.find((r) => r.key === 'term')?.overlay || []} className="text-white">
                        {pkg.termMonths} months
                      </OverlayTrigger>
                    </dd>
                  </div>
                </dl>
              )}

              <div className="mt-5 flex flex-wrap gap-3 text-sm">
                <a
                  href={`${root}/terms`}
                  onClick={(ev) => { ev.preventDefault(); jumpTo('terms', root); }}
                  className="inline-flex min-h-[44px] items-center rounded-xl bg-warm px-4 py-2 font-medium text-ink transition hover:bg-warm-soft"
                >
                  {pkg.lens.ctaLabel}
                </a>
                <a
                  href={`${root}/plan`}
                  onClick={(ev) => { ev.preventDefault(); jumpTo('plan', root); }}
                  className="inline-flex min-h-[44px] items-center rounded-xl border border-white/25 px-4 py-2 font-medium text-white transition hover:border-white/50"
                >
                  Open the plan
                </a>
              </div>
            </section>

            {/* 2. Four-step progression strip for the selected tab */}
            <section data-wb="steps" aria-label="Deal steps" className="rounded-2xl border border-line bg-white p-4 sm:p-5">
              <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {pkg.steps.map((step, idx) => (
                  <li key={step.num} className={`flex items-baseline justify-between gap-3 rounded-xl bg-paper px-3.5 py-3 sm:block ${idx < pkg.steps.length - 1 ? 'border border-line/70' : 'border border-ink/25 bg-warm-soft/50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tracking-[0.14em] text-warm">{step.num}</span>
                      <span className="text-sm font-semibold text-ink">{step.title}</span>
                    </div>
                    <div className="sm:mt-1.5 font-display text-lg font-semibold tabular-nums text-ink">
                      <OverlayTrigger lines={step.overlay}>{step.figure}</OverlayTrigger>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* 3. Tab-specific two-card breakdown */}
            {lenderLens === 'private' ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card data-wb="loan-ask">
                  <CardTitle
                    aside={
                      <a
                        href={`${root}/terms`}
                        onClick={(ev) => { ev.preventDefault(); jumpTo('terms', root); }}
                        className="inline-flex min-h-[40px] items-center text-sm font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
                      >
                        Counter in Your terms
                      </a>
                    }
                  >
                    Total funds needed
                  </CardTitle>
                  <div data-wb="loan-ask-body">
                    <LedgerRows rows={pkg.privateFundsRows} />
                  </div>
                </Card>

                <Card data-wb="private-pool">
                  <CardTitle
                    aside={
                      <OverlayTrigger lines={pkg.privatePoolRows[1]?.overlay || []} className="text-sm font-medium text-ink-soft">
                        {money(pkg.minParticipation)} min
                      </OverlayTrigger>
                    }
                  >
                    Private pool
                  </CardTitle>
                  <div data-wb="private-pool-body">
                    <LedgerRows rows={pkg.privatePoolRows} />
                  </div>
                </Card>
              </div>
            ) : lenderLens === 'dscr' ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card data-wb="dscr-ask">
                  <CardTitle
                    aside={
                      <a
                        href={`${root}/terms`}
                        onClick={(ev) => { ev.preventDefault(); jumpTo('terms', root); }}
                        className="inline-flex min-h-[40px] items-center text-sm font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
                      >
                        Counter in Your terms
                      </a>
                    }
                  >
                    DSCR loan
                  </CardTitle>
                  <div data-wb="dscr-ask-body">
                    <LedgerRows rows={pkg.dscrLoanRows} />
                  </div>
                </Card>

                <Card data-wb="refi-check">
                  <CardTitle
                    aside={
                      <OverlayTrigger lines={pkg.refiCheckRows[0]?.overlay || []} className="text-sm font-medium text-ink-soft">
                        Value {money(pkg.value)}
                      </OverlayTrigger>
                    }
                  >
                    Refinance payoff
                  </CardTitle>
                  <div data-wb="refi-check-body">
                    <LedgerRows rows={pkg.refiCheckRows} />
                  </div>
                </Card>
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card data-wb="loan-ask">
                  <CardTitle
                    aside={
                      <a
                        href={`${root}/terms`}
                        onClick={(ev) => { ev.preventDefault(); jumpTo('terms', root); }}
                        className="inline-flex min-h-[40px] items-center text-sm font-medium text-ink underline underline-offset-4 hover:text-ink-soft"
                      >
                        Counter in Your terms
                      </a>
                    }
                  >
                    Loan ask
                  </CardTitle>
                  <div data-wb="loan-ask-body">
                    <LedgerRows rows={pkg.loanAskRows} />
                  </div>
                </Card>

                <Card data-wb="bridge-terms">
                  <CardTitle
                    aside={
                      <OverlayTrigger lines={pkg.bridgeTermsRows.find((r) => r.key === 'ltc')?.overlay || []} className="text-sm font-medium text-ink-soft">
                        {pkg.ltcPct}% LTC · $0 down
                      </OverlayTrigger>
                    }
                  >
                    Bridge terms
                  </CardTitle>
                  <div data-wb="bridge-terms-body">
                    <LedgerRows rows={pkg.bridgeTermsRows} />
                  </div>
                </Card>
              </div>
            )}

            {/* 3b. Private lender return slider (Private tab only) */}
            {lenderLens === 'private' && <PrivateReturnCard pkg={pkg} />}

            {/* 3c. Private lender protections (Private tab only; owner-editable in commercial_settings) */}
            {lenderLens === 'private' && protections.length > 0 && (
              <div data-wb="private-protections">
                <Card>
                  <CardTitle>Your protections</CardTitle>
                  <ul aria-label="Your protections" className="space-y-2.5 text-sm leading-relaxed text-ink">
                    {protections.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span aria-hidden="true" className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}

            {/* 4. Rent plan */}
            {(isRentValue(effectiveGuide?.rentValue) || fallbackRent) && (
              <div data-wb="rent-plan">
                {isRentValue(effectiveGuide?.rentValue)
                  ? <RentValue data={effectiveGuide.rentValue} showMarket hideUnits />
                  : <RentValue data={fallbackRent} showMarket hideUnits />}
              </div>
            )}
          </>
        )}
      </section>

      <section id="sec-terms" data-section="terms" className="scroll-mt-20">
        <LenderTerms
          deal={deal}
          me={me}
          member={member}
          preview={preview}
          guide={effectiveGuide}
          base={effectiveBase}
          offer={plan}
          lenderLens={lenderLens}
          onLensChange={setLenderLens}
          hideProgramTabs
        />
      </section>

      <section id="sec-plan" data-section="plan" className="scroll-mt-20 space-y-5">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
          lenderLens === 'private' ? (
            <Card data-plan="private">
              <CardTitle
                aside={
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-white">
                    First-lien pooled
                  </span>
                }
              >
                Private pool plan
              </CardTitle>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total funds needed" value={money(pkg.privatePool.totalFunds)} overlay={pkg.privateFundsRows.find((r) => r.key === 'total')?.overlay} />
                <Stat label="Repair budget" value={money(pkg.repairs)} overlay={guideCostSummary?.headingOverlay} />
                <Stat label="Interest rate" value={`${pkg.privatePool.ratePct}% a year`} overlay={pkg.privateFundsRows.find((r) => r.key === 'interest')?.overlay} />
                <Stat label="Minimum share" value={money(pkg.minParticipation)} overlay={pkg.privatePoolRows.find((r) => r.key === 'minParticipation')?.overlay} />
              </dl>

              {guideCostSummary && <CostSummary summary={guideCostSummary} className="mt-5" />}

              <ol className="mt-5 space-y-3 border-t border-line pt-4">
                {privatePlanSteps.map((step) => (
                  <li key={step.num} className="flex gap-3 rounded-xl bg-paper p-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                      {step.num}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{step.title}</span>
                      <OverlayTrigger lines={step.overlay} className="text-sm font-semibold tabular-nums text-ink">
                        {step.value}
                      </OverlayTrigger>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ) : lenderLens === 'dscr' ? (
            <Card data-plan="dscr">
              <CardTitle
                aside={
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-white">
                    {pkg.refiCheck.refiYears}-yr · {pkg.refiCheck.refiRate}%
                  </span>
                }
              >
                DSCR refinance plan
              </CardTitle>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={`Takeout loan (${pkg.refiCheck.refiLtv}% LTV)`} value={money(pkg.refiCheck.newLoan)} overlay={pkg.dscrLoanRows.find((r) => r.key === 'loan')?.overlay} />
                <Stat label="Stabilized value" value={money(pkg.value)} overlay={pkg.dscrLoanRows.find((r) => r.key === 'value')?.overlay} />
                <Stat label="Monthly payment (P&I)" value={`${money(pkg.refiCheck.refiPayment)}/mo`} overlay={pkg.dscrLoanRows.find((r) => r.key === 'payment')?.overlay} />
                <Stat label="Pays off bridge" value={money(pkg.refiCheck.bridgePayoff)} overlay={pkg.refiCheckRows.find((r) => r.key === 'payoff')?.overlay} />
              </dl>

              <ol className="mt-5 space-y-3 border-t border-line pt-4">
                {dscrPlanSteps.map((step) => (
                  <li key={step.num} className="flex gap-3 rounded-xl bg-paper p-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                      {step.num}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{step.title}</span>
                      <OverlayTrigger lines={step.overlay} className="text-sm font-semibold tabular-nums text-ink">
                        {step.value}
                      </OverlayTrigger>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-5 border-t border-line pt-4">
                <LedgerRows rows={pkg.refiCheckRows} />
              </div>
            </Card>
          ) : (
            <Card data-plan="1a">
              <CardTitle
                aside={
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-white">
                    {pkg.ltcPct}% LTC · $0 down
                  </span>
                }
              >
                Bridge loan plan
              </CardTitle>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total bridge loan" value={money(pkg.totalLoan)} overlay={pkg.loanAskRows.find((r) => r.key === 'total')?.overlay} />
                <Stat label="Repair budget" value={money(pkg.repairs)} overlay={guideCostSummary?.headingOverlay} />
                <Stat label={`Interest (${pkg.ratePct}% IO · non-Dutch)`} value={`${money(pkg.initialMonthlyInterest)}/mo`} overlay={pkg.loanAskRows.find((r) => r.key === 'interest')?.overlay} />
                <Stat label={`Deferred (${pkg.deferredMonths} mo · due at payoff)`} value={money(pkg.deferredInterest)} overlay={pkg.loanAskRows.find((r) => r.key === 'deferredInterest')?.overlay} />
              </dl>

              {guideCostSummary && <CostSummary summary={guideCostSummary} className="mt-5" />}

              <ol className="mt-5 space-y-3 border-t border-line pt-4">
                {bridgePlanSteps.map((step) => (
                  <li key={step.num} className="flex gap-3 rounded-xl bg-paper p-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                      {step.num}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{step.title}</span>
                      <OverlayTrigger lines={step.overlay} className="text-sm font-semibold tabular-nums text-ink">
                        {step.value}
                      </OverlayTrigger>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )
        )}
      </section>

      <section id="sec-what-if" data-section="what-if" className="scroll-mt-20">
        <h2 className="mb-3 font-display text-2xl font-semibold">What-if</h2>
        {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
          <LenderWhatIf
            deal={deal}
            me={me}
            preview={preview}
            pkg={pkg}
            base={effectiveBase}
            offer={plan}
            guide={effectiveGuide}
            lens={lenderLens}
          />
        )}
      </section>

      <section id="sec-city-records" data-section="city-records" className="scroll-mt-20">
        <Suspense fallback={<Empty>Loading…</Empty>}>
          <CityRecords deal={deal} role="lender" preview={preview} />
        </Suspense>
      </section>

      <section id="sec-documents" data-section="documents" className="scroll-mt-20">
        <Card>
          <CardTitle>Supporting documents</CardTitle>
          {rows === null ? <Empty>Loading…</Empty> : docs.length ? <FileList rows={docs} canShare={false} owner={false} /> : <Empty>No supporting documents shared yet.</Empty>}
        </Card>
      </section>

      <section id="sec-photos" data-section="photos" className="scroll-mt-20">
        <UnitGallery deal={deal} me={me} role="lender" preview={preview} unitSummaries={effectiveGuide?.rentValue?.units} />
      </section>

      <section id="sec-messages" data-section="messages" className="scroll-mt-20">
        <Messages deal={deal} me={me} role="lender" preview={preview} />
      </section>
    </div>
  );
}
