import { DictatedField } from '../components/Dictation.jsx';
import { setDealNames } from '../lib/people.js';
import Walkthrough from './Walkthrough.jsx';
import Tenants from './Tenants.jsx';
import Comps from './Comps.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import { LenderBoard } from './LenderTerms.jsx';
import { useEffect, useState, lazy, Suspense } from 'react';
import { supabase } from '../lib/supabase.js';
import { when, roleLabel } from '../lib/format.js';
import { SITE_KIND, canAccessCityRecords, canAccessDealPlan, memberPageUrl, roleLinkUrl, siteRules } from '../lib/site.js';
import { Card, CardTitle, Button, Field, Empty, InfoTip, Tabs } from '../components/Shell.jsx';
import Messages from '../components/Messages.jsx';
import Files from '../components/Files.jsx';
import Photos from '../components/Photos.jsx';
import Offers from './Offers.jsx';
import { AlertsCard } from '../components/Pulse.jsx';
import Dashboard from './Dashboard.jsx';
import LoanPosition from '../components/LoanPosition.jsx';
import OwnerRentValue from '../components/OwnerRentValue.jsx';
import AccessRequests from '../components/AccessRequests.jsx';

const CityRecords = lazy(() => import('./CityRecords.jsx'));
const DealPlan = import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller' ? null : lazy(() => import('./DealPlan.jsx'));

const BASE_TABS = [
  ['overview', 'Overview'],
  ['offers', 'Offers'],
  ['walkthrough', 'Walkthrough'],
  ['tenants', 'Tenants'],
  ['comps', 'Comps'],
  ['photos', 'Photos'],
  ['messages', 'Messages'],
  ['files', 'Files'],
  ['settings', 'Settings'],
];
const TABS = siteRules(SITE_KIND).ownerAllowed
  ? [...BASE_TABS.slice(0, 2), ['plans', 'Plans'], ...BASE_TABS.slice(2, 8), ['city-records', 'City records'], ...BASE_TABS.slice(8)]
  : BASE_TABS;
const PREVIEWS = [['seller', 'Seller'], ['realtor', 'Realtor'], ['reviewer', 'Reviewer'], ['lender', 'Lender'], ['lead_guest', 'Lead guest'], ['viewer', 'Viewer']];
const ALERTED = ['realtor', 'reviewer', 'lender'];
const MEMBER_ROLES = ['reviewer', 'lender', 'realtor', 'viewer', 'seller', 'lead_guest'];

const topic = () => 'ogdeal-' + crypto.randomUUID().replaceAll('-', '');

