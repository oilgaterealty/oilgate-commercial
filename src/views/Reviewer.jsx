import { buyerName } from '../lib/people.js';
import Comps from './Comps.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { evaluate, operating, money, valueSummary } from '../lib/dealmath.js';
import { plain } from '../lib/plain.js';
import { useDealModel } from '../lib/useDealModel.js';
import { Button, Card, CardTitle, Empty, InfoTip, OverlayTrigger, Tabs } from '../components/Shell.jsx';
import { DictatedField } from '../components/Dictation.jsx';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import { seenBy } from '../lib/visibility.js';
import { isUnitsGuide } from '../components/UnitsRentedGuide.jsx';
import RentValue, { isRentValue } from '../components/RentValue.jsx';

const OPINIONS = ['Looks good', 'Needs changes', 'Pass'];

function QuickOpinion({ deal, me, role, preview }) {
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const send = async (e) => {
    e.preventDefault();
    if (preview || busy || (!pick && !note.trim())) return;
    setBusy(true);
    setStatus('');
    const parts = [pick ? `Quick opinion: ${pick}` : null, note.trim() || null].filter(Boolean);
    try {
      const error = await sendToOwner(deal, me, role, parts.join('\n'), 'Quick opinion');
      setStatus(error ? 'Could not send. Try again.' : `Sent to ${buyerName()}.`);
      if (!error) { setPick(''); setNote(''); }
    } catch {
      setStatus('Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>Quick opinion</CardTitle>
      <form onSubmit={send} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {OPINIONS.map((label) => (
            <button key={label} type="button" aria-pressed={pick === label} onClick={() => setPick((cur) => (cur === label ? '' : label))}
              className={`min-h-[40px] rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${pick === label ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        <DictatedField aria-label="Quick note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note…" />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={preview || busy || (!pick && !note.trim())}>{busy ? 'Sending…' : 'Send'}</Button>
          {status && <span role="status" className="text-sm text-ink-soft">{status}</span>}
        </div>
      </form>
    </Card>
  );
}

// Reviewer and viewer. Each sees only what the owner shared with that role.
export default function Reviewer({ deal, me, role, preview, tab }) {
  const [rows, load] = useUploads(deal);
  const [leadGuide, setLeadGuide] = useState(null);
  const viewer = role !== 'reviewer';
  const { offers, base } = useDealModel(deal, { owner: false, onlyShared: preview ? role : undefined });

  useEffect(() => {
    if (viewer) return;
    let alive = true;
    supabase.rpc('commercial_get_lead_guide', { p_deal: deal.id }).then(({ data }) => {
      if (!alive) return;
      const raw = Array.isArray(data) ? data[0] : data;
      const g = raw?.guide || raw || null;
      setLeadGuide(isUnitsGuide(g) ? g : null);
    });
    return () => { alive = false; };
  }, [deal.id, viewer]);

  const shared = preview ? seenBy(role, rows) : rows || [];
  const photos = photosOf(shared);
  const docs = shared.filter((r) => r.kind === 'document' && r.uploaded_by_email !== me.email);
  const mine = (rows || []).filter((r) => r.uploaded_by_email === me.email);

  const tabs = viewer
    ? [['overview', 'Overview'], ['photos', 'Photos']]
    : [
        ['overview', 'Overview'],
        ['photos', 'Photos'],
        ['comps', 'Comps'],
        ...(isRentValue(leadGuide?.rentValue) ? [['rent-value', 'Rent & value']] : []),
        ['documents', 'Documents'],
        ['messages', 'Messages'],
      ];
  const active = tabs.find(([k]) => k === tab)?.[0] || 'overview';

  const b = { ...base, units: 10 };
  const o = operating(b);
  const val = valueSummary({ base: b, noi: o.noi, units: 10 });
  const leadOffer = offers?.[0] || null;
  const leadEval = leadOffer ? evaluate(leadOffer.structure, leadOffer.inputs, b) : null;
  const leadPlain = leadOffer && leadEval ? plain(leadOffer.structure, leadEval) : null;
  const refiGuide = leadGuide?.refi || null;
  const shownValue = refiGuide?.estimatedValue ?? val.income ?? o.b.value;
  const shownRepair = leadGuide?.costSummary?.total ?? o.b.rehab;
  const propertySummary = String(deal.seller_content?.summary || '').trim() || '10-unit residential property.';

  return (
    <div className="space-y-4">
      {tabs.length > 1 && <Tabs tabs={tabs} active={active} base={preview ? `#/d/${deal.slug}/view/${role}` : `#/d/${deal.slug}`} />}
      {!viewer && active === 'comps' && <Comps deal={deal} me={me} role={role} preview={preview} />}
      {!viewer && role === 'reviewer' && active === 'rent-value' && isRentValue(leadGuide?.rentValue) && <RentValue data={leadGuide.rentValue} />}
      {active === 'photos' && (
        <UnitGallery deal={deal} me={me} role={viewer ? 'viewer' : role} preview={preview} unitSummaries={viewer ? null : leadGuide?.rentValue?.units} />
      )}
      {!viewer && active === 'documents' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle>Documents</CardTitle>
            {docs.length ? <FileList rows={docs} canShare={false} owner={false} /> : <Empty>Nothing shared with you yet.</Empty>}
          </Card>
          <Card>
            <CardTitle>Send us files</CardTitle>
            <Uploader deal={deal} role={role} me={me} onDone={load} label="Upload files" preview={preview} />
            <div className="mt-4">{mine.length ? <FileList rows={mine} /> : <Empty>Nothing sent yet.</Empty>}</div>
          </Card>
        </div>
      )}
      {active === 'overview' && (
        <>
          <Cover rows={photos} compact />
          {viewer ? (
            <Card>
              <CardTitle>The property</CardTitle>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-ink-soft">Address</dt><dd className="font-semibold">{deal.address || deal.title}</dd></div>
                <div><dt className="text-ink-soft">Units</dt><dd className="font-semibold">10</dd></div>
                <div className="sm:col-span-2"><dt className="text-ink-soft">Summary</dt><dd className="font-medium leading-relaxed">{propertySummary}</dd></div>
              </dl>
            </Card>
          ) : (
            <>
              <Card>
                <CardTitle>The property</CardTitle>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="col-span-2 sm:col-span-2"><dt className="text-ink-soft">Address</dt><dd className="font-semibold">{deal.address || deal.title}</dd></div>
                  <div><dt className="text-ink-soft">Value</dt><dd className="font-display text-xl font-semibold"><OverlayTrigger lines={refiGuide?.estimatedValueOverlay || val.incomeOverlay}>{money(shownValue)}</OverlayTrigger></dd></div>
                  <div><dt className="text-ink-soft">Repair budget</dt><dd className="font-display text-xl font-semibold"><OverlayTrigger lines={leadGuide?.costHeadingOverlay || []}>{money(shownRepair)}</OverlayTrigger></dd></div>
                </dl>
              </Card>

              <Card className="border-2 border-ink">
                <CardTitle aside={leadPlain ? <InfoTip label="How the lead offer works" lines={[...leadPlain.lines, `Worth knowing: ${leadPlain.risk}.`]} /> : null}>
                  {leadOffer ? leadOffer.name.replace(/^[A-Z]\s*:\s*/, '') : 'The lead offer'}
                </CardTitle>
                {offers === null ? <Empty>Loading…</Empty> : !leadOffer ? <Empty>No lead offer shared yet.</Empty> : (
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-paper p-3">
                      <dt className="text-xs text-ink-soft">{leadOffer.structure === 'wrap' ? 'Seller’s note' : 'Seller payoff'}</dt>
                      <dd className="mt-1 font-display text-xl font-semibold">
                        {refiGuide ? refiGuide.sellerPayoffText : leadOffer.structure === 'wrap' ? money(leadEval?.inputs?.note) : leadPlain?.payoff || '—'}
                      </dd>
                    </div>
                    <div className="rounded-2xl bg-paper p-3">
                      <dt className="text-xs text-ink-soft">Monthly payment</dt>
                      <dd className="mt-1 font-display text-xl font-semibold">
                        {leadEval?.sellerMonthly === null ? 'At closing' : `${money(leadEval?.sellerMonthly)}/mo`}
                      </dd>
                    </div>
                    {refiGuide ? (
                      <div className="rounded-2xl bg-paper p-3">
                        <dt className="text-xs text-ink-soft">Left for you</dt>
                        <dd className={`mt-1 font-display text-xl font-semibold ${refiGuide.leftForYou >= 0 ? 'text-good' : 'text-red-700'}`}>
                          {money(refiGuide.leftForYou)}
                        </dd>
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-paper p-3">
                        <dt className="text-xs text-ink-soft">Rent covers payment</dt>
                        <dd className="mt-1 font-display text-xl font-semibold">
                          {Number.isFinite(leadEval?.dscr) ? `${leadEval.dscr.toFixed(2)}x` : 'No payment'}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </Card>

              <QuickOpinion deal={deal} me={me} role={role} preview={preview} />
            </>
          )}
        </>
      )}
      {!viewer && active === 'messages' && <Messages deal={deal} me={me} role={role} preview={preview} />}
    </div>
  );
}
