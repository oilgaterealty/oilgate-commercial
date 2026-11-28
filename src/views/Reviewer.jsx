import { buyerName } from '../lib/people.js';
import Comps from './Comps.jsx';
import Offers from './Offers.jsx';
import { Suspense, lazy, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { evaluate, operating, money, pct, valueSummary } from '../lib/dealmath.js';
import { useDealModel } from '../lib/useDealModel.js';
import { SITE_KIND, canAccessCityRecords } from '../lib/site.js';
import { Button, Card, CardTitle, Empty, Field, JumpNav, OverlayTrigger, useSectionScroll } from '../components/Shell.jsx';
import { DictatedField } from '../components/Dictation.jsx';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { Cover, useDealGallery } from '../components/Photos.jsx';
import { InPagePanel, OverviewActionButtons } from '../components/OverlaySheet.jsx';
import { useSheetBadges } from '../lib/sheetBadges.js';
import PropertyFacts from '../components/PropertyFacts.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import { seenBy } from '../lib/visibility.js';
import { isUnitsGuide } from '../components/UnitsRentedGuide.jsx';
import RentValue, { isRentValue } from '../components/RentValue.jsx';
import { VIEWER_REQUEST_ROLES } from '../lib/requestRoles.js';

const CityRecords = lazy(() => import('./CityRecords.jsx'));

const OPINIONS = ['Looks good', 'Needs changes', 'Pass'];
const VIEWER_REQUEST_LABEL = {
  idle: 'Request access',
  sending: 'Sending…',
  sent: 'Request sent',
  denied: 'Not approved',
  error: 'Try again',
};

function ViewerAccessRequest({ deal, me, member, preview }) {
  const initialName = preview ? '' : String(member?.display_name || me?.name || '').trim().slice(0, 120);
  const viewerEmail = preview || !me?.email || me.email === '__preview__' ? '' : String(me.email).trim().toLowerCase();
  const [open, setOpen] = useState(false);
  const [requestedRole, setRequestedRole] = useState('lender');
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState('');
  const [note, setNote] = useState('');
  const [submitState, setSubmitState] = useState('idle');

  const cleanName = name.trim().slice(0, 120);
  const locked = submitState === 'sending' || submitState === 'sent' || submitState === 'denied';

  const submit = async (e) => {
    e.preventDefault();
    if (preview || locked || !cleanName || !viewerEmail) return;
    if (!VIEWER_REQUEST_ROLES.some(([k]) => k === requestedRole)) return;
    setSubmitState('sending');
    try {
      const payload = {
        p_deal: deal.id,
        p_requested_role: requestedRole,
        p_name: cleanName,
        p_note: note.trim().slice(0, 1000),
        ...(requestedRole === 'lender' ? { p_company: company.trim().slice(0, 120) } : {}),
      };
      const { data, error } = await supabase.rpc('commercial_request_viewer_access', payload);
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

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Request access</h2>
        <Button
          type="button"
          kind={open ? 'secondary' : 'primary'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : 'Request access'}
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
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
                    if (k !== 'lender') setCompany('');
                    if (submitState === 'error') setSubmitState('idle');
                  }}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="grid gap-1 text-xs font-medium text-ink-soft">
            Name
            <Field
              required
              maxLength={120}
              aria-label="Name"
              placeholder="Name"
              disabled={locked}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (submitState === 'error') setSubmitState('idle');
              }}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-ink-soft">
            Email
            <Field
              type="email"
              required
              readOnly
              aria-label="Email"
              placeholder="Email"
              value={viewerEmail}
              className="bg-warm-soft/40 text-ink-soft"
            />
          </label>
          {requestedRole === 'lender' && (
            <label className="grid gap-1 text-xs font-medium text-ink-soft">
              Company
              <Field
                maxLength={120}
                aria-label="Company"
                placeholder="Company"
                disabled={locked}
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  if (submitState === 'error') setSubmitState('idle');
                }}
              />
            </label>
          )}
          <label className={`grid gap-1 text-xs font-medium text-ink-soft ${requestedRole === 'lender' ? '' : 'sm:col-span-2'}`}>
            Note
            <Field
              maxLength={1000}
              aria-label="Note"
              placeholder="Note"
              disabled={locked}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (submitState === 'error') setSubmitState('idle');
              }}
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={preview || locked || !requestedRole || !cleanName}>
              {VIEWER_REQUEST_LABEL[submitState] || 'Request access'}
            </Button>
          </div>
        </form>
      )}
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

