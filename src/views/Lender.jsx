import { useMemo, useState } from 'react';
import { evaluate, money } from '../lib/dealmath.js';
import { plain } from '../lib/plain.js';
import { breakEvenCount } from '../lib/occupancy.js';
import { useDealModel } from '../lib/useDealModel.js';
import { useUploads } from '../components/Files.jsx';
import { Hero, photosOf } from '../components/Photos.jsx';
import { Card, CardTitle, Empty, Tabs, Button } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import { OptionTable, letterOf, titleOf } from './Offers.jsx';
import LenderTerms from './LenderTerms.jsx';

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

// The lender's page: one plan, stated plainly, with the few switches a lender would test.
export default function Lender({ deal, me, preview, tab }) {
  const tabs = [['overview', 'The plan'], ['messages', 'Messages']];
  const active = tabs.find(([k]) => k === tab)?.[0] || 'overview';
  const [rows] = useUploads(deal);
  const photos = photosOf(preview ? seenBy('lender', rows) : rows || []);
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

  const plan = useMemo(() => {
    if (!offers?.length) return null;
    const chosen = offers.find((x) => x.id === base.planOffer);
    if (chosen) return chosen;
    return offers.reduce((a, x) => (!a || evaluate(x.structure, x.inputs, base).keepMonthly > evaluate(a.structure, a.inputs, base).keepMonthly ? x : a), null);
  }, [offers, base]);

  const e = plan && evaluate(plan.structure, plan.inputs, b);
  const o = e?.operating;
  // The low end of everything a lender can switch here: still the answer we stand behind.
  const floor = useMemo(() => {
    if (!plan) return null;
    let worst = null;
    for (const r of RENTS) for (const s of [0, 1, 2]) for (const u of [9, 10]) {
      const x = evaluate(plan.structure, plan.inputs, { ...base, units: u, strUnits: s, rent: r });
      if (!worst || x.keepMonthly < worst.e.keepMonthly) worst = { e: x, r, s, u };
    }
    return worst;
  }, [plan, base]);

  const randomize = () => {
    const r = pick(RENTS), s = pick([0, 1, 2]), u = pick([9, 10]);
    setRent(r); setStr(s); setUnits(u);
    const x = evaluate(plan.structure, plan.inputs, { ...base, units: u, strUnits: s, rent: r });
    setLastRandom(`${money(r)} rent, ${s ? `${s} Airbnb unit${s > 1 ? 's' : ''}` : 'no Airbnb'}, ${u} units: ${money(x.keepMonthly)}/mo left after the payment, rent covers it ${times(x.dscr)}.`);
  };

  return (
    <div className="space-y-5">
      <Tabs tabs={tabs} active={active} base={preview ? `#/d/${deal.slug}/view/lender` : `#/d/${deal.slug}`} />
      {active === 'messages' && <Messages deal={deal} me={me} role="lender" preview={preview} />}
      {active === 'overview' && (
        <>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {offers === null ? <Empty>Loading…</Empty> : !plan ? <Card><Empty>LaVante will share the plan here.</Empty></Card> : (
            <>
              <section className="rounded-3xl bg-ink p-6 text-white">
                <p className="text-xs uppercase tracking-[0.18em] text-warm">The plan</p>
                <h2 className="mt-1 font-display text-3xl font-semibold">{titleOf(plan)}</h2>
                <p className="mt-2 max-w-3xl text-white/80">{plain(plan.structure, e).glance}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div><p className="text-xs text-white/60">Left each month after the payment</p><p className="font-display text-4xl font-semibold">{money(e.keepMonthly)}</p></div>
                  <div><p className="text-xs text-white/60">Rent covers the payment</p><p className="font-display text-4xl font-semibold">{times(e.dscr)}</p></div>
                  <div><p className="text-xs text-white/60">Bank loan at refinance</p><p className="font-display text-4xl font-semibold">{money(o.refiLoan)}</p></div>
                </div>
                <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-white/15 pt-4">
                  <Segmented label="Units" options={[[9, '9 units'], [10, '10 units']]} value={units} onChange={setUnits} />
                  <Segmented label="Units as Airbnb" options={[[0, 'None'], [1, '1 unit'], [2, '2 units']]} value={str} onChange={setStr} />
                  <label className="text-xs text-white/60">Rent per unit
                    <select value={rent} onChange={(ev) => setRent(+ev.target.value)} className="mt-1 block rounded-full bg-white px-3 py-1 text-sm text-ink">
                      {RENTS.map((r) => <option key={r} value={r}>{money(r)}/mo</option>)}
                    </select>
                  </label>
                  <Button kind="secondary" onClick={randomize}>Randomize</Button>
                </div>
                {lastRandom && <p role="status" className="mt-3 text-sm text-white/80">Random check: {lastRandom}</p>}
                {floor && <p className="mt-3 text-sm text-white/80">Lowest case you can set here ({money(floor.r)} rent, {floor.s ? `${floor.s} Airbnb` : 'no Airbnb'}, {floor.u} units): {money(floor.e.keepMonthly)}/mo left after the payment, rent covers it {times(floor.e.dscr)}.</p>}
              </section>

              {photos.length > 0 && <Hero photos={photos} />}

              <Card>
                <CardTitle>The numbers</CardTitle>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Units" value={o.b.units} sub={str ? `${str} as Airbnb` : 'All long-term rentals'} />
                  <Stat label="Rent per unit" value={`${money(o.b.rent)}/mo`} />
                  <Stat label="Yearly profit before payments" value={money(o.noi)} />
                  <Stat label="Monthly payment" value={money(debtOf(e))} />
                  <Stat label="Value after repairs" value={money(o.b.value)} />
                  <Stat label="Repair budget" value={money(o.b.rehab)} sub={o.extraRepair ? `Includes ${money(o.extraRepair)} for the 10th unit` : undefined} />
                  <Stat label="Total cost" value={money(e.allIn)} sub={o.b.value ? `${Math.round((e.allIn / o.b.value) * 100)}% of value` : undefined} />
                  <Stat label="Rented units to break even" value={breakEvenCount(e)} />
                </dl>
                <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">{plain(plan.structure, e).lines.map((t, i) => <li key={i}>{t}</li>)}</ol>
              </Card>

              {offers.length > 1 && (
                <section>
                  <h2 className="mb-3 font-display text-2xl font-semibold">Every option we looked at</h2>
                  <p className="mb-3 text-sm text-ink-soft">Option {letterOf(plan, offers.indexOf(plan))} is the plan. The rest are shown for comparison.</p>
                  <OptionTable offers={offers} evals={Object.fromEntries(offers.map((x) => [x.id, evaluate(x.structure, x.inputs, b)]))} />
                </section>
              )}
            </>
          )}
          <LenderTerms deal={deal} me={me} preview={preview} />
        </>
      )}
    </div>
  );
}
