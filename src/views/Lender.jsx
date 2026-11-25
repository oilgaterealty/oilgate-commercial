import { buyerName } from '../lib/people.js';
import { Suspense, lazy, useMemo, useState } from 'react';
import { buildLeadStory, evaluate, money, STR_UNIT_CHOICES, strUnitOptions, valueSummary } from '../lib/dealmath.js';
import { plain } from '../lib/plain.js';
import { breakEvenCount } from '../lib/occupancy.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useUploads, FileList } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import { Card, CardTitle, Empty, Tabs, Button, OverlayTrigger } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import LenderTerms from './LenderTerms.jsx';

const CityRecords = lazy(() => import('./CityRecords.jsx'));

const RENTS = [850, 875, 900, 925, 950, 975, 1000];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const debtOf = (e) => e.operating.cashFlow / 12 - e.keepMonthly;
const times = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}x` : 'No payment');

function Segmented({ label, options, value, onChange }) {
  return (
    <div>
      <p className="mb-1 text-xs text-white/60">{label}</p>
      <div className="inline-flex rounded-full bg-white/10 p-0.5" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
            className={`rounded-full px-3 py-1 text-sm transition ${value === v ? 'bg-white text-ink' : 'text-white/80 hover:bg-white/10'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

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
  const [pickUnits, setUnits] = useState(null);
  const [pickStr, setStr] = useState(null);
  const [pickRent, setRent] = useState(null);
  const [lastRandom, setLastRandom] = useState('');

  const baseRent = Math.min(1000, Math.max(850, Math.round((+base.rent || 850) / 25) * 25));
  const units = pickUnits ?? (+base.units >= 10 ? 10 : 9);
  const str = pickStr ?? (Math.round(+base.strUnits) || 0);
  const rent = pickRent ?? baseRent;
  const b = { ...base, units, strUnits: str, rent };

  const plan = offers?.[0] || null;
  const e = plan && evaluate(plan.structure, plan.inputs, b);
  const o = e?.operating;
  const val = o ? valueSummary({ base: b, noi: o.noi, units: o.b.units }) : null;
  const story = e ? buildLeadStory(plan.structure, e, { base: b }) : null;

  const floor = useMemo(() => {
    if (!plan) return null;
    let worst = null;
    for (const r of RENTS) for (const s of STR_UNIT_CHOICES) for (const u of [9, 10]) {
      const x = evaluate(plan.structure, plan.inputs, { ...base, units: u, strUnits: s, rent: r });
      if (!worst || x.keepMonthly < worst.e.keepMonthly) worst = { e: x, r, s, u };
    }
    return worst;
  }, [plan, base]);

  const randomize = () => {
    const r = pick(RENTS), s = pick(STR_UNIT_CHOICES), u = pick([9, 10]);
    setRent(r); setStr(s); setUnits(u);
    const x = evaluate(plan.structure, plan.inputs, { ...base, units: u, strUnits: s, rent: r });
    setLastRandom(`${money(r)} rent, ${s ? `${s} Airbnb unit${s > 1 ? 's' : ''}` : 'no Airbnb'}, ${u} units: ${money(x.keepMonthly)}/mo left after the payment, rent covers it ${times(x.dscr)}.`);
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
                  <Segmented label="Units" options={[[9, '9 units'], [10, '10 units']]} value={units} onChange={setUnits} />
                  <Segmented label="Units as Airbnb" options={strUnitOptions()} value={str} onChange={setStr} />
                  <label className="text-xs text-white/60">Rent per unit
                    <select value={rent} onChange={(ev) => setRent(+ev.target.value)} className="mt-1 block rounded-full bg-white px-3 py-1 text-sm text-ink">
                      {RENTS.map((r) => <option key={r} value={r}>{money(r)}/mo</option>)}
                    </select>
                  </label>
                  <Button kind="secondary" onClick={randomize}>Randomize</Button>
                </div>
                {lastRandom && <p role="status" className="mt-3 text-sm text-white/80">Random check: {lastRandom}</p>}
                {floor && <p className="mt-3 text-sm text-white/80">Lowest case ({money(floor.r)} rent, {floor.s ? `${floor.s} Airbnb` : 'no Airbnb'}, {floor.u} units): {money(floor.e.keepMonthly)}/mo left after payment, {times(floor.e.dscr)} coverage.</p>}
              </section>

              <Cover rows={photos} />

              <Card>
                <CardTitle>The numbers</CardTitle>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Units" value={o.b.units} sub={str ? `${str} as Airbnb` : 'All long-term tenants'} />
                  <Stat label="Rent per unit" value={`${money(o.b.rent)}/mo`} />
                  <Stat label="Yearly profit before payments" value={money(o.noi)} />
                  <Stat label="Monthly payment" value={money(debtOf(e))} />
                  <Stat label="Value by income" value={money(val?.income ?? o.b.value)} sub={val?.incomePerUnit ? `${money(val.incomePerUnit)}/unit` : undefined} />
                  <Stat label="Repair budget" value={money(o.b.rehab)} />
                  <Stat label="Total cost" value={money(e.allIn)} sub={o.b.value ? `${Math.round((e.allIn / o.b.value) * 100)}% of value` : undefined} />
                  <Stat label="Rented units to break even" value={breakEvenCount(e)} />
                </dl>
                {story && (
                  <ol className="mt-5 space-y-3 border-t border-line pt-4">
                    {story.steps.map((step, idx) => (
                      <li key={step.num} className="flex gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{idx + 1}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="text-sm font-semibold text-ink">{step.title}</div>
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
