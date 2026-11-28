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
    if (k === 'heatGas') continue;
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

export function normalizeUpside(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw
    .filter((it) => it && typeof it === 'object' && typeof it.label === 'string' && it.label.trim())
    .map((it, idx) => ({
      key: typeof it.key === 'string' && it.key.trim() ? it.key.trim() : `upside-${idx}`,
      label: it.label.trim(),
      valueText: typeof it.valueText === 'string' ? it.valueText.trim() : '',
      annual: it.annual !== undefined && it.annual !== null && Number.isFinite(+it.annual) ? +it.annual : null,
      overlay: Array.isArray(it.overlay)
        ? it.overlay.filter((s) => typeof s === 'string' && s.trim())
        : (typeof it.source === 'string' && it.source.trim() ? [it.source.trim()] : []),
    }));
  if (!items.length) return null;
  const overlay = Array.isArray(raw.overlay)
    ? raw.overlay.filter((s) => typeof s === 'string' && s.trim())
    : (typeof raw.note === 'string' && raw.note.trim() ? [raw.note.trim()] : []);
  return {
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'Upside (not counted)',
    totalText: typeof raw.totalText === 'string' && raw.totalText.trim() ? raw.totalText.trim() : '',
    overlay,
    items,
  };
}

export function normalizeOpex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cleanSources = cleanSourcesMap(raw.sources);
  const laundry = raw.laundry && typeof raw.laundry === 'object' ? normalizeLaundry(raw.laundry) : null;
  const upside = raw.upside && typeof raw.upside === 'object' ? normalizeUpside(raw.upside) : null;
  return {
    taxesAnnual: num(raw.taxesAnnual, 0),
    insuranceAnnual: num(raw.insuranceAnnual, 0),
    waterSewerTrashAnnual: num(raw.waterSewerTrashAnnual, 0),
    commonAreaUtilitiesAnnual: num(raw.commonAreaUtilitiesAnnual, 0),
    reservesPerUnitAnnual: num(raw.reservesPerUnitAnnual, 0),
    vacancyPct: num(raw.vacancyPct, 0),
    repairsMaintPct: num(raw.repairsMaintPct, 0),
    mgmtHelpPct: num(raw.mgmtHelpPct, 0),
    mgmtHelpAnnual: num(raw.mgmtHelpAnnual, 0),
    wifiAnnual: num(raw.wifiAnnual, 0),
    wifiLabel: typeof raw.wifiLabel === 'string' && raw.wifiLabel.trim() ? raw.wifiLabel.trim() : '',
    wifiRentAddPerUnit: num(raw.wifiRentAddPerUnit, 0),
    camerasAnnual: num(raw.camerasAnnual, 0),
    rentalRegPerUnitAnnual: num(raw.rentalRegPerUnitAnnual, 0),
    snowLawnAnnual: num(raw.snowLawnAnnual, 0),
    sources: cleanSources,
    ...(laundry ? { laundry } : {}),
    ...(upside ? { upside } : {}),
  };
}

function fmtLine(label, annual, sources, key, extraNote = '') {
  const src = sources?.[key] || extraNote;
  const mo = annual / 12;
  return `${label}: ${moneyRound(mo)}/mo (${moneyRound(annual)}/yr)${src ? ` — ${src}` : ''}`;
}

