// Roles a visitor can ask for on the shared site. The owner can still approve as any role.
export const REQUEST_ROLES = [
  ['reviewer', 'Reviewer'],
  ['lender', 'Lender'],
  ['viewer', 'Viewer'],
];

// Roles a signed-in viewer can request an upgrade to.
export const VIEWER_REQUEST_ROLES = [
  ['lender', 'Lender'],
  ['reviewer', 'Reviewer'],
];

const KEY = 'requestRole';
const valid = (r) => REQUEST_ROLES.some(([k]) => k === r);

export function readRequestRole(store = globalThis.localStorage) {
  try {
    const r = store?.getItem(KEY) || '';
    return valid(r) ? r : '';
  } catch {
    return '';
  }
}

export function saveRequestRole(role, store = globalThis.localStorage) {
  try {
    if (valid(role)) store?.setItem(KEY, role);
  } catch {
    // storage blocked; the visitor picks again after sign-in
  }
}

export function clearRequestRole(store = globalThis.localStorage) {
  try {
    store?.removeItem(KEY);
  } catch {
    // ignore
  }
}
