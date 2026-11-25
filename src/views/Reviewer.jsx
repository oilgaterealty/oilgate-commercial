import { buyerName } from '../lib/people.js';
import Comps from './Comps.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { operating, money, pct } from '../lib/dealmath.js';
import { Card, CardTitle, Empty, Tabs } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import Offers from './Offers.jsx';
import { seenBy } from '../lib/visibility.js';

function Facts({ deal, numbers }) {
  const [base, setBase] = useState(null);
  useEffect(() => {
    if (!numbers) return;
    supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle().then(({ data }) => setBase(data?.base || {}));
  }, [deal.id]);
  const o = base && operating({ units: 9, ...base });
  return (
    <Card>
      <CardTitle>The property</CardTitle>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className="text-ink-soft">Address</dt><dd className="font-medium">{deal.address}</dd></div>
        <div><dt className="text-ink-soft">Units</dt><dd className="font-medium">{o ? o.b.units : 9}</dd></div>
        {o && base.askPrice ? <div><dt className="text-ink-soft">Current offer (seller’s number)</dt><dd className="font-medium">{money(+base.askPrice)}</dd></div> : null}
        {o && <>
          <div><dt className="text-ink-soft">Rent assumed</dt><dd className="font-medium">{money(o.b.rent)}/unit/mo</dd></div>
          <div><dt className="text-ink-soft">Yearly profit before payments</dt><dd className="font-medium">{money(o.noi)}/yr</dd></div>
          <div><dt className="text-ink-soft">Value after repairs</dt><dd className="font-medium">{money(o.b.value)}</dd></div>
          <div><dt className="text-ink-soft">Yearly return on value</dt><dd className="font-medium">{pct(o.capRate, 1)}</dd></div>
          <div><dt className="text-ink-soft">Repair budget</dt><dd className="font-medium">{money(o.b.rehab)}</dd></div>
          <div><dt className="text-ink-soft">Refinance assumed</dt><dd className="font-medium">{o.b.refiRate}%, {o.b.refiYears} yrs</dd></div>
        </>}
      </dl>
      {!numbers && <div className="mt-5 space-y-3 text-sm"><p>A proposed purchase of this nine-unit property. The parties are reviewing the purchase structure and arranging due diligence; final terms remain subject to agreement.</p><ol className="list-decimal space-y-2 pl-5"><li>Walk the property and confirm its condition.</li><li>Verify occupancy, leases, and property records.</li><li>Agree purchase terms, financing, and a closing timeline.</li></ol></div>}
    </Card>
  );
}

// Reviewer and viewer. Each sees only what the owner shared with that role.
export default function Reviewer({ deal, me, role, preview, tab }) {
  const [rows, load] = useUploads(deal);
  const viewer = role === 'viewer' || role === 'guest';
  const shared = preview ? seenBy(role, rows) : rows || [];
  const photos = photosOf(shared);
  const docs = shared.filter((r) => r.kind === 'document' && r.uploaded_by_email !== me.email);
  const mine = (rows || []).filter((r) => r.uploaded_by_email === me.email);
  const tabs = viewer ? [['overview', 'Overview'], ['photos', 'Photos']] : [['overview', 'Overview'], ['photos', 'Photos'], ['comps', 'Comps'], ['messages', 'Messages']];
  const active = tabs.find(([k]) => k === tab)?.[0] || 'overview';
  return (
    <div className="space-y-5">
      {tabs.length > 1 && <Tabs tabs={tabs} active={active} base={preview ? `#/d/${deal.slug}/view/${role}` : `#/d/${deal.slug}`} />}
      {!viewer && active === 'comps' && <Comps deal={deal} me={me} role={role} preview={preview} />}
      {active === 'photos' && <UnitGallery deal={deal} me={me} role={viewer ? 'viewer' : role} preview={preview} />}
      {active === 'overview' && (
        <>
          <Cover rows={photos} />
          <Facts deal={deal} numbers={!viewer} />
          {!viewer && (
            <section>
              <h2 className="mb-3 font-display text-2xl font-semibold">The offers</h2>
              <Offers deal={deal} canSave={false} onlyShared={preview ? role : undefined} me={me} role={role} preview={preview} />
            </section>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle>Documents</CardTitle>
              {/* Read only: no sharing, moving, reordering or deleting controls for reviewer or viewer. */}
              {viewer ? <Empty>Ask {buyerName()} for purchase details.</Empty> : docs.length ? <FileList rows={docs} canShare={false} owner={false} /> : <Empty>Nothing shared with you yet.</Empty>}
            </Card>
            {!viewer && (
              <Card>
                <CardTitle>Send us files</CardTitle>
                <Uploader deal={deal} role={role} me={me} onDone={load} label="Upload files" preview={preview} />
                <div className="mt-4">{mine.length ? <FileList rows={mine} /> : <Empty>Nothing sent yet.</Empty>}</div>
              </Card>
            )}
          </div>
        </>
      )}
      {active === 'messages' && <Messages deal={deal} me={me} role={role} preview={preview} />}
    </div>
  );
}
