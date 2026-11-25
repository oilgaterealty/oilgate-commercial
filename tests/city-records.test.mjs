import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ReactModule from 'react';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import { canAccessCityRecords, siteRules } from '../src/lib/site.js';
import {
  answerTone,
  collectRecordPaths,
  findVisibleSubtextViolations,
  normalizeCityRecords,
  organizeCityRecords,
  sortRecordsNewestFirst,
} from '../src/lib/cityRecords.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadCityRecordsView() {
  const src = read('src/components/CityRecordsView.jsx');
  const { outputFiles } = esbuild.buildSync({
    stdin: { contents: src, loader: 'jsx', resolveDir: join(root, 'src/components') },
    bundle: true,
    write: false,
    external: ['react'],
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    format: 'cjs',
  });
  const mod = { exports: {} };
  const fakeRequire = (id) => {
    if (id === 'react') return ReactModule;
    throw new Error(`Unexpected external require: ${id}`);
  };
  const fn = new Function('exports', 'module', 'require', 'h', 'Fragment', outputFiles[0].text);
  fn(mod.exports, mod, fakeRequire, createElement, Fragment);
  return mod.exports.default;
}

const SAMPLE_DATA = {
  updatedAt: '2026-11-24',
  summary: [
    {
      id: 'sum-units',
      label: 'Legal units',
      answer: '10',
      line: 'Built 1919 · 10,800 sq ft',
      value: '10 units (County commercial card) · Certificate of Occupancy: Not online, needs request (Summit County Dept. of Building Standards)',
      files: [{ label: 'Commercial card PDF', path: 'deal/city-records/card.pdf' }],
      source: {
        sourceName: 'Summit County Fiscal Office Commercial Card',
        sourceUrl: 'https://propertyaccess.summitoh.net/example-commercial',
        documentDate: '2026-01-01',
        retrievedAt: '2026-11-24',
        unverified: true,
      },
    },
    {
      id: 'sum-taxes',
      label: 'Taxes owed',
      answer: '$0',
      line: '2025 paid in full',
      value: '$0.00 due',
      files: [{ label: '2025 tax bill PDF', path: 'deal/city-records/tax.pdf' }],
      source: {
        sourceName: 'Summit County Fiscal Office Tax Summary',
        sourceUrl: 'https://propertyaccess.summitoh.net/example-tax',
        documentDate: '2026-08-10',
        retrievedAt: '2026-11-24',
        unverified: false,
      },
    },
  ],
  agencies: [
    {
      id: 'summit-fiscal',
      agency: 'Summit County Fiscal Office',
      items: [
        {
          id: 'deed-2012',
          sortDate: '2012-06-19',
          label: 'Deed transfer #8355',
          value: 'Bayview Loan Servicing LLC to 23C Properties LLC ($108,000)',
          files: [],
          source: {
            sourceName: 'Summit County Fiscal Office Sales Summary',
            sourceUrl: 'https://propertyaccess.summitoh.net/example-sales',
            documentDate: '2012-06-19',
            retrievedAt: '2026-11-24',
            unverified: false,
          },
        },
        {
          id: 'deed-2021',
          sortDate: '2021-12-27',
          label: 'Deed transfer #23514',
          value: 'YG Super Corp to 23C Properties LLC ($410,000) · Instrument 56701234',
          files: [{ label: 'Sales PDF', path: 'deal/city-records/sales.pdf' }],
          source: {
            sourceName: 'Summit County Fiscal Office Sales Summary',
            sourceUrl: 'https://propertyaccess.summitoh.net/example-sales',
            documentDate: '2021-12-27',
            retrievedAt: '2026-11-24',
            unverified: false,
          },
        },
      ],
    },
  ],
};

