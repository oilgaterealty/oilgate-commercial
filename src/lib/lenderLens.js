export const LENDER_LENS_OPTIONS = [
  ['bridge', 'Bridge'],
  ['private', 'Private'],
  ['dscr', 'DSCR'],
];

export const LENDER_LENS_LABELS = {
  bridge: 'Bridge',
  private: 'Private',
  dscr: 'DSCR',
};

const VALID_LENSES = new Set(['bridge', 'private', 'dscr']);
const STORAGE_KEY = 'lenderLens';

export function normalizeLenderLens(value) {
  const clean = String(value || '').trim().toLowerCase();
  return VALID_LENSES.has(clean) ? clean : '';
}

export function readLensFromLocation(hash = '', search = '') {
  const hashQuery = String(hash || '').split('?')[1] || '';
  if (hashQuery) {
    const fromHash = normalizeLenderLens(new URLSearchParams(hashQuery).get('lens'));
    if (fromHash) return fromHash;
  }
  const cleanSearch = String(search || '').replace(/^\?/, '');
  if (cleanSearch) {
    const fromSearch = normalizeLenderLens(new URLSearchParams(cleanSearch).get('lens'));
    if (fromSearch) return fromSearch;
  }
  return '';
}

export function appendLensToHash(hashPath, lens) {
  const cleanLens = normalizeLenderLens(lens);
  const raw = String(hashPath || '#/').trim() || '#/';
  if (!cleanLens) return raw;
  const [base, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (!params.has('lens')) params.set('lens', cleanLens);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function readStoredLenderLens(store = globalThis.localStorage) {
  try {
    return normalizeLenderLens(store?.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
}

export function saveStoredLenderLens(lens, store = globalThis.localStorage) {
  const clean = normalizeLenderLens(lens);
  if (!clean) return;
  try {
    store?.setItem(STORAGE_KEY, clean);
  } catch {
    // storage blocked; caller falls back to URL or member default_lens
  }
}

export function clearStoredLenderLens(store = globalThis.localStorage) {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
