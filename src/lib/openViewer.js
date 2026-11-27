// Pure helpers for the unauthenticated open viewer link, view counter, and lender/reviewer request form.
export { getOpenViewerFacts } from './openViewerFacts.js';

export const OPEN_REQUEST_ROLES = [
  ['lender', 'Lender'],
  ['reviewer', 'Reviewer'],
];

const VISITOR_KEY = 'og_open_visitor_id';
const VISITOR_RE = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function defaultMakeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll('-', '');
  }
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`.slice(0, 64);
}

/**
 * Reads or creates a random anonymous visitor id capped at 64 chars, surviving blocked storage.
 */
export function getOrCreateVisitorId(store = globalThis.localStorage, makeId = defaultMakeId) {
  try {
    const existing = store?.getItem?.(VISITOR_KEY) || '';
    if (VISITOR_RE.test(existing)) return existing;
  } catch {
    // storage unavailable; fall through to ephemeral id
  }
  const raw = String(makeId() || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const id = raw.length >= 8 ? raw : defaultMakeId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  try {
    store?.setItem?.(VISITOR_KEY, id);
  } catch {
    // ignore blocked storage
  }
  return id;
}

/**
 * Allowlists only the fields rendered by the signed-in viewer view (deal summary + viewer photos).
 */
export function filterOpenViewerSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw.deal;
  if (!d || typeof d !== 'object' || !d.id || !d.slug) return null;

  const deal = {
    id: String(d.id),
    slug: String(d.slug),
    title: String(d.title || ''),
    address: String(d.address || ''),
    units: 10,
    summary: String(d.summary || '').trim() || '10-unit residential property.',
  };

  const photos = Array.isArray(raw.photos)
    ? raw.photos
        .filter((p) => p && typeof p === 'object' && (!p.kind || p.kind === 'photo') && (p.storage_path || p.url))
        .map((p) => ({
          id: String(p.id || p.storage_path || p.url),
          kind: 'photo',
          storage_path: p.storage_path ? String(p.storage_path) : '',
          url: p.url ? String(p.url) : '',
          note: p.note ? String(p.note) : '',
          featured: Boolean(p.featured),
          created_at: p.created_at ? String(p.created_at) : '',
        }))
    : [];

  const walkthroughPhotos = Array.isArray(raw.walkthrough_photos)
    ? raw.walkthrough_photos
        .filter((p) => p && typeof p === 'object' && Number.isFinite(Number(p.unit_number)) && (p.storage_path || p.url))
        .map((p) => ({
          id: String(p.id || p.storage_path || p.url),
          unit_number: Number(p.unit_number),
          room: String(p.room || 'general'),
          storage_path: p.storage_path ? String(p.storage_path) : '',
          url: p.url ? String(p.url) : '',
          created_at: p.created_at ? String(p.created_at) : '',
        }))
    : [];

  return { deal, photos, walkthroughPhotos };
}

/**
 * Validates open-viewer access requests (lender or reviewer only, length caps, basic email, honeypot).
 */
export function validateAccessRequest({ name = '', company = '', email = '', role = '', note = '', honeypot = '' } = {}) {
  if (String(honeypot || '').trim()) {
    return { ok: true, honeypot: true, values: null };
  }
  const cleanName = String(name || '').trim().slice(0, 120);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanRole = String(role || '').trim().toLowerCase();
  const cleanCompany = cleanRole === 'lender' ? String(company || '').trim().slice(0, 120) : '';
  const cleanNote = String(note || '').trim().slice(0, 1000);

  if (!cleanName) return { ok: false, error: 'Name required' };
  if (cleanEmail.length < 3 || cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) {
    return { ok: false, error: 'Valid email required' };
  }
  if (cleanRole !== 'lender' && cleanRole !== 'reviewer') {
    return { ok: false, error: 'Choose Lender or Reviewer' };
  }
  return {
    ok: true,
    honeypot: false,
    values: {
      name: cleanName,
      company: cleanCompany,
      email: cleanEmail,
      role: cleanRole,
      note: cleanNote,
    },
  };
}

/**
 * Summarizes open viewer link state, total views, unique visitors, and last viewed timestamp for Owner view.
 */
export function summarizeOpenViews(links = [], views = []) {
  const linkList = Array.isArray(links) ? links : [];
  const activeLink = linkList.find((l) => l && !l.revoked_at) || null;
  const viewList = Array.isArray(views) ? views : [];
  const visitors = new Set();
  let lastViewed = null;
  for (const v of viewList) {
    if (!v) continue;
    if (v.visitor) visitors.add(String(v.visitor));
    if (v.viewed_at && (!lastViewed || String(v.viewed_at) > lastViewed)) {
      lastViewed = String(v.viewed_at);
    }
  }
  return {
    activeLink,
    totalViews: viewList.length,
    uniqueVisitors: visitors.size,
    lastViewed,
  };
}

/**
 * Merges signed photo URLs by id into a photo list without mutating inputs or appending unknown ids.
 */
export function mergePhotoUrlsById(rows = [], signedRows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const urlById = new Map();
  if (Array.isArray(signedRows)) {
    for (const item of signedRows) {
      if (!item || typeof item !== 'object' || item.id == null) continue;
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (url) urlById.set(String(item.id), url);
    }
  }
  return list.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const nextUrl = row.id != null ? urlById.get(String(row.id)) : undefined;
    return nextUrl ? { ...row, url: nextUrl } : { ...row };
  });
}

/**
 * Applies signed photo and walkthrough_photos URLs returned by open-viewer-photos onto a snapshot.
 */
export function mergeOpenViewerPhotoUrls(snapshot, signed) {
  if (!snapshot || typeof snapshot !== 'object' || !signed || typeof signed !== 'object') {
    return snapshot;
  }
  return {
    ...snapshot,
    photos: mergePhotoUrlsById(snapshot.photos, signed.photos),
    walkthroughPhotos: mergePhotoUrlsById(snapshot.walkthroughPhotos, signed.walkthrough_photos),
  };
}

/**
 * Picks the featured cover photo once signed URLs are loaded, falling back to the first loaded photo.
 */
export function selectFeaturedPhoto(photos = [], walkthroughPhotos = []) {
  const coverCandidates = (Array.isArray(photos) ? photos : []).filter(
    (p) => p && typeof p === 'object' && (!p.kind || p.kind === 'photo') && typeof p.url === 'string' && p.url.trim(),
  );
  const pick =
    coverCandidates.find((p) => Boolean(p.featured)) ||
    coverCandidates[0] ||
    (Array.isArray(walkthroughPhotos) ? walkthroughPhotos : []).find(
      (p) => p && typeof p === 'object' && typeof p.url === 'string' && p.url.trim(),
    ) ||
    null;
  if (!pick) return null;
  return {
    id: String(pick.id || pick.storage_path || pick.url),
    url: pick.url.trim(),
    alt: String(pick.note || '').trim() || 'Property photo',
  };
}