test('collapsed default renders answer + line only; expanded reveals details, files, and info button; overlay shows on activeId', () => {
  const CityRecordsView = loadCityRecordsView();
  const signedUrls = {
    'deal/city-records/card.pdf': 'https://signed.example/card.pdf',
    'deal/city-records/tax.pdf': 'https://signed.example/tax.pdf',
    'deal/city-records/sales.pdf': 'https://signed.example/sales.pdf',
  };

  assert.deepEqual(findVisibleSubtextViolations(SAMPLE_DATA), []);

  // Default collapsed state: activeId is null, nothing expanded.
  const html = renderToStaticMarkup(
    createElement(CityRecordsView, { data: SAMPLE_DATA, signedUrls, activeId: null })
  );

  // 2-col phone / 3-col desktop grid and big bold answers + 1-line summary visible.
  assert.match(html, /grid-cols-2/);
  assert.match(html, /sm:grid-cols-3/);
  assert.match(html, /text-2xl/);
  assert.doesNotMatch(html, /truncate/);
  assert.match(html, /Legal units/);
  assert.match(html, />10</);
  assert.match(html, /Built 1919 · 10,800 sq ft/);
  assert.match(html, /\$0/);
  assert.match(html, /2025 paid in full/);
  assert.match(html, /Ownership &amp; sale history/);
  assert.match(html, /YG Super Corp to 23C Properties LLC \(\$410,000\)/);

  // Details, PDF links, info button, and request notes MUST NOT appear collapsed.
  assert.doesNotMatch(html, /10 units \(County commercial card\)/);
  assert.doesNotMatch(html, /Instrument 56701234/);
  assert.doesNotMatch(html, /https:\/\/signed\.example\/card\.pdf/);
  assert.doesNotMatch(html, /Source details for/);
  assert.doesNotMatch(html, /Certificate of Occupancy: Not online/);

  // Source / verification / subtext MUST NOT appear anywhere without hover or tap.
  assert.doesNotMatch(html, /role="tooltip"/);
  assert.doesNotMatch(html, /propertyaccess\.summitoh\.net/);
  assert.doesNotMatch(html, /Commercial Property Card|Commercial Card|Sales Summary|Tax Summary/);
  assert.doesNotMatch(html, /2026-11-24/);
  assert.doesNotMatch(html, /Document date:/i);
  assert.doesNotMatch(html, /Retrieved:/i);
  assert.doesNotMatch(html, /\bunverified\b/i);
  assert.doesNotMatch(html, /verified from/i);
  assert.doesNotMatch(html, /disclaimer/i);
  assert.doesNotMatch(html, /hover or tap/i);
  assert.doesNotMatch(html, /<small\b/i);
  assert.doesNotMatch(html, /<figcaption\b/i);
  assert.doesNotMatch(html, /\stitle=/i);

  // Expanded card state (without activeId): reveals details, file pills, and ⓘ button, NO overlay.
  const expandedHtml = renderToStaticMarkup(
    createElement(CityRecordsView, {
      data: SAMPLE_DATA,
      signedUrls,
      activeId: null,
      expandedIds: ['sum-units'],
    })
  );
  assert.match(expandedHtml, /col-span-full/);
  assert.doesNotMatch(expandedHtml, /County commercial card/);
  assert.match(expandedHtml, /https:\/\/signed\.example\/card\.pdf/);
  assert.match(expandedHtml, /aria-label="Source details for Legal units"/);
  assert.doesNotMatch(expandedHtml, /role="tooltip"/);

  // Active overlay state: renders ONLY that item's SourceOverlay.
  const hoveredHtml = renderToStaticMarkup(
    createElement(CityRecordsView, { data: SAMPLE_DATA, signedUrls, activeId: 'sum-units' })
  );
  assert.match(hoveredHtml, /role="tooltip"/);
  assert.match(hoveredHtml, /https:\/\/propertyaccess\.summitoh\.net\/example-commercial/);
  assert.match(hoveredHtml, /Summit County Fiscal Office Commercial Card/);
  assert.match(hoveredHtml, /Document date: 2026-01-01/);
  assert.match(hoveredHtml, /Retrieved: 2026-11-24/);
  assert.match(hoveredHtml, /Unverified/);
});

test('agency records sort newest-first and paths extract cleanly', () => {
  const sorted = sortRecordsNewestFirst([
    { id: 'undated', sortDate: 'Not stated' },
    { id: 'old', sortDate: '2012-06-19' },
    { id: 'newest', sortDate: '2026-08-10' },
    { id: 'mid', sortDate: '2021-12-27' },
  ]);
  assert.deepEqual(sorted.map((x) => x.id), ['newest', 'mid', 'old', 'undated']);

  const norm = normalizeCityRecords(JSON.stringify(SAMPLE_DATA));
  assert.deepEqual(norm.agencies[0].items.map((x) => x.id), ['deed-2021', 'deed-2012']);
  assert.deepEqual(collectRecordPaths(norm), [
    'deal/city-records/card.pdf',
    'deal/city-records/tax.pdf',
    'deal/city-records/sales.pdf',
  ]);
});

