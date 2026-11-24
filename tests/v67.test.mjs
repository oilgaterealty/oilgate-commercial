import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STR_UNIT_CHOICES, strUnitOptions, operating } from '../src/lib/dealmath.js';

test('Airbnb switch offers a third unit', () => {
  assert.deepEqual(STR_UNIT_CHOICES, [0, 1, 2, 3]);
  assert.deepEqual(strUnitOptions().map(([, l]) => l), ['None', '1 unit', '2 units', '3 units']);
});

test('three Airbnb units recalculate income and costs', () => {
  const B = { units: 9, rent: 900, vacancyPct: 5, strNightly: 133, strOccPct: 38, strFeesPct: 15, strCleaningPerStay: 60, strNightsPerStay: 3, strCostsMo: 250 };
  const two = operating({ ...B, strUnits: 2 });
  const three = operating({ ...B, strUnits: 3 });
  assert.equal(three.strUnits, 3);
  assert.equal(three.ltrUnits, 6);
  assert.notEqual(three.gpr, two.gpr);
  assert.ok(three.fixed > two.fixed);
});

test('switch and lender page use the shared choices, not a hard-coded two', () => {
  for (const f of ['src/components/Switches.jsx', 'src/views/Lender.jsx']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!src.includes("[2, '2 units']]"), f);
    assert.ok(!src.includes('[0, 1, 2]'), f);
    assert.match(src, /strUnitOptions\(\)/);
  }
});