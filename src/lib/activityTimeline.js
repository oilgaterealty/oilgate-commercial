import { activityText } from './people.js';
import { signinActionLabel, signinRoleLabel } from './signinActivity.js';

const normEmail = (email) => String(email || '').trim().toLowerCase();
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export function buildMemberIndex(members) {
  const index = {};
  for (const m of members || []) {
    const email = normEmail(m?.email);
    if (!email) continue;
    index[email] = {
      name: String(m.display_name || '').trim(),
      role: String(m.role || '').trim(),
    };
  }
  return index;
}

function resolveName({ explicitName, email, role, memberIndex, deal }) {
  const cleanExplicit = String(explicitName || '').trim();
  if (cleanExplicit) return cleanExplicit;
  const key = normEmail(email);
  const fromMember = key ? memberIndex[key]?.name : '';
  if (fromMember) return fromMember;
  if (role === 'owner' && deal?.buyer_name) return String(deal.buyer_name).trim();
  if (role === 'seller' && deal?.seller_name) return String(deal.seller_name).trim();
  return key || signinRoleLabel(role) || 'Someone';
}

function timeMs(iso) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function formatAccessRequestWhat(req) {
  const target = signinRoleLabel(req.requested_role || 'access').toLowerCase();
  const via = req.source === 'open_link' ? ' via open link' : '';
  const base = `Requested ${target} access${via}`;
  if (req.status === 'approved') {
    const asRole = req.approved_role ? signinRoleLabel(req.approved_role).toLowerCase() : target;
    return `${base} (approved as ${asRole})`;
  }
  if (req.status === 'denied') return `${base} (denied)`;
  if (req.status === 'superseded') return `${base} (superseded)`;
  return base;
}

/**
 * Merges every owner-visible history source into one newest-first timeline.
 * Missing or unavailable sources (null/false/undefined) are skipped cleanly.
 */
export function buildOwnerActivityTimeline({
  deal = null,
  members = [],
  signins = [],
  activity = [],
  openViews = [],
  accessRequests = [],
  messages = [],
  uploads = [],
} = {}) {
  const memberIndex = buildMemberIndex(members);
  const rows = [];

  for (const s of Array.isArray(signins) ? signins : []) {
    if (!s?.at) continue;
    const rawRole = String(s.role || memberIndex[normEmail(s.email)]?.role || '').trim();
    rows.push({
      id: `signin:${normEmail(s.email)}:${s.action || 'login'}:${s.at}`,
      kind: s.action === 'user_signedup' ? 'signup' : 'signin',
      name: resolveName({ explicitName: s.display_name, email: s.email, role: rawRole, memberIndex, deal }),
      role: signinRoleLabel(rawRole),
      what: signinActionLabel(s.action),
      at: s.at,
    });
  }

  for (const v of Array.isArray(openViews) ? openViews : []) {
    if (!v?.viewed_at) continue;
    rows.push({
      id: `open-view:${v.id || `${v.link_id || ''}:${v.visitor || ''}:${v.viewed_at}`}`,
      kind: 'open_view',
      name: 'Open link visitor',
      role: 'Viewer',
      what: 'Opened the viewer link',
      at: v.viewed_at,
    });
  }

  for (const r of Array.isArray(accessRequests) ? accessRequests : []) {
    if (!r?.created_at) continue;
    const roleText = r.requested_role ? signinRoleLabel(`requested ${r.requested_role}`) : 'Access request';
    rows.push({
      id: `request:${r.id || `${normEmail(r.email)}:${r.created_at}`}`,
      kind: 'access_request',
      name: resolveName({ explicitName: r.requester_name, email: r.email, role: '', memberIndex, deal }),
      role: roleText,
      what: formatAccessRequestWhat(r),
      at: r.created_at,
    });
  }

  const msgIndex = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m?.created_at) continue;
    const email = normEmail(m.author_email);
    const t = timeMs(m.created_at);
    msgIndex.push({ email, t });
    const topic = String(m.topic || '').trim();
    const body = String(m.body || '').slice(0, 140);
    rows.push({
      id: `message:${m.id || `${email}:${m.created_at}`}`,
      kind: 'message',
      name: resolveName({ explicitName: m.author_name, email, role: m.author_role, memberIndex, deal }),
      role: signinRoleLabel(m.author_role),
      what: `Wrote${topic ? ` (${topic})` : ''}: ${body}`,
      at: m.created_at,
    });
  }

  const uploadIndex = [];
  for (const u of Array.isArray(uploads) ? uploads : []) {
    if (!u?.created_at) continue;
    const email = normEmail(u.uploaded_by_email);
    const t = timeMs(u.created_at);
    uploadIndex.push({ email, t });
    const kindLabel = u.kind === 'photo' ? 'photo' : 'document';
    rows.push({
      id: `upload:${u.id || `${email}:${u.file_name || ''}:${u.created_at}`}`,
      kind: 'upload',
      name: resolveName({ explicitName: '', email, role: u.uploaded_by_role, memberIndex, deal }),
      role: signinRoleLabel(u.uploaded_by_role),
      what: `Uploaded a ${kindLabel}: ${u.file_name || ''}`.trim(),
      at: u.created_at,
    });
  }

  for (const a of Array.isArray(activity) ? activity : []) {
    if (!a?.created_at) continue;
    const email = normEmail(a.actor_email);
    const t = timeMs(a.created_at);
    if (a.kind === 'message' && msgIndex.some((m) => m.email === email && Math.abs(m.t - t) <= 10000)) continue;
    if (a.kind === 'upload' && uploadIndex.some((u) => u.email === email && Math.abs(u.t - t) <= 10000)) continue;
    const what = capFirst(activityText(a));
    rows.push({
      id: `activity:${a.id || `${email}:${a.kind}:${a.created_at}`}`,
      kind: a.kind || 'activity',
      name: resolveName({ explicitName: a.actor_name, email, role: a.actor_role, memberIndex, deal }),
      role: signinRoleLabel(a.actor_role),
      what,
      at: a.created_at,
    });
  }

  return rows.sort((a, b) => timeMs(b.at) - timeMs(a.at));
}