test('organizer carries answer and line, deduplicates details, and isolates request notes to Not online yet', () => {
  const input = {
    summary: [
      {
        id: 'sum-units',
        label: 'Legal units',
        answer: '10',
        line: 'Built 1919 · 10,800 sq ft',
        value: '10 units (County commercial card) · Certificate of Occupancy: Not online, needs request (Summit County Dept. of Building Standards)',
        files: [{ label: 'Card PDF', path: 'card.pdf' }],
        source: { sourceName: 'County Card', documentDate: '2026-01-01', retrievedAt: '2026-11-24' },
      },
      {
        id: 'sum-code',
        label: 'Open code case',
        answer: '1 open',
        line: 'Exterior repairs',
        value: '1 open',
        files: [],
      },
    ],
    agencies: [
      {
        agency: 'Summit County Fiscal Office',
        items: [
          {
            id: 'sf-commercial-card',
            label: 'Commercial card',
            value: 'Parcel 6801234 (Alt 010203) · Class C Commercial, LUC 401 (Apartments 4-19 units), Structure 211 · 10 units · Year built 1919 · 10,800 gross SF · Lot 5,194 SF · Legal: BUCHTEL & WOLF LOT 12',
            files: [{ label: 'Commercial PDF', path: 'sf-card.pdf' }],
          },
        ],
      },
      {
        agency: 'Akron & Summit Building',
        items: [
          {
            id: 'ak-co-unit-count-request',
            label: 'Certificate of Occupancy & legal unit count (9 vs 10)',
            value: 'Request from City of Akron & Summit County Building Standards',
            files: [],
          },
        ],
      },
    ],
  };

  const out = organizeCityRecords(input);
  const units = out.summary.find((r) => r.id === 'sum-units');
  assert.equal(units.answer, '10');
  assert.equal(units.line, 'Built 1919 · 10,800 sq ft');

  // Every factual detail preserved, no duplicates, no bare "10 units", no request notes.
  assert.ok(!units.details.some((d) => /commercial card/i.test(d)));
  assert.ok(units.details.includes('Parcel 6801234 (Alt 010203)'));
  assert.ok(units.details.some((d) => d.includes('LUC 401')));
  assert.ok(units.details.includes('10,800 gross SF'));
  assert.ok(units.details.includes('Lot 5,194 SF'));
  assert.ok(units.details.includes('Legal: BUCHTEL & WOLF LOT 12'));
  assert.equal(units.details.filter((d) => d === '10 units').length, 0);
  assert.equal(units.details.filter((d) => /not online|request/i.test(d)).length, 0);

  // Code case restating only the answer drops duplicate detail.
  const code = out.summary.find((r) => r.id === 'sum-code');
  assert.equal(code.answer, '1 open');
  assert.deepEqual(code.details, []);

  // Offline group merges Certificate of Occupancy requests into ONE entry naming the office.
  const offline = out.groups.find((g) => g.id === 'offline');
  assert.ok(offline);
  assert.equal(offline.items.length, 1);
  assert.match(offline.items[0].label, /Certificate of Occupancy/i);
  assert.equal(offline.items[0].value, 'City of Akron & Summit County Building Standards');
});

test('older records without answer/line fall back to first plain fact segment and empty line', () => {
  const out = organizeCityRecords({
    summary: [
      {
        id: 'sum-owner',
        label: 'Owner',
        value: '23C Properties LLC · Acquired 2021-12-27 · Active Ohio LLC',
      },
    ],
    agencies: [
      {
        agency: 'Fiscal Office',
        items: [
          {
            id: 'legacy-parcel',
            label: 'Parcel record',
            value: 'Parcel 6801234 · 10,800 gross SF · Lot 5,194 SF',
          },
        ],
      },
    ],
  });

  const owner = out.summary.find((r) => r.id === 'sum-owner');
  assert.equal(owner.answer, '23C Properties LLC');
  assert.equal(owner.line, '');
  assert.deepEqual(owner.details, ['Acquired 2021-12-27', 'Active Ohio LLC']);

  const parcel = out.groups.flatMap((g) => g.items).find((r) => r.id === 'legacy-parcel');
  assert.equal(parcel.answer, '10,800 gross SF');
  assert.equal(parcel.line, '');
  assert.deepEqual(parcel.details, ['Parcel 6801234', 'Lot 5,194 SF']);
});

