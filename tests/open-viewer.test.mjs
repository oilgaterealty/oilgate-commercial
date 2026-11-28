import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import {
  OPEN_REQUEST_ROLES,
  filterOpenViewerSnapshot,
  getOpenViewerFacts,
  getOrCreateVisitorId,
  mergeOpenViewerPhotoUrls,
  mergePhotoUrlsById,
  selectFeaturedPhoto,
  summarizeOpenViews,
  validateAccessRequest,
} from '../src/lib/openViewer.js';
import { ALLOWED_FACT_KEYS, OPEN_VIEWER_FACTS } from '../src/lib/openViewerFacts.js';
import { VIEWER_REQUEST_ROLES } from '../src/lib/requestRoles.js';
import { parseHash } from '../src/lib/useHashRoute.js';
import {
  GUEST_SITE,
  isOpenViewerToken,
  openViewerAllowed,
  openViewerUrl,
} from '../src/lib/site.js';

const require = createRequire(import.meta.url);
const jsxRuntime = require('react/jsx-runtime');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

function loadJsx(file, mocks, reactImpl = React) {
  const code = transformSync(read(file), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === 'react') return reactImpl;
    if (spec === 'react/jsx-runtime') return jsxRuntime;
    if (spec in mocks) return mocks[spec];
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, localRequire);
  return mod.exports;
}

test('filterOpenViewerSnapshot keeps only viewer fields and strips sensitive or extraneous keys', () => {
  assert.equal(filterOpenViewerSnapshot(null), null);
  assert.equal(filterOpenViewerSnapshot({ deal: {} }), null);

  const raw = {
    deal: {
      id: 'd1',
      slug: 'charlotte',
      title: '23-27 Charlotte St',
      address: '23-27 Charlotte St, Akron, OH 44303',
      units: 10,
      summary: '10-unit residential property.',
      buyer_name: 'Private Buyer',
      seller_name: 'Private Seller',
      drive_folder_id: 'secret-drive-id',
      contacts: [{ email: 'secret@example.com' }],
      offers: [{ id: 'o1', inputs: { askPrice: 500000 } }],
    },
    contacts: [{ email: 'leak@example.com' }],
    emails: ['leak@example.com'],
    messages: [{ body: 'private' }],
    offers: [{ name: 'Lead' }],
    notes: [{ body: 'owner note' }],
    photos: [
      {
        id: 'p1',
        kind: 'photo',
        storage_path: 'd1/p1.jpg',
        url: 'https://signed.example/p1.jpg',
        note: 'Front exterior',
        featured: true,
        created_at: '2026-11-26T00:00:00Z',
        uploaded_by_email: 'owner@example.com',
        drive_file_id: 'drive-123',
      },
      {
        id: 'doc1',
        kind: 'document',
        storage_path: 'd1/secret.pdf',
      },
    ],
    walkthrough_photos: [
      {
        id: 'w1',
        unit_number: 2,
        room: 'kitchen',
        storage_path: 'commercial-v5/d1/walkthrough/u1/w1.jpg',
        created_at: '2026-11-26T00:00:00Z',
        author_name: 'Secret Author',
        author_uid: 'u1',
      },
    ],
  };

  const filtered = filterOpenViewerSnapshot(raw);
  assert.deepEqual(Object.keys(filtered).sort(), ['deal', 'photos', 'walkthroughPhotos']);
  assert.deepEqual(filtered.deal, {
    id: 'd1',
    slug: 'charlotte',
    title: '23-27 Charlotte St',
    address: '23-27 Charlotte St, Akron, OH 44303',
    units: 10,
    summary: '10-unit residential property.',
  });
  assert.equal(filtered.photos.length, 1);
  assert.deepEqual(Object.keys(filtered.photos[0]).sort(), ['created_at', 'featured', 'id', 'kind', 'note', 'storage_path', 'url']);
  assert.equal(filtered.walkthroughPhotos.length, 1);
  assert.deepEqual(Object.keys(filtered.walkthroughPhotos[0]).sort(), ['created_at', 'id', 'room', 'storage_path', 'unit_number', 'url']);
});

test('getOrCreateVisitorId reads, creates, caps to 64 chars, and survives blocked localStorage', () => {
  const mem = new Map();
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
  };

  const id1 = getOrCreateVisitorId(store, () => 'abc12345_def67890_xyz');
  assert.equal(id1, 'abc12345_def67890_xyz');
  assert.equal(getOrCreateVisitorId(store, () => 'should_not_replace'), 'abc12345_def67890_xyz');

  const overlong = 'a'.repeat(100);
  const store2 = { getItem: () => null, setItem: (k, v) => mem.set(k + '_2', v) };
  const id2 = getOrCreateVisitorId(store2, () => overlong);
  assert.equal(id2.length, 64);

  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const id3 = getOrCreateVisitorId(broken, () => 'safeVisitorId1234');
  assert.equal(id3, 'safeVisitorId1234');
});

