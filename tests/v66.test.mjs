import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteRules, isLinkToken, roleLinkUrl, PUBLIC_SITE } from '../src/lib/site.js';
import { parseHash } from '../src/lib/useHashRoute.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

test('owner page loads only on the owner build, guests only on the guest build', () => {
  assert.deepEqual(siteRules('public'), { ownerAllowed: false, guestsAllowed: true });
  assert.deepEqual(siteRules('owner'), { ownerAllowed: true, guestsAllowed: false });
  assert.deepEqual(siteRules(''), { ownerAllowed: true, guestsAllowed: true });
  const app = read('src/App.jsx');
  // The site check happens before any page that loads deal data.
  assert.ok(app.indexOf('rules.ownerAllowed') < app.indexOf('<DealRoom'));
  assert.ok(app.indexOf('rules.guestsAllowed') < app.indexOf('<Home'));
  assert.ok(app.indexOf('rules.guestsAllowed') < app.indexOf('<Join'));
});

test('role links point at the guest site and carry a full token', () => {
  assert.equal(PUBLIC_SITE, 'https://2327charlotte.oilgateai.com/');
  const t = 'a'.repeat(64);
  assert.equal(roleLinkUrl(t), `${PUBLIC_SITE}#/join/${t}`);
  assert.ok(isLinkToken(t));
  assert.ok(!isLinkToken('a'.repeat(63)));
  assert.ok(!isLinkToken('../x'));
  assert.deepEqual(parseHash(`#/join/${t.toUpperCase()}`), { name: 'join', token: t });
  assert.match(read('src/views/Owner.jsx'), /const link = PUBLIC_SITE;/);
  assert.doesNotMatch(read('src/views/Owner.jsx'), /location\.origin/);
});

test('role link rules in the database', () => {
  const sql = read('supabase/migrations/0016_v66_role_links.sql');
  assert.match(sql, /token_hash text not null unique/);
  assert.doesNotMatch(sql, /\btoken text\b/, 'raw tokens are never stored');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.commercial_role_links from anon, authenticated/);
  assert.match(sql, /using \(public\.commercial_is_owner\(\)\)/);
  assert.match(sql, /l\.revoked_at is null/, 'turning a link off removes access');
  assert.match(sql, /expires_at > now\(\)/);
  for (const fn of ['create_role_link', 'revoke_role_link', 'redeem_role_link']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.commercial_${fn}\\([^)]*\\) from public, anon`));
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.commercial_${fn}\\([^)]*\\) to anon`));
  }
  assert.match(read('scripts/live-security-check.mjs'), /'role_links'/);
});

test('no other oilgateai.com address appears anywhere in the code', () => {
  const skip = new Set(['node_modules', 'dist', '.git']);
  const hits = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (skip.has(n)) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsx?|mjs|html|ya?ml|sql|md|json|txt)$/.test(n) && !/package-lock/.test(n)) {
        for (const m of readFileSync(p, 'utf8').matchAll(/([a-z0-9-]+)\.oilgateai\.com/gi)) if (m[1].toLowerCase() !== '2327charlotte') hits.push(`${p}: ${m[1]}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('public site build blocks the owner page', () => {
  const wf = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(wf, /VITE_SITE_KIND: seller/);
  assert.equal(siteRules('public').ownerAllowed, false);
  assert.equal(siteRules('public').guestsAllowed, true);
});
test('Seller only on 2327; every other role on the one shared private address', async () => {
  const { roleLinkUrl, roleAllowedHere, requestAccessAllowed, siteRules: rules } = await import('../src/lib/site.js');
  const t = 'a'.repeat(64);
  assert.equal(roleLinkUrl(t, 'seller'), 'https://2327charlotte.oilgateai.com/#/join/' + t);
  for (const r of ['realtor', 'lender', 'reviewer', 'viewer', 'lead_guest']) {
    assert.equal(roleAllowedHere('seller', r), false);
    assert.equal(roleAllowedHere('public', r), true);
  }
  assert.equal(roleAllowedHere('seller', 'seller'), true);
  assert.equal(roleAllowedHere('public', 'seller'), false);
  assert.equal(rules('seller').ownerAllowed, false);
  assert.equal(requestAccessAllowed('seller'), false);
  assert.equal(requestAccessAllowed('public'), true);
  assert.match(read('src/views/DealRoom.jsx'), /roleAllowedHere\(SITE_KIND, state\.role\)/);
});

test('Owner can pick the lead offer from the default Offers view', () => {
  const src = read('src/views/Offers.jsx');
  assert.match(src, /aria-label="Lead offer"/);
  assert.ok(src.indexOf('aria-label="Lead offer"') < src.indexOf("view === 'table' && <OptionTable"));
});
