// Single-source operating expense (opex) calculator. Pure functions, no network, no hardcoded deal dollars.

const num = (v, d = 0) => (v !== undefined && v !== null && v !== '' && Number.isFinite(+v) ? Math.max(0, +v) : d);

const moneyRound = (v) => (v === null || v === undefined || !Number.isFinite(v)
  ? '—'
  : (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'));

export function moneyCents(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−$' : '$';
  const cents = Math.round(Math.abs(v) * 100);
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return rem === 0
    ? sign + dollars.toLocaleString('en-US')
    : sign + dollars.toLocaleString('en-US') + '.' + String(rem).padStart(2, '0');
}

export function hasOpex(obj) {
  return Boolean(obj && typeof obj === 'object' && obj.opex && typeof obj.opex === 'object');
}

export function normalizeOpex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw.sources && typeof raw.sources === 'object' ? raw.sources : {};
  const cleanSources = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'string' && v.trim()) cleanSources[k] = v.trim();
  }
  return {
    taxesAnnual: num(raw.taxesAnnual, 0),
    insuranceAnnual: num(raw.insuranceAnnual, 0),
    waterSewerTrashAnnual: num(raw.waterSewerTrashAnnual, 0),
    heatGasAnnual: num(raw.heatGasAnnual, 0),
    reservesPerUnitAnnual: num(raw.reservesPerUnitAnnual, 0),
    vacancyPct: num(raw.vacancyPct, 0),
    repairsMaintPct: num(raw.repairsMaintPct, 0),
    mgmtHelpPct: num(raw.mgmtHelpPct, 0),
    wifiAnnual: num(raw.wifiAnnual, 0),
    camerasAnnual: num(raw.camerasAnnual, 0),
    rentalRegPerUnitAnnual: num(raw.rentalRegPerUnitAnnual, 0),
    snowLawnAnnual: num(raw.snowLawnAnnual, 0),
    sources: cleanSources,
  };
}

function fmtLine(label, annual, sources, key, extraNote = '') {
  const src = sources?.[key] || extraNote;
  const mo = annual / 12;
  return `${label}: ${moneyRound(mo)}/mo (${moneyRound(annual)}/yr)${src ? ` — ${src}` : ''}`;
}