test('validateAccessRequest accepts only lender/reviewer, checks fields, and detects honeypot', () => {
  assert.deepEqual(OPEN_REQUEST_ROLES.map(([k]) => k), ['lender', 'reviewer']);

  const ok = validateAccessRequest({
    name: '  Alex Rivera ',
    company: ' First Bank ',
    email: ' Alex@Example.COM ',
    role: 'lender',
    note: ' Interested in financing ',
    honeypot: '',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.honeypot, false);
  assert.deepEqual(ok.values, {
    name: 'Alex Rivera',
    company: 'First Bank',
    email: 'alex@example.com',
    role: 'lender',
    note: 'Interested in financing',
  });

  const okReviewer = validateAccessRequest({
    name: '  Jordan Lee ',
    company: ' Should Be Ignored ',
    email: ' Jordan@Example.COM ',
    role: 'reviewer',
    note: ' Reviewing photos ',
    honeypot: '',
  });
  assert.equal(okReviewer.ok, true);
  assert.deepEqual(okReviewer.values, {
    name: 'Jordan Lee',
    company: '',
    email: 'jordan@example.com',
    role: 'reviewer',
    note: 'Reviewing photos',
  });

  const hp = validateAccessRequest({
    name: 'Bot',
    email: 'bot@example.com',
    role: 'lender',
    honeypot: 'http://spam.invalid',
  });
  assert.equal(hp.ok, true);
  assert.equal(hp.honeypot, true);

  for (const badRole of ['viewer', 'seller', 'realtor', 'owner', 'lead_guest', '']) {
    const res = validateAccessRequest({ name: 'Sam', email: 'sam@example.com', role: badRole });
    assert.equal(res.ok, false, `role ${badRole} rejected`);
  }
  assert.equal(validateAccessRequest({ name: '', email: 'sam@example.com', role: 'reviewer' }).ok, false);
  assert.equal(validateAccessRequest({ name: '   ', email: 'sam@example.com', role: 'lender' }).ok, false);
  assert.equal(validateAccessRequest({ name: 'Sam', email: '', role: 'lender' }).ok, false);
  assert.equal(validateAccessRequest({ name: 'Sam', email: '   ', role: 'reviewer' }).ok, false);
  assert.equal(validateAccessRequest({ name: 'Sam', email: 'not-an-email', role: 'reviewer' }).ok, false);
});

test('route parser and site helpers distinguish open viewer tokens from owner preview roles', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-';
  assert.equal(isOpenViewerToken(token), true);
  assert.equal(isOpenViewerToken('seller'), false);
  assert.equal(isOpenViewerToken('viewer'), false);

  assert.deepEqual(parseHash(`#/d/Charlotte/view/${token}`), {
    name: 'open-viewer',
    slug: 'charlotte',
    token,
    tab: '',
  });
  assert.deepEqual(parseHash(`#/d/charlotte/view/${token}/photos`), {
    name: 'open-viewer',
    slug: 'charlotte',
    token,
    tab: 'photos',
  });
  assert.deepEqual(parseHash('#/d/charlotte/view/seller'), {
    name: 'deal',
    slug: 'charlotte',
    tab: 'view',
    sub: 'seller',
  });
  assert.deepEqual(parseHash('#/d/charlotte/view/viewer'), {
    name: 'deal',
    slug: 'charlotte',
    tab: 'view',
    sub: 'viewer',
  });

  assert.equal(openViewerUrl('charlotte', token), `${GUEST_SITE}#/d/charlotte/view/${token}`);
  assert.equal(openViewerAllowed('public'), true);
  assert.equal(openViewerAllowed(''), true);
  assert.equal(openViewerAllowed('seller'), false);
  assert.equal(openViewerAllowed('owner'), false);
});

test('0027 migration grants anon only EXECUTE on the three open functions and creates no anon table policies', () => {
  const sql = read('supabase/migrations/0027_open_viewer_link.sql');
  assert.match(sql, /^[\s\S]*begin;/i);
  assert.match(sql, /notify pgrst,\s*'reload schema';/);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|net\.http_post|ntfy)\b/i);

  for (const tbl of ['commercial_open_links', 'commercial_open_views', 'commercial_open_request_attempts']) {
    assert.match(sql, new RegExp(`alter table public\\.${tbl} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on public\\.${tbl} from public, anon, authenticated`, 'i'));
  }

  // Zero policies may target anon.
  const policies = [...sql.matchAll(/create policy\s+\w+\s+on\s+[\w.]+[\s\S]*?;/gi)].map((m) => m[0]);
  assert.ok(policies.length >= 3);
  for (const pol of policies) {
    assert.match(pol, /\bto\s+authenticated\b/i, `policy must target authenticated only: ${pol}`);
    assert.doesNotMatch(pol, /\bto\s+(public|anon)\b/i, `no anon/public policy allowed: ${pol}`);
    assert.match(pol, /commercial_is_owner\(\)/i, `policy must be owner-only: ${pol}`);
  }

  // Only the exact 3 open RPCs may be granted to anon.
  const anonGrants = [...sql.matchAll(/grant\s+[^;]*\bto\s+[^;]*\banon\b[^;]*;/gi)].map((m) => m[0]);
  const expected = [
    'public.commercial_open_viewer(text)',
    'public.commercial_open_log_view(text, text)',
    'public.commercial_open_request_access(text, text, text, text, text, text)',
  ];
  assert.equal(anonGrants.length, expected.length);
  for (const fn of expected) {
    assert.ok(
      anonGrants.some((g) => /grant\s+execute\s+on\s+function/i.test(g) && g.includes(fn)),
      `missing anon EXECUTE grant for ${fn}`,
    );
  }
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete|all)\s+on\s+(table\s+)?[\w.]+\s+to\s+[^;]*\banon\b/i);

  // Security definer + search_path + limits
  assert.match(sql, /commercial_open_viewer[\s\S]*security definer\s+set search_path = public/i);
  assert.match(sql, /commercial_open_log_view[\s\S]*interval '1 hour'/i);
  assert.match(sql, /commercial_open_request_access[\s\S]*not in \('lender', 'reviewer'\)/i);
  assert.match(sql, /v_attempts >= 3/);
});

