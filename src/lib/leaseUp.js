import { money } from './dealmath.js';

export const STAGES = [
  ['new_lead', 'New lead'],
  ['contacted', 'Contacted'],
  ['showing', 'Showing'],
  ['applied', 'Applied'],
  ['approved', 'Approved'],
  ['moved_in', 'Moved in'],
];

export const ROOMS = [
  ['kitchen', 'Kitchen'],
  ['bath', 'Bath'],
  ['bedroom_1', 'Bedroom 1'],
  ['bedroom_2', 'Bedroom 2'],
  ['living', 'Living'],
];

export const CAP_RATES = [8, 8.5, 9, 9.5, 10];

// Role-based access matrix for v5 sections.
export function v5Access(role) {
  const owner = role === 'owner';
  const realtor = role === 'realtor';
  const reviewer = role === 'reviewer';
  return {
    walkthrough: owner || realtor,
    tenants: owner || realtor,
    comps: owner || realtor || reviewer,
    strategy: owner,
    // v8: strategy ideas are private per author (realtor or reviewer) + owner.
    ideas: owner || realtor || reviewer,
    // v6.3: per-unit photos and videos for everyone except the seller.
    unitPhotos: owner || realtor || reviewer || role === 'lender' || role === 'viewer' || role === 'guest',
    editWalkthrough: owner || realtor,
    editTenants: owner || realtor,
    saveComps: owner,
  };
}

// Walkthrough always covers 10 units plus shared areas (spaces 11-16 use the single room 'general').
export const WALK_UNITS = 10;
export const WALK_AREAS = [
  [11, 'Front stairwell (units 1-3)'],
  [12, 'Front stairwell (units 4-10)'],
  [13, 'Back stairwell (units 1-3)'],
  [14, 'Exterior'],
  [15, 'Storage'],
  [17, 'Laundry room'],
  [18, 'Utility room (gas & electric)'],
  [16, 'Back stairwell (units 4-10)'],
];
export const AREA_ROOMS = [['general', 'Photos & notes']];
export const WALK_SPACES = [...Array.from({ length: WALK_UNITS }, (_, i) => i + 1), ...WALK_AREAS.map(([n]) => n)];
export const LAST_SPACE = WALK_SPACES[WALK_SPACES.length - 1];
export const spaceLabel = (n) => (n <= WALK_UNITS ? `Unit ${n}` : WALK_AREAS.find(([k]) => k === n)?.[1] || `Area ${n}`);
export const roomsFor = (n) => (n <= WALK_UNITS ? ROOMS : AREA_ROOMS);
export const roomFits = (n, room) => roomsFor(n).some(([k]) => k === room);
// Step through spaces in the order shown (space 16 stays last), not by number.
export const stepSpace = (n, dir) => {
  const i = WALK_SPACES.indexOf(n);
  return WALK_SPACES[Math.min(WALK_SPACES.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
};
// Moving walkthrough media: the owner moves anything, the realtor only what she took.
export const canMoveMedia = (role, row, uid) =>
  role === 'owner' || (role === 'realtor' && Boolean(uid) && (row?.author_uid ?? row?.userUid) === uid);
// What still has to reach the server: queued photos/videos and voice notes not yet saved.
export function uploadCounts(media = [], sessions = []) {
  const uploading = media.filter((m) => m.status === 'uploading').length;
  const failed = media.filter((m) => m.status === 'failed').length;
  return { waiting: media.length + sessions.length, uploading, failed };
}
export const unitCount = (savedUnits) => (+savedUnits >= 10 ? 10 : 9);

export function stageMove(stage, requestedUnit, units, occupied = []) {
  if (!STAGES.some(([id]) => id === stage)) throw new Error('Choose a valid stage.');
  if (stage !== 'moved_in') return { stage, unit_number: null };
  const unit = Number(requestedUnit);
  if (!Number.isInteger(unit) || unit < 1 || unit > unitCount(units)) {
    throw new Error('Choose an available unit before moving this lead in.');
  }
  if (occupied.includes(unit)) throw new Error('That unit already has a tenant.');
  return { stage, unit_number: unit };
}

export function validComp({ address, units, sale_price }) {
  return (
    Boolean(address?.trim()) &&
    Number.isInteger(+units) &&
    +units > 0 &&
    +units <= 10000 &&
    Number.isFinite(+sale_price) &&
    +sale_price > 0 &&
    +sale_price < 1e12
  );
}

export function pricePerUnit(comp) {
  if (!validComp(comp)) return null;
  return Number(comp.sale_price) / Number(comp.units);
}

export function arvEstimate(comps, units, noi, cap) {
  const valid = (comps || []).filter(validComp);
  const avg = valid.length
    ? valid.reduce((sum, x) => sum + Number(x.sale_price) / Number(x.units), 0) / valid.length
    : null;
  const count = unitCount(units);
  const rate = Number(cap);
  const income =
    noi !== null && noi !== '' && Number.isFinite(+noi) && rate >= 8 && rate <= 10
      ? Number(noi) / (rate / 100)
      : null;
  return { avg, market: avg === null ? null : avg * count, income };
}

export function compWhatIfMessage({ savedComps, localComps, units, noi, cap }) {
  const all = [...(savedComps || []), ...(localComps || [])];
  const calc = arvEstimate(all, units, noi, cap);
  const lines = ['Comps / ARV what-if (nothing was saved):'];
  if (localComps?.length) {
    lines.push('Added comps:');
    for (const c of localComps) {
      lines.push(`- ${c.address}: ${c.units} units, ${money(+c.sale_price)} (${money(pricePerUnit(c))}/unit)`);
    }
  } else if (savedComps?.length) {
    lines.push(`Using ${savedComps.length} saved comp${savedComps.length === 1 ? '' : 's'}.`);
  }
  lines.push(
    `Units: ${unitCount(units)} · Annual NOI: ${money(noi === '' ? null : +noi)} · Cap rate: ${cap}%`,
    `Value by comps: ${money(calc.market)} (${money(calc.avg)} avg/unit × ${unitCount(units)})`,
    `Value by income: ${money(calc.income)} (NOI ÷ ${cap}%)`
  );
  return lines.join('\n');
}

// Voice notes: the owner's are his alone. Everyone else (and his "See as" preview) sees only the realtor's.
export function visibleNotes(role, rows) {
  return role === 'owner' ? rows || [] : (rows || []).filter((n) => n.author_role !== 'owner');
}

// Walkthrough photos a seller or lender may see: only the ones the owner switched on for them.
export function sharedPhotos(role, rows) {
  if (role === 'seller') return (rows || []).filter((p) => p.share_seller);
  if (role === 'lender') return (rows || []).filter((p) => p.share_lender);
  return rows || [];
}

// Tenants: the owner changes anything; the realtor changes only rows she added.
export const canChangeLead = (role, lead, uid) => role === 'owner' || (Boolean(uid) && lead?.author_uid === uid);

export const SUGGEST_FIELDS = ['name', 'phone', 'email', 'notes', 'stage'];

// Only the fields the realtor actually changed, so the owner sees a clean before/after.
export function suggestionDiff(lead, draft) {
  const out = {};
  for (const k of SUGGEST_FIELDS) {
    const next = (draft?.[k] ?? '').toString().trim();
    if (next !== ((lead?.[k] ?? '').toString().trim())) out[k] = next;
  }
  if (out.stage === 'moved_in') delete out.stage;
  return out;
}