export function computeOpex({
  opex,
  units = 10,
  rentedUnits = units,
  grossRentMonthly = 0,
  applyVacancy = true,
  capRate = 9,
} = {}) {
  const n = normalizeOpex(opex);
  if (!n) return null;
  const unitCount = Math.max(0, num(units, 10));
  const rented = Math.max(0, Math.min(unitCount || 10, num(rentedUnits, unitCount)));
  const grossMonthly = Math.max(0, num(grossRentMonthly, 0));
  const grossAnnual = grossMonthly * 12;
  const vacancyPct = n.vacancyPct;
  const vacancyAnnual = applyVacancy ? grossAnnual * (vacancyPct / 100) : 0;
  const effectiveRentAnnual = grossAnnual - vacancyAnnual;
  const effectiveRentMonthly = effectiveRentAnnual / 12;

  const taxesAnnual = n.taxesAnnual;
  const insuranceAnnual = n.insuranceAnnual;
  const waterSewerTrashAnnual = n.waterSewerTrashAnnual;
  const heatGasAnnual = n.heatGasAnnual;
  const reservesAnnual = rented * n.reservesPerUnitAnnual;
  const repairsMaintAnnual = grossAnnual * (n.repairsMaintPct / 100);
  const mgmtHelpAnnual = grossAnnual * (n.mgmtHelpPct / 100);
  const wifiAnnual = n.wifiAnnual;
  const camerasAnnual = n.camerasAnnual;
  const rentalRegAnnual = unitCount * n.rentalRegPerUnitAnnual;
  const snowLawnAnnual = n.snowLawnAnnual;

  const fixedAnnual = taxesAnnual
    + insuranceAnnual
    + waterSewerTrashAnnual
    + heatGasAnnual
    + wifiAnnual
    + camerasAnnual
    + rentalRegAnnual
    + snowLawnAnnual;
  const variableAnnual = repairsMaintAnnual + mgmtHelpAnnual;
  const totalExpensesAnnual = fixedAnnual + reservesAnnual + variableAnnual;
  const totalExpensesMonthly = totalExpensesAnnual / 12;
  const noiAnnual = effectiveRentAnnual - totalExpensesAnnual;
  const noiMonthly = noiAnnual / 12;
  const rate = num(capRate, 9);
  const value = rate > 0 ? Math.max(0, noiAnnual / (rate / 100)) : 0;

  const src = n.sources || {};
  const lines = [
    { key: 'taxes', label: 'Property taxes', annual: taxesAnnual, monthly: taxesAnnual / 12, text: fmtLine('Property taxes', taxesAnnual, src, 'taxes') },
    { key: 'insurance', label: 'Insurance', annual: insuranceAnnual, monthly: insuranceAnnual / 12, text: fmtLine('Insurance', insuranceAnnual, src, 'insurance') },
    { key: 'waterSewerTrash', label: 'Water, sewer and trash', annual: waterSewerTrashAnnual, monthly: waterSewerTrashAnnual / 12, text: fmtLine('Water, sewer and trash', waterSewerTrashAnnual, src, 'waterSewerTrash') },
    ...(heatGasAnnual > 0 || src.heatGas ? [{ key: 'heatGas', label: 'Heat / gas', annual: heatGasAnnual, monthly: heatGasAnnual / 12, text: fmtLine('Heat / gas', heatGasAnnual, src, 'heatGas') }] : []),
    { key: 'reserves', label: rented < unitCount ? `Reserves (${rented} rented)` : 'Reserves (CapEx)', annual: reservesAnnual, monthly: reservesAnnual / 12, text: fmtLine(rented < unitCount ? `Reserves (${rented} rented)` : 'Reserves (CapEx)', reservesAnnual, src, 'reserves') },
    ...(repairsMaintAnnual > 0 ? [{ key: 'repairsMaint', label: `Repairs & maintenance (${n.repairsMaintPct}%)`, annual: repairsMaintAnnual, monthly: repairsMaintAnnual / 12, text: fmtLine(`Repairs & maintenance (${n.repairsMaintPct}%)`, repairsMaintAnnual, src, 'repairsMaint') }] : []),
    ...(mgmtHelpAnnual > 0 ? [{ key: 'mgmtHelp', label: `Management help (${n.mgmtHelpPct}%)`, annual: mgmtHelpAnnual, monthly: mgmtHelpAnnual / 12, text: fmtLine(`Management help (${n.mgmtHelpPct}%)`, mgmtHelpAnnual, src, 'mgmtHelp') }] : []),
    ...(wifiAnnual > 0 ? [{ key: 'wifi', label: 'Wi-Fi (smart locks)', annual: wifiAnnual, monthly: wifiAnnual / 12, text: fmtLine('Wi-Fi (smart locks)', wifiAnnual, src, 'wifi') }] : []),
    ...(camerasAnnual > 0 ? [{ key: 'cameras', label: 'Cameras', annual: camerasAnnual, monthly: camerasAnnual / 12, text: fmtLine('Cameras', camerasAnnual, src, 'cameras') }] : []),
    ...(rentalRegAnnual > 0 ? [{ key: 'rentalReg', label: 'Rental registration', annual: rentalRegAnnual, monthly: rentalRegAnnual / 12, text: fmtLine('Rental registration', rentalRegAnnual, src, 'rentalReg') }] : []),
    ...(snowLawnAnnual > 0 ? [{ key: 'snowLawn', label: 'Snow and lawn', annual: snowLawnAnnual, monthly: snowLawnAnnual / 12, text: fmtLine('Snow and lawn', snowLawnAnnual, src, 'snowLawn') }] : []),
  ];

  const costsOverlay = [
    ...lines.map((l) => l.text),
    `Total operating costs: ${moneyRound(totalExpensesMonthly)}/mo (${moneyRound(totalExpensesAnnual)}/yr).`,
  ];

  const vacancyOverlayLine = applyVacancy
    ? `Less ${vacancyPct}% vacancy: ${moneyRound(effectiveRentMonthly)}/mo${src.vacancy ? ` (${src.vacancy})` : ''}`
    : null;

  return {
    normalized: n,
    units: unitCount,
    rentedUnits: rented,
    grossMonthly,
    grossAnnual,
    vacancyPct,
    vacancyAnnual,
    effectiveRentAnnual,
    effectiveRentMonthly,
    taxesAnnual,
    insuranceAnnual,
    waterSewerTrashAnnual,
    heatGasAnnual,
    reservesAnnual,
    repairsMaintAnnual,
    mgmtHelpAnnual,
    wifiAnnual,
    camerasAnnual,
    rentalRegAnnual,
    snowLawnAnnual,
    fixedAnnual,
    variableAnnual,
    totalExpensesAnnual,
    totalExpensesMonthly,
    noiAnnual,
    noiMonthly,
    capRate: rate,
    value,
    lines,
    costsOverlay,
    vacancyOverlayLine,
  };
}

// Keep base.opex in sync when a user edits overlapping building assumptions in local what-if controls.
export function syncOpexOverride(base, field, value) {
  const next = { ...base, [field]: value };
  if (!hasOpex(base)) return next;
  const opex = { ...base.opex };
  const v = value === '' ? 0 : Math.max(0, +value || 0);
  if (field === 'vacancyPct') opex.vacancyPct = v;
  else if (field === 'taxes') opex.taxesAnnual = v;
  else if (field === 'insurance') opex.insuranceAnnual = v;
  else if (field === 'waterMo') opex.waterSewerTrashAnnual = v * 12;
  else if (field === 'reservesPerUnit') opex.reservesPerUnitAnnual = v;
  return { ...next, opex };
}