test('OpenViewer and Owner UI keep zero subtext, no polling, hidden honeypot, and summarizeOpenViews stats', () => {
  const ov = read('src/views/OpenViewer.jsx');
  assert.match(ov, /commercial_open_viewer/);
  assert.match(ov, /commercial_open_log_view/);
  assert.match(ov, /commercial_open_request_access/);
  assert.match(ov, /aria-hidden="true"[\s\S]*className="hidden"/);
  assert.doesNotMatch(ov, /setInterval/);

  const owner = read('src/views/Owner.jsx');
  assert.match(owner, /Open viewer link/);
  assert.match(owner, /openViewerUrl\(deal\.slug,\s*activeLink\.token\)/);
  assert.match(owner, /commercial_open_link_create/);
  assert.match(owner, /commercial_open_link_revoke/);
  assert.doesNotMatch(owner, /location\.origin/);

  const stats = summarizeOpenViews(
    [
      { id: 'l2', token: 'b'.repeat(32), revoked_at: null },
      { id: 'l1', token: 'a'.repeat(32), revoked_at: '2026-11-25T00:00:00Z' },
    ],
    [
      { link_id: 'l2', visitor: 'v1', viewed_at: '2026-11-26T10:00:00Z' },
      { link_id: 'l2', visitor: 'v1', viewed_at: '2026-11-26T12:00:00Z' },
      { link_id: 'l1', visitor: 'v2', viewed_at: '2026-11-25T09:00:00Z' },
    ],
  );
  assert.equal(stats.activeLink?.id, 'l2');
  assert.equal(stats.totalViews, 3);
  assert.equal(stats.uniqueVisitors, 2);
  assert.equal(stats.lastViewed, '2026-11-26T12:00:00Z');
});

test('mergePhotoUrlsById and mergeOpenViewerPhotoUrls merge signed urls by id without mutating inputs', () => {
  const baseRows = [
    { id: 'p1', storage_path: 'd1/p1.jpg', url: '' },
    { id: 'p2', storage_path: 'd1/p2.jpg', url: '' },
  ];
  const mergedRows = mergePhotoUrlsById(baseRows, [
    { id: 'p2', url: ' https://signed.example/p2.jpg ' },
    { id: 'unknown', url: 'https://signed.example/unknown.jpg' },
    { id: 'p1', url: '   ' },
  ]);
  assert.equal(baseRows[1].url, '');
  assert.equal(mergedRows.length, 2);
  assert.equal(mergedRows[0].url, '');
  assert.equal(mergedRows[1].url, 'https://signed.example/p2.jpg');

  const snapshot = {
    deal: { id: 'd1', slug: 'charlotte' },
    photos: [{ id: 'p1', storage_path: 'd1/p1.jpg', url: '' }],
    walkthroughPhotos: [
      { id: 'w1', unit_number: 1, room: 'kitchen', storage_path: 'd1/w1.jpg', url: '' },
      { id: 'w2', unit_number: 2, room: 'bath', storage_path: 'd1/w2.jpg', url: '' },
    ],
  };

  assert.equal(mergeOpenViewerPhotoUrls(snapshot, null), snapshot);

  const hydrated = mergeOpenViewerPhotoUrls(snapshot, {
    photos: [{ id: 'p1', url: 'https://signed.example/p1.jpg' }],
    walkthrough_photos: [{ id: 'w2', url: 'https://signed.example/w2.jpg' }],
  });

  assert.equal(snapshot.photos[0].url, '');
  assert.equal(snapshot.walkthroughPhotos[1].url, '');
  assert.equal(hydrated.photos[0].url, 'https://signed.example/p1.jpg');
  assert.equal(hydrated.walkthroughPhotos[0].url, '');
  assert.equal(hydrated.walkthroughPhotos[1].url, 'https://signed.example/w2.jpg');
});

