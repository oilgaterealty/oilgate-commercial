import { buyerName } from '../lib/people.js';
import { Suspense, lazy, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { evaluate, money, moneyCents, valueSummary } from '../lib/dealmath.js';
import { computePrivateReturn, buildFallbackRentValue, buildLenderPackage, LENDER_LENSES, parseLenderProtections } from '../lib/lenderModel.js';
import { effectiveMarketRange } from '../lib/rangeValue.js';
import { SITE_KIND, canAccessCityRecords } from '../lib/site.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useUploads, FileList } from '../components/Files.jsx';
import { Cover, useDealGallery } from '../components/Photos.jsx';
import { InPagePanel, OverviewActionButtons } from '../components/OverlaySheet.jsx';
import { useSheetBadges } from '../lib/sheetBadges.js';
import UnitGallery from '../components/UnitGallery.jsx';
import CostSummary from '../components/CostSummary.jsx';
import { ExecutionPlanCard } from '../components/LeadOfferCard.jsx';
import { isUnitsGuide } from '../components/UnitsRentedGuide.jsx';
import RentValue, { isRentValue } from '../components/RentValue.jsx';
import { Card, CardTitle, Empty, JumpNav, OverlayTrigger, useSectionScroll } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import LenderTerms from './LenderTerms.jsx';

const fmtCents = moneyCents || money;
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
  const [open, setOpen] = useState({});
  const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <dl className="divide-y divide-line">
      {rows.map((row) => {
        const isTotal = row.emphasis === 'total';
        const isAccent = row.emphasis === 'accent';
        const hasItems = Array.isArray(row.items) && row.items.length > 0;
        const isOpen = hasItems && Boolean(open[row.key]);
        const isLong = !hasItems && !isTotal && String(row.display || '').length > 24;
        const valCls = row.tone === 'good'
          ? 'text-good'
          : row.tone === 'warn'
            ? 'text-amber-800'
            : 'text-ink';
        if (hasItems) {
          return (
            <div
              key={row.key}
              data-ledger-group={row.key}
              className={`py-2 first:pt-0 last:pb-0 ${isTotal ? 'border-t-2 border-ink/20 pt-3' : isAccent ? 'rounded-xl bg-warm-soft/70 px-3 py-2 my-1' : ''}`}
            >
              <div className="flex items-center justify-between gap-x-3">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(row.key)}
                  className="flex min-h-[40px] min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 -mx-1 text-left transition hover:bg-warm-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <span aria-hidden="true" className="shrink-0 text-xs text-ink-soft">{isOpen ? '▴' : '▾'}</span>
                  <span className={`min-w-0 text-sm ${isTotal || isAccent ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{row.label}</span>
                </button>
                <dd className={`shrink-0 whitespace-nowrap tabular-nums text-right ${isTotal ? 'font-display text-xl font-semibold' : 'text-sm font-semibold'} ${valCls}`}>
                  <OverlayTrigger lines={row.overlay} className={valCls}>{row.display}</OverlayTrigger>
                </dd>
              </div>
              {isOpen && (
                <dl className="mt-1 space-y-1.5 rounded-xl bg-paper px-3 py-2 text-sm tabular-nums">
                  {row.items.map((item) => (
                    <div key={item.key || item.label} className="flex items-baseline justify-between gap-x-3 gap-y-0.5 py-0.5">
                      <dt className="min-w-0 flex-1 text-ink-soft">{item.label}</dt>
                      <dd className="shrink-0 whitespace-nowrap text-right font-medium text-ink">
                        <OverlayTrigger lines={item.overlay}>{item.display}</OverlayTrigger>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        }
        return (
          <div
            key={row.key}
            className={`${
              isLong
                ? 'flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4'
                : 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5'
            } py-2.5 first:pt-0 last:pb-0 ${
              isTotal ? 'border-t-2 border-ink/20 pt-3 font-semibold' : isAccent ? 'rounded-xl bg-warm-soft/70 px-3 py-2.5 my-1 font-semibold' : ''
            }`}
          >
            <dt className={`min-w-0 text-sm ${isTotal || isAccent ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{row.label}</dt>
            <dd className={`min-w-0 max-w-full break-words tabular-nums ${isLong ? 'text-left sm:text-right' : 'text-right'} ${isTotal ? 'font-display text-xl font-semibold' : 'text-sm font-semibold'} ${valCls}`}>
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
  const [open, setOpen] = useState(false);

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
      <button
        type="button"
        aria-expanded={open}
        data-private-return-toggle
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <span aria-hidden="true" className="text-xs text-ink-soft">{open ? '▴' : '▾'}</span>
          <span>Your return</span>
        </span>
        <span className="text-xs font-medium tabular-nums text-ink-soft">
          {fmtCents(calc.monthly)}/mo · {ratePct}% IO
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
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

          <dl className="grid gap-3 sm:grid-cols-3 tabular-nums">
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

          <dl className="grid grid-cols-1 gap-2 border-t border-line pt-3 text-sm sm:grid-cols-3">
            <div className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 sm:block">
              <dt className="text-xs text-ink-soft">Schedule</dt>
              <dd className="font-medium text-ink">First payment after month 1</dd>
            </div>
            <div className="rounded-xl bg-paper px-3 py-2 sm:col-span-2">
              <dt className="text-xs text-ink-soft">Term</dt>
              <dd className="font-medium text-ink">{pkg.privatePool.termSummary || '12 months, one 3-month extension. Paid off early at refinance, no prepayment penalty.'}</dd>
            </div>
          </dl>
        </div>
      )}
    </Card>
  );
}

const SECTIONS = [
  ['overview', 'Overview'],
  ['terms', 'Your terms'],
  ['plan', 'The plan'],
];

const PANEL_ALIASES = {
  photos: 'photos',
  documents: 'documents',
  files: 'documents',
  messages: 'messages',
  'city-records': 'city-records',
};
const PANEL_TITLES = {
  photos: 'Photos by unit',
  documents: 'Supporting documents',
  messages: 'Messages',
  'city-records': 'City records',
};

const LENS_DRIVEN_SECTIONS = new Set(['overview', 'terms', 'plan']);

// Consolidated 3-tab lender workspace (Overview, Your terms, The plan) across Bridge, Private, and DSCR.
export default function Lender({ deal, me, member = null, preview, tab, initialLens = 'bridge', urlLens = '', privateProtections = null }) {
  const root = preview ? `#/d/${deal.slug}/view/lender` : `#/d/${deal.slug}`;
  const [panel, setPanel] = useState(() => PANEL_ALIASES[tab] || null);
  const { activeSection, jumpTo: scrollJumpTo } = useSectionScroll(tab, SECTIONS, {
    offers: 'terms',
    'what-if': 'terms',
    ...Object.fromEntries(Object.keys(PANEL_ALIASES).map((k) => [k, 'overview'])),
  });
  const [lenderLens, setLenderLens] = useState(() => (LENDER_LENSES[initialLens] ? initialLens : 'bridge'));
  const [rows] = useUploads(deal);
  const gallery = useDealGallery(deal, 'lender', preview, { externalRows: rows });
  const visible = preview ? seenBy('lender', rows) : rows || [];
  const docs = visible.filter((r) => r.kind === 'document');
  const { docBadge, msgBadge } = useSheetBadges({ deal, me, role: 'lender', preview, docs });
  const { offers, base, error, liveGuide } = useDealModel(deal, { owner: false, onlyShared: preview ? 'lender' : undefined });
  const [leadGuide, setLeadGuide] = useState(null);
  const [loadedProtections, setLoadedProtections] = useState([]);
  const [sharedRent, setSharedRent] = useState(null);
  const [sharedUnits, setSharedUnits] = useState(10);
  const [protectionsOpen, setProtectionsOpen] = useState(false);
  const [planStepsOpen, setPlanStepsOpen] = useState({});

  useEffect(() => {
    setSharedRent(null);
  }, [base?.rent]);

  useEffect(() => {
    if (LENDER_LENSES[urlLens]) setLenderLens(urlLens);
  }, [urlLens]);

  useEffect(() => {
    setPanel(PANEL_ALIASES[tab] || null);
  }, [tab]);

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

  const jumpTo = (k, basePath) => {
    setPanel(null);
    scrollJumpTo(k, basePath);
  };

  const openPanel = (kind) => {
    const clean = PANEL_ALIASES[kind] || kind;
    setPanel(clean);
    const next = `${root}/${clean}`;
    if (typeof window !== 'undefined' && window.location.hash !== next) {
      window.location.hash = next;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const closePanel = () => {
    setPanel(null);
    if (typeof window !== 'undefined' && window.location.hash !== root) {
      window.location.hash = root;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const protections = Array.isArray(privateProtections)
    ? parseLenderProtections(privateProtections)
    : loadedProtections;

  const b = { ...base, units: 10 };
  const plan = offers?.[0] || null;
  const rawGuide = isUnitsGuide(liveGuide)
    ? liveGuide
    : (isUnitsGuide(leadGuide) ? leadGuide : (isUnitsGuide(plan?.seller_summary?.guide) ? plan.seller_summary.guide : null));
  const opexSource = b?.opex || rawGuide?.opex || null;
  const laundrySource = b?.laundry || rawGuide?.laundry || opexSource?.laundry || null;
  const upsideSource = b?.upside || rawGuide?.upside || opexSource?.upside || null;
  const effectiveBase = {
    ...b,
    ...(opexSource && !b?.opex ? { opex: opexSource } : {}),
    ...(laundrySource && !b?.laundry ? { laundry: laundrySource } : {}),
    ...(upsideSource && !b?.upside ? { upside: upsideSource } : {}),
  };
  const baseDefaultRent = Number.isFinite(+effectiveBase?.rent) && +effectiveBase.rent > 0
    ? +effectiveBase.rent
    : (Number.isFinite(+rawGuide?.rentValue?.ourRent) && +rawGuide.rentValue.ourRent > 0
        ? +rawGuide.rentValue.ourRent
        : (Number.isFinite(+rawGuide?.rent) && +rawGuide.rent > 0 ? +rawGuide.rent : 1000));
  const activeRent = sharedRent !== null && Number.isFinite(+sharedRent) ? +sharedRent : baseDefaultRent;
  const activeBase = { ...effectiveBase, rent: activeRent };
  const e = plan && evaluate(plan.structure, plan.inputs, activeBase);
  const o = e?.operating;
  const val = o ? valueSummary({ base: activeBase, noi: o.noi, units: 10 }) : null;
  const liftedRentValue = rawGuide?.rentValue
    ? {
        ...rawGuide.rentValue,
        ourRent: activeRent,
        ...(opexSource && !rawGuide.rentValue.opex ? { opex: opexSource } : {}),
        ...(laundrySource && !rawGuide.rentValue.laundry ? { laundry: laundrySource } : {}),
        ...(upsideSource && !rawGuide.rentValue.upside ? { upside: upsideSource } : {}),
        marketRange: effectiveMarketRange(rawGuide.rentValue.marketRange, activeBase),
      }
    : null;
  const effectiveGuide = rawGuide
    ? { ...rawGuide, rent: activeRent, ...(liftedRentValue ? { rentValue: liftedRentValue } : {}) }
    : null;
  const guide = effectiveGuide || plan?.seller_summary?.guide || null;
  const guideCostSummary = guide?.costSummary || (guide?.cost?.length
    ? { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost }
    : null);

  const pkg = buildLenderPackage({
    base: activeBase,
    offer: plan,
    guide: effectiveGuide,
    valSummary: val,
    lens: lenderLens,
  });
  const fallbackRent = !isRentValue(effectiveGuide?.rentValue) ? buildFallbackRentValue(activeBase, pkg) : null;

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

  const navActive = panel ? 'overview' : activeSection;

  return (
    <div className="space-y-4 pb-8" data-active-tab={lenderLens}>
      <JumpNav sections={SECTIONS} active={navActive} onJump={jumpTo} base={root} preview={preview} />

      {!panel && LENS_DRIVEN_SECTIONS.has(activeSection) && (
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

      <InPagePanel open={Boolean(panel)} kind={panel || 'panel'} title={PANEL_TITLES[panel] || ''} onClose={closePanel}>
        {panel === 'photos' && (
          <UnitGallery deal={deal} me={me} role="lender" preview={preview} unitSummaries={effectiveGuide?.rentValue?.units} />
        )}
        {panel === 'documents' && (
          <Card>
            <CardTitle>Supporting documents</CardTitle>
            {rows === null ? <Empty>Loading…</Empty> : docs.length ? <FileList rows={docs} canShare={false} owner={false} /> : <Empty>No supporting documents shared yet.</Empty>}
          </Card>
        )}
        {panel === 'messages' && (
          <Messages deal={deal} me={me} role="lender" preview={preview} />
        )}
        {panel === 'city-records' && canAccessCityRecords(SITE_KIND, 'lender', preview) && (
          <Suspense fallback={<Empty>Loading…</Empty>}>
            <CityRecords deal={deal} role="lender" preview={preview} />
          </Suspense>
        )}
      </InPagePanel>

      {!panel && (
        <>
          <section id="sec-overview" data-section="overview" className="scroll-mt-20 space-y-3.5">
            <Cover items={gallery.items} compact onOpenUnitGallery={() => openPanel('photos')} />
            <OverviewActionButtons
              showDocuments
              showMessages
              showCityRecords={canAccessCityRecords(SITE_KIND, 'lender', preview)}
              docCount={docBadge}
              msgCount={msgBadge}
              onOpenDocuments={() => openPanel('documents')}
              onOpenMessages={() => openPanel('messages')}
              onOpenCityRecords={() => openPanel('city-records')}
            />
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
                          <OverlayTrigger lines={pkg.privatePoolRows.find((r) => r.key === 'rateAndMin')?.items?.[0]?.overlay || pkg.privatePoolRows[0]?.overlay || []} className="text-white">
                            {pkg.privatePool.ratePct}%
                          </OverlayTrigger>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/65">Minimum share</dt>
                        <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                          <OverlayTrigger lines={pkg.privatePoolRows.find((r) => r.key === 'rateAndMin')?.items?.[1]?.overlay || pkg.privatePoolRows[0]?.overlay || []} className="text-white">
                            {money(pkg.minParticipation)}
                          </OverlayTrigger>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/65">Monthly income (min)</dt>
                        <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                          <OverlayTrigger lines={pkg.privatePoolRows.find((r) => r.key === 'rateAndMin')?.items?.[1]?.overlay || []} className="text-white">
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
                          <OverlayTrigger lines={pkg.dscrLoanRows.find((r) => r.key === 'loan')?.items?.[0]?.overlay || pkg.dscrLoanRows[0]?.overlay || []} className="text-white">
                            {money(pkg.value)}
                          </OverlayTrigger>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/65">Rate &amp; term</dt>
                        <dd className="mt-0.5 font-display text-lg font-semibold text-white sm:text-2xl">
                          <OverlayTrigger lines={pkg.dscrLoanRows.find((r) => r.key === 'rateAmort')?.overlay || []} className="text-white">
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

                {/* 2. Tab-specific two-card breakdown */}
                {lenderLens === 'private' ? (
                  <div className="grid gap-3.5 lg:grid-cols-2">
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
                          <OverlayTrigger lines={pkg.privatePoolRows.find((r) => r.key === 'rateAndMin')?.overlay || []} className="text-sm font-medium text-ink-soft">
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
                  <div className="grid gap-3.5 lg:grid-cols-2">
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
                  <div className="grid gap-3.5 lg:grid-cols-2">
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
                          <OverlayTrigger lines={pkg.bridgeTermsRows.find((r) => r.key === 'rateAndDraws')?.overlay || []} className="text-sm font-medium text-ink-soft">
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

                {/* 3b. Private lender return slider (Private tab only; collapsed by default) */}
                {lenderLens === 'private' && <PrivateReturnCard pkg={pkg} />}

                {/* 3c. Private lender protections (Private tab only; collapsed by default) */}
                {lenderLens === 'private' && protections.length > 0 && (
                  <div data-wb="private-protections">
                    <Card>
                      <button
                        type="button"
                        aria-expanded={protectionsOpen}
                        data-protections-group="private"
                        onClick={() => setProtectionsOpen((v) => !v)}
                        className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
                      >
                        <span className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
                          <span aria-hidden="true" className="text-xs text-ink-soft">{protectionsOpen ? '▴' : '▾'}</span>
                          <span>Your protections</span>
                        </span>
                        <span className="text-xs font-medium text-ink-soft">{protections.length} items</span>
                      </button>
                      {protectionsOpen && (
                        <ul aria-label="Your protections" className="mt-3 space-y-2.5 border-t border-line pt-3 text-sm leading-relaxed text-ink">
                          {protections.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2.5">
                              <span aria-hidden="true" className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  </div>
                )}

                {/* 4. Rent plan (slider lives in Your terms -> Test the numbers; tables collapsed by default) */}
                {(isRentValue(effectiveGuide?.rentValue) || fallbackRent) && (
                  <div data-wb="rent-plan">
                    {isRentValue(effectiveGuide?.rentValue)
                      ? <RentValue data={effectiveGuide.rentValue} showMarket hideUnits hideSlider hideValueRange collapseTables rent={activeRent} onRentChange={setSharedRent} />
                      : <RentValue data={fallbackRent} showMarket hideUnits hideSlider hideValueRange collapseTables rent={activeRent} onRentChange={setSharedRent} />}
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
              base={activeBase}
              offer={plan}
              lenderLens={lenderLens}
              onLensChange={setLenderLens}
              hideProgramTabs
              rent={activeRent}
              onRentChange={setSharedRent}
              unitsRented={sharedUnits}
              onUnitsRentedChange={setSharedUnits}
              defaultRent={baseDefaultRent}
            />
          </section>

          <section id="sec-plan" data-section="plan" className="scroll-mt-20 space-y-5">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
              <>
                {lenderLens === 'private' ? (
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

                    <div className="mt-4 border-t border-line pt-3">
                      <button
                        type="button"
                        aria-expanded={Boolean(planStepsOpen.private)}
                        data-plan-timeline="private"
                        onClick={() => setPlanStepsOpen((p) => ({ ...p, private: !p.private }))}
                        className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-1 -mx-1 text-left text-sm font-medium text-ink hover:bg-warm-soft/50"
                      >
                        <span className="flex items-center gap-1.5">
                          <span aria-hidden="true" className="text-xs text-ink-soft">{planStepsOpen.private ? '▴' : '▾'}</span>
                          <span>Step-by-step timeline</span>
                        </span>
                        <span className="text-xs text-ink-soft">{privatePlanSteps.length} steps</span>
                      </button>
                      {planStepsOpen.private && (
                        <ol className="mt-3 space-y-3">
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
                      )}
                    </div>
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
                      <Stat label="Stabilized value" value={money(pkg.value)} overlay={pkg.dscrLoanRows.find((r) => r.key === 'loan')?.items?.[0]?.overlay} />
                      <Stat label="Monthly payment (P&I)" value={`${money(pkg.refiCheck.refiPayment)}/mo`} overlay={pkg.dscrLoanRows.find((r) => r.key === 'payment')?.overlay} />
                      <Stat label="Pays off bridge" value={money(pkg.refiCheck.bridgePayoff)} overlay={pkg.refiCheckRows.find((r) => r.key === 'payoff')?.overlay} />
                    </dl>

                    {guideCostSummary && <CostSummary summary={guideCostSummary} className="mt-5" />}

                    <div className="mt-4 border-t border-line pt-3">
                      <button
                        type="button"
                        aria-expanded={Boolean(planStepsOpen.dscr)}
                        data-plan-timeline="dscr"
                        onClick={() => setPlanStepsOpen((p) => ({ ...p, dscr: !p.dscr }))}
                        className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-1 -mx-1 text-left text-sm font-medium text-ink hover:bg-warm-soft/50"
                      >
                        <span className="flex items-center gap-1.5">
                          <span aria-hidden="true" className="text-xs text-ink-soft">{planStepsOpen.dscr ? '▴' : '▾'}</span>
                          <span>Step-by-step timeline</span>
                        </span>
                        <span className="text-xs text-ink-soft">{dscrPlanSteps.length} steps</span>
                      </button>
                      {planStepsOpen.dscr && (
                        <ol className="mt-3 space-y-3">
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
                      )}
                    </div>

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
                      <Stat label={`Deferred (${pkg.deferredMonths} mo · due at payoff)`} value={money(pkg.deferredInterest)} overlay={pkg.loanAskRows.find((r) => r.key === 'interest')?.items?.[0]?.overlay} />
                    </dl>

                    {guideCostSummary && <CostSummary summary={guideCostSummary} className="mt-5" />}

                    <div className="mt-4 border-t border-line pt-3">
                      <button
                        type="button"
                        aria-expanded={Boolean(planStepsOpen.bridge)}
                        data-plan-timeline="bridge"
                        onClick={() => setPlanStepsOpen((p) => ({ ...p, bridge: !p.bridge }))}
                        className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-1 -mx-1 text-left text-sm font-medium text-ink hover:bg-warm-soft/50"
                      >
                        <span className="flex items-center gap-1.5">
                          <span aria-hidden="true" className="text-xs text-ink-soft">{planStepsOpen.bridge ? '▴' : '▾'}</span>
                          <span>Step-by-step timeline</span>
                        </span>
                        <span className="text-xs text-ink-soft">{bridgePlanSteps.length} steps</span>
                      </button>
                      {planStepsOpen.bridge && (
                        <ol className="mt-3 space-y-3">
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
                      )}
                    </div>
                  </Card>
                )}
                <ExecutionPlanCard
                  content={deal.seller_content}
                  summary={guideCostSummary ? { ...plan?.seller_summary, ...guideCostSummary, steps: plan?.seller_summary?.steps } : plan?.seller_summary}
                  stepBudgets={guideCostSummary?.stepBudgets || plan?.seller_summary?.stepBudgets}
                  lenderMode
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