/**
 * Builds the realtor's seller-only activity timeline (never includes buyer/owner or other roles).
 */
export function buildRealtorSellerTimeline({
  deal = null,
  rpcRows = null,
  fallbackActivity = [],
  fallbackMessages = [],
  fallbackSignins = [],
} = {}) {
  const sellerFallbackName = String(deal?.seller_name || '').trim() || 'Seller';

  if (Array.isArray(rpcRows)) {
    return rpcRows
      .filter((r) => r && r.at)
      .map((r, idx) => ({
        id: `realtor-seller:${r.kind || 'event'}:${r.at}:${idx}`,
        kind: r.kind || 'activity',
        name: String(r.display_name || '').trim() || sellerFallbackName,
        role: 'Seller',
        what: capFirst(String(r.summary || '').trim()),
        at: r.at,
      }))
      .sort((a, b) => timeMs(b.at) - timeMs(a.at));
  }

  const rows = [];

  for (const s of Array.isArray(fallbackSignins) ? fallbackSignins : []) {
    if (!s?.at || String(s.role || '').trim().toLowerCase() !== 'seller') continue;
    rows.push({
      id: `realtor-signin:${normEmail(s.email)}:${s.action || 'login'}:${s.at}`,
      kind: s.action === 'user_signedup' ? 'signup' : 'signin',
      name: String(s.display_name || '').trim() || sellerFallbackName,
      role: 'Seller',
      what: signinActionLabel(s.action),
      at: s.at,
    });
  }

  for (const a of Array.isArray(fallbackActivity) ? fallbackActivity : []) {
    if (!a?.created_at || String(a.actor_role || '').trim().toLowerCase() !== 'seller') continue;
    if (a.kind !== 'view') continue;
    rows.push({
      id: `realtor-view:${a.id || a.created_at}`,
      kind: 'view',
      name: String(a.actor_name || '').trim() || sellerFallbackName,
      role: 'Seller',
      what: 'Opened the seller page',
      at: a.created_at,
    });
  }

  for (const m of Array.isArray(fallbackMessages) ? fallbackMessages : []) {
    if (!m?.created_at || String(m.author_role || '').trim().toLowerCase() !== 'seller') continue;
    const topic = String(m.topic || '').trim();
    const body = String(m.body || '').slice(0, 140);
    rows.push({
      id: `realtor-msg:${m.id || m.created_at}`,
      kind: 'message',
      name: String(m.author_name || '').trim() || sellerFallbackName,
      role: 'Seller',
      what: `Wrote${topic ? ` (${topic})` : ''}: ${body}`,
      at: m.created_at,
    });
  }

  return rows.sort((a, b) => timeMs(b.at) - timeMs(a.at));
}
