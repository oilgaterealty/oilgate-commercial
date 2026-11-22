// Opt-in end-to-end check against the configured Supabase project and a local/live UI.
// All users, deal rows and objects are temporary fixtures; credentials stay in memory.
// Run: node tests/live-role-check.mjs [http://127.0.0.1:4173/|https://2327charlotte.oilgateai.com/]
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.env.production', root), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^VITE_/.test(l))
    .map((l) => {
      const n = l.indexOf('=');
      return [l.slice(0, n), l.slice(n + 1).replace(/^['"]|['"]$/g, '')];
    })
);
const project = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
if (!/^[a-z]{20}$/.test(project)) throw new Error('Invalid configured project');

const keyOutput = execFileSync(
  'cmd.exe',
  ['/d', '/s', '/c', `npx.cmd --yes supabase projects api-keys --remote=${project} --reveal --output json`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
);
const keys = JSON.parse(keyOutput);
const key = keys.find((k) => k.name === 'service_role')?.api_key;
if (!key) throw new Error('Administrative test access unavailable');

const admin = createClient(env.VITE_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const baseURL = (process.argv[2] || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const prefix = `qa-${Date.now()}`;
const users = {};
const contexts = [];
const objects = [];
const wavPath = join(tmpdir(), `${prefix}-speech.wav`);
let deal, browser, debugPage;

const check = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const log = (message) => console.log(`PASS ${message}`);

// Synthesize a short spoken English WAV clip for real in-browser Whisper dictation verification.
function makeSpeechWav(filePath) {
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = -1
$s.SetOutputToWaveFile('${filePath.replace(/'/g, "''")}')
$s.Speak('Kitchen cabinets look clean and ready for paint.')
$s.Dispose()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true });
}

try {
  makeSpeechWav(wavPath);
  for (const role of ['owner', 'seller', 'realtor', 'reviewer', 'lender', 'viewer', 'lender2']) {
    const email = `${prefix}-${role}@example.invalid`;
    const password = randomUUID() + 'aA1!';
    const user = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `Create temporary ${role}`).user;
    const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = check(await client.auth.signInWithPassword({ email, password }), `Sign in temporary ${role}`);
    users[role] = { id: user.id, email, client, session: auth.session };
  }

  check(await admin.from('commercial_owners').insert({ email: users.owner.email }), 'Create fixture owner');
  deal = check(
    await admin
      .from('commercial_deals')
      .insert({
        slug: prefix,
        title: 'QA temporary v5 role check',
        address: 'QA fixture, Akron, OH',
        seller_content: {
          headline: 'QA purchase overview',
          intro: 'Temporary test fixture',
          options: ['A', 'B', 'C'].map((k) => ({
            key: k,
            title: `QA Option ${k}`,
            tagline: 'Discuss a purchase',
            steps: ['Verify records', 'Agree terms'],
            you_get: [{ label: 'Timeline', value: 'To agree' }],
            ask: 'Documents',
            watch: 'Subject to agreement',
          })),
        },
      })
      .select()
      .single(),
    'Create temporary deal'
  );

  check(
    await admin.from('commercial_members').insert(
      Object.entries(users)
        .filter(([r]) => r !== 'owner')
        .map(([r, u]) => ({
          deal_id: deal.id,
          email: u.email,
          role: r === 'lender2' ? 'lender' : r,
          display_name: `QA ${r}`,
        }))
    ),
    'Create fixture memberships'
  );
  check(
    await admin.from('commercial_models').insert({
      deal_id: deal.id,
      base: { units: 9, rent: 950, value: 700000, taxes: 10000, insurance: 4000 },
    }),
    'Seed fixture model'
  );
  check(
    await admin.from('commercial_offers').insert(
      ['master_lease', 'wrap', 'cash'].map((structure, i) => ({
        deal_id: deal.id,
        structure,
        name: `QA Option ${String.fromCharCode(65 + i)}`,
        share_realtor: true,
        share_reviewer: true,
        share_lender: true,
        sort: i,
      }))
    ),
    'Seed fixture options'
  );
  check(await admin.from('commercial_owner_notes').insert({ deal_id: deal.id, body: 'QA PRIVATE OWNER HISTORY' }), 'Seed private note');
  check(
    await admin.from('commercial_strategy_ideas').insert({ deal_id: deal.id, title: 'QA Private Strategy', notes: 'Owner only secret plan' }),
    'Seed private strategy card'
  );

  const photoPath = `${deal.id}/${randomUUID()}-qa-photo.png`;
  const photoData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCYQAAAAASUVORK5CYII=', 'base64');
  check(await admin.storage.from('commercial-files').upload(photoPath, photoData, { contentType: 'image/png' }), 'Seed fixture photo');
  objects.push(photoPath);
  check(
    await admin.from('commercial_uploads').insert({
      deal_id: deal.id,
      storage_path: photoPath,
      file_name: 'qa-photo.png',
      mime: 'image/png',
      size_bytes: photoData.length,
      kind: 'photo',
      visibility: 'seller',
      audience: ['viewer'],
      uploaded_by_email: users.owner.email,
      uploaded_by_role: 'owner',
    }),
    'Share fixture photo'
  );

  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
    ],
  });

  const pageFor = async (role, width = 390) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, permissions: ['microphone'] });
    contexts.push(context);
    await context.addInitScript(
      ({ session, project }) => localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
      { session: users[role].session, project }
    );
    const page = await context.newPage();
    debugPage = page;
    page.on('dialog', (d) => d.accept());
    await page.goto(`${baseURL}#/d/${deal.slug}`);
    return page;
  };

  // 1. SELLER
  const seller = await pageFor('seller');
  await expect(seller.getByRole('button', { name: 'Table view', exact: true })).toBeVisible();
  await expect(seller.getByRole('columnheader', { name: /Option [ABC]/ })).toHaveCount(3);
  for (const hidden of ['Walkthrough', 'Tenants', 'Comps', 'Strategy ideas', 'QA Private Strategy']) {
    await expect(seller.getByText(hidden, { exact: false })).toHaveCount(0);
  }
  await seller.getByRole('button', { name: 'Ask about this option', exact: true }).first().click();
  await seller.getByRole('textbox', { name: 'Your question about option A' }).fill('QA option question');
  await seller.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(seller.getByText('Sent to the owner and realtor.', { exact: true })).toBeVisible();
  await seller.getByPlaceholder('Write a message').fill('QA seller typed message');
  await seller.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(seller.getByPlaceholder('Write a message')).toHaveValue('');
  await seller.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'qa-seller.txt', mimeType: 'text/plain', buffer: Buffer.from('QA seller upload') });
  await expect(seller.getByText('1 file uploaded.', { exact: true })).toBeVisible();
  await seller.getByRole('button', { name: 'Card view', exact: true }).click();
  await seller.getByRole('button', { name: 'This one looks good', exact: true }).first().click();
  await expect(seller.getByText('Your pick', { exact: true })).toBeVisible();
  expect(await seller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  log('seller: zero v5 exposure, options, question, message, upload, interest, phone width');

  // 2. REALTOR (Walkthrough + real Whisper voice note, Tenants + real Whisper dictation, Comps what-if Send to LaVante, Messages, Files)
  const realtor = await pageFor('realtor');
  await expect(realtor.getByRole('link', { name: 'Strategy ideas', exact: true })).toHaveCount(0);
  await expect(realtor.getByText('QA Private Strategy', { exact: false })).toHaveCount(0);

  // Walkthrough
  await realtor.getByRole('link', { name: 'Walkthrough', exact: true }).click();
  await expect(realtor.getByRole('heading', { name: 'Walkthrough inventory', exact: true })).toBeVisible();
  await expect(realtor.locator('input[capture="environment"]')).toHaveCount(1);
  await realtor.getByLabel('Upload photos for Unit 1 Kitchen').setInputFiles({ name: 'kitchen.png', mimeType: 'image/png', buffer: photoData });
  await expect(realtor.getByText('1 photo saved.', { exact: true })).toBeVisible();
  await expect(realtor.getByText('QA realtor (Realtor)', { exact: true })).toBeVisible();

  // Real in-browser Whisper voice note in Walkthrough
  await realtor.getByRole('button', { name: 'Dictate Unit 1 Kitchen voice note', exact: true }).click();
  await expect(realtor.getByRole('button', { name: 'Stop dictating Unit 1 Kitchen voice note', exact: true })).toBeVisible();
  await realtor.waitForTimeout(3500);
  await realtor.getByRole('button', { name: 'Stop dictating Unit 1 Kitchen voice note', exact: true }).click();
  const transcriptBox = realtor.getByLabel('Voice note transcript', { exact: true });
  await expect(transcriptBox).toBeVisible({ timeout: 90_000 });
  const rawTranscript = await transcriptBox.inputValue();
  expect(rawTranscript.trim().length).toBeGreaterThan(5);
  await realtor.getByRole('button', { name: 'Save voice note', exact: true }).click();
  await expect(realtor.getByText('Voice note saved.', { exact: true })).toBeVisible();
  log(`realtor walkthrough: photo upload + real Whisper voice note transcribed ("${rawTranscript.trim().slice(0, 60)}")`);

  // Tenants + real Whisper dictation into a text box
  await realtor.getByRole('link', { name: 'Tenants', exact: true }).click();
  await expect(realtor.getByText('0 filled · 9 open of 9 units', { exact: false })).toBeVisible();
  await realtor.getByLabel('Lead name', { exact: true }).fill('QA Tenant Alice');
  await realtor.getByLabel('Lead phone', { exact: true }).fill('330-555-0199');
  await realtor.getByLabel('Lead email', { exact: true }).fill('alice@example.invalid');
  // Dictate into Lead notes text box (model already cached in worker!)
  await realtor.getByRole('button', { name: 'Dictate Lead notes', exact: true }).click();
  await realtor.waitForTimeout(3500);
  await realtor.getByRole('button', { name: 'Stop dictating Lead notes', exact: true }).click();
  await expect.poll(async () => (await realtor.getByLabel('Lead notes', { exact: true }).inputValue()).trim().length, { timeout: 45_000 }).toBeGreaterThan(5);
  const dictatedLeadNote = await realtor.getByLabel('Lead notes', { exact: true }).inputValue();
  await realtor.getByRole('button', { name: 'Add lead', exact: true }).click();
  await expect(realtor.getByText('Lead added.', { exact: true })).toBeVisible();
  await realtor.getByLabel('Stage for QA Tenant Alice', { exact: true }).selectOption('moved_in');
  await realtor.getByLabel('Assign unit for QA Tenant Alice', { exact: true }).selectOption('1');
  await realtor.getByRole('button', { name: 'Assign & move in', exact: true }).click();
  await expect(realtor.getByText('1 filled · 8 open of 9 units', { exact: false })).toBeVisible();
  log(`realtor tenants: dictated into textbox ("${dictatedLeadNote.trim().slice(0, 50)}"), moved lead in & assigned Unit 1`);

  // Comps what-if Send to LaVante
  await realtor.getByRole('link', { name: 'Comps', exact: true }).click();
  await realtor.getByLabel('Comp address', { exact: true }).fill('500 Realtor Comp Rd');
  await realtor.getByLabel('Comp units', { exact: true }).fill('8');
  await realtor.getByLabel('Comp sale price', { exact: true }).fill('480000');
  await realtor.getByRole('button', { name: 'Add what-if comp', exact: true }).click();
  await expect(realtor.getByText('$60,000/unit', { exact: false })).toBeVisible();
  await realtor.getByRole('button', { name: '8.5%', exact: true }).click();
  await realtor.getByRole('button', { name: 'Send to LaVante', exact: true }).click();
  await expect(realtor.getByText('Sent to LaVante. It’s in Messages.', { exact: true })).toBeVisible();

  // Realtor other tabs: Offers, Photos, Messages, Files, Seller activity
  await realtor.getByRole('link', { name: 'Offers', exact: true }).click();
  await expect(realtor.getByRole('button', { name: 'Table view', exact: true })).toBeVisible();
  await realtor.getByRole('link', { name: 'Photos', exact: true }).click();
  await realtor.getByRole('link', { name: 'Messages', exact: true }).click();
  await realtor.getByRole('button', { name: /LaVante/ }).first().click();
  await realtor.getByPlaceholder('Write a message').fill('QA realtor direct message');
  await realtor.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(realtor.getByText('QA realtor direct message', { exact: true })).toBeVisible();
  await realtor.getByRole('link', { name: 'Files', exact: true }).click();
  await realtor.getByLabel('Upload files', { exact: true }).setInputFiles({ name: 'qa-realtor.txt', mimeType: 'text/plain', buffer: Buffer.from('QA realtor upload') });
  await expect(realtor.getByText('1 file uploaded.', { exact: true })).toBeVisible();
  await realtor.getByRole('link', { name: 'Seller activity', exact: true }).click();
  expect(await realtor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  log('realtor: comps what-if send, offers, photos, messages, files, seller activity, no strategy');

  // 3. REVIEWER
  const reviewer = await pageFor('reviewer');
  for (const hidden of ['Walkthrough', 'Tenants', 'Strategy ideas']) {
    await expect(reviewer.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  }
  await reviewer.getByRole('link', { name: 'Comps', exact: true }).click();
  await reviewer.getByLabel('Comp address', { exact: true }).fill('777 Reviewer Comp Ave');
  await reviewer.getByLabel('Comp units', { exact: true }).fill('10');
  await reviewer.getByLabel('Comp sale price', { exact: true }).fill('650000');
  await reviewer.getByRole('button', { name: 'Add what-if comp', exact: true }).click();
  await expect(reviewer.getByText('$65,000/unit', { exact: false })).toBeVisible();
  await reviewer.getByRole('button', { name: '8%', exact: true }).click();
  await reviewer.getByRole('button', { name: 'Send to LaVante', exact: true }).click();
  await expect(reviewer.getByText('Sent to LaVante. It’s in Messages.', { exact: true })).toBeVisible();
  await reviewer.getByRole('link', { name: 'Messages', exact: true }).click();
  await reviewer.getByPlaceholder('Write a message').fill('QA reviewer direct message');
  await reviewer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(reviewer.getByText('QA reviewer direct message', { exact: true })).toBeVisible();
  expect(await reviewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  log('reviewer: comps what-if send, messages, zero walkthrough/tenants/strategy');

  // 4. LENDER
  const lender = await pageFor('lender');
  for (const hidden of ['Walkthrough', 'Tenants', 'Comps', 'Strategy ideas']) {
    await expect(lender.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  }
  await expect(lender.getByText('The plan', { exact: true }).first()).toBeVisible();
  await lender.getByRole('button', { name: 'Randomize', exact: true }).click();
  await lender.getByRole('tab', { name: 'Traditional', exact: true }).click();
  await lender.getByLabel('Maximum LTV', { exact: true }).fill('QA 70%');
  await lender.getByRole('button', { name: 'Send terms to owner', exact: true }).click();
  await expect(lender.getByText('Sent privately to the owner. Find it in Messages.', { exact: true })).toBeVisible();
  await lender.getByRole('link', { name: 'Messages', exact: true }).click();
  await lender.getByPlaceholder('Write a message').fill('QA lender direct message');
  await lender.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(lender.getByText('QA lender direct message', { exact: true })).toBeVisible();
  expect(await lender.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  log('lender: the plan, randomize, financing desk send, messages, zero v5 tabs');

  // 5. VIEWER
  const viewer = await pageFor('viewer');
  await expect(viewer.getByText('A proposed purchase of this nine-unit property.', { exact: false })).toBeVisible();
  await expect(viewer.getByRole('textbox')).toHaveCount(0);
  for (const hidden of ['Walkthrough', 'Tenants', 'Comps', 'Strategy ideas', 'Messages']) {
    await expect(viewer.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  }
  log('viewer: read-only overview, zero v5 tabs');

  // 6. OWNER (all tabs + verify received messages + See as previews)
  const owner = await pageFor('owner', 1440);
  await expect(owner.getByRole('heading', { name: 'Deal at a glance', exact: true })).toBeVisible();

  // Walkthrough: owner sees realtor photo & voice note AND adds owner's own photo
  await owner.getByRole('link', { name: 'Walkthrough', exact: true }).click();
  await expect(owner.getByText('QA realtor (Realtor)', { exact: true }).first()).toBeVisible();
  await expect(owner.getByText(rawTranscript.trim(), { exact: true })).toBeVisible();
  await owner.getByLabel('Upload photos for Unit 1 Kitchen').setInputFiles({ name: 'owner-kitchen.png', mimeType: 'image/png', buffer: photoData });
  await expect(owner.getByText('1 photo saved.', { exact: true })).toBeVisible();
  await expect(owner.getByText('LaVante (Owner)', { exact: true })).toBeVisible();

  // Tenants: owner sees realtor's moved-in lead
  await owner.getByRole('link', { name: 'Tenants', exact: true }).click();
  await expect(owner.getByText('QA Tenant Alice', { exact: false }).first()).toBeVisible();
  await expect(owner.getByText('1 filled · 8 open of 9 units', { exact: false })).toBeVisible();

  // Comps: realtor & reviewer what-ifs did NOT overwrite; owner saves comp + cap rate
  await owner.getByRole('link', { name: 'Comps', exact: true }).click();
  await expect(owner.getByText('500 Realtor Comp Rd', { exact: false })).toHaveCount(0);
  await expect(owner.getByText('777 Reviewer Comp Ave', { exact: false })).toHaveCount(0);
  await owner.getByLabel('Comp address', { exact: true }).fill('100 Owner Saved Comp');
  await owner.getByLabel('Comp units', { exact: true }).fill('9');
  await owner.getByLabel('Comp sale price', { exact: true }).fill('540000');
  await owner.getByRole('button', { name: 'Add comp', exact: true }).click();
  await expect(owner.getByText('$60,000/unit', { exact: false })).toBeVisible();
  await owner.getByRole('button', { name: '9.5%', exact: true }).click();
  await expect(owner.getByText('Cap rate saved.', { exact: true })).toBeVisible();
  await owner.reload();
  await expect(owner.getByText('100 Owner Saved Comp', { exact: true })).toBeVisible();
  await expect(owner.getByRole('button', { name: '9.5%', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Strategy ideas: add, edit, delete
  await owner.getByRole('link', { name: 'Strategy ideas', exact: true }).click();
  await expect(owner.getByText('QA Private Strategy', { exact: true })).toBeVisible();
  await owner.getByLabel('Strategy idea title', { exact: true }).fill('QA Added Card');
  await owner.getByLabel('Strategy idea notes', { exact: true }).fill('Draft strategy note');
  await owner.getByRole('button', { name: 'Add idea card', exact: true }).click();
  await expect(owner.getByText('QA Added Card', { exact: true })).toBeVisible();
  await owner.locator('li', { hasText: 'QA Added Card' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await owner.getByLabel('Strategy idea title', { exact: true }).fill('QA Edited Card');
  await owner.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(owner.getByText('QA Edited Card', { exact: true })).toBeVisible();
  await owner.locator('li', { hasText: 'QA Edited Card' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(owner.getByText('Card deleted.', { exact: true })).toBeVisible();

  // Messages: confirm owner received EVERY role's message + both Comps what-ifs!
  await owner.getByRole('link', { name: 'Messages', exact: true }).click();
  await owner.getByRole('button', { name: /Realtor/ }).first().click();
  await expect(owner.getByText('500 Realtor Comp Rd', { exact: false }).first()).toBeVisible();
  await expect(owner.locator('p').filter({ hasText: 'QA realtor direct message' }).first()).toBeVisible();
  await owner.getByRole('button', { name: /Reviewer/ }).first().click();
  await expect(owner.getByText('777 Reviewer Comp Ave', { exact: false }).first()).toBeVisible();
  await expect(owner.locator('p').filter({ hasText: 'QA reviewer direct message' }).first()).toBeVisible();
  await owner.getByRole('button', { name: /Lender/ }).first().click();
  await expect(owner.locator('p').filter({ hasText: 'QA lender direct message' }).first()).toBeVisible();
  await owner.getByRole('button', { name: /Seller/ }).first().click();
  await expect(owner.locator('p').filter({ hasText: 'QA seller typed message' }).first()).toBeVisible();

  // Owner Units 9 -> 10 switch propagates to Walkthrough & Tenants
  await owner.getByRole('link', { name: 'Overview', exact: true }).click();
  await owner.getByRole('button', { name: '10 units', exact: true }).click();
  await expect(owner.getByText('Saved', { exact: true })).toBeVisible({ timeout: 5000 });
  await owner.getByRole('link', { name: 'Walkthrough', exact: true }).click();
  await expect(owner.getByRole('rowheader', { name: 'Unit 10', exact: true })).toBeVisible();
  await owner.getByRole('link', { name: 'Tenants', exact: true }).click();
  await expect(owner.getByText('1 filled · 9 open of 10 units', { exact: false })).toBeVisible();

  // Seller page loan edit -> Seller readback
  await owner.getByRole('link', { name: 'Seller page', exact: true }).click();
  await owner.getByLabel('Remaining loan balance', { exact: true }).fill('123456');
  await owner.getByLabel('Lender', { exact: true }).fill('QA lender entered by owner');
  await owner.getByRole('button', { name: 'Save loan', exact: true }).click();
  await expect(owner.getByText('Loan saved. Visible only to the owner and seller.', { exact: true })).toBeVisible();
  await seller.reload();
  await expect(seller.getByText('$123,456.00', { exact: true })).toBeVisible();

  // See as previews: Strategy ideas NEVER shown in any preview!
  for (const r of ['seller', 'realtor', 'reviewer', 'lender', 'viewer']) {
    await owner.goto(`${baseURL}#/d/${deal.slug}/view/${r}`);
    await expect(owner.getByText(`Seeing it as the`, { exact: false })).toBeVisible();
    await expect(owner.getByRole('link', { name: 'Strategy ideas', exact: true })).toHaveCount(0);
    await expect(owner.getByText('QA Private Strategy', { exact: false })).toHaveCount(0);
  }
  log('owner: all tabs, walkthrough mutual visibility, comps persistence, strategy CRUD, all messages received, See as previews');

  // 7. DIRECT RLS ISOLATION QUERIES
  const get = async (role, table) => check(await users[role].client.from(table).select('*').eq('deal_id', deal.id), `Read ${role} ${table}`);

  for (const role of ['seller', 'reviewer', 'lender', 'viewer']) {
    expect((await get(role, 'commercial_tenant_leads')).length).toBe(0);
    expect((await get(role, 'commercial_walkthrough_photos')).length).toBe(0);
    expect((await get(role, 'commercial_walkthrough_notes')).length).toBe(0);
    expect((await get(role, 'commercial_strategy_ideas')).length).toBe(0);
  }
  expect((await get('realtor', 'commercial_strategy_ideas')).length).toBe(0);
  expect((await get('realtor', 'commercial_tenant_leads')).length).toBeGreaterThan(0);
  expect((await get('realtor', 'commercial_walkthrough_photos')).length).toBeGreaterThanOrEqual(2);
  expect((await get('realtor', 'commercial_walkthrough_notes')).length).toBeGreaterThan(0);

  for (const role of ['lender', 'seller', 'viewer']) {
    expect((await get(role, 'commercial_comps')).length).toBe(0);
    expect((await get(role, 'commercial_comp_settings')).length).toBe(0);
  }
  for (const role of ['realtor', 'reviewer']) {
    expect((await get(role, 'commercial_comps')).length).toBeGreaterThan(0);
    const badComp = await users[role].client.from('commercial_comps').insert({ deal_id: deal.id, address: 'Blocked', units: 4, sale_price: 100000 });
    expect(badComp.error).toBeTruthy();
    const badCap = await users[role].client.from('commercial_comp_settings').upsert({ deal_id: deal.id, cap_rate: 8 });
    expect(badCap.error).toBeTruthy();
  }

  // Storage RLS: seller, reviewer, lender, viewer cannot sign v5 walkthrough media
  const wtPhotos = await get('owner', 'commercial_walkthrough_photos');
  const wtNotes = await get('owner', 'commercial_walkthrough_notes');
  const sampleV5Path = wtPhotos[0]?.storage_path;
  expect(sampleV5Path).toBeTruthy();
  for (const role of ['seller', 'reviewer', 'lender', 'viewer']) {
    const signed = await users[role].client.storage.from('commercial-files').createSignedUrl(sampleV5Path, 60);
    expect(signed.error).toBeTruthy();
  }
  const ownerSigned = check(await users.owner.client.storage.from('commercial-files').createSignedUrl(sampleV5Path, 60), 'Owner sign v5 photo');
  expect((await fetch(ownerSigned.signedUrl)).ok).toBe(true);
  const realtorSigned = check(await users.realtor.client.storage.from('commercial-files').createSignedUrl(sampleV5Path, 60), 'Realtor sign v5 photo');
  expect((await fetch(realtorSigned.signedUrl)).ok).toBe(true);

  // Legacy RLS checks
  for (const role of ['seller', 'realtor', 'reviewer', 'lender', 'viewer']) {
    expect((await get(role, 'commercial_owner_notes')).length).toBe(0);
  }
  expect((await get('lender2', 'commercial_messages')).length).toBe(0);
  for (const role of ['realtor', 'reviewer', 'lender', 'viewer']) {
    expect((await get(role, 'commercial_seller_loans')).length).toBe(0);
  }
  log(`RLS isolation verified across all 6 roles + storage (${wtPhotos.length} photos, ${wtNotes.length} notes)`);
  console.log(`RESULT all v5 + v4 real-role end-to-end checks passed on ${new URL(baseURL).origin}`);
} catch (error) {
  console.error(`FAIL live role check: ${error.name}`);
  console.error(error.message.replace(/https?:\/\/\S+/g, '[URL]').replace(/eyJ[\w.-]+/g, '[redacted]').slice(0, 1500));
  if (debugPage) console.error('Fixture UI:', (await debugPage.locator('body').innerText().catch(() => '')).slice(0, 1200));
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (deal) {
    const [uFiles, wPhotos, wNotes] = await Promise.all([
      admin.from('commercial_uploads').select('storage_path').eq('deal_id', deal.id),
      admin.from('commercial_walkthrough_photos').select('storage_path').eq('deal_id', deal.id),
      admin.from('commercial_walkthrough_notes').select('storage_path').eq('deal_id', deal.id),
    ]);
    const paths = [
      ...new Set([
        ...objects,
        ...(uFiles.data || []).map((f) => f.storage_path),
        ...(wPhotos.data || []).map((f) => f.storage_path),
        ...(wNotes.data || []).map((f) => f.storage_path).filter(Boolean),
      ]),
    ];
    if (paths.length) await admin.storage.from('commercial-files').remove(paths);
    await admin.from('commercial_deals').delete().eq('id', deal.id);
  }
  if (users.owner) await admin.from('commercial_owners').delete().eq('email', users.owner.email);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
  if (existsSync(wavPath)) unlinkSync(wavPath);
  console.log('CLEANUP temporary accounts, deal rows, and uploads removed');
}
