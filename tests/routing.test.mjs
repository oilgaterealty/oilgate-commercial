import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash } from '../src/lib/useHashRoute.js';
import { slugify } from '../src/lib/format.js';

test('deal routes parse slug and tab', () => {
  assert.deepEqual(parseHash('#/d/Charlotte/people'), { name: 'deal', slug: 'charlotte', tab: 'people' });
  assert.deepEqual(parseHash('#/d/quayle'), { name: 'deal', slug: 'quayle', tab: '' });
  assert.deepEqual(parseHash('#/'), { name: 'home' });
  assert.deepEqual(parseHash(''), { name: 'home' });
});

test('slugify makes safe page names', () => {
  assert.equal(slugify('23-27 Charlotte St!'), '23-27-charlotte-st');
  assert.equal(slugify('  2293 Quayle Dr  '), '2293-quayle-dr');
});