test('answerTone marks open/owed amber and $0/none green', () => {
  assert.equal(answerTone('Open code case', '1 open'), 'warn');
  assert.equal(answerTone('Taxes owed', '$1,240 due'), 'warn');
  assert.equal(answerTone('Taxes owed', '$0'), 'good');
  assert.equal(answerTone('Taxes owed', '$0.00 due'), 'good');
  assert.equal(answerTone('Liens', 'None found'), 'good');
  assert.equal(answerTone('Legal units', '10'), 'neutral');
  assert.equal(answerTone('Owner', '23C Properties LLC'), 'neutral');
  assert.equal(answerTone('Open code case', '1'), 'warn');
  assert.equal(answerTone('Open code case', '0'), 'neutral');
});

const TOPIC_FIXTURE = {
  summary: [
    ['sum-owner', 'Owner', '23C Properties LLC'],
    ['sum-units', 'Legal units', '10 units'],
    ['sum-taxes', 'Taxes owed', '$0 due'],
    ['sum-liens', 'Liens', 'No judgments found'],
    ['sum-violations', 'Open code case', 'One open housing case'],
    ['sum-mortgages', 'Open mortgage', 'Recorded mortgage search pending'],
  ].map(([id, label, value]) => ({ id, label, value })),
  agencies: Object.entries({
    'Summit County Fiscal Office': [
      ['sf-recorded-docs-captcha', 'Recorded instruments', 'Blocked online by CAPTCHA'],
      ['sf-tax-2025-paid', '2025 taxes', '$8,400 paid'],
      ['sf-valuation-2026', '2026 valuation', '$310,000 assessed'],
      ['sf-tax-2026-summary', '2026 taxes', '$8,800 billed'],
      ['sf-sa-2026', '2026 assessments', '$240 charged'],
      ['sf-commercial-card', 'Commercial card', '10 units; 7,200 square feet'],
      ['sf-rental-reg', 'Rental registration', 'Registered in 2026'],
      ['sf-bor-bta', 'Valuation appeals', 'No BOR or BTA appeals'],
      ['sf-deed-2021', '2021 deed', '23C acquired for $410,000'],
      ['sf-sa-2019-junk', 'Junk vehicle assessment', '$400 assessed in 2019'],
      ['sf-sa-2012-utility', 'Utility assessment', '$900 delinquent sewer in 2012'],
      ['sf-deed-2012-23c', '2012 transfer', '23C acquired for $108,000'],
      ['sf-deed-2012-sheriff', 'Sheriff deed', 'Bank acquired in 2012'],
      ['sf-sa-rental-2010-2017', 'Rental registration assessments', '$600 assessed during 2010–2017'],
      ['sf-deed-2005', '2005 deed', 'Prior owner purchased'],
      ['sf-deed-1994', '1994 deed', 'Earlier owner purchased'],
    ],
    'Akron and Summit Building Department': [
      ['ak-zoning-gis', 'Zoning', 'Apartment use permitted'],
      ['ak-epa-water-line', 'Water service line', 'Copper service line'],
      ['ak-violation-2023-open', 'Open housing violation', 'Exterior repairs outstanding'],
      ['scbs-permit-po2200103', 'Permit PO2200103', 'Roof replacement approved'],
      ['ak-violation-2018-closed', 'Closed housing violation', 'Repairs completed'],
      ['scbs-govwell-dashboards', 'Enforcement cases', 'Two closed cases'],
      ['ak-grass-311', 'Grass / 311', 'No active mowing order'],
      ['ak-co-unit-count-request', 'Certificate of occupancy', 'Not online, needs request'],
      ['ak-city-rental-file', 'City rental file', 'Not online, needs request'],
      ['ak-water-balance-request', 'Water balance', 'Not searchable online'],
    ],
    'Summit Clerk': [
      ['clerk-23c-civil', 'Civil cases', 'Two civil cases'],
      ['clerk-23c-crim-appeals', 'Criminal and appeals', 'No cases found'],
      ['clerk-2008-foreclosure', '2008 foreclosure', 'Closed in 2012'],
    ],
    'Akron Municipal Court': [['amc-captcha', 'Municipal cases', 'Blocked online by CAPTCHA']],
    'Ohio Secretary of State': [['sos-entity-ucc', 'Owner entity and UCC', '23C is active; UCC search pending']],
    'Other official offices': [
      ['other-fema', 'Flood zone', 'Zone X'],
      ['other-nrhp', 'Historic register', 'No listing'],
      ['other-oppzone-landbank', 'Opportunity zone / land bank', 'Outside the zone'],
      ['other-sheriff-sales', 'Sheriff sales', 'No scheduled sale'],
    ],
  }).map(([agency, items]) => ({
    agency,
    items: items.map(([id, label, value], index) => ({
      id,
      label,
      value,
      sortDate: `2026-${String((index % 9) + 1).padStart(2, '0')}-01`,
      files: [{ label: 'Record PDF', path: `${id}.pdf` }],
      source: { sourceName: agency, sourceUrl: `https://official.example/${id}`, documentDate: '2026-01-01', retrievedAt: '2026-11-24' },
    })),
  })),
};
const allRows = (data) => [...data.summary, ...data.groups.flatMap((group) => group.items)];
const organizedFixture = () => organizeCityRecords(TOPIC_FIXTURE);

