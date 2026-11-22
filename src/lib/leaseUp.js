export const STAGES = [
  ['new_lead', 'New lead'], ['contacted', 'Contacted'], ['showing', 'Showing'],
  ['applied', 'Applied'], ['approved', 'Approved'], ['moved_in', 'Moved in'],
];
export const ROOMS = [
  ['kitchen', 'Kitchen'], ['bath', 'Bath'], ['bedroom_1', 'Bedroom 1'],
  ['bedroom_2', 'Bedroom 2'], ['living', 'Living'],
];

export function leaseAccess(role, slug = 'charlotte') {
  const team = slug === 'charlotte' && ['owner', 'realtor', 'reviewer'].includes(role);
  const owner = team && role === 'owner';
  const realtor = team && role === 'realtor';
  return { pipeline: team, leads: team, walkthrough: team, comps: team, realtor: owner || realtor,
    strategy: owner, editTenants: owner || realtor, saveComps: owner };
}
export const unitCount = (savedUnits) => (+savedUnits === 10 ? 10 : 9);

export function stageMove(stage, requestedUnit, units, occupied = []) {
  if (!STAGES.some(([id]) => id === stage)) throw new Error('Choose a valid stage.');
  if (stage !== 'moved_in') return { stage, unit_number: null };
  const unit = Number(requestedUnit);
  if (!Number.isInteger(unit) || unit < 1 || unit > unitCount(units)) throw new Error('Choose an available unit before moving this lead in.');
  if (occupied.includes(unit)) throw new Error('That unit already has a tenant.');
  return { stage, unit_number: unit };
}

export function validComp({ address, units, sale_price }) {
  return Boolean(address?.trim()) && Number.isInteger(+units) && +units > 0 && +units <= 10000 &&
    Number.isFinite(+sale_price) && +sale_price > 0 && +sale_price < 1e12;
}
export function arvEstimate(comps, units, noi, cap) {
  const valid = comps.filter(validComp);
  const avg = valid.length ? valid.reduce((sum, x) => sum + x.sale_price / x.units, 0) / valid.length : null;
  const rate = Number(cap);
  const income = noi !== null && noi !== '' && Number.isFinite(+noi) && rate >= 8 && rate <= 10 ? Number(noi) / (rate / 100) : null;
  return { avg, market: avg === null ? null : avg * unitCount(units), income };
}
