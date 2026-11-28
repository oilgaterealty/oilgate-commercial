import { setDealNames } from '../lib/people.js';
import Walkthrough from './Walkthrough.jsx';
import Tenants from './Tenants.jsx';
import Comps from './Comps.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import { LenderBoard } from './LenderTerms.jsx';
import { useEffect, useState, lazy, Suspense } from 'react';
import { supabase } from '../lib/supabase.js';
import { when, roleLabel } from '../lib/format.js';
import {
  annotateSignins,
  formatPhoenixDate,
  formatPhoenixDateTime,
  resolveMemberSigninStatus,
  signinActionLabel,
  signinRoleLabel,
} from '../lib/signinActivity.js';
import { SITE_KIND, canAccessCityRecords, canAccessDealPlan, memberPageUrl, openViewerUrl, siteRules } from '../lib/site.js';
import { LENDER_LENS_LABELS, LENDER_LENS_OPTIONS, normalizeLenderLens } from '../lib/lenderLens.js';
import { summarizeOpenViews } from '../lib/openViewer.js';
import { Card, CardTitle, Button, Field, Empty, InfoTip, JumpNav, OverlayTrigger } from '../components/Shell.jsx';
import { InPagePanel } from '../components/OverlaySheet.jsx';
import Messages from '../components/Messages.jsx';
import Files from '../components/Files.jsx';
import Photos from '../components/Photos.jsx';
import Offers from './Offers.jsx';
import { AlertsCard } from '../components/Pulse.jsx';
import Dashboard from './Dashboard.jsx';
import LoanPosition from '../components/LoanPosition.jsx';
import OwnerRentValue from '../components/OwnerRentValue.jsx';
import OwnerNumbersPanel from '../components/OwnerNumbersPanel.jsx';
import AccessRequests from '../components/AccessRequests.jsx';
import Activity from '../components/Activity.jsx';

const ProtectionsEditor = lazy(() => import('../components/ProtectionsEditor.jsx'));

const CityRecords = lazy(() => import('./CityRecords.jsx'));
const DealPlan = import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller' ? null : lazy(() => import('./DealPlan.jsx'));

const BASE_SECTIONS = [
  ['overview', 'Overview'],
  ['offers', 'Offers'],
  ['walkthrough', 'Walkthrough'],
  ['tenants', 'Tenants'],
];
const SECTIONS = siteRules(SITE_KIND).ownerAllowed
  ? [...BASE_SECTIONS, ['plans', 'Plans']]
  : BASE_SECTIONS;

const PANEL_ALIASES = {
  photos: 'photos',
  files: 'documents',
  documents: 'documents',
  messages: 'messages',
  'city-records': 'city-records',
  comps: 'comps',
  activity: 'activity',
  numbers: 'numbers',
  settings: 'settings',
  people: 'settings',
};
const PANEL_TITLES = {
  photos: 'Photos by unit',
  documents: 'Documents',
  messages: 'Messages',
  'city-records': 'City records',
  comps: 'Comps',
  activity: 'Recent activity',
  numbers: 'Numbers',
  settings: 'Settings',
};

const ALERTED = ['realtor', 'reviewer', 'lender'];
const MEMBER_ROLES = ['reviewer', 'lender', 'realtor', 'viewer', 'seller'];

const topic = () => 'ogdeal-' + crypto.randomUUID().replaceAll('-', '');