test('topic organizer preserves specified order and places all request-only items in Not online yet', () => {
  const output = organizedFixture();
  assert.deepEqual(output.groups.map((group) => group.label), [
    'Ownership & sale history', 'Mortgages, liens & court cases', 'Taxes, value & assessments',
    'Building, units & code', 'Zoning & location', 'Records to request',
  ]);
  for (const group of output.groups) assert.equal(group.count, group.items.length);
  const offline = output.groups.at(-1).items;
  assert.deepEqual(
    offline.flatMap((row) => row.mergedIds).sort(),
    ['sf-recorded-docs-captcha', 'amc-captcha', 'ak-water-balance-request', 'ak-co-unit-count-request', 'ak-city-rental-file'].sort()
  );
  for (const row of offline) {
    assert.doesNotMatch(row.value, /^Request from /);
    assert.doesNotMatch(row.value, /blocked|not online|not searchable/i);
    assert.doesNotMatch(row.value, /\n/);
  }
});

test('every input id appears exactly once across tiles and groups, without mutating data', () => {
  const before = structuredClone(TOPIC_FIXTURE);
  const expected = [...before.summary, ...before.agencies.flatMap((agency) => agency.items)].map((row) => row.id).sort();
  const actual = allRows(organizedFixture()).flatMap((row) => row.mergedIds).sort();
  assert.equal(expected.length, 41);
  assert.deepEqual(actual, expected);
  assert.deepEqual(TOPIC_FIXTURE, before);
});

test('unit count and rental families merge cleanly with all facts, files and sources without request notes', () => {
  const rows = allRows(organizedFixture());
  const units = rows.filter((row) => row.mergedIds.includes('sum-units'));
  assert.equal(units.length, 1);
  assert.deepEqual(units[0].mergedIds, ['sum-units', 'sf-commercial-card']);
  assert.equal(units[0].answer, '10 units');
  assert.deepEqual(units[0].details, ['7,200 square feet']);
  assert.doesNotMatch(units[0].value, /10 units · 10 units/);
  assert.doesNotMatch(units[0].value, /Request from/);
  assert.equal(units[0].files.length, 1);
  assert.equal(units[0].sources.length, 1);

  const rental = rows.filter((row) => row.mergedIds.includes('sf-rental-reg'));
  assert.equal(rental.length, 1);
  assert.deepEqual([...rental[0].mergedIds].sort(), ['sf-rental-reg', 'sf-sa-rental-2010-2017'].sort());
  assert.equal(rental[0].answer, 'Registered in 2026');
  assert.deepEqual(rental[0].details, ['$600 assessed during 2010–2017']);
  assert.doesNotMatch(rental[0].value, /Request from/);
  assert.equal(rental[0].files.length, 2);
  assert.equal(rental[0].sources.length, 2);
});

