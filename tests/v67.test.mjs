import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { operating } from '../src/lib/dealmath.js';

test('short-term / Airbnb exports and UI switches are removed', () => {
  const mathSrc = readFileSync(new URL('../src/lib/dealmath.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mathSrc, /STR_UNIT_CHOICES|strUnitOptions|STR_FIELDS/);
  for (const f of ['src/components/Switches.jsx', 'src/views/Lender.jsx', 'src/views/DealPlan.jsx']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Airbnb|strUnitOptions|strUnits/i, f);
  }
});

test('operating ignores legacy strUnits values and runs all units long-term', () => {
  const B = { units: 10, rent: 900, vacancyPct: 5, strNightly: 133, strOccPct: 38, strFeesPct: 15, strCleaningPerStay: 60, strNightsPerStay: 3, strCostsMo: 250 };
  const zero = operating({ ...B, strUnits: 0 });
  const three = operating({ ...B, strUnits: 3 });
  assert.equal(three.strUnits, 0);
  assert.equal(three.ltrUnits, 10);
  assert.equal(three.gpr, zero.gpr);
  assert.equal(three.fixed, zero.fixed);
});