export function SignInsCard({ rows }) {
  const items = annotateSignins(Array.isArray(rows) ? rows : []);
  return (
    <Card className="lg:col-span-2">
      <CardTitle>Sign-ins</CardTitle>
      {rows === null ? (
        <Empty>Loading…</Empty>
      ) : rows === false ? (
        <Empty>Sign-in data unavailable.</Empty>
      ) : items.length === 0 ? (
        <Empty>No sign-ins yet.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item, idx) => {
            const label = (item.display_name || '').trim() || item.email;
            return (
              <li
                key={`${item.email}:${item.action}:${item.at}:${idx}`}
                data-latest={item.isLatest ? 'true' : undefined}
                className={`flex flex-wrap items-center justify-between gap-3 py-2.5 ${item.isLatest ? '-mx-3 rounded-xl border-l-2 border-good bg-good/5 px-3' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <OverlayTrigger label={`Email for ${label}`} lines={[item.email]}>
                    <span className="font-medium">{label}</span>
                  </OverlayTrigger>
                  <span className="rounded-full bg-warm-soft px-2 py-0.5 text-xs">{signinRoleLabel(item.role)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.isLatest ? 'bg-good/10 text-good' : 'bg-paper text-ink-soft'}`}>
                    {signinActionLabel(item.action)}
                  </span>
                </div>
                <time dateTime={item.at} className="shrink-0 tabular-nums text-xs text-ink-soft">
                  {formatPhoenixDateTime(item.at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function People({ deal }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ email: '', role: 'realtor', display_name: '', company: '', lens: 'bridge' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [seen, setSeen] = useState({});
  const [signins, setSignins] = useState(null);
  const loadSignins = () => supabase
    .rpc('commercial_signin_activity', { p_deal: deal.id, p_limit: 200 })
    .then(
      ({ data, error }) => setSignins(error || !Array.isArray(data) ? false : data),
      () => setSignins(false),
    );
  const load = () => {
    supabase.from('commercial_members').select('*').eq('deal_id', deal.id).order('created_at').then(({ data }) => setRows(data || []));
    loadSignins();
  };
  useEffect(() => { load(); }, [deal.id]);
  // Who has actually opened their page: one view is logged per person per hour when they open the deal.
  useEffect(() => {
    supabase.from('commercial_activity').select('actor_email,created_at').eq('deal_id', deal.id).eq('kind', 'view').order('created_at', { ascending: false }).limit(2000)
      .then(({ data }) => {
        const m = {};
        for (const a of data || []) {
          const k = (a.actor_email || '').toLowerCase();
          if (!k) continue;
          if (!m[k]) m[k] = { last: a.created_at, count: 0 };
          m[k].count += 1;
        }
        setSeen(m);
      });
  }, [deal.id]);
  const signinChip = (r) => {
    const status = resolveMemberSigninStatus(r, signins, seen);
    if (status.kind === 'unavailable') return null;
    if (status.kind === 'signed_in') {
      const s = status.row;
      return (
        <OverlayTrigger lines={[`${signinActionLabel(s.action)} ${formatPhoenixDateTime(s.at)}`]}>
          <span className="whitespace-nowrap rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">
            Signed in {formatPhoenixDate(s.at)}
          </span>
        </OverlayTrigger>
      );
    }
    return (
      <span className="whitespace-nowrap rounded-full bg-warm-soft px-2 py-0.5 text-xs font-medium text-ink-soft">
        Never signed in
      </span>
    );
  };
  const seenChip = (r) => {
    const s = seen[(r.email || '').toLowerCase()];
    if (r.status !== 'active') return null;
    return s
      ? <OverlayTrigger lines={[`Opened the page ${s.count} ${s.count === 1 ? 'time' : 'times'}.`, `Last opened ${new Date(s.last).toLocaleString()}.`]}><span className="rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">Active, last {new Date(s.last).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></OverlayTrigger>
      : <span className="rounded-full bg-warm-soft px-2 py-0.5 text-xs font-medium text-ink-soft">Not opened yet</span>;
  };

  const add = async (e) => {
    e.preventDefault();
    setErr('');
    const defaultLens = f.role === 'lender' ? (normalizeLenderLens(f.lens) || 'bridge') : null;
    const row = {
      deal_id: deal.id,
      email: f.email.trim().toLowerCase(),
      role: f.role,
      display_name: f.display_name.trim() || null,
      company: f.role === 'lender' ? f.company.trim() : '',
      default_lens: defaultLens,
      ntfy_topic: ALERTED.includes(f.role) ? topic() : null,
    };
    const { error } = await supabase.from('commercial_members').upsert({ ...row, status: 'active' }, { onConflict: 'deal_id,email' });
    if (error) return setErr(error.message);
    setDone(`${row.email} can sign in now as ${roleLabel[row.role].toLowerCase()}${defaultLens ? ` (${LENDER_LENS_LABELS[defaultLens]})` : ''}.`);
    setF({ email: '', role: 'realtor', display_name: '', company: '', lens: 'bridge' });
    load();
  };
  const setStatus = async (r, status) => { await supabase.from('commercial_members').update({ status }).eq('id', r.id); load(); };

  const setRole = async (r, role) => {
    const ntfy = r.ntfy_topic || (ALERTED.includes(role) ? topic() : null);
    const default_lens = role === 'lender' ? (normalizeLenderLens(r.default_lens) || 'bridge') : null;
    await supabase.from('commercial_members').update({ role, ntfy_topic: ntfy, default_lens }).eq('id', r.id);
    load();
  };

  const setLenderTab = async (r, lens) => {
    const default_lens = normalizeLenderLens(lens) || 'bridge';
    await supabase.from('commercial_members').update({ default_lens }).eq('id', r.id);
    load();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {deal.slug === 'charlotte' && <AccessRequests dealId={deal.id} onApproved={load} />}
      <Card>
        <CardTitle>People</CardTitle>
        {!rows ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>Only you so far.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{r.display_name || r.email} <span className="ml-1 rounded-full bg-warm-soft px-2 py-0.5 text-xs">{roleLabel[r.role]}</span></p>
                  {signinChip(r)}
                  {seenChip(r)}
                  <InfoTip label={`Details for ${r.display_name || r.email}`} lines={[
                    r.company && <>Company: {r.company}</>,
                    r.invited_by_email && <>Invited by {r.invited_by_email}</>,
                    `${r.email} · ${r.status === 'active' ? 'Has access' : 'Access removed'}${r.link_id ? ' · joined with a link' : ''}`,
                    r.ntfy_topic && r.status === 'active' && <>Alert topic: <code className="select-all">{r.ntfy_topic}</code></>,
                  ]} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label={`Role for ${r.email}`} value={r.role} onChange={(e) => setRole(r, e.target.value)}
                    className="min-h-[40px] rounded-xl border border-line bg-white px-3 py-2 text-sm">
                    {MEMBER_ROLES.map((k) => <option key={k} value={k}>{roleLabel[k]}</option>)}
                  </select>
                  {r.role === 'lender' && (
                    <select
                      aria-label={`Lender tab for ${r.email}`}
                      value={normalizeLenderLens(r.default_lens) || 'bridge'}
                      onChange={(e) => setLenderTab(r, e.target.value)}
                      className="min-h-[40px] rounded-xl border border-line bg-white px-3 py-2 text-sm"
                    >
                      {LENDER_LENS_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  )}
                  {r.status === 'active'
                    ? <Button kind="secondary" onClick={() => setStatus(r, 'revoked')}>Remove access</Button>
                    : <Button kind="secondary" onClick={() => setStatus(r, 'active')}>Restore</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardTitle>Invite someone</CardTitle>
        <form onSubmit={add} className="space-y-3">
          <Field type="email" required placeholder="Their email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Field placeholder="Name (optional)" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          <select aria-label="Role" className="min-h-[40px] w-full rounded-xl border border-line bg-white px-3 py-2" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="realtor">Realtor: deal, offers, walkthrough, tenants, messages, files</option>
            <option value="seller">Seller: the seller page only</option>
            <option value="reviewer">Reviewer: unit photos, comps, and offers and files you share</option>
            <option value="lender">Lender: the plan, city records, unit photos, and terms</option>
            <option value="viewer">Viewer: cover photo, unit photos and an overview, read only</option>
          </select>
          {f.role === 'lender' && (
            <>
              <Field placeholder="Company (optional)" maxLength={120} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
              <div role="radiogroup" aria-label="Lender tab" className="grid grid-cols-3 gap-1.5">
                {LENDER_LENS_OPTIONS.map(([k, label]) => {
                  const active = f.lens === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setF({ ...f, lens: k })}
                      className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                        active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {err && <p className="text-sm text-red-700">{err}</p>}
          <Button type="submit" className="w-full">Invite</Button>
          {done && <p className="text-sm text-green-800">{done}</p>}
          <button
            type="button"
            onClick={() => {
              const chosenLens = f.role === 'lender' ? f.lens : '';
              navigator.clipboard?.writeText(memberPageUrl(f.role, deal.slug, chosenLens));
              setDone(f.role === 'lender' ? `${LENDER_LENS_LABELS[f.lens]} link copied.` : 'Link copied.');
            }}
            className="min-h-[40px] w-full rounded-xl border border-line px-3 py-2 text-sm hover:border-ink"
          >
            {f.role === 'lender' ? `Copy ${LENDER_LENS_LABELS[f.lens]} link` : 'Copy their link'}
          </button>
        </form>
      </Card>
      <SignInsCard rows={signins} />
      <OpenViewerLink deal={deal} />
    </div>
  );
}

function OpenViewerLink({ deal }) {
  const [links, setLinks] = useState(null);
  const [views, setViews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const { data: linkRows } = await supabase
      .from('commercial_open_links')
      .select('id,token,created_at,revoked_at')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: false });
    const list = linkRows || [];
    setLinks(list);
    if (!list.length) { setViews([]); return; }
    const { data: viewRows } = await supabase
      .from('commercial_open_views')
      .select('link_id,visitor,viewed_at')
      .in('link_id', list.map((l) => l.id))
      .order('viewed_at', { ascending: false })
      .limit(5000);
    setViews(viewRows || []);
  };

  useEffect(() => { load(); }, [deal.id]);

  const { activeLink, totalViews, uniqueVisitors, lastViewed } = summarizeOpenViews(links, views);

  const createLink = async () => {
    if (busy) return;
    setBusy(true);
    setCopied(false);
    await supabase.rpc('commercial_open_link_create', { p_deal: deal.id });
    await load();
    setBusy(false);
  };

  const revokeLink = async () => {
    if (!activeLink || busy || !window.confirm('Turn off the open viewer link? Anyone holding it loses access now.')) return;
    setBusy(true);
    setCopied(false);
    await supabase.rpc('commercial_open_link_revoke', { p_id: activeLink.id });
    await load();
    setBusy(false);
  };

  const copyLink = () => {
    if (!activeLink) return;
    navigator.clipboard?.writeText(openViewerUrl(deal.slug, activeLink.token));
    setCopied(true);
  };

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Open viewer link</CardTitle>
      {links === null ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <OverlayTrigger lines={[lastViewed ? `Last viewed ${when(lastViewed)}` : 'No views yet']}>
              <span className="rounded-full bg-warm-soft px-3 py-1 text-xs font-medium text-ink">
                {totalViews} {totalViews === 1 ? 'view' : 'views'} · {uniqueVisitors} unique
              </span>
            </OverlayTrigger>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeLink && (
              <>
                <Button type="button" disabled={busy} onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Button>
                <Button type="button" kind="secondary" disabled={busy} onClick={revokeLink}>Revoke</Button>
              </>
            )}
            <Button type="button" kind={activeLink ? 'secondary' : 'primary'} disabled={busy} onClick={createLink}>New link</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Settings({ deal, onSaved }) {
  const [folder, setFolder] = useState('');
  const [d, setD] = useState({ title: deal.title, address: deal.address, status: deal.status, buyer_name: deal.buyer_name || '', seller_name: deal.seller_name || '' });
  const [msg, setMsg] = useState('');
  useEffect(() => { supabase.from('commercial_deal_private').select('drive_folder_id').eq('deal_id', deal.id).maybeSingle().then(({ data }) => setFolder(data?.drive_folder_id || '')); }, [deal.id]);
  const save = async () => {
    const id = (folder.match(/folders\/([A-Za-z0-9_-]+)/) || [])[1] || folder.trim();
    const a = await supabase.from('commercial_deals').update({ ...d, buyer_name: d.buyer_name.trim(), seller_name: d.seller_name.trim() }).eq('id', deal.id).select().single();
    const b = id ? await supabase.from('commercial_deal_private').upsert({ deal_id: deal.id, drive_folder_id: id, updated_at: new Date().toISOString() }) : { error: null };
    setMsg(a.error?.message || b.error?.message || 'Saved.');
    if (a.data) onSaved(a.data);
  };
  return (
    <Card>
      <CardTitle>Property settings</CardTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <Field value={d.title} placeholder="Name" onChange={(e) => setD({ ...d, title: e.target.value })} />
        <Field value={d.address} placeholder="Address" onChange={(e) => setD({ ...d, address: e.target.value })} />
        <label className="text-xs text-ink-soft">Buyer name<Field value={d.buyer_name} maxLength={120} placeholder="Not named yet" onChange={(e) => setD({ ...d, buyer_name: e.target.value })} /></label>
        <label className="text-xs text-ink-soft">Seller name<Field value={d.seller_name} maxLength={120} placeholder="Not named yet" onChange={(e) => setD({ ...d, seller_name: e.target.value })} /></label>
        <Field value={folder} placeholder="Google Drive folder link" onChange={(e) => setFolder(e.target.value)} />
        <select className="min-h-[40px] rounded-xl border border-line bg-white px-3 py-2" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>
          <option value="active">Active</option><option value="closed">Closed</option><option value="archived">Archived</option>
        </select>
      </div>
      <div className="mt-4 flex items-center gap-3"><Button onClick={save}>Save</Button><span role="status" className="text-sm text-ink">{msg}</span></div>
    </Card>
  );
}

function Notes({ deal, me }) {
  const [rows, setRows] = useState([]);
  const [body, setBody] = useState('');
  const load = () => supabase.from('commercial_owner_notes').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }).then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [deal.id]);
  const add = async (e) => { e.preventDefault(); if (!body.trim()) return; await supabase.from('commercial_owner_notes').insert({ deal_id: deal.id, body: body.trim() }); setBody(''); load(); };
  return (
    <Card>
      <CardTitle>Your private notes</CardTitle>
      <form onSubmit={add} className="mb-4 flex gap-2"><Field value={body} placeholder="Only you see these" onChange={(e) => setBody(e.target.value)} /><Button type="submit">Add</Button></form>
      {rows.length === 0 ? <Empty>No notes yet.</Empty> : rows.map((n) => <p key={n.id} className="border-t border-line py-2 text-sm" title={when(n.created_at)}>{n.body}</p>)}
    </Card>
  );
}

function OwnerAlerts() {
  const [t, setT] = useState(null);
  useEffect(() => { supabase.from('commercial_settings').select('value').eq('key', 'owner_ntfy_topic').maybeSingle().then(({ data }) => setT(data?.value || '')); }, []);
  return <AlertsCard topic={t} who="You get a push for every view, message, upload and interest change on every property." />;
}

export default function Owner({ deal: initial, me, tab }) {
  const [deal, setDeal] = useState(initial);
  setDealNames(deal);
  const root = `#/d/${deal.slug}`;
  const routePanel = PANEL_ALIASES[tab] || null;
  const [panel, setPanel] = useState(routePanel);
  const [offersExtra, setOffersExtra] = useState(() => ({
    rentValue: tab === 'rent-value',
    lenders: tab === 'lenders',
  }));

  useEffect(() => {
    setPanel(PANEL_ALIASES[tab] || null);
    if (tab === 'rent-value') setOffersExtra((p) => ({ ...p, rentValue: true }));
    if (tab === 'lenders') setOffersExtra((p) => ({ ...p, lenders: true }));
  }, [tab]);

  const mappedTab = (tab === 'rent-value' || tab === 'lenders') ? 'offers' : tab;
  const active = panel ? 'overview' : (SECTIONS.some(([k]) => k === mappedTab) ? mappedTab : 'overview');
  const show = (k) => !panel && active === k;

  const jumpTo = (k) => {
    if (PANEL_ALIASES[k]) {
      openPanel(PANEL_ALIASES[k]);
      return;
    }
    setPanel(null);
    const next = k === 'overview' ? root : `${root}/${k}`;
    if (window.location.hash !== next) window.location.hash = next;
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const openPanel = (kind) => {
    const clean = PANEL_ALIASES[kind] || kind;
    setPanel(clean);
    const next = `${root}/${clean === 'documents' ? 'files' : clean}`;
    if (typeof window !== 'undefined' && window.location.hash !== next) {
      window.location.hash = next;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  const closePanel = () => {
    setPanel(null);
    if (typeof window !== 'undefined' && window.location.hash !== root) {
      window.location.hash = root;
    }
    try { window.scrollTo({ top: 0 }); } catch {}
  };

  useEffect(() => { try { window.scrollTo({ top: 0 }); } catch {} }, [active, panel]);

  return (
    <div className="space-y-6">
      <JumpNav sections={SECTIONS} active={active} onJump={jumpTo} base={root} />

      <InPagePanel open={Boolean(panel)} kind={panel || 'panel'} title={PANEL_TITLES[panel] || ''} onClose={closePanel}>
        {panel === 'photos' && (
          <div className="space-y-5">
            <UnitGallery deal={deal} me={me} role="owner" />
            <Photos deal={deal} role="owner" me={me} />
          </div>
        )}
        {panel === 'documents' && (
          <Files deal={deal} role="owner" me={me} title="Every upload" canShare allowShare />
        )}
        {panel === 'messages' && (
          <Messages deal={deal} me={me} role="owner" />
        )}
        {panel === 'city-records' && CityRecords && canAccessCityRecords(SITE_KIND, 'owner', false) && (
          <Suspense fallback={<Empty>Loading…</Empty>}>
            <CityRecords deal={deal} role="owner" />
          </Suspense>
        )}
        {panel === 'comps' && (
          <Comps deal={deal} me={me} role="owner" />
        )}
        {panel === 'activity' && (
          <Activity deal={deal} title="Recent activity" />
        )}
        {panel === 'numbers' && (
          <OwnerNumbersPanel deal={deal} />
        )}
        {panel === 'settings' && (
          <div className="space-y-6">
            <People deal={deal} />
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <Settings deal={deal} onSaved={setDeal} />
              <OwnerAlerts />
            </div>
            <Suspense fallback={null}>
              <ProtectionsEditor deal={deal} onSaved={setDeal} />
            </Suspense>
            <Notes deal={deal} me={me} />
          </div>
        )}
      </InPagePanel>

      {show('overview') && (
        <section id="sec-overview" data-section="overview" className="scroll-mt-20">
          <Dashboard deal={deal} me={me} role="owner" onJump={jumpTo} onOpenPanel={openPanel} onOpenNumbers={() => openPanel('numbers')} />
        </section>
      )}

      {show('offers') && (
        <section id="sec-offers" data-section="offers" className="scroll-mt-20 space-y-5">
          <Offers deal={deal} canSave me={me} role="owner" onOpenNumbers={() => openPanel('numbers')} />

          <Card>
            <button
              type="button"
              aria-expanded={offersExtra.rentValue}
              data-owner-offers-group="rent-value"
              onClick={() => setOffersExtra((p) => ({ ...p, rentValue: !p.rentValue }))}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
            >
              <span className="font-display text-xl font-semibold text-ink">Rent &amp; value</span>
              <span aria-hidden="true" className="text-sm text-ink-soft">{offersExtra.rentValue ? '▴' : '▾'}</span>
            </button>
            {offersExtra.rentValue && (
              <div className="mt-4 border-t border-line pt-4">
                <OwnerRentValue deal={deal} onOpenNumbers={() => openPanel('numbers')} />
              </div>
            )}
          </Card>

          <Card>
            <button
              type="button"
              aria-expanded={offersExtra.lenders}
              data-owner-offers-group="lenders"
              onClick={() => setOffersExtra((p) => ({ ...p, lenders: !p.lenders }))}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
            >
              <span className="font-display text-xl font-semibold text-ink">Loan &amp; lenders</span>
              <span aria-hidden="true" className="text-sm text-ink-soft">{offersExtra.lenders ? '▴' : '▾'}</span>
            </button>
            {offersExtra.lenders && (
              <div className="mt-4 space-y-5 border-t border-line pt-4">
                <LoanPosition deal={deal} role="owner" />
                <LenderBoard deal={deal} me={me} role="owner" />
              </div>
            )}
          </Card>
        </section>
      )}

      {show('walkthrough') && (
        <section id="sec-walkthrough" data-section="walkthrough" className="scroll-mt-20">
          <Walkthrough deal={deal} me={me} role="owner" />
        </section>
      )}

      {show('tenants') && (
        <section id="sec-tenants" data-section="tenants" className="scroll-mt-20">
          <Tenants deal={deal} me={me} role="owner" />
        </section>
      )}

      {show('plans') && DealPlan && canAccessDealPlan(SITE_KIND, 'owner', false) && (
        <section id="sec-plans" data-section="plans" className="scroll-mt-20">
          <Suspense fallback={<Empty>Loading…</Empty>}>
            <DealPlan key={deal.id} deal={deal} role="owner" onOpenNumbers={() => openPanel('numbers')} />
          </Suspense>
        </section>
      )}
    </div>
  );
}
