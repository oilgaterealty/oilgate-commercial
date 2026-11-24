// v6.3 pure rules, shared by the pages and the tests. The database enforces the same rules with RLS.

// One cover photo: the starred (featured) upload. If nothing is starred yet, the newest photo stands in.
export function coverOf(rows) {
  const photos = (rows || []).filter((r) => r && r.kind === 'photo' && r.url);
  return photos.find((r) => r.featured) || photos[0] || null;
}

// Unit notes: each author sees their own; the owner sees all; lenders see only the owner's one-line overview.
export function visibleUnitNotes(role, uid, rows) {
  const list = rows || [];
  if (role === 'owner') return list;
  if (role === 'lender') return list.filter((n) => n.kind === 'lender_overview');
  if (role === 'realtor' || role === 'reviewer') return list.filter((n) => n.kind === 'note' && Boolean(uid) && n.author_uid === uid);
  return [];
}
export const canWriteUnitNotes = (role) => role === 'owner' || role === 'realtor' || role === 'reviewer';

// Strategy ideas: the owner changes anything; the realtor deletes only her own.
export const canDeleteIdea = (role, row, uid) => role === 'owner' || (role === 'realtor' && Boolean(uid) && row?.author_uid === uid);
export const canEditIdea = (role) => role === 'owner';

// Comps.
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? null : +v);
export function perUnitOf(price, units) {
  const p = num(price);
  const u = num(units);
  return p && u && u > 0 ? Math.round(p / u) : null;
}
export function yearOf(date) {
  const m = /^(\d{4})/.exec(String(date || ''));
  return m ? Number(m[1]) : null;
}
export function compSource(c) {
  if (!c) return '';
  if (c.source_kind === 'ai') return 'Found by AI (Claude)';
  if ((c.source || '').trim()) return c.source.trim();
  if (c.added_by_role === 'owner') return 'Added by the buyer';
  if (c.added_by_role) return `Added by the ${c.added_by_role}`;
  return '';
}
export function milesLabel(d) {
  const n = num(d);
  if (n === null) return '';
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} mi away`;
}
// Owner's view of picks: comp id -> list of "Name (Role)".
export function picksByComp(picks, roleName = (r) => r) {
  const out = {};
  for (const p of picks || []) {
    const who = (p.picker_name || '').trim() || roleName(p.picker_role) || 'Someone';
    (out[p.comp_id] = out[p.comp_id] || []).push(p.picker_name ? `${who} (${roleName(p.picker_role)})` : who);
  }
  return out;
}

// Files: who can open an upload, in plain words (mirrors the uploads read rule).
export function seenByLabel(r) {
  const who = ['buyer', 'realtor'];
  if (r?.visibility === 'seller') who.push('seller');
  for (const k of ['lender', 'reviewer', 'viewer']) if ((r?.audience || []).includes(k) && (k !== 'viewer' || r?.kind === 'photo')) who.push(k);
  return `Seen by ${who.slice(0, -1).join(', ')}${who.length > 1 ? ' and ' : ''}${who.at(-1)}`;
}

// Lender terms: one row per lender, newest first, always labeled with the company.
export function lenderBoard(rows) {
  const byLender = new Map();
  for (const r of rows || []) {
    const prev = byLender.get(r.lender_uid);
    if (!prev || String(r.updated_at || r.created_at) > String(prev.updated_at || prev.created_at)) byLender.set(r.lender_uid, r);
  }
  return [...byLender.values()]
    .filter((r) => (r.company_name || '').trim())
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
}

// Whose picks the value-by-comps card can show. "Mine" always comes first for a picker;
// everyone else appears only when the database returned their picks (the owner sees all).
export function pickers(picks, myUid, roleName = (r) => r) {
  const out = myUid ? [{ uid: myUid, label: 'My picks' }] : [];
  for (const p of picks || []) {
    if (!p?.picker_uid || out.some((o) => o.uid === p.picker_uid)) continue;
    const who = (p.picker_name || '').trim() || roleName(p.picker_role) || 'Someone';
    out.push({ uid: p.picker_uid, label: who });
  }
  return out;
}

// The comps one view uses: everything, or only the comps one person picked.
export function compsForView(comps, picks, view) {
  if (!view || view === 'all') return comps || [];
  const ids = new Set((picks || []).filter((p) => p.picker_uid === view).map((p) => p.comp_id));
  return (comps || []).filter((c) => ids.has(c.id));
}

// v6.4: comps sort by any column. Blanks always go last, whichever direction.
export const COMP_SORTS = [
  ['address', 'Property'], ['units', 'Units'], ['sale_price', 'Sale price'], ['per_unit', 'Per unit'],
  ['sale_date', 'Sold'], ['distance_mi', 'Distance'], ['source', 'Source'],
];
function sortValue(c, key) {
  if (key === 'per_unit') return perUnitOf(c.sale_price, c.units);
  if (key === 'units' || key === 'sale_price' || key === 'distance_mi') return num(c[key]);
  if (key === 'sale_date') return c.sale_date ? String(c.sale_date) : null;
  if (key === 'source') return compSource(c).toLowerCase() || null;
  return String(c[key] || '').toLowerCase() || null;
}
export function sortComps(comps, key, dir = 'asc') {
  if (!key) return comps || [];
  const sign = dir === 'desc' ? -1 : 1;
  return [...(comps || [])].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign;
  });
}
// "Apr 2026" for a full date; the year alone if that's all there is.
export function soldLabel(date) {
  const m = /^(\d{4})-(\d{2})/.exec(String(date || ''));
  if (!m) return yearOf(date) ? String(yearOf(date)) : '';
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}`;
}
