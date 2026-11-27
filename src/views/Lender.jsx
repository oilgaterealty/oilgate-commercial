import { buyerName } from '../lib/people.js';
import { Suspense, lazy, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { evaluate, money, valueSummary } from '../lib/dealmath.js';
import { buildFallbackRentValue, buildLenderPackage, LENDER_LENSES } from '../lib/lenderModel.js';
import { effectiveMarketRange } from '../lib/rangeValue.js';
import { plain } from '../lib/plain.js';
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

// The lender's one-page workspace: whiteboard overview (Bridge / Private / DSCR), terms, Plan 1A + 1B, bridge/refi what-if, records, docs, photos, messages.
export default function Lender({ deal, me, preview, tab }) {
  const root = preview ? `#/d/${deal.slug}/view/lender` : `#/d/${deal.slug}`;
  const { activeSection, jumpTo } = useSectionScroll(tab, SECTIONS, { offers: 'what-if' });
  const [lenderLens, setLenderLens] = useState('bridge');
  const [rows] = useUploads(deal);
  const visible = preview ? seenBy('lender', rows) : rows || [];
  const photos = photosOf(visible);
  const docs = visible.filter((r) => r.kind === 'document');
  const { offers, base, error } = useDealModel(deal, { owner: false, onlyShared: preview ? 'lender' : undefined });
  const [leadGuide, setLeadGuide] = useState(null);

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

  const b = { ...base, units: 10 };
  const plan = offers?.[0] || null;
  const e = plan && evaluate(plan.structure, plan.inputs, b);
  const o = e?.operating;
  const val = o ? valueSummary({ base: b, noi: o.noi, units: 10 }) : null;
  const rawGuide = isUnitsGuide(leadGuide) ? leadGuide : (isUnitsGuide(plan?.seller_summary?.guide) ? plan.seller_summary.guide : null);
  const liftedRentValue = rawGuide?.rentValue
    ? { ...rawGuide.rentValue, marketRange: effectiveMarketRange(rawGuide.rentValue.marketRange, b) }
    : null;
  const effectiveGuide = rawGuide
    ? { ...rawGuide, ...(liftedRentValue ? { rentValue: liftedRentValue } : {}) }
    : null;
  const guide = effectiveGuide || plan?.seller_summary?.guide || null;
  const guideCostSummary = guide?.costSummary || (guide?.cost?.length
    ? { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost }
    : null);

  const pkg = buildLenderPackage({
    base: b,
    offer: plan,
    guide: effectiveGuide,
    valSummary: val,
    lens: lenderLens,
  });
  const fallbackRent = !isRentValue(effectiveGuide?.rentValue) ? buildFallbackRentValue(b, pkg) : null;
  const heroFigure = lenderLens === 'dscr' ? money(pkg.refiCheck.newLoan) : money(pkg.totalLoan);
  const heroOverlay = lenderLens === 'dscr'
    ? pkg.refiCheckRows[0]?.overlay || []
    : pkg.loanAskRows.find((r) => r.key === 'total')?.overlay || [];

  const pointsWord = pkg.pointsPct === 1 ? 'point' : 'points';
  const stabilizedRentMo = o ? o.egi / 12 : 0;
  const stabilizedNoiMo = o ? o.noi / 12 : 0;
  const plan1aSteps = [
    {
      num: 1,
      title: 'Close',
      value: `${money(pkg.totalLoan)} · $0 down`,
      overlay: [
        `Lender pays off the seller's loan (${money(pkg.purchase)}) and rolls ${money(pkg.closing)} title/closing, ${money(pkg.processing)} processing, ${pkg.pointsPct} ${pointsWord} (${money(pkg.points)}), and ${pkg.deferredMonths} mo deferred interest (${money(pkg.deferredInterest)}) into one ${money(pkg.totalLoan)} loan.`,
      ],
    },
    {
      num: 2,
      title: 'Repairs in draws',
      value: money(pkg.repairs),
      overlay: guideCostSummary?.lines?.length
        ? guideCostSummary.lines.map((l) => l.label).filter(Boolean)
        : [`${money(pkg.repairs)} repair budget released in inspection draws as work completes.`],
    },
    {
      num: 3,
      title: `Lease-up (${pkg.deferredMonths}-mo deferred interest)`,
      value: `${money(pkg.deferredInterest)} cushion · ${pkg.units} units`,
      overlay: [
        `${pkg.deferredMonths} months deferred interest (${money(pkg.deferredInterest)}) covers initial lease-up at ${pkg.ratePct}% IO (${money(pkg.monthlyInterest)}/mo).`,
        stabilizedRentMo > 0 ? `Stabilized rent ${money(stabilizedRentMo)}/mo, NOI ${money(stabilizedNoiMo)}/mo across ${pkg.units} units.` : null,
      ].filter(Boolean),
    },
    {
      num: 4,
      title: 'Refinance pays off bridge',
      value: `${money(pkg.refiCheck.newLoan)} (${pkg.refiCheck.refiLtv}% LTV)`,
      overlay: [
        `${pkg.refiCheck.refiLtv}% of ${money(pkg.value)} stabilized value = ${money(pkg.refiCheck.newLoan)}.`,
        `Pays off ${money(pkg.totalLoan)} bridge loan and ${money(pkg.refiCheck.refiFeesTotal)} refi fees, leaving ${pkg.refiCheck.isGap ? `${money(Math.abs(pkg.refiCheck.netAtRefi))} gap` : `${money(pkg.refiCheck.netAtRefi)} left over`}.`,
      ],
    },
  ];

  return (
    <div className="space-y-8 pb-20">
      <JumpNav sections={SECTIONS} active={activeSection} onJump={jumpTo} base={root} preview={preview} />

      <section id="sec-overview" data-section="overview" className="scroll-mt-20 space-y-5">
        <Cover rows={photos} compact />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
          <>
            {/* 1. Title + one line + lender-type switch (Bridge, Private, DSCR) + hero ask metric */}
            <section data-wb="hero" className="rounded-2xl border border-ink border-t-2 border-t-warm bg-ink p-5 text-white sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="tablist" aria-label="Lender type" className="inline-flex rounded-xl border border-white/15 bg-white/5 p-1">
                  {Object.values(LENDER_LENSES).map((item) => {
                    const active = item.key === lenderLens;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setLenderLens(item.key)}
                        className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                          active ? 'bg-white text-ink' : 'text-white/75 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <span className="rounded-full border border-warm/40 bg-warm/15 px-3 py-1 text-xs font-medium tracking-wide text-warm-soft">
                  {pkg.units} units · Plan 1A
                </span>
              </div>

              <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-end">
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
                    <dt className="text-xs text-white/65">Minimum participation</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.privatePoolRows[1]?.overlay || []} className="text-white">
                        {money(pkg.minParticipation)}
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Loan vs value</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={[`${money(pkg.totalLoan)} of ${money(pkg.value)} stabilized value`]} className="text-white">
                        {pkg.ltvPct > 0 ? `${Math.round(pkg.ltvPct)}% LTV` : '—'}
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">{pkg.refiCheck.isGap ? 'Gap at refinance' : 'Left over at refinance'}</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.privatePoolRows[3]?.overlay || []} className="text-white">
                        {money(Math.abs(pkg.refiCheck.netAtRefi))}
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
                    <dt className="text-xs text-white/65">Loan vs value</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={[`${money(pkg.totalLoan)} of ${money(pkg.value)} stabilized value`]} className="text-white">
                        {pkg.ltvPct > 0 ? `${Math.round(pkg.ltvPct)}% LTV` : '—'}
                      </OverlayTrigger>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/65">Exit refi ({pkg.refiCheck.refiLtv}%)</dt>
                    <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                      <OverlayTrigger lines={pkg.refiCheckRows[0]?.overlay || []} className="text-white">
                        {money(pkg.refiCheck.newLoan)}
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

            {/* 2. Four-step progression strip */}
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

            {/* 3. Loan ask / Total funds needed + 4. Refinance check or Private pool */}
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
                  {lenderLens === 'private' ? 'Total funds needed' : 'Loan ask'}
                </CardTitle>
                <div data-wb="loan-ask-body">
                  <LedgerRows rows={pkg.loanAskRows} />
                </div>
              </Card>

              {lenderLens === 'private' ? (
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
              ) : (
                <Card data-wb="refi-check">
                  <CardTitle
                    aside={
                      <OverlayTrigger lines={pkg.refiCheckRows[0]?.overlay || []} className="text-sm font-medium text-ink-soft">
                        {money(pkg.value)} value
                      </OverlayTrigger>
                    }
                  >
                    Refinance check
                  </CardTitle>
                  <div data-wb="refi-check-body">
                    <LedgerRows rows={pkg.refiCheckRows} />
                  </div>
                </Card>
              )}
            </div>

            {/* 5. Rent plan */}
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
        <LenderTerms deal={deal} me={me} preview={preview} guide={effectiveGuide} base={b} offer={plan} lenderLens={lenderLens} />
      </section>

      <section id="sec-plan" data-section="plan" className="scroll-mt-20 space-y-5">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
          <>
            <Card data-plan="1a">
              <CardTitle
                aside={
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-white">
                    Primary path
                  </span>
                }
              >
                Plan 1A · Bridge to refinance
              </CardTitle>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total bridge loan" value={money(pkg.totalLoan)} overlay={pkg.loanAskRows.find((r) => r.key === 'total')?.overlay} />
                <Stat label="Repair budget" value={money(pkg.repairs)} overlay={guideCostSummary?.headingOverlay} />
                <Stat label={`${pkg.deferredMonths}-mo deferred interest`} value={money(pkg.deferredInterest)} overlay={pkg.loanAskRows.find((r) => r.key === 'deferredInterest')?.overlay} />
                <Stat label={`Takeout refi (${pkg.refiCheck.refiLtv}%)`} value={money(pkg.refiCheck.newLoan)} overlay={pkg.refiCheckRows[0]?.overlay} />
              </dl>

              {guideCostSummary && <CostSummary summary={guideCostSummary} className="mt-5" />}

              <ol className="mt-5 space-y-3 border-t border-line pt-4">
                {plan1aSteps.map((step) => (
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

            {pkg.hasSellerFinancingOption && (
              <Card data-plan="1b">
                <CardTitle aside={<span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-soft">Plan 1B · Backup option</span>}>
                  Seller financing
                </CardTitle>
                <dl className="divide-y divide-line">
                  <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <dt className="text-sm text-ink-soft">Primary bridge path</dt>
                    <dd className="text-sm font-semibold tabular-nums text-ink">Plan 1A · {money(pkg.totalLoan)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <dt className="text-sm text-ink-soft">Backup structure</dt>
                    <dd className="text-sm font-medium text-ink">
                      <OverlayTrigger lines={[plain(plan.structure, e).glance]}>Seller carry note</OverlayTrigger>
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <dt className="text-sm text-ink-soft">Repair budget</dt>
                    <dd className="text-sm font-semibold tabular-nums text-ink">{money(pkg.repairs)}</dd>
                  </div>
                </dl>
              </Card>
            )}
          </>
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
            base={b}
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
