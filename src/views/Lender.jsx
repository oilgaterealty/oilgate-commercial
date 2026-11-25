import { buyerName } from '../lib/people.js';
import { Suspense, lazy, useMemo, useState } from 'react';
import { buildLeadStory, evaluate, money, valueSummary } from '../lib/dealmath.js';
import { plain } from '../lib/plain.js';
import { breakEvenCount } from '../lib/occupancy.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useUploads, FileList } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import CostSummary from '../components/CostSummary.jsx';
import { Card, CardTitle, Empty, Tabs, Button, OverlayTrigger } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import LenderTerms from './LenderTerms.jsx';

const CityRecords = lazy(() => import('./CityRecords.jsx'));

const RENTS = [850, 875, 900, 925, 950, 975, 1000];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const debtOf = (e) => e.operating.cashFlow / 12 - e.keepMonthly;
const times = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}x` : 'No payment');

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl bg-paper p-3">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold leading-tight">{value}</dd>
      {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
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
  const [pickRent, setRent] = useState(null);
  const [lastRandom, setLastRandom] = useState('');

  const baseRent = Math.min(1000, Math.max(850, Math.round((+base.rent || 850) / 25) * 25));
  const rent = pickRent ?? baseRent;
  const b = { ...base, units: 10, rent };

  const plan = offers?.[0] || null;
  const e = plan && evaluate(plan.structure, plan.inputs, b);
  const o = e?.operating;
  const val = o ? valueSummary({ base: b, noi: o.noi, units: 10 }) : null;
  const story = e ? buildLeadStory(plan.structure, e, { base: b }) : null;
  const guide = plan?.seller_summary?.guide || null;
  const guideCostSummary = guide?.cost?.length
    ? { heading: guide.costHeading, headingOverlay: guide.costHeadingOverlay || [], lines: guide.cost }
    : null;
  const steps = guide?.steps?.length ? guide.steps : story?.steps;

  const floor = useMemo(() => {
    if (!plan) return null;
    let worst = null;
    for (const r of RENTS) {
      const x = evaluate(plan.structure, plan.inputs, { ...base, units: 10, rent: r });
      if (!worst || x.keepMonthly < worst.e.keepMonthly) worst = { e: x, r };
    }
    return worst;
  }, [plan, base]);

  const randomize = () => {
    const r = pick(RENTS);
    setRent(r);
    const x = evaluate(plan.structure, plan.inputs, { ...base, units: 10, rent: r });
    setLastRandom(`${money(r)} rent, 10 units: ${money(x.keepMonthly)}/mo left after the payment, rent covers it ${times(x.dscr)}.`);
  };

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
                <p className="text-xs uppercase tracking-[0.18em] text-warm">The plan</p>
                <h2 className="mt-1 font-display text-3xl font-semibold">{plan.name.replace(/^[A-Z]\s*:\s*/, '')}</h2>
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
                <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-white/15 pt-4">
                  <label className="text-xs text-white/60">Rent per unit
                    <select value={rent} onChange={(ev) => setRent(+ev.target.value)} className="mt-1 block rounded-full bg-white px-3 py-1 text-sm text-ink">
                      {RENTS.map((r) => <option key={r} value={r}>{money(r)}/mo</option>)}
                    </select>
                  </label>
                  <Button kind="secondary" onClick={randomize}>Randomize</Button>
                </div>
                {lastRandom && <p role="status" className="mt-3 text-sm text-white/80">Random check: {lastRandom}</p>}
                {floor && <p className="mt-3 text-sm text-white/80">Lowest case ({money(floor.r)} rent, 10 units): {money(floor.e.keepMonthly)}/mo left after payment, {times(floor.e.dscr)} coverage.</p>}
              </section>

              <Cover rows={photos} />

              <Card>
                <CardTitle>The numbers</CardTitle>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Units" value={10} sub="All long-term tenants" />
                  <Stat label="Rent per unit" value={`${money(o.b.rent)}/mo`} />
                  <Stat label="Yearly profit before payments" value={money(o.noi)} />
                  <Stat label="Monthly payment" value={money(debtOf(e))} />
                  <Stat label="Estimated value by income" value={money(val?.income ?? o.b.value)} sub={val?.incomePerUnit ? `${money(val.incomePerUnit)}/unit` : undefined} />
                  <Stat label="Repair budget" value={money(o.b.rehab)} />
                  <Stat label="Total cost" value={money(e.allIn)} sub={o.b.value ? `${Math.round((e.allIn / o.b.value) * 100)}% of estimated value` : undefined} />
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
              </Card>
            </>
          )}
          <LenderTerms deal={deal} me={me} preview={preview} />
        </>
      )}
    </div>
  );
}
