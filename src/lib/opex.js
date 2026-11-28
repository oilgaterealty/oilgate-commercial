// Single-source operating expense (opex) and laundry income calculator. Pure functions, no network, no hardcoded deal dollars.

const num = (v, d = 0) => (v !== undefined && v !== null && v !== '' && Number.isFinite(+v) ? Math.max(0, +v) : d);

export const DEFAULT_LAUNDRY = {
  enabled: false,
  stacks: 2,
  pricePerLoad: 4,
  loadsPerUnitPerWeek: 3,
  utilityPerLoad: 0.45,
  cardSharePct: 60,
  cardFeePct: 4,
  readerFeesAnnual: 480,
  repairsPerStackAnnual: 250,
  sources: {},
};

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

function cleanSourcesMap(rawSources) {
  const s = rawSources && typeof rawSources === 'object' ? rawSources : {};
  const cleanSources = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'string' && v.trim()) cleanSources[k] = v.trim();
  }
  return cleanSources;
}

export function normalizeLaundry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    enabled: Boolean(raw.enabled),
    stacks: num(raw.stacks, DEFAULT_LAUNDRY.stacks),
    pricePerLoad: num(raw.pricePerLoad, DEFAULT_LAUNDRY.pricePerLoad),
    loadsPerUnitPerWeek: num(raw.loadsPerUnitPerWeek, DEFAULT_LAUNDRY.loadsPerUnitPerWeek),
    utilityPerLoad: num(raw.utilityPerLoad, DEFAULT_LAUNDRY.utilityPerLoad),
    cardSharePct: num(raw.cardSharePct, DEFAULT_LAUNDRY.cardSharePct),
    cardFeePct: num(raw.cardFeePct, DEFAULT_LAUNDRY.cardFeePct),
    readerFeesAnnual: num(raw.readerFeesAnnual, DEFAULT_LAUNDRY.readerFeesAnnual),
    repairsPerStackAnnual: num(raw.repairsPerStackAnnual, DEFAULT_LAUNDRY.repairsPerStackAnnual),
    sources: cleanSourcesMap(raw.sources),
  };
}

export function computeLaundry(rawLaundry, rentedUnits = 0) {
  const n = normalizeLaundry(rawLaundry);
  const rented = Math.max(0, num(rentedUnits, 0));
  if (!n || !n.enabled || rented <= 0) {
    return {
      enabled: Boolean(n?.enabled),
      active: false,
      stacks: n?.stacks ?? 0,
      rentedUnits: rented,
      loads: 0,
      grossAnnual: 0,
      grossMonthly: 0,
      utilityAnnual: 0,
      cardFeeAnnual: 0,
      readerFeesAnnual: 0,
      repairsAnnual: 0,
      costsAnnual: 0,
      costsMonthly: 0,
      netAnnual: 0,
      netMonthly: 0,
      overlay: n?.enabled ? ['Laundry enabled: $0 while 0 units are rented.'] : [],
      config: n,
    };
  }
  const loads = rented * n.loadsPerUnitPerWeek * 52;
  const grossAnnual = loads * n.pricePerLoad;
  const utilityAnnual = loads * n.utilityPerLoad;
  const cardFeeAnnual = grossAnnual * (n.cardSharePct / 100) * (n.cardFeePct / 100);
  const readerFeesAnnual = n.readerFeesAnnual;
  const repairsAnnual = n.stacks * n.repairsPerStackAnnual;
  const costsAnnual = utilityAnnual + cardFeeAnnual + readerFeesAnnual + repairsAnnual;
  const netAnnual = grossAnnual - costsAnnual;
  const src = n.sources || {};
  const overlay = [
    `${rented} units × ${n.loadsPerUnitPerWeek} loads/wk × 52 wks = ${Math.round(loads).toLocaleString('en-US')} loads/yr at ${moneyCents(n.pricePerLoad)}/load = ${moneyRound(grossAnnual)}/yr${src.gross ? ` (${src.gross})` : ''}`,
    `Laundry utilities (${moneyCents(n.utilityPerLoad)}/load): −${moneyRound(utilityAnnual)}/yr`,
    `Card fees (${n.cardSharePct}% card × ${n.cardFeePct}% fee): −${moneyRound(cardFeeAnnual)}/yr`,
    `Reader fees: −${moneyRound(readerFeesAnnual)}/yr${src.reader ? ` (${src.reader})` : ''}`,
    `Machine repairs (${n.stacks} stacks × ${moneyRound(n.repairsPerStackAnnual)}/yr): −${moneyRound(repairsAnnual)}/yr`,
    `Laundry net: ${moneyRound(netAnnual)}/yr (${moneyRound(netAnnual / 12)}/mo).`,
  ];
  return {
    enabled: true,
    active: true,
    stacks: n.stacks,
    rentedUnits: rented,
    loads,
    grossAnnual,
    grossMonthly: grossAnnual / 12,
    utilityAnnual,
    cardFeeAnnual,
    readerFeesAnnual,
    repairsAnnual,
    costsAnnual,
    costsMonthly: costsAnnual / 12,
    netAnnual,
    netMonthly: netAnnual / 12,
    overlay,
    config: n,
  };
}

