// Live security check, no secrets needed. Runs in CI before every release and weekly.
// 1) Someone who is not signed in gets nothing from any deal-site table or the file bucket.
// 2) The live page carries its security rules (CSP, referrer, noindex).
// Uses only the public anon key that already ships in the page.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.production', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => /^VITE_/.test(l))
    .map((l) => { const n = l.indexOf('='); return [l.slice(0, n), l.slice(n + 1).replace(/^['"]|['"]$/g, '')]; })
);
const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const site = (process.argv[2] || 'https://2327charlotte.oilgateai.com/').replace(/\/?$/, '/');
const checkPage = !process.argv.includes('--data-only');
const h = { apikey: anon, Authorization: `Bearer ${anon}` };
const fails = [];

const TABLES = ['access_requests', 'activity', 'bia', 'comp_picks', 'comp_settings', 'comps', 'conversations', 'deal_private', 'deals',
  'interest', 'lender_terms', 'members', 'messages', 'models', 'offers', 'owner_notes', 'owners', 'role_links', 'seller_loans',
  'settings', 'strategy_ideas', 'tenant_leads', 'tenant_suggestions', 'unit_notes', 'uploads',
  'walkthrough_notes', 'walkthrough_photos', 'walkthrough_videos', 'work_items'].map((t) => `commercial_${t}`);

for (const t of TABLES) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: h });
  const body = await r.text();
  const leaked = r.ok && body.trim() !== '[]';
  if (leaked) fails.push(`${t}: readable without signing in`);
  const w = await fetch(`${url}/rest/v1/${t}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: '{}' });
  if (w.ok) fails.push(`${t}: writable without signing in`);
}

for (const [fn, body] of [['commercial_create_role_link', { p_deal: '00000000-0000-0000-0000-000000000000', p_role: 'viewer' }],
  ['commercial_redeem_role_link', { p_token: '0'.repeat(64) }], ['commercial_revoke_role_link', { p_link: '00000000-0000-0000-0000-000000000000' }],
  ['commercial_get_lead_offer', { p_deal: '00000000-0000-0000-0000-000000000000' }],
  ['commercial_set_lead_offer', { p_deal: '00000000-0000-0000-0000-000000000000', p_offer: null }],
  ['commercial_request_charlotte_access', { p_submit: false, p_requested_role: null }]]) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.ok) fails.push(`${fn}: callable without signing in`);
}

const files = await fetch(`${url}/storage/v1/object/list/commercial-files`, {
  method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 5 }),
});
if (files.ok && (await files.json()).length) fails.push('commercial-files: listable without signing in');
const pub = await fetch(`${url}/storage/v1/object/public/commercial-files/x`);
if (pub.ok) fails.push('commercial-files: public bucket');

if (checkPage) {
  const page = await (await fetch(site, { cache: 'no-store' })).text();
  for (const [label, re] of [
    ['CSP', /http-equiv="Content-Security-Policy"[^>]*object-src 'none'/],
    ['referrer rule', /name="referrer" content="strict-origin-when-cross-origin"/],
    ['noindex', /name="robots" content="noindex, nofollow"/],
  ]) if (!re.test(page)) fails.push(`live page missing ${label}`);
  const http = await fetch(site.replace(/^https:/, 'http:'), { redirect: 'manual' }).catch(() => null);
  if (http && http.status === 200) fails.push('plain http is served without redirect to https');
}

if (fails.length) { console.error('SECURITY CHECK FAILED\n- ' + fails.join('\n- ')); process.exit(1); }
console.log(`Security check passed: ${TABLES.length} tables and the file bucket are closed to anyone not signed in${checkPage ? '; live page rules present' : ''}.`);
