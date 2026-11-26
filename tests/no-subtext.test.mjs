// Owner rule: no visible subtext, and no month guesses in deal tables, stage cards, pills, buttons or result rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const rel = `${dir}/${name}`;
  return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
});

test('Dashboard Tile has no sub prop and renders no caption under the figure', () => {
  const d = read('src/views/Dashboard.jsx');
  const tile = d.match(/function Tile\(\{([^}]*)\}\)/);
  assert.ok(tile, 'Tile component exists');
  assert.doesNotMatch(tile[1], /\bsub\b/);
  assert.doesNotMatch(d, /<Tile\b[^>]*\bsub=/);
  assert.doesNotMatch(d, /\{sub &&/);
});

test('no month-guess wording anywhere in src', () => {
  const banned = ['example pace', 'Months until we can buy', 'Refinance month', 'Expected refinance (Month'];
  for (const file of walk('src').filter((f) => /\.(jsx?|mjs|css|html)$/.test(f))) {
    const text = read(file);
    for (const phrase of banned) assert.ok(!text.includes(phrase), `${file} contains "${phrase}"`);
  }
});
