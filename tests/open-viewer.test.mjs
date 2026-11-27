import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPEN_REQUEST_ROLES,
  filterOpenViewerSnapshot,
  getOrCreateVisitorId,
  mergeOpenViewerPhotoUrls,
  mergePhotoUrlsById,
  summarizeOpenViews,
  validateAccessRequest,
} from '../src/lib/openViewer.js';
import { parseHash } from '../src/lib/useHashRoute.js';
import {
  GUEST_SITE,
  isOpenViewerToken,
  openViewerAllowed,
  openViewerUrl,
} from '../src/lib/site.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

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
