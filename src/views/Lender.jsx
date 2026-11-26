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
import RentValue, { isRentValue } from '../components/RentValue.jsx';
import { Card, CardTitle, Empty, JumpNav, OverlayTrigger, useSectionScroll } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import LenderTerms from './LenderTerms.jsx';
import Offers from './Offers.jsx';

const CityRecords = lazy(() => import('./CityRecords.jsx'));

// Pills never show a month guess: "1st Unit 9 · month 1" reads "1st Unit 9".
const noMonth = (s) => (typeof s === 'string' ? s.replace(/\s*·\s*months?\s+\d+(\s*[–-]\s*\d+)?/gi, '').replace(/\s*\(month \d+ refi\)/gi, '') : s);
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

const SECTIONS = [
  ['overview', 'Overview'],
  ['plan', 'The plan'],
  ['what-if', 'What-if'],
  ['terms', 'Your terms'],
  ['city-records', 'City records'],
  ['documents', 'Documents'],
  ['photos', 'Photos'],
  ['messages', 'Messages'],
];

// The lender's one-page workspace: overview, full plan numbers, local what-ifs, terms, city records, documents, photos, messages.
export default function Lender({ deal, me, preview, tab }) {
  const root = preview ? `#/d/${deal.slug}/view/lender` : `#/d/${deal.slug}`;
  const { activeSection, jumpTo } = useSectionScroll(tab, SECTIONS, { offers: 'what-if' });
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
  const repairBudget = guideCostSummary?.total ?? o?.b?.rehab;

  return (
    <div className="space-y-8 pb-20">
      <JumpNav sections={SECTIONS} active={activeSection} onJump={jumpTo} base={root} preview={preview} />

      <section id="sec-overview" data-section="overview" className="scroll-mt-20 space-y-4">
        <Cover rows={photos} compact />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
          <section className="rounded-3xl bg-ink p-5 text-white">
            <h2 className="font-display text-2xl font-semibold sm:text-3xl">
              <OverlayTrigger lines={effectiveGuide ? [] : [plain(plan.structure, e).glance]} className="text-white">{plan.name.replace(/^[A-Z]\s*:\s*/, '')}</OverlayTrigger>
            </h2>
            {effectiveGuide ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-white/60">Value</dt>
                  <dd className="font-display text-2xl font-semibold sm:text-3xl">
                    <OverlayTrigger lines={effectiveGuide.refi.estimatedValueOverlay} className="text-white">
                      {money(effectiveGuide.refi.estimatedValue)}
                    </OverlayTrigger>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/60">Loan at {effectiveGuide.refi.ltvShownPct}%</dt>
                  <dd className="font-display text-2xl font-semibold sm:text-3xl">
                    <OverlayTrigger lines={effectiveGuide.refi.loanOverlay} className="text-white">
                      {money(effectiveGuide.refi.loan)}
                    </OverlayTrigger>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/60">Repair budget</dt>
                  <dd className="font-display text-2xl font-semibold sm:text-3xl">{money(repairBudget)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/60">Seller paid back in full</dt>
                  <dd className="font-display text-2xl font-semibold sm:text-3xl">
                    <OverlayTrigger lines={effectiveGuide.refi.sellerPayoffOverlay} className="text-white">
                      {money(effectiveGuide.refi.sellerTotalPayoff ?? effectiveGuide.refi.sellerPayoff)}
                    </OverlayTrigger>
                  </dd>
                </div>
              </dl>
            ) : (
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-white/60">{e.keepMonthly < 0 ? 'Short each month' : 'Left over each month after every bill'}</dt>
                  <dd className="font-display text-2xl font-semibold">{money(e.keepMonthly < 0 ? -e.keepMonthly : e.keepMonthly)}</dd>
                </div>
                <div><dt className="text-xs text-white/60">Rent covers the payment</dt><dd className="font-display text-2xl font-semibold">{times(e.dscr)}</dd></div>
                <div><dt className="text-xs text-white/60">Bank loan at refinance</dt><dd className="font-display text-2xl font-semibold">{money(o.refiLoan)}</dd></div>
                <div><dt className="text-xs text-white/60">Repair budget</dt><dd className="font-display text-2xl font-semibold">{money(repairBudget)}</dd></div>
              </dl>
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a href={`${root}/plan`} onClick={(ev) => { ev.preventDefault(); jumpTo('plan', root); }} className="inline-flex min-h-[40px] items-center rounded-full bg-white px-4 py-1.5 font-medium text-ink">Open the plan</a>
              <a href={`${root}/terms`} onClick={(ev) => { ev.preventDefault(); jumpTo('terms', root); }} className="inline-flex min-h-[40px] items-center rounded-full border border-white/30 px-4 py-1.5 font-medium text-white">Your terms</a>
            </div>
          </section>
        )}
      </section>

      <section id="sec-plan" data-section="plan" className="scroll-mt-20 space-y-4">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>{buyerName()} will share the plan here.</Empty></Card> : (
          <>
            <Card>
              <CardTitle>The numbers</CardTitle>
              {effectiveGuide ? (
                <UnitsRentedGuide guide={effectiveGuide} shared />
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Units" value={10} />
                    <Stat label="Rent per unit" value={`${money(o.b.rent)}/mo`} />
                    <Stat label="Yearly profit before payments" value={money(o.noi)} />
                    <Stat label="Monthly payment" value={money(debtOf(e))} />
                    <Stat label="Value" value={money(val?.income ?? o.b.value)} overlay={val?.incomeOverlay} />
                    <Stat label="Repair budget" value={money(o.b.rehab)} />
                    <Stat label="Total cost" value={money(e.allIn)} overlay={o.b.value ? [`${Math.round((e.allIn / o.b.value) * 100)}% of value`] : []} />
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
                                    {noMonth(pill.label)}
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

            {isRentValue(effectiveGuide?.rentValue) && <RentValue data={effectiveGuide.rentValue} showMarket />}
          </>
        )}
      </section>

      <section id="sec-what-if" data-section="what-if" className="scroll-mt-20">
        <h2 className="mb-3 font-display text-2xl font-semibold">What-if</h2>
        <Offers deal={deal} canSave={false} onlyShared={preview ? 'lender' : undefined} me={me} role="lender" preview={preview} leadGuide={effectiveGuide} />
      </section>

      <section id="sec-terms" data-section="terms" className="scroll-mt-20">
        <LenderTerms deal={deal} me={me} preview={preview} />
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
