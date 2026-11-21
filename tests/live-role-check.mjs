// Opt-in end-to-end check against the configured Supabase project and a local/live UI.
// All users, deal rows and objects are temporary fixtures; credentials stay in memory.
// Run: node tests/live-role-check.mjs [http://127.0.0.1:5173/|https://2327charlotte.oilgateai.com/]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env.production', root), 'utf8').split(/\r?\n/).filter(l => /^VITE_/.test(l)).map(l => { const n = l.indexOf('='); return [l.slice(0, n), l.slice(n + 1).replace(/^['"]|['"]$/g, '')]; }));
const project = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
if (!/^[a-z]{20}$/.test(project)) throw new Error('Invalid configured project');
const keyOutput = execFileSync('cmd.exe', ['/d', '/s', '/c', `npx.cmd --yes supabase projects api-keys --remote=${project} --reveal --output json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const keys = JSON.parse(keyOutput);
const key = keys.find(k => k.name === 'service_role')?.api_key;
if (!key) throw new Error('Administrative test access unavailable');
const admin = createClient(env.VITE_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const baseURL = process.argv[2] || 'http://127.0.0.1:5173/';
const prefix = `qa-${Date.now()}`;
const users = {};
const contexts = [];
const objects = [];
let deal, browser, debugPage;
const check = (result, label) => { if (result.error) throw new Error(label); return result.data; };
const log = message => console.log(`PASS ${message}`);
try {
  for (const role of ['owner', 'seller', 'realtor', 'reviewer', 'lender', 'viewer', 'lender2']) {
    const email = `${prefix}-${role}@example.invalid`;
    const password = randomUUID() + 'aA1!';
    const user = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `Create temporary ${role}`).user;
    users[role] = { id: user.id, email };
    const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = check(await client.auth.signInWithPassword({ email, password }), `Sign in temporary ${role}`);
    users[role] = { id: user.id, email, client, session: auth.session };
  }
  check(await admin.from('commercial_owners').insert({ email: users.owner.email }), 'Create fixture owner');
  deal = check(await admin.from('commercial_deals').insert({ slug: prefix, title: 'QA temporary Charlotte role check', address: 'QA fixture, Akron, OH', seller_content: { headline: 'QA purchase overview', intro: 'Temporary test fixture', options: ['A', 'B', 'C'].map(key => ({ key, title: `QA Option ${key}`, tagline: 'Discuss a purchase', steps: ['Verify records', 'Agree terms'], you_get: [{ label: 'Timeline', value: 'To agree' }], ask: 'Documents', watch: 'Subject to agreement' })) } }).select().single(), 'Create temporary deal');
  check(await admin.from('commercial_members').insert(Object.entries(users).filter(([r]) => r !== 'owner').map(([r, u]) => ({ deal_id: deal.id, email: u.email, role: r === 'lender2' ? 'lender' : r, display_name: `QA ${r}` }))), 'Create fixture memberships');
  check(await admin.from('commercial_models').insert({ deal_id: deal.id, base: { units: 9, rent: 1200, value: 700000, taxes: 10000, insurance: 4000 } }), 'Seed fixture model');
  check(await admin.from('commercial_offers').insert(['master_lease', 'wrap', 'cash'].map((structure, i) => ({ deal_id: deal.id, structure, name: `QA Option ${String.fromCharCode(65 + i)}`, share_reviewer: true, share_lender: true, sort: i }))), 'Seed fixture options');
  check(await admin.from('commercial_owner_notes').insert({ deal_id: deal.id, body: 'QA PRIVATE OWNER HISTORY' }), 'Seed private note');
  check(await users.owner.client.from('commercial_work_items').insert({ deal_id: deal.id, kind: 'research', body: 'QA REALTOR RESEARCH', audience: ['realtor'], author_email: users.owner.email, author_role: 'owner' }), 'Share fixture research');
  const photoPath = `${deal.id}/${randomUUID()}-qa-photo.png`;
  const photoData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCYQAAAAASUVORK5CYII=', 'base64');
  check(await admin.storage.from('commercial-files').upload(photoPath, photoData, { contentType: 'image/png' }), 'Seed fixture photo');
  objects.push(photoPath);
  check(await admin.from('commercial_uploads').insert({ deal_id: deal.id, storage_path: photoPath, file_name: 'qa-photo.png', mime: 'image/png', size_bytes: photoData.length, kind: 'photo', visibility: 'seller', audience: ['viewer'], uploaded_by_email: users.owner.email, uploaded_by_role: 'owner' }), 'Share fixture photo');
  browser = await chromium.launch({ headless: true });
  const pageFor = async (role, width = 390) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } }); contexts.push(context);
    await context.addInitScript(({ session, project }) => localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)), { session: users[role].session, project });
    const page = await context.newPage();
    debugPage = page;
    page.on('pageerror', () => { /* Assertions below fail on missing UI; never log raw page data. */ });
    await page.goto(`${baseURL}#/d/${deal.slug}`);
    return page;
  };
  const seller = await pageFor('seller');
  await expect(seller.getByRole('button', { name: 'Compare options', exact: true })).toBeVisible();
  await expect(seller.getByRole('columnheader', { name: /Option [ABC]/ })).toHaveCount(3);
  if (process.env.COMMERCIAL_QA_ARTIFACT_DIR) await seller.screenshot({ path: join(process.env.COMMERCIAL_QA_ARTIFACT_DIR, 'seller-phone.png') });
  await seller.getByRole('button', { name: 'Ask about this option', exact: true }).first().click();
  await seller.getByRole('textbox', { name: 'Your question about option A' }).fill('QA option question');
  await seller.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(seller.getByText('Sent to the owner and realtor.', { exact: true })).toBeVisible();
  await seller.getByPlaceholder('Write a message').fill('QA seller typed message');
  await seller.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(seller.getByPlaceholder('Write a message')).toHaveValue('');
  await seller.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'qa-seller.txt', mimeType: 'text/plain', buffer: Buffer.from('QA seller upload') });
  await expect(seller.getByText('1 file uploaded.', { exact: true })).toBeVisible();
  await expect(seller.getByRole('link', { name: 'qa-seller.txt', exact: true })).toBeVisible();
  await seller.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(seller.locator('li').filter({ hasText: 'Verify records' })).toHaveCount(3);
  await seller.getByRole('button', { name: 'This one looks good', exact: true }).first().click();
  await expect(seller.getByText('Your pick', { exact: true })).toBeVisible();
  expect(await seller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  log('seller phone comparison, all expanded cards, option question, typing/send, upload, interest');
  const realtor = await pageFor('realtor');
  await realtor.getByRole('link', { name: 'Research', exact: true }).click();
  await expect(realtor.getByText('QA REALTOR RESEARCH', { exact: true })).toBeVisible();
  await realtor.getByRole('link', { name: 'BIA sheet', exact: true }).click();
  await realtor.getByLabel('Building condition / repairs', { exact: true }).fill('QA needs inspection');
  await realtor.getByRole('button', { name: 'Save BIA sheet', exact: true }).click();
  await expect(realtor.getByText('Saved. The owner can read your BIA sheet.', { exact: true })).toBeVisible();
  const savedBia = check(await users.realtor.client.from('commercial_bia').select('answers').eq('deal_id', deal.id).eq('author_email', users.realtor.email).single(), 'Read saved fixture BIA');
  expect(savedBia.answers.condition).toBe('QA needs inspection');
  await realtor.reload(); await expect(realtor.getByLabel('Building condition / repairs', { exact: true })).toHaveValue('QA needs inspection');
  await realtor.getByRole('link', { name: 'Tasks', exact: true }).click();
  await realtor.getByRole('textbox', { name: 'New task', exact: true }).fill('QA inspect unit layout');
  await realtor.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(realtor.getByText('QA inspect unit layout', { exact: true })).toBeVisible();
  await realtor.getByLabel('Complete QA inspect unit layout', { exact: true }).check();
  await expect(realtor.getByLabel('Complete QA inspect unit layout', { exact: true })).toBeEnabled();
  await realtor.reload();
  await expect(realtor.getByLabel('Complete QA inspect unit layout', { exact: true })).toBeChecked();
  await realtor.getByRole('link', { name: 'Messages', exact: true }).click();
  await expect(realtor.getByText('QA option question', { exact: true })).toBeVisible();
  await realtor.getByPlaceholder('Write a message').fill('QA realtor reply');
  await realtor.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(realtor.getByText('QA realtor reply', { exact: true })).toBeVisible();
  await realtor.getByRole('button', { name: 'Message owner', exact: true }).click();
  await realtor.getByPlaceholder('Write a message').fill('QA private realtor history');
  await realtor.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(realtor.getByText('QA private realtor history', { exact: true })).toBeVisible();
  await realtor.getByRole('link', { name: 'Files', exact: true }).click();
  await realtor.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'qa-realtor.txt', mimeType: 'text/plain', buffer: Buffer.from('QA realtor upload') });
  await expect(realtor.getByText('1 file uploaded.', { exact: true })).toBeVisible();
  log('realtor research, persistent BIA, task, seller thread/reply, upload');
  for (const role of ['reviewer', 'lender']) {
    const page = await pageFor(role);
    await expect(page.getByText('Potential for a 10th unit ? must be seen/verified first.', { exact: false })).toBeVisible();
    await expect(page.getByRole('row', { name: /Break-even occupancy/ })).toContainText('of 9 units');
    if (role === 'lender') {
      for (const type of ['Private money', 'Hard money', 'Traditional']) { await page.getByRole('tab', { name: type, exact: true }).click(); await expect(page.getByRole('heading', { name: type, exact: true })).toBeVisible(); }
      await page.getByLabel('Maximum LTV', { exact: true }).fill('QA 70%');
      await page.getByRole('button', { name: 'Send terms to owner', exact: true }).click();
      await expect(page.getByText('Sent privately to the owner. Find it in Messages.', { exact: true })).toBeVisible();
    }
    await page.getByLabel('Upload files', { exact: true }).setInputFiles({ name: `qa-${role}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`QA ${role} upload`) });
    await expect(page.getByText('1 file uploaded.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Messages', exact: true }).click();
    await page.getByPlaceholder('Write a message').fill(`QA ${role} typed message`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByPlaceholder('Write a message')).toHaveValue('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    log(`${role} phone view, typing/send, upload${role === 'lender' ? ', three lender types and private terms submission' : ''}`);
  }
  const owner = await pageFor('owner', 1440);
  await expect(owner.getByRole('heading', { name: 'Deal at a glance', exact: true })).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Latest messages by role', exact: true })).toBeVisible();
  if (process.env.COMMERCIAL_QA_ARTIFACT_DIR) await owner.screenshot({ path: join(process.env.COMMERCIAL_QA_ARTIFACT_DIR, 'owner-dashboard.png'), fullPage: true });
  await expect(owner.getByText('QA needs inspection', { exact: false })).toBeVisible();
  await owner.getByRole('button', { name: 'Preview qa-photo.png', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Close preview', exact: true })).toBeVisible();
  await owner.getByRole('button', { name: 'Close preview', exact: true }).click();
  await owner.getByRole('link', { name: 'Reply', exact: true }).first().click();
  await owner.getByPlaceholder('Write a message').fill('QA owner reply from dashboard');
  await owner.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(owner.getByText('QA owner reply from dashboard', { exact: true })).toBeVisible();
  await owner.getByRole('link', { name: 'Seller page', exact: true }).click();
  await owner.getByLabel('Remaining loan balance', { exact: true }).fill('123456');
  await owner.getByLabel('Lender', { exact: true }).fill('QA lender entered by owner');
  await owner.getByRole('button', { name: 'Save loan', exact: true }).click();
  await expect(owner.getByText('Loan saved. Visible only to the owner and seller.', { exact: true })).toBeVisible();
  await seller.reload();
  await expect(seller.getByText('$123,456.00', { exact: true })).toBeVisible();
  await expect(seller.getByText('QA lender entered by owner', { exact: true })).toBeVisible();
  await expect(seller.getByText('QA owner reply from dashboard', { exact: true })).toBeVisible();
  log('owner dashboard, realtor BIA readback, owner-only loan editing and seller readback');
  const viewer = await pageFor('viewer');
  await expect(viewer.getByText('A proposed purchase of this nine-unit property.', { exact: false })).toBeVisible();
  await expect(viewer.getByRole('textbox')).toHaveCount(0);
  await expect(viewer.getByAltText('Property photo', { exact: true })).toBeVisible();
  await expect(viewer.getByText('QA REALTOR RESEARCH', { exact: true })).toHaveCount(0);
  log('viewer purchase overview with no editing, underwriting or research');
  const get = async (role, table) => check(await users[role].client.from(table).select('*').eq('deal_id', deal.id), `Read ${role} ${table}`);
  for (const role of ['seller', 'realtor', 'reviewer', 'lender', 'viewer']) {
    expect((await get(role, 'commercial_owner_notes')).length).toBe(0);
    const convs = await get(role, 'commercial_conversations');
    expect(convs.every(c => c.participants.includes(users[role].email))).toBe(true);
    if (['seller', 'realtor', 'viewer'].includes(role)) expect((await get(role, 'commercial_offers')).length).toBe(0);
    if (['seller', 'viewer'].includes(role)) expect((await get(role, 'commercial_work_items')).length).toBe(0);
  }
  expect((await get('lender2', 'commercial_messages')).length).toBe(0);
  const lenderConvs = await get('lender', 'commercial_conversations'); expect(lenderConvs.every(c => c.participants.length === 1)).toBe(true);
  const sellerConvs = await get('seller', 'commercial_conversations'); expect(sellerConvs.every(c => c.participants.includes(users.realtor.email))).toBe(true);
  expect((await get('seller', 'commercial_messages')).some(m => m.body === 'QA private realtor history')).toBe(false);
  const lenderConv = lenderConvs[0];
  const moved = await users.owner.client.from('commercial_conversations').update({ participants: [users.realtor.email] }).eq('id', lenderConv.id).select();
  expect(moved.error).toBeTruthy();
  const mixed = await users.owner.client.from('commercial_conversations').insert({ deal_id: deal.id, participants: [users.lender.email, users.realtor.email], created_by: users.owner.email }).select();
  expect(mixed.error).toBeTruthy();
  for (const role of ['realtor', 'reviewer', 'lender', 'viewer']) expect((await get(role, 'commercial_seller_loans')).length).toBe(0);
  const denied = await users.seller.client.from('commercial_offers').update({ name: 'QA FORBIDDEN' }).eq('deal_id', deal.id).select();
  expect(denied.data || []).toHaveLength(0);
  const deniedBia = await users.reviewer.client.from('commercial_bia').select('*').eq('deal_id', deal.id); expect(deniedBia.data || []).toHaveLength(0);
  const task = (await get('realtor', 'commercial_work_items')).find(x => x.kind === 'task');
  expect((await get('lender', 'commercial_work_items')).some(x => x.id === task.id)).toBe(false);
  const denyToggle = await users.lender.client.rpc('commercial_set_task_done', { p_id: task.id, p_done: false }); expect(denyToggle.error).toBeTruthy();
  const files = check(await admin.from('commercial_uploads').select('*').eq('deal_id', deal.id), 'Read fixture uploads');
  for (const role of ['seller', 'realtor', 'reviewer', 'lender']) {
    const f = files.find(x => x.uploaded_by_role === role); expect(f).toBeTruthy();
    const signed = check(await users[role].client.storage.from('commercial-files').createSignedUrl(f.storage_path, 60), `Sign ${role} upload`);
    const response = await fetch(signed.signedUrl); expect(response.ok).toBe(true); expect(await response.text()).toContain('QA');
  }
  log('real RLS isolation, no seller offer edits, seller-to-realtor routing, lender isolation, upload download/readback');
  console.log(`RESULT all real-role end-to-end checks passed on ${new URL(baseURL).origin}`);
} catch (error) {
  // Assertion output can contain signed URLs or tokens: print only bounded operation labels.
  console.error(`FAIL live role check: ${error.name === 'Error' && !error.message.includes('http') && error.message.length < 100 ? error.message : error.name}`);
  console.error(error.message.replace(/https?:\/\/\S+/g, '[URL]').replace(/eyJ[\w.-]+/g, '[redacted]').slice(0, 1200));
  if (debugPage) console.error('Fixture UI:', (await debugPage.locator('body').innerText().catch(() => '')).slice(0, 1200));
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (deal) {
    const files = await admin.from('commercial_uploads').select('storage_path').eq('deal_id', deal.id);
    const paths = [...new Set([...objects, ...(files.data || []).map(f => f.storage_path)])];
    if (paths.length) check(await admin.storage.from('commercial-files').remove(paths), 'Clean fixture storage');
    check(await admin.from('commercial_deals').delete().eq('id', deal.id), 'Clean temporary deal');
  }
  if (users.owner) check(await admin.from('commercial_owners').delete().eq('email', users.owner.email), 'Clean fixture owner');
  for (const u of Object.values(users)) check(await admin.auth.admin.deleteUser(u.id), 'Clean temporary user');
  console.log('CLEANUP temporary accounts, deal rows, and uploads removed');
}
