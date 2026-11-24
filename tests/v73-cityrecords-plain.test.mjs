import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { organizeCityRecords } from '../src/lib/cityRecords.js';

const DATA = {
  summary: [{ id: 'sum-mortgages', label: 'Open mortgage', answer: 'Not confirmed',
    value: 'Not confirmed; Needs request from Example Recorder', skipRequest: true }],
  agencies: [{ id: 'a', agency: 'Example County Office', items: [
    { id: 'deed-1', label: 'Deed transfer #111 (Jan 2, 2020)', title: 'Sold Jan 2020', answer: '$100 to Example LLC',
      value: 'SELLER CO to EXAMPLE LLC; $100; Deed type A' },
    { id: 'entity', label: 'Example LLC entity filing & UCC', title: 'LLC filing', requestFrom: 'Example State Office',
      value: 'Blocked online (HTTP 403 on a.example; b.example gated by check) - Example State Office' },
    { id: 'recorded', label: 'Recorded documents', title: 'Recorded deeds', requestFrom: 'Example Recorder',
      value: 'Blocked online by a check - Example Recorder (not online without check)' },
  ] }],
};

test('hand-written titles and answers replace raw labels', () => {
  const out = organizeCityRecords(DATA);
  const deed = out.groups.flatMap((g) => g.items).find((r) => r.id === 'deed-1');
  assert.equal(deed.label, 'Sold Jan 2020');
  assert.equal(deed.answer, '$100 to Example LLC');
  assert.ok(deed.details.some((d) => /Deed type A/.test(d)));
});

test('requestFrom makes the whole entry one clean request, nothing leaks into facts', () => {
  const out = organizeCityRecords(DATA);
  const facts = out.groups.filter((g) => g.id !== 'offline').flatMap((g) => g.items);
  assert.ok(!facts.some((r) => r.id === 'entity'));
  assert.ok(!facts.some((r) => /gated|HTTP|\.example/.test(`${r.answer} ${r.details.join(' ')}`)));
  const req = out.groups.find((g) => g.id === 'offline').items;
  assert.deepEqual(req.map((r) => [r.label, r.value]).sort(), [['LLC filing', 'Example State Office'], ['Recorded deeds', 'Example Recorder']]);
});

test('skipRequest keeps a card from adding a duplicate request', () => {
  const out = organizeCityRecords(DATA);
  const req = out.groups.find((g) => g.id === 'offline').items;
  assert.ok(!req.some((r) => /mortgage/i.test(r.label)));
  assert.equal(out.summary[0].answer, 'Not confirmed');
});

test('rows show no dates and groups have a tappable header', () => {
  const src = readFileSync(new URL('../src/components/CityRecordsView.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /<time/);
  assert.match(src, /min-h-\[48px\][^"]*list-none/);
  assert.match(src, /group-open:rotate-180/);
});