export function normalizeOpex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cleanSources = cleanSourcesMap(raw.sources);
  const laundry = raw.laundry && typeof raw.laundry === 'object' ? normalizeLaundry(raw.laundry) : null;
  return {
    taxesAnnual: num(raw.taxesAnnual, 0),
    insuranceAnnual: num(raw.insuranceAnnual, 0),
    waterSewerTrashAnnual: num(raw.waterSewerTrashAnnual, 0),
    heatGasAnnual: num(raw.heatGasAnnual, 0),
    reservesPerUnitAnnual: num(raw.reservesPerUnitAnnual, 0),
    vacancyPct: num(raw.vacancyPct, 0),
    repairsMaintPct: num(raw.repairsMaintPct, 0),
    mgmtHelpPct: num(raw.mgmtHelpPct, 0),
    mgmtHelpAnnual: num(raw.mgmtHelpAnnual, 0),
    wifiAnnual: num(raw.wifiAnnual, 0),
    camerasAnnual: num(raw.camerasAnnual, 0),
    rentalRegPerUnitAnnual: num(raw.rentalRegPerUnitAnnual, 0),
    snowLawnAnnual: num(raw.snowLawnAnnual, 0),
    sources: cleanSources,
    ...(laundry ? { laundry } : {}),
  };
}

function fmtLine(label, annual, sources, key, extraNote = '') {
  const src = sources?.[key] || extraNote;
  const mo = annual / 12;
  return `${label}: ${moneyRound(mo)}/mo (${moneyRound(annual)}/yr)${src ? ` — ${src}` : ''}`;
}

