import { buyerName } from '../lib/people.js';
import Comps from './Comps.jsx';
import Offers from './Offers.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { evaluate, operating, money, pct, valueSummary } from '../lib/dealmath.js';
import { useDealModel } from '../lib/useDealModel.js';
import { Button, Card, CardTitle, Empty, Field, JumpNav, OverlayTrigger, useSectionScroll } from '../components/Shell.jsx';
import { DictatedField } from '../components/Dictation.jsx';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import PropertyFacts from '../components/PropertyFacts.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import { seenBy } from '../lib/visibility.js';
import { isUnitsGuide } from '../components/UnitsRentedGuide.jsx';
import RentValue, { isRentValue } from '../components/RentValue.jsx';
import { VIEWER_REQUEST_ROLES } from '../lib/requestRoles.js';

const OPINIONS = ['Looks good', 'Needs changes', 'Pass'];
const VIEWER_REQUEST_LABEL = {
  idle: 'Request access',
  sending: 'Sending…',
  sent: 'Request sent',
  denied: 'Not approved',
  error: 'Try again',
};

function ViewerAccessRequest({ deal, preview }) {
  const [requestedRole, setRequestedRole] = useState('lender');
  const [company, setCompany] = useState('');
  const [note, setNote] = useState('');
  const [submitState, setSubmitState] = useState('idle');

  const submit = async (e) => {
    e.preventDefault();
    if (preview || submitState === 'sending' || submitState === 'sent' || submitState === 'denied') return;
    if (!VIEWER_REQUEST_ROLES.some(([k]) => k === requestedRole)) return;
    setSubmitState('sending');
    try {
      const { data, error } = await supabase.rpc('commercial_request_viewer_access', {
        p_deal: deal.id,
        p_requested_role: requestedRole,
        p_company: company.trim().slice(0, 120),
        p_note: note.trim().slice(0, 1000),
      });
      if (error) {
        setSubmitState('error');
      } else if (data === 'pending') {
        setSubmitState('sent');
      } else if (data === 'denied') {
        setSubmitState('denied');
      } else {
        setSubmitState('error');
      }
    } catch {
      setSubmitState('error');
    }
  };

  const locked = submitState === 'sending' || submitState === 'sent' || submitState === 'denied';

  return (
    <Card>
      <CardTitle>Request access</CardTitle>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div role="radiogroup" aria-label="Requested role" className="grid grid-cols-2 gap-2 sm:col-span-2">
          {VIEWER_REQUEST_ROLES.map(([k, label]) => {
            const on = requestedRole === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                onClick={() => {
                  setRequestedRole(k);
                  if (submitState === 'error') setSubmitState('idle');
                }}
                className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <Field
          maxLength={120}
          aria-label="Company"
          placeholder="Company (optional)"
          disabled={locked}
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
            if (submitState === 'error') setSubmitState('idle');
          }}
        />
        <Field
          maxLength={1000}
          aria-label="Note"
          placeholder="Note (optional)"
          disabled={locked}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (submitState === 'error') setSubmitState('idle');
          }}
        />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={preview || locked || !requestedRole}>
            {VIEWER_REQUEST_LABEL[submitState] || 'Request access'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

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

// Reviewer and viewer: one scrollable page per role. Each sees only what the owner shared with that role.
export default function Reviewer({ deal, me, role, preview, tab }) {
  const [rows, load] = useUploads(deal);
  const [leadGuide, setLeadGuide] = useState(null);
  const viewer = role !== 'reviewer';
  const { base } = useDealModel(deal, { owner: false, onlyShared: preview ? role : undefined });

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

  const sections = viewer
    ? [['overview', 'Overview'], ['photos', 'Photos']]
    : [
        ['overview', 'Overview'],
        ['offers', 'The offer'],
        ...(isRentValue(leadGuide?.rentValue) ? [['rent-value', 'Rent & value']] : []),
        ['comps', 'Comps'],
        ['photos', 'Photos'],
        ['documents', 'Documents'],
        ['messages', 'Messages'],
      ];
  const basePath = preview ? `#/d/${deal.slug}/view/${role}` : `#/d/${deal.slug}`;
  const { activeSection, jumpTo } = useSectionScroll(tab, sections);

  const b = { ...base, units: 10 };
  const o = operating(b);
  const val = valueSummary({ base: b, noi: o.noi, units: 10 });
  const refiGuide = leadGuide?.refi || null;
  const shownValue = refiGuide?.estimatedValue ?? val.income ?? o.b.value;
  const shownRepair = leadGuide?.costSummary?.total ?? o.b.rehab;

  return (
    <div className={viewer ? 'space-y-6' : 'space-y-8 pb-20'}>
      {sections.length > 1 && <JumpNav sections={sections} active={activeSection} onJump={jumpTo} base={basePath} preview={preview} />}

      <section id="sec-overview" data-section="overview" className={`scroll-mt-20 ${viewer ? 'space-y-6' : 'space-y-4'}`}>
        <Cover rows={photos} compact={!viewer} />
        {viewer ? (
          <>
            <PropertyFacts slug={deal.slug} />
            <ViewerAccessRequest deal={deal} preview={preview} />
          </>
        ) : (
          <>
            <Card>
              <CardTitle>The property</CardTitle>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <div className="col-span-2 sm:col-span-2"><dt className="text-ink-soft">Address</dt><dd className="font-semibold">{deal.address || deal.title}</dd></div>
                <div><dt className="text-ink-soft">Units</dt><dd className="font-semibold">10</dd></div>
                {base.askPrice ? <div><dt className="text-ink-soft">Current offer (seller’s number)</dt><dd className="font-semibold">{money(+base.askPrice)}</dd></div> : null}
                <div><dt className="text-ink-soft">Rent</dt><dd className="font-semibold">{money(o.b.rent)}/unit/mo</dd></div>
                <div><dt className="text-ink-soft">Yearly profit before payments</dt><dd className="font-semibold">{money(o.noi)}/yr</dd></div>
                <div><dt className="text-ink-soft">Value after repairs</dt><dd className="font-semibold"><OverlayTrigger lines={refiGuide?.estimatedValueOverlay || val.incomeOverlay}>{money(shownValue)}</OverlayTrigger></dd></div>
                <div><dt className="text-ink-soft">Yearly return on value</dt><dd className="font-semibold">{pct(o.capRate, 1)}</dd></div>
                <div><dt className="text-ink-soft">Repair budget</dt><dd className="font-semibold"><OverlayTrigger lines={leadGuide?.costHeadingOverlay || []}>{money(shownRepair)}</OverlayTrigger></dd></div>
                <div><dt className="text-ink-soft">Refinance</dt><dd className="font-semibold">{o.b.refiRate}%, {o.b.refiYears} yrs</dd></div>
              </dl>
            </Card>

            <QuickOpinion deal={deal} me={me} role={role} preview={preview} />
          </>
        )}
      </section>

      {!viewer && (
        <section id="sec-offers" data-section="offers" className="scroll-mt-20">
          <h2 className="mb-3 font-display text-2xl font-semibold">The lead offer</h2>
          <Offers deal={deal} canSave={false} onlyShared={preview ? role : undefined} me={me} role={role} preview={preview} leadGuide={leadGuide} />
        </section>
      )}

      {!viewer && role === 'reviewer' && isRentValue(leadGuide?.rentValue) && (
        <section id="sec-rent-value" data-section="rent-value" className="scroll-mt-20">
          <RentValue data={leadGuide.rentValue} />
        </section>
      )}

      {!viewer && (
        <section id="sec-comps" data-section="comps" className="scroll-mt-20">
          <Comps deal={deal} me={me} role={role} preview={preview} />
        </section>
      )}

      <section id="sec-photos" data-section="photos" className="scroll-mt-20">
        <UnitGallery deal={deal} me={me} role={viewer ? 'viewer' : role} preview={preview} unitSummaries={viewer ? null : leadGuide?.rentValue?.units} />
      </section>

      {!viewer && (
        <section id="sec-documents" data-section="documents" className="scroll-mt-20 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle>Documents</CardTitle>
            {docs.length ? <FileList rows={docs} canShare={false} owner={false} /> : <Empty>Nothing shared with you yet.</Empty>}
          </Card>
          <Card>
            <CardTitle>Send us files</CardTitle>
            <Uploader deal={deal} role={role} me={me} onDone={load} label="Upload files" preview={preview} />
            <div className="mt-4">{mine.length ? <FileList rows={mine} /> : <Empty>Nothing sent yet.</Empty>}</div>
          </Card>
        </section>
      )}

      {!viewer && (
        <section id="sec-messages" data-section="messages" className="scroll-mt-20">
          <Messages deal={deal} me={me} role={role} preview={preview} />
        </section>
      )}
    </div>
  );
}