test('identical normalized label and value merge transitively with explicit families', () => {
  const fixture = structuredClone(TOPIC_FIXTURE);
  const card = fixture.agencies[0].items.find((item) => item.id === 'sf-commercial-card');
  fixture.agencies[0].items.push({ ...card, id: 'future-card', label: ' COMMERCIAL CARD! ', value: card.value.toUpperCase() });
  const units = allRows(organizeCityRecords(fixture)).find((row) => row.id === 'sum-units');
  assert.ok(units.mergedIds.includes('future-card'));
  assert.equal(units.files.length, 1);
  assert.equal(units.sources.length, 1);
});

test('unknown ids use keyword fallback or Other and request status overrides topic', () => {
  const output = organizeCityRecords({
    agencies: [{
      agency: 'Records Desk',
      items: [
        { id: 'future-a', label: 'Mortgage release', value: 'Satisfied' },
        { id: 'future-b', label: 'Boundary marker', value: 'Survey peg' },
        { id: 'future-c', label: 'Tax certificate', value: 'Not online, needs request' },
      ],
    }],
  });
  assert.deepEqual(
    output.groups.map((group) => [group.id, group.items[0].id]),
    [['liens', 'future-a'], ['other', 'future-b'], ['offline', 'future-c']]
  );
});

test('every topic sorts newest first, including merged records using latest member date', () => {
  for (const group of organizedFixture().groups) {
    assert.deepEqual(group.items, sortRecordsNewestFirst(group.items));
  }
  const fixture = structuredClone(TOPIC_FIXTURE);
  fixture.agencies[0].items.find((item) => item.id === 'sf-rental-reg').sortDate = '2027-03-01';
  const building = organizeCityRecords(fixture).groups.find((group) => group.id === 'building');
  assert.equal(building.items[0].id, 'sf-rental-reg');
  assert.equal(building.items[0].sortDate, '2027-03-01');
});

test('organizer output keeps forbidden provenance text out of all visible fields', () => {
  const fixture = structuredClone(TOPIC_FIXTURE);
  fixture.agencies[0].items[1].value += '; Source: official register. Retrieved 2026-11-24. https://official.example/secret';
  fixture.agencies[0].items[1].label += ' (unverified)';
  fixture.agencies[0].items[1].files[0].label = 'https://official.example/file';
  const output = organizeCityRecords(fixture);
  assert.deepEqual(findVisibleSubtextViolations(output), []);
  assert.match(allRows(output).find((row) => row.id === 'sf-tax-2025-paid').value, /\$8,400 paid/);
});

