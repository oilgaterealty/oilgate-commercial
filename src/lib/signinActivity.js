import { roleLabel } from './format.js';

export const PHOENIX_TZ = 'America/Phoenix';

const phoenixDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PHOENIX_TZ,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const phoenixDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PHOENIX_TZ,
  month: 'short',
  day: 'numeric',
});

/** Formats an ISO timestamp as date + time in America/Phoenix. */
export function formatPhoenixDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return phoenixDateTimeFormatter.format(d);
}

/** Formats an ISO timestamp as a short date in America/Phoenix. */
export function formatPhoenixDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return phoenixDateFormatter.format(d);
}

/** Maps auth audit action names to owner-facing labels. */
export function signinActionLabel(action) {
  if (action === 'user_signedup') return 'Signed up';
  return 'Signed in';
}

/** Formats member or requested role labels for the Sign-ins card. */
export function signinRoleLabel(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('requested ')) {
    const sub = raw.slice('requested '.length).trim();
    return `Requested ${roleLabel[sub] || sub || 'access'}`;
  }
  return roleLabel[raw] || role;
}

/** Sorts sign-in rows newest first and marks the latest entry per email. */
export function annotateSignins(rows) {
  const sorted = [...(rows || [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const seen = new Set();
  return sorted.map((row) => {
    const key = String(row.email || '').trim().toLowerCase();
    const isLatest = Boolean(key) && !seen.has(key);
    if (key) seen.add(key);
    return { ...row, isLatest };
  });
}

/** Indexes the most recent sign-in row by lowercased email for member summary chips. */
export function latestSigninByEmail(rows) {
  const map = {};
  for (const row of annotateSignins(rows)) {
    const key = String(row.email || '').trim().toLowerCase();
    if (key && row.isLatest) map[key] = row;
  }
  return map;
}

/**
 * Resolves a member's sign-in chip state.
 * Returns unavailable (show nothing) when sign-in RPC data is missing/loading or a page view contradicts "Never signed in".
 */
export function resolveMemberSigninStatus(member, signins, seen) {
  if (!Array.isArray(signins)) return { kind: 'unavailable', row: null };
  const email = String(member?.email || '').trim().toLowerCase();
  const row = email ? latestSigninByEmail(signins)[email] || null : null;
  if (row) return { kind: 'signed_in', row };
  if (email && seen && seen[email]) return { kind: 'unavailable', row: null };
  return { kind: 'never', row: null };
}
