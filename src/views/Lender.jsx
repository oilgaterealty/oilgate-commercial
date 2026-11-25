import { buyerName } from '../lib/people.js';
import { Suspense, lazy, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { buildLeadStory, evaluate, money, valueSummary } from '../lib/dealmath.js';
import { plain } from '../lib/plain.js';
import { breakEvenCount } from '../lib/occupancy.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useUploads, FileList } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import CostSummary from '../components/CostSummary.jsx';
import UnitsRentedGuide, { isUnitsGuide } from '../components/UnitsRentedGuide.jsx';
import { Card, CardTitle, Empty, Tabs, OverlayTrigger } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import LenderTerms from './LenderTerms.jsx';

const CityRecords = lazy(() => import('./CityRecords.jsx'));

const debtOf = (e) => e.operating.cashFlow / 12 - e.keepMonthly;
const times = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}x` : 'No payment');

function Stat({ label, value, overlay }) {
  return (
    <div className="rounded-2xl bg-paper p-3">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold leading-tight">
        {overlay?.length ? <OverlayTrigger lines={overlay}>{value}</OverlayTrigger> : value}
      </dd>
    </div>
  );
}

// The lender's page: single lead plan, full read-only City Records, approved supporting documents, and required questionnaire.
export default function Lender({ deal, me, preview, tab }) {
  const tabs = [
    ['overview', 'The plan'],
    ['city-records', 'City records'],
    ['documents', 'Documents'],
    ['photos', 'Photos'],
    ['messages', 'Messages'],
  ];
  const active = tabs.find(([k]) => k === tab)?.[0] || 'overview';
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
  const story = e ? buildLeadStory(plan.structure, e, { base: b }) : null;
  const effectiveGuide = isUnitsGuide(leadGuide) ? leadGuide : (isUnitsGuide(plan?.seller_summary?.guide) ? plan.seller_summary.guide : null);
  const guide = effectiveGuide || plan?.seller_summary?.guide || null;
  const guideCostSummary = guide?.costSummary || (guide?.cost?.length
    ? { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost }
    : null);
  const steps = guide?.steps?.length ? guide.steps : story?.steps;

  return (
    <div className="space-y-5">
      <Tabs tabs={tabs} active={active} base={preview ? `#/d/${deal.slug}/view/lender` : `#/d/${deal.slug}`} />
      {active === 'messages' && <Messages deal={deal} me={me} role="lender" preview={preview} />}
      {active === 'photos' && <UnitGallery deal={deal} me={me} role="lender" preview={preview} />}
      {active === 'city-records' && (
        <Suspense fallback={<Empty>Loading…</Empty>}>
          <CityRecords deal={deal} role="lender" preview={preview} />
        </Suspense>
      )}
      {active === 'documents' && (
        <Card>
          <CardTitle>Supporting documents</CardTitle>
          {rows === null ? <Empty>Loading…</Empty> : docs.length ? <FileList rows={docs} canShare={false} owner={false} /> : <Empty>No supporting documents shared yet.</Empty>}
        </Card>
      )}
      {active === 'overview' && (
        <>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
            <>
              <section className="rounded-3xl bg-ink p-6 text-white">
                <h2 className="font-display text-3xl font-semibold">{plan.name.replace(/^[A-Z]\s*:\s*/, '')}</h2>
                {effectiveGuide ? (
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-white/60">Estimated value</p>
                      <p className="font-display text-4xl font-semibold">
                        <OverlayTrigger lines={effectiveGuide.refi.estimatedValueOverlay} className="text-white">
                          {money(effectiveGuide.refi.estimatedValue)}
                        </OverlayTrigger>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-white/60">Loan at {effectiveGuide.refi.ltvShownPct}%</p>
                      <p className="font-display text-4xl font-semibold">
                        <OverlayTrigger lines={effectiveGuide.refi.loanOverlay} className="text-white">
                          {money(effectiveGuide.refi.loan)}
                        </OverlayTrigger>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-white/60">Left for you</p>
                      <p className="font-display text-3xl font-semibold">
                        <OverlayTrigger lines={effectiveGuide.refi.leftForYouOverlay} className="text-white">
                          {money(effectiveGuide.refi.leftForYou)}
                        </OverlayTrigger>
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 max-w-3xl text-white/80">{plain(plan.structure, e).glance}</p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-white/60">{e.keepMonthly < 0 ? 'Short each month' : 'Left over each month after every bill'}</p>
                        <p className="font-display text-4xl font-semibold">{money(e.keepMonthly < 0 ? -e.keepMonthly : e.keepMonthly)}</p>
                      </div>
                      <div><p className="text-xs text-white/60">Rent covers the payment</p><p className="font-display text-4xl font-semibold">{times(e.dscr)}</p></div>
                      <div><p className="text-xs text-white/60">Bank loan at refinance</p><p className="font-display text-4xl font-semibold">{money(o.refiLoan)}</p></div>
                    </div>
                    {val && (
                      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/90">
                        <OverlayTrigger lines={val.incomeOverlay} className="font-medium text-white">{val.incomeLine}</OverlayTrigger>
                        {val.compsLine && <OverlayTrigger lines={val.compsOverlay} className="text-white/75">{val.compsLine}</OverlayTrigger>}
                      </div>
                    )}
                  </>
                )}
              </section>

              <Cover rows={photos} />

              <Card>
                <CardTitle>The numbers</CardTitle>
                {effectiveGuide ? (
                  <UnitsRentedGuide guide={effectiveGuide} />
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Units" value={10} />
                      <Stat label="Rent per unit" value={`${money(o.b.rent)}/mo`} />
                      <Stat label="Yearly profit before payments" value={money(o.noi)} />
                      <Stat label="Monthly payment" value={money(debtOf(e))} />
                      <Stat label="Estimated value by income" value={money(val?.income ?? o.b.value)} overlay={val?.incomeOverlay} />
                      <Stat label="Repair budget" value={money(o.b.rehab)} />
                      <Stat label="Total cost" value={money(e.allIn)} overlay={o.b.value ? [`${Math.round((e.allIn / o.b.value) * 100)}% of estimated value`] : []} />
                      <Stat label="Rented units to break even" value={breakEvenCount(e)} />
                    </dl>
                    {guideCostSummary && <CostSummary summary={guideCostSummary} className="mt-5" />}
                    {steps && (
                      <ol className="mt-5 space-y-3 border-t border-line pt-4">
                        {steps.map((step, idx) => (
                          <li key={step.num || idx} className="flex gap-3">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{idx + 1}</span>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="text-sm font-semibold text-ink">{step.title}</div>
                              {step.pills && (
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {step.pills.map((pill, pIdx) => (
                                    <OverlayTrigger key={pIdx} lines={pill.overlay} className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-medium text-ink">
                                      {pill.label}
                                    </OverlayTrigger>
                                  ))}
                                </div>
                              )}
                              {step.lines?.map((line, lIdx) => (
                                <div key={lIdx} className={line.big ? `font-display text-xl font-semibold ${line.tone === 'pass' ? 'text-good' : line.tone === 'fail' ? 'text-red-700' : ''}` : 'flex flex-wrap justify-between gap-2 text-sm'}>
                                  {line.big ? (
                                    <OverlayTrigger lines={line.overlay}>{line.label}</OverlayTrigger>
                                  ) : line.value ? (
                                    <>
                                      <span className="text-ink-soft">{line.label}</span>
                                      <OverlayTrigger lines={line.overlay} className="font-semibold text-ink">{line.value}</OverlayTrigger>
                                    </>
                                  ) : (
                                    <OverlayTrigger lines={line.overlay}>{line.label}</OverlayTrigger>
                                  )}
                                </div>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
              </Card>
            </>
          )}
          <LenderTerms deal={deal} me={me} preview={preview} />
        </>
      )}
    </div>
  );
}