export function groupOpexCalc(calc) {
  if (!calc || typeof calc !== 'object') return [];
  const lineMap = new Map((calc.lines || []).map((l) => [l.key, l]));
  const take = (keys) => keys.map((k) => lineMap.get(k)).filter(Boolean);
  const sum = (items) => items.reduce((s, l) => s + (l.annual || 0), 0);
  const perUnitMo = calc.units > 0 ? calc.grossMonthly / calc.units : calc.grossMonthly;
  const hasWifiAdd = (calc.wifiRentAddAnnual || 0) > 0 && (calc.wifiRentAddPerUnit || 0) > 0;
  const perUnitBaseMo = calc.rentedUnits > 0
    ? (calc.baseGrossMonthly ?? calc.grossMonthly) / calc.rentedUnits
    : (calc.units > 0 ? (calc.baseGrossMonthly ?? calc.grossMonthly) / calc.units : 0);

  const rentItems = hasWifiAdd
    ? [
        {
          key: 'baseRent',
          label: `Base rent (${calc.units} × ${moneyRound(perUnitBaseMo)}/mo)`,
          valueText: `${moneyRound(calc.baseGrossAnnual)}/yr`,
          overlay: [`${calc.units} units × ${moneyRound(perUnitBaseMo)}/mo = ${moneyRound(calc.baseGrossMonthly)}/mo (${moneyRound(calc.baseGrossAnnual)}/yr)`],
          tone: 'default',
        },
        {
          key: 'wifiRent',
          label: `Wi-Fi included (+${moneyRound(calc.wifiRentAddPerUnit)}/unit)`,
          valueText: `+${moneyRound(calc.wifiRentAddAnnual)}/yr`,
          overlay: [`${calc.rentedUnits || calc.units} units × ${moneyRound(calc.wifiRentAddPerUnit)}/mo = +${moneyRound(calc.wifiRentAddMonthly)}/mo (+${moneyRound(calc.wifiRentAddAnnual)}/yr)`],
          tone: 'default',
        },
        {
          key: 'vacancy',
          label: `Vacancy (${calc.vacancyPct}%)`,
          valueText: `−${moneyRound(calc.vacancyAnnual)}/yr`,
          overlay: [calc.vacancyOverlayLine].filter(Boolean),
          tone: 'default',
        },
      ]
    : [
        {
          key: 'grossRent',
          label: `Gross rent (${calc.units} × ${moneyRound(perUnitMo)}/mo)`,
          valueText: `${moneyRound(calc.grossAnnual)}/yr`,
          overlay: [`${calc.units} units × ${moneyRound(perUnitMo)}/mo = ${moneyRound(calc.grossMonthly)}/mo (${moneyRound(calc.grossAnnual)}/yr)`],
          tone: 'default',
        },
        {
          key: 'vacancy',
          label: `Vacancy (${calc.vacancyPct}%)`,
          valueText: `−${moneyRound(calc.vacancyAnnual)}/yr`,
          overlay: [calc.vacancyOverlayLine].filter(Boolean),
          tone: 'default',
        },
      ];

  const groups = [
    {
      key: 'rent-in',
      label: `Rent in (after ${calc.vacancyPct}% vacancy)`,
      subtotalAnnual: calc.effectiveRentAnnual,
      subtotalText: `${moneyRound(calc.effectiveRentAnnual)}/yr`,
      tone: 'default',
      items: rentItems,
    },
  ];

  const l = calc.laundry;
  if (l?.enabled) {
    groups.push({
      key: 'laundry',
      label: 'Laundry income (net)',
      subtotalAnnual: l.netAnnual,
      subtotalText: `+${moneyRound(l.netAnnual)}/yr`,
      tone: 'good',
      items: [
        {
          key: 'laundryLoads',
          label: `Loads (${l.rentedUnits} rented)`,
          valueText: `${Math.round(l.loads).toLocaleString('en-US')}/yr`,
          overlay: l.overlay,
          tone: 'default',
        },
        {
          key: 'laundryGross',
          label: 'Laundry gross',
          valueText: `${moneyRound(l.grossAnnual)}/yr`,
          overlay: l.overlay,
          tone: 'default',
        },
        {
          key: 'laundryCosts',
          label: 'Laundry costs',
          valueText: `−${moneyRound(l.costsAnnual)}/yr`,
          overlay: l.overlay,
          tone: 'default',
        },
        {
          key: 'laundryNet',
          label: 'Laundry net',
          valueText: `+${moneyRound(l.netAnnual)}/yr`,
          overlay: l.overlay,
          tone: 'good',
        },
      ],
    });
  }

  const fixedLines = take(['taxes', 'insurance', 'waterSewerTrash', 'commonAreaUtilities']);
  if (fixedLines.length) {
    const sub = sum(fixedLines);
    groups.push({
      key: 'fixed',
      label: 'Fixed costs',
      subtotalAnnual: -sub,
      subtotalText: `−${moneyRound(sub)}/yr`,
      tone: 'default',
      items: fixedLines.map((item) => ({
        key: item.key,
        label: item.label,
        valueText: `−${moneyRound(item.annual)}/yr`,
        overlay: [item.text].filter(Boolean),
        tone: 'default',
      })),
    });
  }

  const upkeepLines = take(['repairsMaint', 'reserves']);
  if (upkeepLines.length) {
    const sub = sum(upkeepLines);
    groups.push({
      key: 'upkeep',
      label: 'Upkeep',
      subtotalAnnual: -sub,
      subtotalText: `−${moneyRound(sub)}/yr`,
      tone: 'default',
      items: upkeepLines.map((item) => ({
        key: item.key,
        label: item.label,
        valueText: `−${moneyRound(item.annual)}/yr`,
        overlay: [item.text].filter(Boolean),
        tone: 'default',
      })),
    });
  }

  const opsLines = take(['mgmtHelp', 'wifi', 'cameras', 'rentalReg', 'snowLawn']);
  if (opsLines.length) {
    const sub = sum(opsLines);
    groups.push({
      key: 'operations',
      label: 'Operations',
      subtotalAnnual: -sub,
      subtotalText: `−${moneyRound(sub)}/yr`,
      tone: 'default',
      items: opsLines.map((item) => ({
        key: item.key,
        label: item.label,
        valueText: `−${moneyRound(item.annual)}/yr`,
        overlay: [item.text].filter(Boolean),
        tone: 'default',
      })),
    });
  }

  return groups;
}