test('open-viewer-photos edge function reads key only from Deno.env, validates token, uses commercial-files, and never returns storage_path', () => {
  const fn = read('supabase/functions/open-viewer-photos/index.ts');

  // Only jsr:@supabase/supabase-js@2 imported; no other dependencies.
  const imports = [...fn.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['jsr:@supabase/supabase-js@2']);

  // Service key comes strictly from Deno.env, never hard-coded or logged.
  assert.match(fn, /Deno\.env\.get\(\s*['"]SUPABASE_URL['"]\s*\)/);
  assert.match(fn, /Deno\.env\.get\(\s*['"]SUPABASE_SERVICE_ROLE_KEY['"]\s*\)/);
  const stripped = fn.replace(/Deno\.env\.get\(\s*['"]SUPABASE_SERVICE_ROLE_KEY['"]\s*\)/g, '');
  assert.doesNotMatch(stripped, /service_role|sb_secret_|eyJ[A-Za-z0-9_-]{10,}\./i);
  assert.doesNotMatch(fn, /console\.(log|info|warn|error|debug)/);

  // CORS and token validation.
  assert.match(fn, /req\.method === 'OPTIONS'/);
  assert.match(fn, /'Access-Control-Allow-Origin': '\*'/);
  assert.match(fn, /authorization, apikey, content-type, x-client-info/);
  assert.match(fn, /\^\[A-Za-z0-9_-\]\{32,128\}\$/);

  // RPC + 404 + single batch signing call on private bucket.
  assert.match(fn, /rpc\(\s*'commercial_open_viewer'/);
  assert.match(fn, /p_token:\s*token/);
  assert.match(fn, /json\(\s*\{\s*photos:\s*\[\]\s*\}\s*,\s*404\s*\)/);
  assert.match(fn, /BUCKET\s*=\s*'commercial-files'/);
  assert.match(fn, /EXPIRES_IN\s*=\s*3600/);
  assert.equal((fn.match(/\.createSignedUrls\(/g) || []).length, 1);

  // Output shape contains only { id, url } and never returns storage_path.
  assert.match(fn, /out\.push\(\s*\{\s*id,\s*url\s*\}\s*\)/);
  assert.match(fn, /photos:\s*toSignedList\(rawPhotos\)/);
  assert.match(fn, /walkthrough_photos:\s*toSignedList\(rawWalkthrough\)/);
  const jsonPayloads = [...fn.matchAll(/json\(\s*\{[\s\S]*?\}\s*(?:,\s*\d+)?\s*\)/g)].map((m) => m[0]);
  assert.ok(jsonPayloads.length >= 4);
  for (const payload of jsonPayloads) {
    assert.doesNotMatch(payload, /storage_path/);
  }

  // OpenViewer client calls the function once via invoke, merges by id, and never signs directly or polls.
  const ov = read('src/views/OpenViewer.jsx');
  assert.match(ov, /supabase\.functions\.invoke\(\s*'open-viewer-photos'\s*,\s*\{\s*body:\s*\{\s*token\s*\}/);
  assert.match(ov, /mergeOpenViewerPhotoUrls/);
  assert.doesNotMatch(ov, /createSignedUrls/);
  assert.doesNotMatch(ov, /setInterval/);
});

test('openViewerFacts allows only verified keys for charlotte and matches exact stat tiles', () => {
  assert.deepEqual(Object.keys(OPEN_VIEWER_FACTS), ['charlotte']);
  assert.deepEqual([...ALLOWED_FACT_KEYS], ['building', 'neighborhood', 'schools', 'nearby', 'map']);
  const c = OPEN_VIEWER_FACTS.charlotte;
  assert.deepEqual(Object.keys(c).sort(), ['building', 'map', 'nearby', 'neighborhood', 'schools']);
  assert.deepEqual(Object.keys(c.building).sort(), ['sources', 'stats']);
  assert.equal(c.building.style, undefined);
  assert.deepEqual(Object.keys(c.neighborhood).sort(), ['highlight', 'name', 'sources', 'transitScore', 'walkScore']);
  assert.deepEqual(Object.keys(c.schools).sort(), ['district', 'list', 'sources']);
  assert.equal(c.building.stats.length, 4);
  assert.deepEqual(
    c.building.stats.map((s) => s.value),
    ['1919', '10,800 sq ft', '10 apartments', '~810 sq ft avg'],
  );
  assert.equal(c.neighborhood.name, 'Highland Square, Akron');
  assert.equal(c.neighborhood.walkScore.value, 79);
  assert.equal(c.neighborhood.transitScore.value, 35);
  assert.equal(c.schools.district, 'Akron Public Schools');
  assert.deepEqual(c.schools.list, [
    'King Community Learning Center (K-5)',
    'Litchfield Community Learning Center',
    'Firestone High School',
  ]);
});

test('openViewerFacts nearby list and transit routes match exact verified values', () => {
  const { nearby } = OPEN_VIEWER_FACTS.charlotte;
  assert.deepEqual(nearby.walk, [
    { name: "Frank's Place on Market", distance: '0.1 mi', time: '2 min walk' },
    { name: 'House Three Thirty and Buckets', distance: '0.2 mi', time: '4 min walk' },
    { name: 'I Promise School', distance: '0.4 mi', time: '8 min walk' },
    { name: 'Highland Theatre', distance: '0.5 mi', time: '10 min walk' },
    { name: 'Mustard Seed Market', distance: '0.6 mi', time: '12 min walk' },
  ]);
  assert.deepEqual(nearby.drive, [
    { name: "Dr. Bob's Home", distance: '1.0 mi', time: '3 min drive' },
    { name: 'Cleveland Clinic Akron General', distance: '1.3 mi', time: '3 min drive' },
    { name: 'Downtown Akron (Lock 3)', distance: '1.6 mi', time: '4 min drive' },
    { name: 'University of Akron', distance: '2.0 mi', time: '5 min drive' },
    { name: 'Stan Hywet Hall & Gardens', distance: '2.3 mi', time: '6 min drive' },
    { name: 'Summa Akron City Hospital', distance: '2.4 mi', time: '7 min drive' },
  ]);
  assert.deepEqual(nearby.sources, [
    'Route distance from OpenStreetMap (OSRM), measured Nov 26, 2026',
  ]);
  assert.deepEqual(nearby.transit, {
    label: 'METRO RTA',
    routes: ['1 West Market', '28 Merriman Valley'],
    sources: ['walkscore.com'],
  });
});

test('openViewerFacts map embed and Get directions link exist only for charlotte and are rendered safely', () => {
  const { map } = OPEN_VIEWER_FACTS.charlotte;
  assert.equal(
    map.embedUrl,
    'https://www.openstreetmap.org/export/embed.html?bbox=-81.5458,41.0893,-81.5258,41.0993&layer=mapnik&marker=41.0943012,-81.5358543',
  );
  assert.equal(
    map.directionsUrl,
    'https://www.google.com/maps/dir/?api=1&destination=23-27+Charlotte+St+Akron+OH+44303',
  );
  assert.equal(getOpenViewerFacts('charlotte').map, map);
  assert.equal(getOpenViewerFacts('other-deal'), null);

  const pf = read('src/components/PropertyFacts.jsx');
  const ov = read('src/views/OpenViewer.jsx');
  assert.equal(pf.includes('openstreetmap.org'), false, 'map embed URL must live only in openViewerFacts.js');
  assert.equal(pf.includes('google.com/maps'), false, 'directions URL must live only in openViewerFacts.js');
  assert.equal(ov.includes('openstreetmap.org'), false, 'map embed URL must live only in openViewerFacts.js');
  assert.equal(ov.includes('google.com/maps'), false, 'directions URL must live only in openViewerFacts.js');
  assert.match(pf, /<iframe[\s\S]*src=\{facts\.map\.embedUrl\}[\s\S]*title="Map"[\s\S]*loading="lazy"[\s\S]*referrerPolicy="no-referrer"/);
  assert.match(pf, /<a[\s\S]*href=\{facts\.map\.directionsUrl\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"[\s\S]*Get directions/);
  assert.match(ov, /<PropertyFacts\s+slug=\{deal\.slug\}\s*\/>/);

  const html = read('index.html');
  assert.match(html, /frame-src[^;]*https:\/\/www\.openstreetmap\.org/);
});

test('openViewerFacts, PropertyFacts, and OpenViewer contain no banned words, no brick, and no site hostname', () => {
  const strings = [];
  const collect = (val) => {
    if (typeof val === 'string') strings.push(val);
    else if (Array.isArray(val)) val.forEach(collect);
    else if (val && typeof val === 'object') Object.values(val).forEach(collect);
  };
  collect(OPEN_VIEWER_FACTS);

  const factsSrc = read('src/lib/openViewerFacts.js');
  const pfSrc = read('src/components/PropertyFacts.jsx');
  const ovSrc = read('src/views/OpenViewer.jsx');
  const banned = /\b(owner|llc|sale|price|rent|mortgage|bank|code\s+case|tenant|brick)\b/i;
  const siteHost = new URL(GUEST_SITE).hostname;

  for (const s of [...strings, factsSrc]) {
    assert.doesNotMatch(s, banned);
    assert.equal(s.includes('$'), false);
    assert.equal(s.includes(siteHost), false);
  }
  assert.doesNotMatch(pfSrc, /\bbrick\b/i);
  assert.equal(pfSrc.includes(siteHost), false);
  assert.doesNotMatch(ovSrc, /\bbrick\b/i);
  assert.equal(ovSrc.includes(siteHost), false);
});

test('PropertyFacts renders sources only in OverlayTrigger and shares exact layout across OpenViewer and Reviewer viewer mode', () => {
  const c = OPEN_VIEWER_FACTS.charlotte;
  assert.deepEqual(c.building.sources, ['Summit County Fiscal Office commercial property card, parcel 6801234']);
  assert.deepEqual(c.neighborhood.sources, ['walkscore.com', 'Highland Square neighborhood listings']);
  assert.deepEqual(c.schools.sources, ['Zillow school assignment for 23-27 Charlotte St']);
  assert.deepEqual(c.nearby.sources, ['Route distance from OpenStreetMap (OSRM), measured Nov 26, 2026']);
  assert.deepEqual(c.nearby.transit.sources, ['walkscore.com']);

  const pf = read('src/components/PropertyFacts.jsx');
  assert.match(pf, /import\s+[\s\S]*\bOverlayTrigger\b[\s\S]*from\s+'\.\/Shell\.jsx'/);
  assert.match(pf, /<OverlayTrigger[\s\S]*lines=\{facts\.building\.sources\}/);
  assert.match(pf, /<OverlayTrigger[\s\S]*lines=\{facts\.neighborhood\.sources\}/);
  assert.match(pf, /<OverlayTrigger[\s\S]*lines=\{facts\.schools\.sources\}/);
  assert.match(pf, /<OverlayTrigger[\s\S]*lines=\{facts\.nearby\.sources\}/);
  assert.match(pf, /<OverlayTrigger[\s\S]*lines=\{facts\.nearby\.transit\.sources\}/);
  assert.match(pf, /tabular-nums/);

  // Source strings must never appear hardcoded as visible text in PropertyFacts.jsx or OpenViewer.jsx
  const ov = read('src/views/OpenViewer.jsx');
  for (const srcLine of [
    ...c.building.sources,
    ...c.neighborhood.sources,
    ...c.schools.sources,
    ...c.nearby.sources,
    ...c.nearby.transit.sources,
  ]) {
    assert.equal(pf.includes(srcLine), false, `source line should only live in openViewerFacts.js: ${srcLine}`);
    assert.equal(ov.includes(srcLine), false, `source line should only live in openViewerFacts.js: ${srcLine}`);
  }

  // Verify section order in PropertyFacts: 4 stat tiles -> Neighborhood -> Schools -> Nearby -> Map
  const pfStats = pf.indexOf('facts.building.stats');
  const pfNeighborhood = pf.search(/>\s*Neighborhood\s*</);
  const pfSchools = pf.search(/>\s*Schools\s*</);
  const pfNearby = pf.search(/>\s*Nearby\s*</);
  const pfMap = pf.search(/>\s*Map\s*</);
  assert.ok(pfStats > 0 && pfNeighborhood > pfStats && pfSchools > pfNeighborhood && pfNearby > pfSchools && pfMap > pfNearby);

  // Verify section order in OpenViewer: hero -> PropertyFacts -> Request access (UnitGallery lives inside InPagePanel)
  const idxHero = ov.indexOf('aria-label="Property hero"');
  const idxFacts = ov.indexOf('<PropertyFacts');
  const idxRequest = ov.indexOf('aria-label="Request access"');
  assert.ok(idxHero > 0 && idxFacts > idxHero && idxRequest > idxFacts);
  assert.match(ov, /<InPagePanel[^>]*open=\{unitGalleryOpen\}[\s\S]*?<UnitGallery/);

  // Render PropertyFacts directly for charlotte and unknown slugs.
  const pfMod = loadJsx('src/components/PropertyFacts.jsx', {
    '../lib/openViewerFacts.js': { getOpenViewerFacts },
    './Shell.jsx': {
      Card: ({ children, className }) => React.createElement('section', { className }, children),
      CardTitle: ({ children, aside }) => React.createElement('div', null, React.createElement('h2', null, children), aside),
      OverlayTrigger: ({ children, lines }) => React.createElement('span', { 'data-sources': (lines || []).join(' | ') }, children),
    },
  });
  const charlotteHtml = renderToStaticMarkup(React.createElement(pfMod.default, { slug: 'charlotte' }));
  assert.match(charlotteHtml, /10,800 sq ft/);
  assert.match(charlotteHtml, /Highland Square, Akron/);
  assert.match(charlotteHtml, /Akron Public Schools/);
  assert.match(charlotteHtml, /METRO RTA/);
  assert.match(charlotteHtml, /Get directions/);
  assert.equal(renderToStaticMarkup(React.createElement(pfMod.default, { slug: 'unknown' })), '');
});

test('Signed-in viewer mode uses PropertyFacts, removes bare property card, and enforces Name/Email/role-gated Company in ViewerAccessRequest', () => {
  const revSrc = read('src/views/Reviewer.jsx');
  const viewerReqBlock = revSrc.slice(
    revSrc.indexOf('function ViewerAccessRequest'),
    revSrc.indexOf('function QuickOpinion'),
  );
  assert.match(revSrc, /import\s+PropertyFacts\s+from\s+'\.\.\/components\/PropertyFacts\.jsx'/);
  assert.match(revSrc, /import\s+\{\s*VIEWER_REQUEST_ROLES\s*\}\s+from\s+'\.\.\/lib\/requestRoles\.js'/);
  assert.match(revSrc, /\{viewer\s*\?\s*\(\s*<>\s*<PropertyFacts\s+slug=\{deal\.slug\}\s*\/>\s*<ViewerAccessRequest\s+deal=\{deal\}\s+me=\{me\}\s+member=\{member\}\s+preview=\{preview\}\s*\/>\s*<\/>\s*\)/);
  assert.match(viewerReqBlock, /commercial_request_viewer_access/);
  assert.match(viewerReqBlock, /p_name:\s*cleanName/);
  assert.match(viewerReqBlock, /requestedRole === 'lender' \? \{ p_company:/);
  assert.doesNotMatch(viewerReqBlock, /role="status"/);
  assert.doesNotMatch(viewerReqBlock, /\(optional\)/i);
  assert.doesNotMatch(revSrc, /10-unit residential property/);

  const rolesSrc = read('src/lib/requestRoles.js');
  assert.match(rolesSrc, /VIEWER_REQUEST_ROLES\s*=\s*\[\s*\['lender',\s*'Lender'\],\s*\['reviewer',\s*'Reviewer'\]/);

  const makeViewerReact = (roleOverride) => ({
    ...React,
    useState(init) {
      if (init === false) return [true, () => {}];
      if (init === 'lender') return [roleOverride, () => {}];
      return React.useState(init);
    },
  });
  const reviewerMocks = {
    '../lib/people.js': { buyerName: () => 'Buyer' },
    './Comps.jsx': { __esModule: true, default: () => null },
    './Offers.jsx': { __esModule: true, default: () => null },
    '../lib/supabase.js': { supabase: { rpc: async () => ({ data: null, error: null }) } },
    '../lib/dealmath.js': { evaluate: () => ({}), operating: () => ({ b: { rent: 0, value: 0, rehab: 0, refiRate: 0, refiYears: 0 }, noi: 0, capRate: 0 }), money: (v) => String(v), pct: (v) => String(v), valueSummary: () => ({}) },
    '../lib/useDealModel.js': { useDealModel: () => ({ base: {} }) },
    '../lib/site.js': { SITE_KIND: '', canAccessCityRecords: () => false },
    '../components/Shell.jsx': {
      Button: ({ children, ...p }) => React.createElement('button', p, children),
      Card: ({ children }) => React.createElement('section', null, children),
      CardTitle: ({ children }) => React.createElement('h2', null, children),
      Empty: ({ children }) => React.createElement('p', null, children),
      Field: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p),
      JumpNav: () => null,
      OverlayTrigger: ({ children }) => React.createElement('span', null, children),
      useSectionScroll: () => ({ activeSection: 'overview', jumpTo: () => {} }),
    },
    '../components/Dictation.jsx': { DictatedField: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p) },
    '../components/Messages.jsx': { __esModule: true, default: () => null, sendToOwner: async () => null },
    '../components/Files.jsx': { useUploads: () => [[], () => {}], Uploader: () => null, FileList: () => null },
    '../components/Photos.jsx': { Cover: () => null, photosOf: () => [], useDealGallery: () => ({ items: [] }) },
    '../components/OverlaySheet.jsx': {
      InPagePanel: () => null,
      OverviewActionButtons: () => null,
    },
    '../lib/sheetBadges.js': { useSheetBadges: () => ({ docBadge: 0, msgBadge: 0, markDocsSeen: () => {}, markMsgsSeen: () => {} }) },
    './CityRecords.jsx': { __esModule: true, default: () => null },
    '../components/PropertyFacts.jsx': { __esModule: true, default: () => null },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../lib/visibility.js': { seenBy: (_r, rows) => rows || [] },
    '../components/UnitsRentedGuide.jsx': { isUnitsGuide: () => false },
    '../components/RentValue.jsx': { __esModule: true, default: () => null, isRentValue: () => false },
    '../lib/requestRoles.js': { VIEWER_REQUEST_ROLES },
  };

  const inputWithLabel = (html, label) => {
    const m = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`));
    assert.ok(m, `expected input with aria-label="${label}"`);
    return m[0];
  };

  const revLenderMod = loadJsx('src/views/Reviewer.jsx', reviewerMocks, makeViewerReact('lender'));
  const filledLenderHtml = renderToStaticMarkup(
    React.createElement(revLenderMod.default, {
      deal: { id: 'd1', slug: 'charlotte' },
      me: { email: 'Viewer@Example.com', name: 'Member Name' },
      member: { display_name: 'Alice Viewer' },
      role: 'viewer',
      preview: false,
    }),
  );
  assert.match(inputWithLabel(filledLenderHtml, 'Name'), /\brequired=""/);
  assert.match(inputWithLabel(filledLenderHtml, 'Name'), /\bvalue="Alice Viewer"/);
  const lenderEmailInput = inputWithLabel(filledLenderHtml, 'Email');
  assert.match(lenderEmailInput, /\btype="email"/);
  assert.match(lenderEmailInput, /\brequired=""/);
  assert.match(lenderEmailInput, /\breadonly=""/i);
  assert.match(lenderEmailInput, /\bvalue="viewer@example\.com"/);
  inputWithLabel(filledLenderHtml, 'Company');
  inputWithLabel(filledLenderHtml, 'Note');
  assert.doesNotMatch(filledLenderHtml, /<button[^>]*type="submit"[^>]*disabled=""/);

  const blankNameHtml = renderToStaticMarkup(
    React.createElement(revLenderMod.default, {
      deal: { id: 'd1', slug: 'charlotte' },
      me: { email: 'viewer@example.com', name: '' },
      member: { display_name: '' },
      role: 'viewer',
      preview: false,
    }),
  );
  assert.match(blankNameHtml, /<button[^>]*type="submit"[^>]*disabled=""/);

  const previewHtml = renderToStaticMarkup(
    React.createElement(revLenderMod.default, {
      deal: { id: 'd1', slug: 'charlotte' },
      me: { email: '__preview__', name: 'Preview' },
      role: 'viewer',
      preview: true,
    }),
  );
  assert.match(previewHtml, /<button[^>]*type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(previewHtml, /__preview__/);

  const revReviewerMod = loadJsx('src/views/Reviewer.jsx', reviewerMocks, makeViewerReact('reviewer'));
  const reviewerRoleHtml = renderToStaticMarkup(
    React.createElement(revReviewerMod.default, {
      deal: { id: 'd1', slug: 'charlotte' },
      me: { email: 'viewer@example.com', name: 'Bob Reviewer' },
      role: 'viewer',
      preview: false,
    }),
  );
  assert.match(inputWithLabel(reviewerRoleHtml, 'Name'), /\brequired=""/);
  assert.match(inputWithLabel(reviewerRoleHtml, 'Name'), /\bvalue="Bob Reviewer"/);
  assert.match(inputWithLabel(reviewerRoleHtml, 'Email'), /\breadonly=""/i);
  assert.doesNotMatch(reviewerRoleHtml, /aria-label="Company"/);
  inputWithLabel(reviewerRoleHtml, 'Note');
});

test('OpenViewer request access form requires Name/Email, shows Company only for Lender, and omits subtext', () => {
  const ovSrc = read('src/views/OpenViewer.jsx');
  assert.doesNotMatch(ovSrc, /\(optional\)/i);
  assert.match(ovSrc, /p_company:\s*check\.values\.role === 'lender' \? check\.values\.company : ''/);

  const snapshot = {
    deal: { id: 'd1', slug: 'charlotte', title: '23-27 Charlotte St', address: '23-27 Charlotte St, Akron, OH', units: 10, summary: 'Property' },
    photos: [],
    walkthroughPhotos: [],
  };
  const makeOpenReact = (roleOverride) => {
    let falseCalls = 0;
    return {
      ...React,
      useState(init) {
        if (init && typeof init === 'object' && 'snapshot' in init) return [{ loading: false, snapshot }, () => {}];
        if (init === false) {
          falseCalls += 1;
          return [falseCalls >= 2, () => {}];
        }
        if (init && typeof init === 'object' && 'role' in init) return [{ ...init, role: roleOverride }, () => {}];
        return React.useState(init);
      },
    };
  };
  const openMocks = {
    '../lib/supabase.js': { supabase: { rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null, error: null }) } } },
    '../lib/site.js': { isOpenViewerToken: () => true },
    '../lib/leaseUp.js': { ROOMS: [], AREA_ROOMS: [], spaceLabel: (u) => String(u) },
    '../lib/openViewer.js': {
      OPEN_REQUEST_ROLES,
      filterOpenViewerSnapshot,
      getOpenViewerFacts,
      getOrCreateVisitorId,
      mergeOpenViewerPhotoUrls,
      selectFeaturedPhoto,
      validateAccessRequest,
    },
    '../components/Shell.jsx': Object.assign(
      ({ children }) => React.createElement('div', null, children),
      {
        Button: ({ children, ...p }) => React.createElement('button', p, children),
        Card: ({ children }) => React.createElement('section', null, children),
        CardTitle: ({ children }) => React.createElement('h2', null, children),
        Empty: ({ children }) => React.createElement('p', null, children),
        Field: ({ as: Tag = 'input', ...p }) => React.createElement(Tag, p),
      },
    ),
    '../components/Photos.jsx': { PhotoGrid: () => null, photosOf: () => [] },
    '../components/PhotoViewer.jsx': { __esModule: true, default: () => null },
    '../components/PropertyFacts.jsx': { __esModule: true, default: () => null },
    '../components/UnitGallery.jsx': { __esModule: true, default: () => null },
    '../components/OverlaySheet.jsx': { InPagePanel: ({ open, children }) => (open ? React.createElement('div', null, children) : null) },
  };

  const inputTag = (html, label) => {
    const m = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`));
    assert.ok(m, `expected input with aria-label="${label}"`);
    return m[0];
  };

  const lenderHtml = renderToStaticMarkup(
    React.createElement(loadJsx('src/views/OpenViewer.jsx', openMocks, makeOpenReact('lender')).default, { slug: 'charlotte', token: 'a'.repeat(32), tab: '' }),
  );
  assert.match(inputTag(lenderHtml, 'Name'), /\brequired=""/);
  assert.match(inputTag(lenderHtml, 'Email'), /\btype="email"/);
  assert.match(inputTag(lenderHtml, 'Email'), /\brequired=""/);
  assert.doesNotMatch(inputTag(lenderHtml, 'Company'), /\brequired=""/);
  inputTag(lenderHtml, 'Note');

  const reviewerHtml = renderToStaticMarkup(
    React.createElement(loadJsx('src/views/OpenViewer.jsx', openMocks, makeOpenReact('reviewer')).default, { slug: 'charlotte', token: 'a'.repeat(32), tab: '' }),
  );
  assert.match(inputTag(reviewerHtml, 'Name'), /\brequired=""/);
  assert.match(inputTag(reviewerHtml, 'Email'), /\btype="email"/);
  assert.match(inputTag(reviewerHtml, 'Email'), /\brequired=""/);
  assert.doesNotMatch(reviewerHtml, /aria-label="Company"/);
  inputTag(reviewerHtml, 'Note');
});

test('0028 migration requires p_name, nulls company for reviewer on both RPCs, and preserves anon grants', () => {
  const sql = read('supabase/migrations/0028_viewer_access_upgrade.sql');
  assert.match(sql, /^[\s\S]*begin;/i);
  assert.match(sql, /notify pgrst,\s*'reload schema';/);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|net\.http_post|ntfy)\b/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*\bto\s+[^;]*\b(public|anon)\b/i);
  assert.match(sql, /grant execute on function public\.commercial_request_viewer_access\(uuid, text, text, text, text\) to authenticated/i);
  assert.match(sql, /request_viewer_access\(\s*p_deal uuid,\s*p_requested_role text,\s*p_name text,\s*p_company text default '',\s*p_note text default ''\s*\)[\s\S]*security definer set search_path = ''/i);
  assert.match(sql, /if v_name = '' then\s*raise exception 'name required' using errcode = '22023';/i);
  assert.match(sql, /request_viewer_access[\s\S]*when v_req_role = 'lender' then nullif\(left\(btrim\(coalesce\(p_company, ''\)\), 120\), ''\)\s*else null/i);
  assert.match(sql, /commercial_open_request_access[\s\S]*when v_role = 'lender' then nullif\(left\(btrim\(coalesce\(p_company, ''\)\), 120\), ''\)\s*else null/i);
  assert.match(sql, /v_role not in \('viewer', 'guest'\)/i);
  assert.match(sql, /v_req_role not in \('lender', 'reviewer'\)/i);
  assert.match(sql, /decide_request[\s\S]*and role in \('viewer', 'guest'\)/i);
  assert.match(sql, /req\.source = 'signed_in'/i);
});

test('getOpenViewerFacts returns facts for charlotte and null for unknown or prototype slugs', () => {
  assert.equal(getOpenViewerFacts('charlotte'), OPEN_VIEWER_FACTS.charlotte);
  assert.equal(getOpenViewerFacts('  Charlotte  '), OPEN_VIEWER_FACTS.charlotte);
  for (const bad of ['unknown', '', null, undefined, 'quayle', '__proto__', 'constructor', 'toString']) {
    assert.equal(getOpenViewerFacts(bad), null);
  }
});

test('selectFeaturedPhoto prefers featured cover photo, falls back to cover then walkthrough', () => {
  assert.equal(selectFeaturedPhoto([], []), null);
  assert.equal(selectFeaturedPhoto([{ id: 'p1', kind: 'photo', url: '' }], []), null);

  const featured = selectFeaturedPhoto(
    [
      { id: 'p1', kind: 'photo', url: 'https://signed.example/p1.jpg', featured: false, note: 'Side' },
      { id: 'p2', kind: 'photo', url: ' https://signed.example/p2.jpg ', featured: true, note: 'Front' },
    ],
    [{ id: 'w1', url: 'https://signed.example/w1.jpg' }],
  );
  assert.deepEqual(featured, { id: 'p2', url: 'https://signed.example/p2.jpg', alt: 'Front' });

  const firstCover = selectFeaturedPhoto(
    [{ id: 'p1', kind: 'photo', url: 'https://signed.example/p1.jpg', featured: false }],
    [{ id: 'w1', url: 'https://signed.example/w1.jpg' }],
  );
  assert.deepEqual(firstCover, { id: 'p1', url: 'https://signed.example/p1.jpg', alt: 'Property photo' });

  const walkFallback = selectFeaturedPhoto(
    [{ id: 'p1', kind: 'photo', url: '' }],
    [{ id: 'w1', unit_number: 1, room: 'kitchen', url: 'https://signed.example/w1.jpg' }],
  );
  assert.deepEqual(walkFallback, { id: 'w1', url: 'https://signed.example/w1.jpg', alt: 'Property photo' });
});