export function computeOpex({
  opex,
  laundry = null,
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
  const isFlatMgmtHelp = n.mgmtHelpAnnual > 0;
  const mgmtHelpAnnual = isFlatMgmtHelp ? n.mgmtHelpAnnual : grossAnnual * (n.mgmtHelpPct / 100);
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
    + snowLawnAnnual
    + (isFlatMgmtHelp ? mgmtHelpAnnual : 0);
  const variableAnnual = repairsMaintAnnual + (isFlatMgmtHelp ? 0 : mgmtHelpAnnual);
  const totalExpensesAnnual = fixedAnnual + reservesAnnual + variableAnnual;
  const totalExpensesMonthly = totalExpensesAnnual / 12;

  const laundryCalc = computeLaundry(laundry ?? n.laundry ?? null, rented);
  const laundryNetAnnual = laundryCalc.netAnnual;
  const laundryNetMonthly = laundryCalc.netMonthly;

  const noiAnnual = effectiveRentAnnual + laundryNetAnnual - totalExpensesAnnual;
  const noiMonthly = noiAnnual / 12;
  const rate = num(capRate, 9);
  const value = rate > 0 ? Math.max(0, noiAnnual / (rate / 100)) : 0;

  const src = n.sources || {};
  const mgmtLabel = isFlatMgmtHelp
    ? `Management help (${moneyRound(mgmtHelpAnnual / 12)}/mo)`
    : `Management help (${n.mgmtHelpPct}%)`;
  const reservesLabel = rented < unitCount
    ? `Reserves (${rented} rented)`
    : `Reserves (${moneyRound(n.reservesPerUnitAnnual)}/unit)`;
  const rentalRegLabel = n.rentalRegPerUnitAnnual > 0
    ? `Rental registration (${moneyRound(n.rentalRegPerUnitAnnual)}/unit)`
    : 'Rental registration';

  const makeLine = (key, label, annual) => ({
    key,
    label,
    annual,
    monthly: annual / 12,
    source: src[key] || '',
    text: fmtLine(label, annual, src, key),
  });

  const lines = [
    makeLine('taxes', 'Property taxes', taxesAnnual),
    makeLine('insurance', 'Insurance', insuranceAnnual),
    makeLine('waterSewerTrash', 'Water, sewer and trash', waterSewerTrashAnnual),
    ...(heatGasAnnual > 0 || src.heatGas ? [makeLine('heatGas', 'Heat / gas', heatGasAnnual)] : []),
    makeLine('reserves', reservesLabel, reservesAnnual),
    ...(repairsMaintAnnual > 0 ? [makeLine('repairsMaint', `Repairs & maintenance (${n.repairsMaintPct}%)`, repairsMaintAnnual)] : []),
    ...(mgmtHelpAnnual > 0 ? [makeLine('mgmtHelp', mgmtLabel, mgmtHelpAnnual)] : []),
    ...(wifiAnnual > 0 ? [makeLine('wifi', 'Wi-Fi (smart locks)', wifiAnnual)] : []),
    ...(camerasAnnual > 0 ? [makeLine('cameras', 'Cameras', camerasAnnual)] : []),
    ...(rentalRegAnnual > 0 ? [makeLine('rentalReg', rentalRegLabel, rentalRegAnnual)] : []),
    ...(snowLawnAnnual > 0 ? [makeLine('snowLawn', 'Snow and lawn', snowLawnAnnual)] : []),
  ];

  const costsOverlay = [
    ...lines.map((l) => l.text),
    `Total operating costs: ${moneyRound(totalExpensesMonthly)}/mo (${moneyRound(totalExpensesAnnual)}/yr).`,
    ...(laundryCalc.active ? [`Laundry net income: +${moneyRound(laundryNetMonthly)}/mo (+${moneyRound(laundryNetAnnual)}/yr).`] : []),
  ];

  const vacancyOverlayLine = applyVacancy
    ? `Less ${vacancyPct}% vacancy: ${moneyRound(effectiveRentMonthly)}/mo${src.vacancy ? ` (${src.vacancy})` : ''}`
    : null;

  const vacancyLine = {
    key: 'vacancy',
    label: `Vacancy (${vacancyPct}%)`,
    annual: vacancyAnnual,
    monthly: vacancyAnnual / 12,
    source: src.vacancy || '',
    text: vacancyOverlayLine || `Vacancy (${vacancyPct}%): $0`,
  };

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
    isFlatMgmtHelp,
    wifiAnnual,
    camerasAnnual,
    rentalRegAnnual,
    snowLawnAnnual,
    fixedAnnual,
    variableAnnual,
    totalExpensesAnnual,
    totalExpensesMonthly,
    laundry: laundryCalc,
    laundryNetAnnual,
    laundryNetMonthly,
    noiAnnual,
    noiMonthly,
    capRate: rate,
    value,
    lines,
    vacancyLine,
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
