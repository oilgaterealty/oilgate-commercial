import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizeCityRecords } from '../src/lib/cityRecords.js';

const DATA = {
  summary: [{ id: 'sum-units', label: 'Legal units', answer: '10', line: 'Built 1900',
    value: '10 units (County commercial card) · Certificate of Occupancy: Not online, needs request (Example Building Office)' }],
  agencies: [{ id: 'a', agency: 'Example County Office', items: [
    { id: 'sf-commercial-card', label: 'Parcel card', value: 'Parcel 123 · Class C, LUC 401 (Apartments 4-19 units), Structure 211 (Garden Apartments) · 10 units' },
    { id: 'co', label: 'Certificate of Occupancy', value: 'Not online, needs request (Example Building Office)' },
  ] }],
};

test('source-only parentheticals are dropped and unit count is not repeated', () => {
  const out = organizeCityRecords(DATA);
  const units = out.summary.find((r) => r.id === 'sum-units');
  assert.equal(units.answer, '10');
  const all = units.details.join(' | ');
  assert.doesNotMatch(all, /commercial card\)/i);
  assert.doesNotMatch(all, /(^|\| )10 units( |$)/);
  assert.match(all, /Garden Apartments/);
  assert.match(all, /4-19 units/);
});

test('requests appear once, in one list at the end', () => {
  const out = organizeCityRecords(DATA);
  const last = out.groups[out.groups.length - 1];
  assert.equal(last.label, 'Records to request');
  assert.equal(last.items.filter((r) => /Certificate of Occupancy/i.test(r.label)).length, 1);
  for (const row of out.summary) assert.doesNotMatch(row.details.join(' '), /needs request|not online/i);
});

test('file links are styled as buttons with an icon', () => {
  const src = readFileSync(new URL('../src/components/CityRecordsView.jsx', import.meta.url), 'utf8');
  const fileLinks = src.slice(src.indexOf('function FileLinks'), src.indexOf('function SourceButton'));
  assert.match(fileLinks, /bg-ink/);
  assert.match(fileLinks, /min-h-\[44px\]/);
  assert.match(fileLinks, /<svg/);
});