const REVIEWER_PANELS = {
  photos: 'photos',
  documents: 'documents',
  files: 'documents',
  messages: 'messages',
  'city-records': 'city-records',
};
const PANEL_TITLES = {
  photos: 'Photos by unit',
  documents: 'Documents',
  messages: 'Messages',
  'city-records': 'City records',
};

// Reviewer (3 tabs: Overview, The offer, Comps) and Viewer (1 view: Overview).
export default function Reviewer({ deal, me, member, role, preview, tab }) {
  const [rows, load] = useUploads(deal);
  const [leadGuide, setLeadGuide] = useState(null);
  const viewer = role !== 'reviewer';
  const [panel, setPanel] = useState(() => (tab === 'photos' ? 'photos' : (!viewer ? (REVIEWER_PANELS[tab] || null) : null)));
  const [rentValueOpen, setRentValueOpen] = useState(() => tab === 'rent-value');
  const model = useDealModel(deal, { owner: false, onlyShared: preview ? role : undefined });
  const { base } = model;
  const activeGuide = model.liveGuide || leadGuide;

  const gallery = useDealGallery(deal, viewer ? 'viewer' : role, preview, { externalRows: rows });

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
  const docs = shared.filter((r) => r.kind === 'document' && r.uploaded_by_email !== me.email);
  const mine = (rows || []).filter((r) => r.uploaded_by_email === me.email);
  const { docBadge, msgBadge, markDocsSeen, markMsgsSeen } = useSheetBadges({
    deal,
    me,
    role,
    preview,
    docs: viewer ? [] : [...docs, ...mine],
  });

  useEffect(() => {
    if (tab === 'photos') setPanel('photos');
    else if (!viewer && REVIEWER_PANELS[tab]) {
      const next = REVIEWER_PANELS[tab];
      setPanel(next);
      if (next === 'documents') markDocsSeen();
      if (next === 'messages') markMsgsSeen();
    } else {
      setPanel(null);
    }
    if (tab === 'rent-value') setRentValueOpen(true);
  }, [tab, viewer]);

  const sections = viewer
    ? [['overview', 'Overview']]
    : [
        ['overview', 'Overview'],
        ['offers', 'The offer'],
        ['comps', 'Comps'],
      ];
  const basePath = preview ? `#/d/${deal.slug}/view/${role}` : `#/d/${deal.slug}`;
  const { activeSection, jumpTo: scrollJumpTo } = useSectionScroll(tab, sections, {
    'rent-value': 'offers',
    ...Object.fromEntries(Object.keys(REVIEWER_PANELS).map((k) => [k, 'overview'])),
  });

  const jumpTo = (k, root) => {
    setPanel(null);
    scrollJumpTo(k, root);
  };

  const openPanel = (kind) => {
    const clean = REVIEWER_PANELS[kind] || kind;
    if (clean === 'documents') markDocsSeen();
    if (clean === 'messages') markMsgsSeen();
    setPanel(clean);
    const next = `${basePath}/${clean}`;
    if (typeof window !== 'undefined' && window.location.hash !== next) {
      window.location.hash = next;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const closePanel = () => {
    setPanel(null);
    if (typeof window !== 'undefined' && window.location.hash !== basePath) {
      window.location.hash = basePath;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const b = {
    ...base,
    units: 10,
    ...(activeGuide?.opex && !base?.opex ? { opex: activeGuide.opex } : {}),
    ...(activeGuide?.laundry && !base?.laundry ? { laundry: activeGuide.laundry } : {}),
    ...(activeGuide?.upside && !base?.upside ? { upside: activeGuide.upside } : {}),
  };
  const o = operating(b);
  const val = valueSummary({ base: b, noi: o.noi, units: 10 });
  const refiGuide = activeGuide?.refi || null;
  const shownValue = o.opexCalc ? (val.income || o.b.value) : (refiGuide?.estimatedValue || val.income || o.b.value);
  const shownRepair = activeGuide?.costSummary?.total ?? o.b.rehab;
  const reviewerRentValue = activeGuide?.rentValue
    ? {
        ...activeGuide.rentValue,
        ...(b.opex && !activeGuide.rentValue.opex ? { opex: b.opex } : {}),
        ...(b.laundry && !activeGuide.rentValue.laundry ? { laundry: b.laundry } : {}),
        ...(b.upside && !activeGuide.rentValue.upside ? { upside: b.upside } : {}),
      }
    : null;

  const navActive = panel ? 'overview' : activeSection;

  return (
    <div className={viewer ? 'space-y-6' : 'space-y-6 pb-20'}>
      {sections.length > 1 && <JumpNav sections={sections} active={navActive} onJump={jumpTo} base={basePath} preview={preview} />}

      <InPagePanel open={Boolean(panel)} kind={panel || 'panel'} title={PANEL_TITLES[panel] || ''} onClose={closePanel}>
        {panel === 'photos' && (
          <UnitGallery deal={deal} me={me} role={viewer ? 'viewer' : role} preview={preview} />
        )}
        {!viewer && panel === 'documents' && (
          <div className="space-y-5">
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
        {!viewer && panel === 'messages' && (
          <Messages deal={deal} me={me} role={role} preview={preview} />
        )}
        {!viewer && panel === 'city-records' && canAccessCityRecords(SITE_KIND, 'reviewer', preview) && (
          <Suspense fallback={<Empty>Loading…</Empty>}>
            <CityRecords deal={deal} role="reviewer" preview={preview} />
          </Suspense>
        )}
      </InPagePanel>

      {!panel && (
        <>
          <section id="sec-overview" data-section="overview" className={`scroll-mt-20 ${viewer ? 'space-y-6' : 'space-y-4'}`}>
            <Cover items={gallery.items} compact={!viewer} onOpenUnitGallery={() => openPanel('photos')} />
            {viewer ? (
              <>
                <PropertyFacts slug={deal.slug} />
                <ViewerAccessRequest deal={deal} me={me} member={member} preview={preview} />
              </>
            ) : (
              <>
                <OverviewActionButtons
                  showDocuments
                  showMessages
                  showCityRecords={canAccessCityRecords(SITE_KIND, 'reviewer', preview)}
                  docCount={docBadge}
                  msgCount={msgBadge}
                  onOpenDocuments={() => openPanel('documents')}
                  onOpenMessages={() => openPanel('messages')}
                  onOpenCityRecords={() => openPanel('city-records')}
                />

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
                    <div><dt className="text-ink-soft">Repair budget</dt><dd className="font-semibold"><OverlayTrigger lines={activeGuide?.costHeadingOverlay || []}>{money(shownRepair)}</OverlayTrigger></dd></div>
                    <div><dt className="text-ink-soft">Refinance</dt><dd className="font-semibold">{o.b.refiRate}%, {o.b.refiYears} yrs</dd></div>
                  </dl>
                </Card>

                <QuickOpinion deal={deal} me={me} role={role} preview={preview} />
              </>
            )}
          </section>

          {!viewer && (
            <section id="sec-offers" data-section="offers" className="scroll-mt-20 space-y-5">
              <h2 className="font-display text-2xl font-semibold">The lead offer</h2>
              <Offers deal={deal} canSave={false} onlyShared={preview ? role : undefined} me={me} role={role} preview={preview} leadGuide={activeGuide} />
              {isRentValue(reviewerRentValue) && (
                <Card>
                  <button
                    type="button"
                    aria-expanded={rentValueOpen}
                    data-reviewer-rent-toggle
                    onClick={() => setRentValueOpen((v) => !v)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
                  >
                    <span className="font-display text-xl font-semibold text-ink">Rent &amp; value</span>
                    <span aria-hidden="true" className="text-sm text-ink-soft">{rentValueOpen ? '▴' : '▾'}</span>
                  </button>
                  {rentValueOpen && (
                    <div className="mt-4 border-t border-line pt-4">
                      <RentValue data={reviewerRentValue} collapseTables />
                    </div>
                  )}
                </Card>
              )}
            </section>
          )}

          {!viewer && (
            <section id="sec-comps" data-section="comps" className="scroll-mt-20">
              <Comps deal={deal} me={me} role={role} preview={preview} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
