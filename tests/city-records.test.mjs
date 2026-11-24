import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import { canAccessCityRecords, siteRules } from '../src/lib/site.js';
import {
  collectRecordPaths,
  findVisibleSubtextViolations,
  normalizeCityRecords,
  sortRecordsNewestFirst,
} from '../src/lib/cityRecords.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadCityRecordsView() {
  const src = read('src/components/CityRecordsView.jsx');
  const { code } = esbuild.transformSync(src, {
    loader: 'jsx',
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    format: 'cjs',
  });
  const mod = { exports: {} };
  const fn = new Function('exports', 'module', 'h', 'Fragment', code);
  fn(mod.exports, mod, createElement, Fragment);
  return mod.exports.default;
}

const SAMPLE_DATA = {
  updatedAt: '2026-11-24',
  summary: [
    {
      id: 'sum-units',
      label: 'Legal unit count',
      value: '10 units (County commercial card)',
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
          value: 'YG Super Corp to 23C Properties LLC ($410,000)',
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

test('no source or verification text renders visibly without hover or tap', () => {
  const CityRecordsView = loadCityRecordsView();
  const signedUrls = {
    'deal/city-records/card.pdf': 'https://signed.example/card.pdf',
    'deal/city-records/tax.pdf': 'https://signed.example/tax.pdf',
    'deal/city-records/sales.pdf': 'https://signed.example/sales.pdf',
  };

  assert.deepEqual(findVisibleSubtextViolations(SAMPLE_DATA), []);

  // Default state: activeId is null (not hovering or tapping anything).
  const html = renderToStaticMarkup(
    createElement(CityRecordsView, { data: SAMPLE_DATA, signedUrls, activeId: null })
  );

  // Required visible facts & file links ARE present.
  assert.match(html, /Legal unit count/);
  assert.match(html, /10 units \(County commercial card\)/);
  assert.match(html, /\$0\.00 due/);
  assert.match(html, /Summit County Fiscal Office/);
  assert.match(html, /https:\/\/signed\.example\/card\.pdf/);

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

  // Hover or tap state: activeId renders ONLY that item's overlay.
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

test('City Records page never loads on the public site or for non-owner roles', async () => {
  assert.equal(siteRules('public').ownerAllowed, false);
  assert.equal(canAccessCityRecords('public', 'owner', false), false);
  assert.equal(canAccessCityRecords('owner', 'owner', true), false);
  for (const r of ['seller', 'realtor', 'reviewer', 'lender', 'viewer', 'guest', '']) {
    assert.equal(canAccessCityRecords('owner', r, false), false, `blocked for ${r}`);
  }
  assert.equal(canAccessCityRecords('owner', 'owner', false), true);

  for (const view of ['Seller.jsx', 'Realtor.jsx', 'Reviewer.jsx', 'Lender.jsx', 'Home.jsx', 'Join.jsx']) {
    const s = read(`src/views/${view}`);
    assert.doesNotMatch(s, /CityRecords|city-records|city_records:/, `${view} must not reference City Records`);
  }

  const ownerSrc = read('src/views/Owner.jsx');
  assert.match(ownerSrc, /import\.meta\.env\.VITE_SITE_KIND === 'public' \? null : lazy/);
  assert.match(ownerSrc, /siteRules\(SITE_KIND\)\.ownerAllowed/);

  // Verify real VITE_SITE_KIND=public Vite build omits CityRecords & city_records: completely.
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
      assert.doesNotMatch(content, /city_records:|CityRecordsView/, `public bundle leaked CityRecords into ${file}`);
    }
  } finally {
    if (prevKind === undefined) delete process.env.VITE_SITE_KIND;
    else process.env.VITE_SITE_KIND = prevKind;
    rmSync(outDir, { recursive: true, force: true });
  }
});