export function computeOpex({
  opex,
  laundry = null,
  upside = null,
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
  const baseGrossMonthly = Math.max(0, num(grossRentMonthly, 0));
  const baseGrossAnnual = baseGrossMonthly * 12;
  const wifiAddActiveUnits = baseGrossMonthly > 0 ? rented : 0;
  const wifiRentAddMonthly = wifiAddActiveUnits * n.wifiRentAddPerUnit;
  const wifiRentAddAnnual = wifiRentAddMonthly * 12;
  const grossMonthly = baseGrossMonthly + wifiRentAddMonthly;
  const grossAnnual = grossMonthly * 12;
  const vacancyPct = n.vacancyPct;
  const vacancyAnnual = applyVacancy ? grossAnnual * (vacancyPct / 100) : 0;
  const effectiveRentAnnual = grossAnnual - vacancyAnnual;
  const effectiveRentMonthly = effectiveRentAnnual / 12;

  const taxesAnnual = n.taxesAnnual;
  const insuranceAnnual = n.insuranceAnnual;
  const waterSewerTrashAnnual = n.waterSewerTrashAnnual;
  const commonAreaUtilitiesAnnual = n.commonAreaUtilitiesAnnual;
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
    + commonAreaUtilitiesAnnual
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

  const wifiLabel = n.wifiLabel || 'Wi-Fi (smart locks)';

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
    ...(commonAreaUtilitiesAnnual > 0 ? [makeLine('commonAreaUtilities', 'Common-area gas & electric', commonAreaUtilitiesAnnual)] : []),
    makeLine('reserves', reservesLabel, reservesAnnual),
    ...(repairsMaintAnnual > 0 ? [makeLine('repairsMaint', `Repairs & maintenance (${n.repairsMaintPct}%)`, repairsMaintAnnual)] : []),
    ...(mgmtHelpAnnual > 0 ? [makeLine('mgmtHelp', mgmtLabel, mgmtHelpAnnual)] : []),
    ...(wifiAnnual > 0 ? [makeLine('wifi', wifiLabel, wifiAnnual)] : []),
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

  const upsideCalc = normalizeUpside(upside ?? n.upside ?? null);

  const result = {
    normalized: n,
    units: unitCount,
    rentedUnits: rented,
    baseGrossMonthly,
    baseGrossAnnual,
    wifiRentAddPerUnit: n.wifiRentAddPerUnit,
    wifiRentAddMonthly,
    wifiRentAddAnnual,
    grossMonthly,
    grossAnnual,
    vacancyPct,
    vacancyAnnual,
    effectiveRentAnnual,
    effectiveRentMonthly,
    taxesAnnual,
    insuranceAnnual,
    waterSewerTrashAnnual,
    commonAreaUtilitiesAnnual,
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
    ...(upsideCalc ? { upside: upsideCalc } : {}),
  };
  result.groups = groupOpexCalc(result);
  return result;
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
