export const FRAME_SESSION_MSG_TYPE = 'og-session';
export const POPUP_QUERY_PARAM = 'popup_signin';
export const POPUP_STORAGE_KEY = 'og_popup_signin';

export function parseAllowedOrigin(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function isAllowedFrameParent({ siteKind, allowedParent, framed, ancestorOrigins, referrer }) {
  if (!framed) return true;
  if (siteKind !== 'owner') return false;
  const allowed = parseAllowedOrigin(allowedParent);
  if (!allowed) return false;
  if (ancestorOrigins && typeof ancestorOrigins.length === 'number' && ancestorOrigins.length > 0) {
    return Array.from(ancestorOrigins).every((origin) => origin === allowed);
  }
  if (typeof referrer === 'string' && referrer.trim()) {
    try {
      return new URL(referrer).origin === allowed;
    } catch {
      return false;
    }
  }
  return false;
}

export function isValidSessionMessage(event, expectedOrigin, expectedSource) {
  if (!event || !expectedOrigin || !expectedSource) return false;
  if (event.origin !== expectedOrigin) return false;
  if (event.source !== expectedSource) return false;
  const data = event.data;
  if (!data || typeof data !== 'object') return false;
  if (data.type !== FRAME_SESSION_MSG_TYPE) return false;
  return typeof data.access_token === 'string' && data.access_token.length > 0
    && typeof data.refresh_token === 'string' && data.refresh_token.length > 0;
}

export function isPopupSignInFlow(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  try {
    const q = new URLSearchParams(win.location?.search || '').get(POPUP_QUERY_PARAM);
    if (q === '1') return true;
    return win.sessionStorage?.getItem(POPUP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPopupSignInFlow(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return;
  try {
    const q = new URLSearchParams(win.location?.search || '').get(POPUP_QUERY_PARAM);
    if (q === '1') win.sessionStorage?.setItem(POPUP_STORAGE_KEY, '1');
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

export function clearPopupSignInFlow(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return;
  try {
    win.sessionStorage?.removeItem(POPUP_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function deliverPopupSession(session, win = typeof window !== 'undefined' ? window : null) {
  if (!win?.opener || !session?.access_token || !session?.refresh_token) return false;
  win.opener.postMessage(
    {
      type: FRAME_SESSION_MSG_TYPE,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    },
    win.location.origin,
  );
  if (typeof win.close === 'function') win.close();
  return true;
}
