import { money } from './dealmath.js';
import { computeOpex, hasOpex, normalizeUpside } from './opex.js';

function rentOverlayLine(units, baseRent, calc) {
  if ((calc.wifiRentAddMonthly || 0) > 0 && (calc.wifiRentAddPerUnit || 0) > 0) {
    return `${units} × (${money(baseRent)} + ${money(calc.wifiRentAddPerUnit)} Wi-Fi)/mo = ${money(calc.grossMonthly)}/mo`;
  }
  return `${units} × ${money(baseRent)}/mo = ${money(calc.grossMonthly)}/mo`;
}

export function defaultMarketRent(mr) {
  if (!mr) return 0;
  const low = +mr.low;
  const high = +mr.high;
  const def = +mr.defaultRent;
  if (Number.isFinite(def) && def > 0) {
    if (Number.isFinite(low) && Number.isFinite(high) && high >= low && low > 0) {
      return Math.round(Math.min(high, Math.max(low, def)));
    }
    return Math.round(def);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 0;
  if (high <= low) return Math.round(low);
  return Math.round((low + high) / 2);
}

export function effectiveMarketRange(mr, base = null) {
  if (!mr) return null;
  const baseLow = +base?.marketRentLow;
  const baseHigh = +base?.marketRentHigh;
  const low = Number.isFinite(baseLow) && baseLow > 0
    ? baseLow
    : (Number.isFinite(+mr.low) && +mr.low > 0 ? +mr.low : 0);
  const high = Number.isFinite(baseHigh) && baseHigh > 0
    ? baseHigh
    : (Number.isFinite(+mr.high) && +mr.high > 0 ? +mr.high : 0);
  const baseRent = +base?.rent;
  const defaultRent = Number.isFinite(baseRent) && baseRent > 0
    ? baseRent
    : (Number.isFinite(+mr.defaultRent) && +mr.defaultRent > 0 ? +mr.defaultRent : undefined);
  const laundry = base?.laundry || mr?.laundry || mr?.opex?.laundry || null;
  const upside = normalizeUpside(base?.upside || mr?.upside || mr?.opex?.upside || null);
  const baseMerged = {
    ...mr,
    ...(defaultRent !== undefined ? { defaultRent } : {}),
    ...(laundry ? { laundry } : {}),
    ...(upside ? { upside } : {}),
  };
  if (!(low > 0) || !(high >= low)) return baseMerged;
  return { ...baseMerged, low, high };
}

export function rangeSummary(mr, rent) {
  if (!mr) return null;
  const units = mr.units || 10;
  const r = Number.isFinite(+rent) ? +rent : 0;
  const capRate = mr.capRate > 0 ? mr.capRate : 9;
  if (hasOpex(mr)) {
    const calc = computeOpex({
      opex: mr.opex,
      laundry: mr.laundry || mr.opex?.laundry || null,
      upside: mr.upside || mr.opex?.upside || null,
      units,
      rentedUnits: units,
      grossRentMonthly: units * r,
      applyVacancy: true,
      capRate,
    });
    return {
      grossMo: calc.grossMonthly,
      rentMo: calc.effectiveRentMonthly,
      costsMo: calc.totalExpensesMonthly,
      netYr: calc.noiAnnual,
      value: calc.value,
      vacancyPct: calc.vacancyPct,
      costsOverlay: calc.costsOverlay,
      rentOverlay: [rentOverlayLine(units, r, calc), calc.vacancyOverlayLine].filter(Boolean),
      opexCalc: calc,
    };
  }
  const grossMo = units * r;
  const rentMo = grossMo * (1 - mr.vacancyPct / 100);
  const netYr = (rentMo - mr.costsMo) * 12;
  const value = capRate > 0 ? Math.max(0, netYr / (capRate / 100)) : 0;
  return {
    grossMo,
    rentMo,
    costsMo: mr.costsMo,
    netYr,
    value,
    vacancyPct: mr.vacancyPct,
    costsOverlay: [`Operating costs: ${money(mr.costsMo)}/mo`],
    rentOverlay: [`${units} × ${money(r)}/mo = ${money(grossMo)}/mo`, `Less ${mr.vacancyPct}% vacancy: ${money(rentMo)}/mo`],
    opexCalc: null,
  };
}

export function operatingBreakdownFor(data, rent = null) {
  if (!data) return null;
  const mr = data.marketRange || null;
  const opex = mr?.opex || data.opex || null;
  if (!opex) return null;
  const laundry = mr?.laundry || data.laundry || opex.laundry || null;
  const upside = mr?.upside || data.upside || opex.upside || null;
  const units = mr?.units || (Array.isArray(data.units) && data.units.length ? data.units.length : 10);
  const capRate = (mr?.capRate > 0 ? mr.capRate : data.capRate) || 9;
  const activeRent = Number.isFinite(+rent) && +rent > 0 ? +rent : (Number.isFinite(+data.ourRent) ? +data.ourRent : 0);
  return computeOpex({
    opex,
    laundry,
    upside,
    units,
    rentedUnits: units,
    grossRentMonthly: units * activeRent,
    applyVacancy: true,
    capRate,
  });
}

export function rangeValue(mr, rent) {
  if (!mr || !(mr.capRate > 0)) return 0;
  return rangeSummary(mr, rent)?.value ?? 0;
}

const finiteRent = (rent) => (
  rent === null || rent === undefined || rent === '' ? NaN : +rent
);

export function whatIfViews(data, rent) {
  const mr = data?.marketRange;
  const r = finiteRent(rent);
  if (!mr || !Number.isFinite(r) || !Array.isArray(data?.views)) return data?.views;
  const capRate = mr.capRate > 0 ? mr.capRate : data.capRate;
  const allInAfter = data.allIn ?? mr.allIn;
  const laundrySrc = mr.laundry || data?.laundry || mr.opex?.laundry || null;
  const upsideSrc = mr.upside || data?.upside || mr.opex?.upside || null;
  return data.views.map((v) => {
    if (v.key === 'asis') {
      const hasPayingUnit = Array.isArray(data?.units) && data.units.some((u) => (u.rentToday ?? 0) > 0);
      if (v.rented > 0 && (v.rentMo <= 0 || !hasPayingUnit)) {
        return { ...v, rented: 0, rentMo: 0, rentOverlay: [`0 of ${v.total} rented today`] };
      }
      return v;
    }
    if (v.key !== 'after' && v.key !== 'market') return v;
    const units = mr.units || v.total;
    if (hasOpex(mr)) {
      const calc = computeOpex({
        opex: mr.opex,
        laundry: laundrySrc,
        upside: upsideSrc,
        units,
        rentedUnits: units,
        grossRentMonthly: units * r,
        applyVacancy: true,
        capRate,
      });
      const laundryPart = calc.laundry?.active ? ` + ${money(calc.laundryNetMonthly)} laundry` : '';
      return {
        ...v,
        rentMo: calc.effectiveRentMonthly,
        costsMo: calc.totalExpensesMonthly,
        netYr: calc.noiAnnual,
        value: calc.value,
        allIn: allInAfter ?? v.allIn,
        rentOverlay: [
          rentOverlayLine(units, r, calc),
          calc.vacancyOverlayLine,
        ].filter(Boolean),
        costsOverlay: calc.costsOverlay,
        netOverlay: [`(${money(calc.effectiveRentMonthly)}${laundryPart} − ${money(calc.totalExpensesMonthly)}) × 12 = ${money(calc.noiAnnual)}/yr`],
        valueOverlay: [`${money(calc.noiAnnual)}/yr ÷ ${capRate}% cap rate = ${money(calc.value)}`],
      };
    }
    const gross = units * r;
    const rentMo = gross * (1 - mr.vacancyPct / 100);
    const costsMo = v.costsMo;
    const netYr = (rentMo - costsMo) * 12;
    const value = capRate > 0 ? Math.max(0, netYr / (capRate / 100)) : 0;
    return {
      ...v,
      rentMo,
      netYr,
      value,
      rentOverlay: [
        `${units} × ${money(r)}/mo = ${money(gross)}/mo`,
        `Less ${mr.vacancyPct}% vacancy: ${money(rentMo)}/mo`,
      ],
      netOverlay: [`(${money(rentMo)} − ${money(costsMo)}) × 12 = ${money(netYr)}/yr`],
      valueOverlay: [`${money(netYr)}/yr ÷ ${capRate}% cap rate = ${money(value)}`],
    };
  });
}

export function whatIfGrid(data, rent) {
  const mr = data?.marketRange;
  const baseRent = finiteRent(rent);
  if (!mr || !Number.isFinite(baseRent)) return data?.grid;
  const units = mr.units;
  const vacancyPct = mr.vacancyPct;
  const fullCosts = mr.costsMo;
  const caps = Array.isArray(data.caps) ? data.caps : [];
  const allIn = data.allIn ?? mr.allIn;
  const baseCap = data.capRate ?? mr.capRate;
  const laundrySrc = mr.laundry || data?.laundry || mr.opex?.laundry || null;
  const maxRent = mr.high > 0 ? mr.high : Infinity;
  const clampedBase = Math.min(baseRent, maxRent);
  const rents = [...new Set(
    [-2, -1, 0, 1, 2]
      .map((k) => Math.min(clampedBase + k * 100, maxRent))
      .filter((r) => r > 0),
  )].sort((a, b) => a - b);
  return rents.map((r) => {
    const calc = hasOpex(mr)
      ? computeOpex({ opex: mr.opex, laundry: laundrySrc, units, rentedUnits: units, grossRentMonthly: units * r, applyVacancy: true, capRate: baseCap })
      : null;
    const rentMo = calc ? calc.effectiveRentMonthly : units * r * (1 - vacancyPct / 100);
    const rowVacPct = calc ? calc.vacancyPct : vacancyPct;
    const rowCosts = calc ? calc.totalExpensesMonthly : fullCosts;
    const netYr = calc ? calc.noiAnnual : (rentMo - fullCosts) * 12;
    const laundryNote = calc?.laundry?.active ? [`Laundry net: +${money(calc.laundryNetMonthly)}/mo`] : [];
    return {
      rent: r,
      cells: caps.map((c) => {
        const value = c > 0 ? Math.max(0, netYr / (c / 100)) : 0;
        return {
          cap: c,
          value,
          clears: value >= allIn,
          stabilized: r === clampedBase && c === baseCap,
          overlay: [
            `${calc && (calc.wifiRentAddPerUnit || 0) > 0 ? `${units} units × (${money(r)} + ${money(calc.wifiRentAddPerUnit)} Wi-Fi)/mo` : `${units} units × ${money(r)}/mo`}, less ${rowVacPct}% vacancy: ${money(rentMo)}/mo`,
            ...laundryNote,
            `Less costs: ${money(rowCosts)}/mo`,
            `${money(netYr)}/yr ÷ ${c}% = ${money(value)}`,
            `All in: ${money(allIn)}`,
          ],
        };
      }),
    };
  });
}