test('compact sections cap visible rows at 5, render counts, dates, and expanded/overlay states cleanly', () => {
  const View = loadCityRecordsView();
  const output = organizedFixture();
  const signedUrls = Object.fromEntries(collectRecordPaths(TOPIC_FIXTURE).map((path) => [path, `https://signed.example/${path}`]));
  const html = renderToStaticMarkup(createElement(View, { data: TOPIC_FIXTURE, signedUrls }));
  assert.match(html, /What matters/);
  assert.equal((html.match(/<details[^>]* open=""/g) || []).length, 4);
  assert.match(html, /<details[^>]*><summary[^>]*><span>Records to request/);
  assert.doesNotMatch(html, /<time/);
  assert.match(html, /Show 2 more/);
  for (const group of output.groups) assert.ok(html.includes(`(${group.count})`));
  assert.doesNotMatch(html.replace(/\s(?:href|dateTime)="[^"]*"/g, ''), /https?:|Retrieved|Unverified|Source:/i);

  const rental = allRows(output).find((row) => row.id === 'sf-rental-reg');
  const expanded = renderToStaticMarkup(
    createElement(View, { data: TOPIC_FIXTURE, signedUrls, expandedIds: [rental.id] })
  );
  assert.match(expanded, /\$600 assessed during 2010–2017/);
  for (const file of rental.files) assert.ok(expanded.includes(signedUrls[file.path]));
  assert.match(expanded, /aria-label="Source details for Rental registration &amp; assessments"/);

  const active = renderToStaticMarkup(
    createElement(View, { data: TOPIC_FIXTURE, signedUrls, activeId: rental.id })
  );
  for (const source of rental.sources) assert.ok(active.includes(source.sourceUrl));
  assert.equal((active.match(/role="tooltip"/g) || []).length, 1);
});

test('City Records page is restricted to non-preview owner (owner site) and non-preview lender', async () => {
  assert.equal(siteRules('public').ownerAllowed, false);
  assert.equal(canAccessCityRecords('public', 'owner', false), false);
  assert.equal(canAccessCityRecords('owner', 'owner', true), false);
  assert.equal(canAccessCityRecords('owner', 'lender', true), true);
  assert.equal(canAccessCityRecords('owner', 'lender', false), true);
  assert.equal(canAccessCityRecords('public', 'lender', false), true);
  for (const r of ['seller', 'realtor', 'reviewer', 'viewer', 'guest', 'lead_guest', '']) {
    assert.equal(canAccessCityRecords('owner', r, false), false, `blocked for ${r}`);
  }
  assert.equal(canAccessCityRecords('owner', 'owner', false), true);

  for (const view of ['Seller.jsx', 'Realtor.jsx', 'Reviewer.jsx', 'LeadGuest.jsx', 'Home.jsx', 'Join.jsx']) {
    const s = read(`src/views/${view}`);
    assert.doesNotMatch(s, /CityRecords|city-records|city_records:/, `${view} must not reference City Records`);
  }

  const ownerSrc = read('src/views/Owner.jsx');
  assert.match(ownerSrc, /import\.meta\.env\.VITE_SITE_KIND === 'public' \? null : lazy/);
  assert.match(ownerSrc, /siteRules\(SITE_KIND\)\.ownerAllowed/);

  // Verify real VITE_SITE_KIND=public Vite build omits owner-only DealPlan & keeps zero real city-record data in static chunks.
  const outDir = mkdtempSync(join(tmpdir(), 'public-site-check-'));
  const prevKind = process.env.VITE_SITE_KIND;
  process.env.VITE_SITE_KIND = 'public';
  try {
    await viteBuild({
      root,
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    const collectFiles = (dir) => {
      const out = [];
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) out.push(...collectFiles(p));
        else if (/\.(js|html)$/.test(n)) out.push(p);
      }
      return out;
    };
    const emitted = collectFiles(outDir);
    assert.ok(emitted.length > 0);
    for (const file of emitted) {
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(content, /deal_plan:|DealPlan/, `public bundle leaked DealPlan into ${file}`);
      assert.doesNotMatch(content, /23C Properties|C\/O THE FAHEY BANK/i, `public bundle leaked real city record data into ${file}`);
    }
  } finally {
    if (prevKind === undefined) delete process.env.VITE_SITE_KIND;
    else process.env.VITE_SITE_KIND = prevKind;
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('partly blocked records extract request notes to offline while keeping real facts; fully blocked ones keep tucked-in numbers', async () => {
  const { organizeCityRecords } = await import('../src/lib/cityRecords.js');
  const out = organizeCityRecords({
    summary: [{
      id: 'sum-mortgages',
      label: 'Open mortgage',
      value: 'Blocked online by CAPTCHA (County Recorder) \u00b7 Tax bill mailing: C/O Example Bank',
      files: [],
    }],
    agencies: [{
      id: 'ak',
      agency: 'City Utilities',
      items: [{
        id: 'ak-water-balance-request',
        label: 'Water balance',
        value: 'Not online, needs request (0 delinquent charges certified to taxes)',
        sortDate: '2026-11-24',
        files: [],
      }],
    }],
  });
  const tile = out.summary.find((r) => r.mergedIds.includes('sum-mortgages'));
  assert.ok(tile, 'mortgage tile stays in What matters');
  assert.equal(tile.answer, 'Tax bill mailing: C/O Example Bank');
  assert.doesNotMatch(tile.value, /CAPTCHA|Blocked/i);

  const offline = out.groups.find((g) => g.id === 'offline');
  const water = offline.items.find((r) => r.mergedIds.includes('ak-water-balance-request'));
  assert.match(water.value, /0 delinquent charges/);
  const recorder = offline.items.find((r) => /Open mortgage/i.test(r.label));
  assert.equal(recorder.value, 'County Recorder');
});
