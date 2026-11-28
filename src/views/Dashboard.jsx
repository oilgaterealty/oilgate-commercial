import { useEffect, useState } from 'react';
import { evaluate, money, valueSummary } from '../lib/dealmath.js';
import { supabase } from '../lib/supabase.js';
import { useDealModel } from '../lib/useDealModel.js';
import { Card, CardTitle } from '../components/Shell.jsx';
import { useUploads } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import { WorkBoard } from '../components/DealWorkspace.jsx';
import { seenBy } from '../lib/visibility.js';
import { SellerPulse } from '../components/Pulse.jsx';

// Owner-only dynamic import so public and seller builds never bundle dealplan or deal_plan data.
const loadPlanLib =
  import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller'
    ? null
    : () => import('../lib/dealplan.js');

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function Tile({ label, children, strong }) {
  return (
    <div className={`rounded-2xl p-3 ${strong ? 'bg-ink text-white' : 'bg-paper'}`}>
      <dt className={`text-xs ${strong ? 'text-warm' : 'text-ink-soft'}`}>{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold leading-tight">{children}</dd>
    </div>
  );
}

// The two offers lead the glance: the seller's number and ours. Owner types them; everyone else reads them.
export const OFFER_TILES = [['askPrice', 'Seller’s offer'], ['ourOffer', 'Our offer']];
function CurrentOffer({ base, setBase, owner, field = 'askPrice', label = 'Seller’s offer' }) {
  const v = base[field];
  if (!owner) return <Tile label={label} strong>{v ? money(+v) : 'Not set yet'}</Tile>;
  return (
    <div className="rounded-2xl bg-ink p-3 text-white">
      <label htmlFor={`offer-${field}`} className="text-xs text-warm">{label}</label>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-display text-xl text-white/60">$</span>
        <input id={`offer-${field}`} type="number" inputMode="decimal" min={0} step={5000} value={v ?? ''} placeholder="Type it" onChange={(e) => setBase({ ...base, [field]: e.target.value === '' ? '' : +e.target.value })}
          className="w-full rounded-lg border border-white/20 bg-white/10 py-1 pl-6 pr-2 font-display text-xl font-semibold text-white outline-none focus:border-warm" />
      </div>
    </div>
  );
}

// Short phone-first overview for the owner.
export default function Dashboard({ deal, me, role = 'owner', preview, onJump }) {
  const owner = role === 'owner' && !preview;
  const root = preview ? `#/d/${deal.slug}/view/${role}` : `#/d/${deal.slug}`;
  const [rows] = useUploads(deal);
  const model = useDealModel(deal, { owner, onlyShared: role === 'owner' ? undefined : role });
  const { offers, base, setBase } = model;
  const [planRepairBudget, setPlanRepairBudget] = useState(0);
  const [planOpex, setPlanOpex] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!owner || !loadPlanLib) {
      setPlanRepairBudget(0);
      setPlanOpex(null);
      return () => { alive = false; };
    }
    (async () => {
      try {
        const lib = await loadPlanLib();
        const plan = await lib.loadDealPlan(supabase, deal.slug);
        if (alive) {
          setPlanRepairBudget(plan ? lib.overallRepairBudget(plan) : 0);
          setPlanOpex(plan?.opex || null);
        }
      } catch {
        if (alive) {
          setPlanRepairBudget(0);
          setPlanOpex(null);
        }
      }
    })();
    return () => { alive = false; };
  }, [deal.slug, owner]);
  const visible = preview ? seenBy(role, rows) : rows || [];
  const photos = photosOf(visible);
  const effectiveBase = {
    ...base,
    ...(planRepairBudget > 0 ? { rehab: planRepairBudget } : {}),
    ...(planOpex && !base?.opex ? { opex: planOpex } : {}),
  };
  const evals = (offers || []).map((x) => ({ x, e: evaluate(x.structure, x.inputs, effectiveBase) }));
  const best = evals.reduce((a, b) => (!a || b.e.keepMonthly > a.e.keepMonthly ? b : a), null);
  const o = evaluate('cash', {}, effectiveBase).operating;
  const shownValue = Boolean(effectiveBase?.opex)
    ? (valueSummary({ base: { ...o.b, ...effectiveBase }, noi: o.noi, units: o.b.units }).income ?? o.b.value)
    : o.b.value;
  const ready = offers !== null;

  return (
    <div className="space-y-4">
      {model.error && <p role="alert" className="text-sm text-red-700">{model.error}</p>}
      {photos.length > 0 && (
        <div className="space-y-1.5">
          <Cover rows={photos} compact />
          <a href={`${root}/photos`} onClick={onJump ? (e) => { e.preventDefault(); onJump('photos', root); } : undefined} className="inline-flex min-h-[40px] items-center text-sm underline">See all {photos.length} photos</a>
        </div>
      )}
      <Card>
        <CardTitle aside={<a className="inline-flex min-h-[40px] items-center text-sm underline" href={`${root}/offers`} onClick={onJump ? (e) => { e.preventDefault(); onJump('offers', root); } : undefined}>Compare the offers</a>}>Deal at a glance</CardTitle>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {OFFER_TILES.map(([f, l]) => <CurrentOffer key={f} field={f} label={l} base={base} setBase={setBase} owner={owner} />)}
          <Tile label="Best cash flow" strong>{ready ? (best ? `${money(best.e.keepMonthly)}/mo` : 'No offers yet') : '…'}</Tile>
          <Tile label="Value after repairs">{money(shownValue)}</Tile>
          <Tile label="Repair budget">{money(o.b.rehab)}</Tile>
          <Tile label="Units">{o.b.units}</Tile>
          <Tile label="Status">{cap(deal.status)}</Tile>
        </dl>
        {owner && model.saved && model.saved !== 'Saved' && <p role="status" className="mt-2 text-sm text-ink">{model.saved}</p>}
      </Card>
      <SellerPulse deal={deal} />
      <WorkBoard deal={deal} me={me} role={role} preview={preview} />
    </div>
  );
}