function People({ deal }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ email: '', role: 'realtor', display_name: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const load = () => supabase.from('commercial_members').select('*').eq('deal_id', deal.id).order('created_at').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [deal.id]);

  const add = async (e) => {
    e.preventDefault();
    setErr('');
    const row = { deal_id: deal.id, email: f.email.trim().toLowerCase(), role: f.role, display_name: f.display_name.trim() || null, ntfy_topic: ALERTED.includes(f.role) ? topic() : null };
    const { error } = await supabase.from('commercial_members').upsert({ ...row, status: 'active' }, { onConflict: 'deal_id,email' });
    if (error) return setErr(error.message);
    setDone(`${row.email} can sign in now as ${roleLabel[row.role].toLowerCase()}.`);
    setF({ email: '', role: 'realtor', display_name: '' });
    load();
  };
  const setStatus = async (r, status) => { await supabase.from('commercial_members').update({ status }).eq('id', r.id); load(); };

  const setRole = async (r, role) => {
    const ntfy = r.ntfy_topic || (ALERTED.includes(role) ? topic() : null);
    await supabase.from('commercial_members').update({ role, ntfy_topic: ntfy }).eq('id', r.id);
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
                <div className="flex items-center gap-2">
                  <p className="font-medium">{r.display_name || r.email} <span className="ml-1 rounded-full bg-warm-soft px-2 py-0.5 text-xs">{roleLabel[r.role]}</span></p>
                  <InfoTip label={`Details for ${r.display_name || r.email}`} lines={[
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
          <select className="w-full rounded-xl border border-line bg-white px-3 py-2" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="realtor">Realtor: deal, offers, walkthrough, tenants, messages, files</option>
            <option value="seller">Seller: the seller page only</option>
            <option value="reviewer">Reviewer: unit photos, comps, and offers and files you share</option>
            <option value="lender">Lender: the plan, city records, unit photos, and terms</option>
            <option value="lead_guest">Lead guest: deal overview and the one lead offer</option>
            <option value="viewer">Viewer: cover photo, unit photos and an overview, read only</option>
          </select>
          {err && <p className="text-sm text-red-700">{err}</p>}
          <Button type="submit" className="w-full">Invite</Button>
          {done && <p className="text-sm text-green-800">{done}</p>}
          <button type="button" onClick={() => { navigator.clipboard?.writeText(memberPageUrl(f.role, deal.slug)); setDone('Link copied.'); }}
            className="w-full rounded-xl border border-line px-3 py-2 text-sm hover:border-ink">Copy their link</button>
        </form>
      </Card>
      <RoleLinks deal={deal} onJoined={load} />
    </div>
  );
}

const LINK_ROLES = [['lead_guest', 'Lead guest'], ['lender', 'Lender'], ['realtor', 'Realtor'], ['reviewer', 'Reviewer'], ['viewer', 'Viewer'], ['seller', 'Seller']];

// One private link per verified recipient email. Turning a link off or letting it expire removes access.
function RoleLinks({ deal, onJoined }) {
  const [links, setLinks] = useState(null);
  const [f, setF] = useState({ role: 'lead_guest', label: '', recipient_email: '', expires_days: 14 });
  const [fresh, setFresh] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => supabase.from('commercial_role_links').select('id,role,label,recipient_email,created_at,expires_at,revoked_at,uses').eq('deal_id', deal.id).order('created_at', { ascending: false }).then(({ data }) => setLinks(data || []));
  useEffect(() => { load(); }, [deal.id]);

  const make = async (e) => {
    e.preventDefault();
    setMsg('');
    const recipient = f.recipient_email.trim().toLowerCase();
    const expiresDays = Math.min(90, Math.max(1, Math.round(+f.expires_days || 14)));
    if (!recipient) return setMsg('Recipient email is required.');
    const { data: token, error } = await supabase.rpc('commercial_create_role_link', {
      p_deal: deal.id,
      p_role: f.role,
      p_label: f.label.trim(),
      p_recipient_email: recipient,
      p_expires_days: expiresDays,
    });
    if (error || !token) return setMsg('That link couldn’t be made. Try again.');
    setFresh({ url: roleLinkUrl(token, f.role), label: f.label.trim() || roleLabel[f.role], recipient });
    setF({ ...f, label: '', recipient_email: '' });
    load();
  };
  const turnOff = async (l) => {
    if (!window.confirm(`Turn off the link for ${l.recipient_email || l.label || roleLabel[l.role]}? Anyone who joined with it loses access now.`)) return;
    const { error } = await supabase.rpc('commercial_revoke_role_link', { p_link: l.id });
    setMsg(error ? 'That link couldn’t be turned off. Try again.' : 'Link turned off.');
    load(); onJoined?.();
  };
  const state = (l) => (l.revoked_at ? 'Off' : new Date(l.expires_at) < new Date() ? 'Expired' : 'On');

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Private links</CardTitle>
      <form onSubmit={make} className="grid gap-2 sm:grid-cols-[160px_1fr_1fr_96px_auto]">
        <select aria-label="Link role" className="rounded-xl border border-line bg-white px-3 py-2 text-sm" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          {LINK_ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Field type="email" required aria-label="Recipient email" placeholder="Recipient email" value={f.recipient_email} onChange={(e) => setF({ ...f, recipient_email: e.target.value })} />
        <Field aria-label="Recipient label" placeholder="Name or note (e.g. Evan)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <Field type="number" inputMode="numeric" min={1} max={90} aria-label="Expires in days" title="Expires in days" value={f.expires_days} onChange={(e) => setF({ ...f, expires_days: e.target.value })} />
        <Button type="submit">Make link</Button>
      </form>
      {fresh && (
        <div className="mt-3 rounded-xl border border-good/40 bg-good/5 p-3 text-sm">
          <p className="font-medium">Link for {fresh.label} ({fresh.recipient}). Shown once.</p>
          <p className="mt-1 break-all font-mono text-xs select-all">{fresh.url}</p>
          <button type="button" className="mt-2 rounded-xl border border-line bg-white px-3 py-1.5 text-sm hover:border-ink" onClick={() => { navigator.clipboard?.writeText(fresh.url); setMsg('Link copied.'); }}>Copy link</button>
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-sm text-ink">{msg}</p>}
      {links === null ? <Empty>Loading…</Empty> : links.length === 0 ? <div className="mt-3"><Empty>No links yet.</Empty></div> : (
        <ul className="mt-3 divide-y divide-line">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{l.label || roleLabel[l.role]} <span className="ml-1 rounded-full bg-warm-soft px-2 py-0.5 text-xs">{roleLabel[l.role]}</span></p>
                <InfoTip label={`Details for the ${l.label || roleLabel[l.role]} link`} lines={[`${l.recipient_email ? `${l.recipient_email} · ` : ''}${state(l)} · expires ${when(l.expires_at)} · used ${l.uses} ${l.uses === 1 ? 'time' : 'times'}`]} />
              </div>
              {!l.revoked_at && <Button kind="secondary" onClick={() => turnOff(l)}>Turn off</Button>}
            </li>
          ))}
        </ul>
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
        <select className="rounded-xl border border-line bg-white px-3 py-2" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>
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
  const active = TABS.find(([k]) => k === tab)?.[0] || 'overview';
  return (
    <div>
      <div className="mb-4 space-y-2.5">
        <Tabs tabs={TABS} active={active} base={`#/d/${deal.slug}`} />
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-ink-soft">See as</span>
          {PREVIEWS.map(([k, l]) => <a key={k} href={`#/d/${deal.slug}/view/${k}`} className="inline-flex min-h-[36px] shrink-0 items-center whitespace-nowrap rounded-full border border-line bg-white px-3 py-1 hover:border-ink">{l}</a>)}
        </div>
      </div>

      {active === 'overview' && (
        <div className="space-y-5">
          <Dashboard deal={deal} me={me} role="owner" />
          <LoanPosition deal={deal} role="owner" />
          <OwnerRentValue deal={deal} />
          <LenderBoard deal={deal} me={me} role="owner" />
        </div>
      )}
      {active === 'offers' && <Offers deal={deal} canSave me={me} role="owner" />}
      {active === 'plans' && DealPlan && canAccessDealPlan(SITE_KIND, 'owner', false) && (
        <Suspense fallback={<Empty>Loading…</Empty>}>
          <DealPlan key={deal.id} deal={deal} role="owner" />
        </Suspense>
      )}
      {active === 'walkthrough' && <Walkthrough deal={deal} me={me} role="owner" />}
      {active === 'tenants' && <Tenants deal={deal} me={me} role="owner" />}
      {active === 'comps' && <Comps deal={deal} me={me} role="owner" />}
      {active === 'photos' && <div className="space-y-5"><UnitGallery deal={deal} me={me} role="owner" /><Photos deal={deal} role="owner" me={me} /></div>}
      {active === 'messages' && <Messages deal={deal} me={me} role="owner" />}
      {active === 'files' && <Files deal={deal} role="owner" me={me} title="Every upload" canShare allowShare />}
      {active === 'city-records' && CityRecords && canAccessCityRecords(SITE_KIND, 'owner', false) && (
        <Suspense fallback={<Empty>Loading…</Empty>}>
          <CityRecords deal={deal} role="owner" />
        </Suspense>
      )}
      {active === 'settings' && <div className="space-y-6"><People deal={deal} /><div className="grid gap-6 lg:grid-cols-[1fr_360px]"><Settings deal={deal} onSaved={setDeal} /><OwnerAlerts /></div><Notes deal={deal} me={me} /></div>}
    </div>
  );
}
