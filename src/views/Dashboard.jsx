import { useState } from 'react';
import { evaluate, money } from '../lib/dealmath.js';
import { useDealModel } from '../lib/useDealModel.js';
import { Card, CardTitle, Empty, Button } from '../components/Shell.jsx';
import { useUploads, FileList } from '../components/Files.jsx';
import { photosOf } from '../components/Photos.jsx';
import { WorkBoard } from '../components/DealWorkspace.jsx';
import { InboxSummary } from '../components/Messages.jsx';
import { seenBy } from '../lib/visibility.js';
import Activity from '../components/Activity.jsx';
import Switches, { SendWhatIf } from '../components/Switches.jsx';
import { SellerPulse } from '../components/Pulse.jsx';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function Tile({ label, children, sub, strong }) {
  return (
    <div className={`rounded-2xl p-3 ${strong ? 'bg-ink text-white' : 'bg-paper'}`}>
      <dt className={`text-xs ${strong ? 'text-warm' : 'text-ink-soft'}`}>{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold leading-tight">{children}</dd>
      {sub && <p className={`mt-0.5 text-xs ${strong ? 'text-white/70' : 'text-ink-soft'}`}>{sub}</p>}
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

function PhotoTile({ photos, href }) {
  const [first, ...rest] = photos;
  return (
    <Card className="!p-3">
      {!first ? <Empty>Photos will show here once they’re uploaded.</Empty> : (
        <>
          <a href={href} className="block overflow-hidden rounded-2xl"><img src={first.url} alt={first.note || 'The building'} className="h-44 w-full object-cover transition hover:scale-[1.02]" /></a>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {rest.slice(0, 4).map((p) => <a key={p.id} href={href}><img src={p.url} alt={p.note || 'Property photo'} className="h-14 w-full rounded-lg object-cover" /></a>)}
          </div>
          <a href={href} className="mt-2 inline-block text-sm underline">See all {photos.length} photos</a>
        </>
      )}
    </Card>
  );
}

// Overview for the owner and (with fewer powers) the realtor.
export default function Dashboard({ deal, me, role = 'owner', preview }) {
  const owner = role === 'owner' && !preview;
  const realtor = role === 'realtor';
  const root = preview ? `#/d/${deal.slug}/view/${role}` : `#/d/${deal.slug}`;
  const [rows] = useUploads(deal);
  const model = useDealModel(deal, { owner, onlyShared: role === 'owner' ? undefined : role });
  const { offers, base, setBase } = model;
  const [filePreview, setFilePreview] = useState(null);
  const visible = preview ? seenBy(role, rows) : rows || [];
  const photos = photosOf(visible);
  const evals = (offers || []).map((x) => ({ x, e: evaluate(x.structure, x.inputs, base) }));
  const best = evals.reduce((a, b) => (!a || b.e.keepMonthly > a.e.keepMonthly ? b : a), null);
  const o = evaluate('cash', {}, base).operating;
  const ready = offers !== null;

  return (
    <div className="space-y-5">
      {model.error && <p role="alert" className="text-sm text-red-700">{model.error}</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card>
            {realtor ? <CardTitle>Deal at a glance</CardTitle> : <CardTitle aside={<a className="text-sm underline" href={`${root}/offers`}>Compare the offers</a>}>Deal at a glance</CardTitle>}
            {realtor ? (
              // The realtor sees building facts only: no price, value, costs or returns.
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Tile label="Units">{o.b.units}</Tile>
                <Tile label="Status">{cap(deal.status)}</Tile>
              </dl>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {OFFER_TILES.map(([f, l]) => <CurrentOffer key={f} field={f} label={l} base={base} setBase={setBase} owner={owner} />)}
                  <Tile label="Best cash flow" strong>{ready ? (best ? `${money(best.e.keepMonthly)}/mo` : 'No offers yet') : '…'}</Tile>
                  <Tile label="Monthly rent / unit">{money(o.b.rent)}</Tile>
                  <Tile label="Status">{cap(deal.status)}</Tile>
                  <Tile label="Units">{o.b.units}</Tile>
                  <Tile label="Yearly profit before payments">{money(o.noi)}</Tile>
                  <Tile label="Value after repairs">{money(o.b.value)}</Tile>
                  <Tile label="Repair budget">{money(o.b.rehab)}</Tile>
                </dl>
                <div className="mt-4"><Switches base={base} setBase={setBase} owner={owner} /></div>
                {!owner && <div className="mt-3"><SendWhatIf deal={deal} me={me} role={role} preview={preview} model={model} /></div>}
              </>
            )}
            {owner && model.saved && <p className="mt-2 text-xs text-ink-soft">{model.saved}</p>}
          </Card>
          <WorkBoard deal={deal} me={me} role={role} preview={preview} />
        </div>
        <aside className="space-y-5">
          <PhotoTile photos={photos} href={`${root}/photos`} />
          <SellerPulse deal={deal} />
          <InboxSummary deal={deal} me={me} role={role} preview={preview} />
        </aside>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Recent files</CardTitle>
          <FileList rows={visible.slice(0, 5)} />
          <div className="mt-2 flex flex-wrap gap-2">{visible.slice(0, 5).filter(x => x.url && (x.kind === 'photo' || x.mime === 'application/pdf')).map(x => <Button key={x.id} kind="secondary" onClick={() => setFilePreview(x)}>Preview {x.file_name}</Button>)}</div>
          {filePreview && <div className="mt-4 rounded-xl border border-line p-3"><div className="mb-2 flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">{filePreview.file_name}</p><Button kind="secondary" onClick={() => setFilePreview(null)}>Close preview</Button></div>{filePreview.kind === 'photo' ? <img src={filePreview.url} alt={filePreview.note || filePreview.file_name} className="max-h-80 w-full object-contain" /> : <iframe title={`Preview ${filePreview.file_name}`} src={filePreview.url} className="h-96 w-full" />}</div>}
          <a className="mt-3 inline-block text-sm underline" href={`${root}/files`}>All files and uploads</a>
        </Card>
        <div className="max-h-[520px] overflow-y-auto rounded-3xl"><Activity deal={deal} title="Recent activity" /></div>
      </div>
    </div>
  );
}
