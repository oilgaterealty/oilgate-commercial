import { money } from './dealmath.js';
import { computeOpex, hasOpex } from './opex.js';

export function defaultMarketRent(mr) {
  if (!mr) return 0;
  const low = +mr.low;
  const high = +mr.high;
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
  if (!(low > 0) || !(high >= low)) return mr;
  return { ...mr, low, high };
}

export function rangeSummary(mr, rent) {
  if (!mr) return null;
  const units = mr.units || 10;
  const r = Number.isFinite(+rent) ? +rent : 0;
  const capRate = mr.capRate > 0 ? mr.capRate : 9;
  if (hasOpex(mr)) {
    const calc = computeOpex({
      opex: mr.opex,
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
      rentOverlay: [`${units} × ${money(r)}/mo = ${money(calc.grossMonthly)}/mo`, calc.vacancyOverlayLine].filter(Boolean),
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
  };
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
        units,
        rentedUnits: units,
        grossRentMonthly: units * r,
        applyVacancy: true,
        capRate,
      });
      return {
        ...v,
        rentMo: calc.effectiveRentMonthly,
        costsMo: calc.totalExpensesMonthly,
        netYr: calc.noiAnnual,
        value: calc.value,
        allIn: allInAfter ?? v.allIn,
        rentOverlay: [
          `${units} × ${money(r)}/mo = ${money(calc.grossMonthly)}/mo`,
          calc.vacancyOverlayLine,
        ].filter(Boolean),
        costsOverlay: calc.costsOverlay,
        netOverlay: [`(${money(calc.effectiveRentMonthly)} − ${money(calc.totalExpensesMonthly)}) × 12 = ${money(calc.noiAnnual)}/yr`],
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
  const maxRent = mr.high > 0 ? mr.high : Infinity;
  const clampedBase = Math.min(baseRent, maxRent);
  const rents = [...new Set(
    [-2, -1, 0, 1, 2]
      .map((k) => Math.min(clampedBase + k * 100, maxRent))
      .filter((r) => r > 0),
  )].sort((a, b) => a - b);
  return rents.map((r) => {
    const calc = hasOpex(mr)
      ? computeOpex({ opex: mr.opex, units, rentedUnits: units, grossRentMonthly: units * r, applyVacancy: true, capRate: baseCap })
      : null;
    const rentMo = calc ? calc.effectiveRentMonthly : units * r * (1 - vacancyPct / 100);
    const rowVacPct = calc ? calc.vacancyPct : vacancyPct;
    const rowCosts = calc ? calc.totalExpensesMonthly : fullCosts;
    const netYr = calc ? calc.noiAnnual : (rentMo - fullCosts) * 12;
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
            `${units} units × ${money(r)}/mo, less ${rowVacPct}% vacancy: ${money(rentMo)}/mo`,
            `Less costs: ${money(rowCosts)}/mo`,
            `${money(netYr)}/yr ÷ ${c}% = ${money(value)}`,
            `All in: ${money(allIn)}`,
          ],
        };
      }),
    };
  });
}
