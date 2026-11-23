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

// Synthesize a spoken English WAV clip for real in-browser Whisper dictation verification.
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

async function assertMobileNavAndOverflow(page, width, label) {
  const metrics = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth;
    const links = [...document.querySelectorAll('nav[aria-label="Deal sections"] a')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent?.trim(),
        current: el.getAttribute('aria-current'),
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });
    return { overflow, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, links };
  });
  expect(metrics.overflow, `${label} width ${width}px overflow (${metrics.scrollWidth} > ${metrics.innerWidth})`).toBe(false);
  expect(metrics.links.length).toBeGreaterThan(0);
  for (let i = 0; i < metrics.links.length; i++) {
    const l = metrics.links[i];
    expect(l.width, `${label} nav pill "${l.text}" collapsed`).toBeGreaterThan(44);
    expect(l.height, `${label} nav pill "${l.text}" too short`).toBeGreaterThanOrEqual(36);
    expect(l.scrollWidth <= l.clientWidth + 2, `${label} nav pill "${l.text}" clipped`).toBe(true);
    if (i > 0) {
      const prev = metrics.links[i - 1];
      const overlaps = l.left < prev.right - 1 && l.top < prev.bottom - 1 && l.bottom > prev.top + 1;
      expect(overlaps, `${label} nav pills "${prev.text}" and "${l.text}" overlap`).toBe(false);
    }
  }
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

  const pageFor = async (role, width = 390, height = 844) => {
    const context = await browser.newContext({
      viewport: { width, height },
      permissions: ['microphone', 'camera'],
    });
    contexts.push(context);
    await context.addInitScript(
      ({ session, project }) => localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
      { session: users[role].session, project }
    );
    const page = await context.newPage();
    debugPage = page;
    page.on('dialog', (d) => d.accept());
    await page.goto(`${baseURL}#/d/${deal.slug}`);
    return { context, page };
  };

  // 1. SELLER
  const { page: seller } = await pageFor('seller');
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

  // 2. REALTOR (Walkthrough mobile widths, concurrent camera + Whisper, interruption, offline/reload/retry, Tenants dictation, Comps)
  const { context: realtorCtx, page: realtor } = await pageFor('realtor', 390, 844);
  await expect(realtor.getByRole('link', { name: 'Strategy ideas', exact: true })).toHaveCount(0);
  await expect(realtor.getByText('QA Private Strategy', { exact: false })).toHaveCount(0);

  await realtor.getByRole('link', { name: 'Walkthrough', exact: true }).click();
  await expect(realtor.getByRole('heading', { name: 'Walkthrough inventory', exact: true })).toBeVisible();
  await expect(realtor.locator('input[capture="environment"]')).toHaveCount(1);

  // Whisper model failure + retry verification (runs while model cache is empty, then caches Whisper once for the session)
  await realtorCtx.route(/huggingface\.co|hf\.co/, (route) => route.abort());
  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 3/ }).click();
  await realtor.getByRole('button', { name: 'Record voice note', exact: true }).click();
  await realtor.waitForTimeout(2200);
  await realtor.getByRole('button', { name: 'Stop & transcribe', exact: true }).click();
  await expect(realtor.getByText('Whisper needs retry · audio safe', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(realtor.getByLabel('Local voice note audio', { exact: true })).toBeVisible();
  await realtorCtx.unrouteAll();
  await realtor.getByRole('button', { name: 'Retry Whisper', exact: true }).click();
  await expect.poll(async () => (await realtor.getByLabel('Voice note transcript', { exact: true }).inputValue()).trim().length, { timeout: 90_000 }).toBeGreaterThan(5);
  await realtor.getByRole('button', { name: 'Save voice note', exact: true }).click();
  await expect(realtor.getByText(/Voice note \+ original audio saved to Unit 3 Kitchen\./)).toBeVisible({ timeout: 20_000 });
  log('realtor Whisper failure recovery: audio stayed playable during outage & Retry Whisper succeeded');

  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 1\b/ }).click();

  // Verify 360 / 390 / 430 portrait nav pills, non-collapsed Walkthrough pill, 5 named rooms, collapsed matrix, and zero overflow
  for (const [w, h] of [[360, 800], [390, 844], [430, 932]]) {
    await realtor.setViewportSize({ width: w, height: h });
    await realtor.waitForTimeout(100);
    await assertMobileNavAndOverflow(realtor, w, `realtor-${w}`);
    for (const roomName of ['Kitchen', 'Bath', 'Bedroom 1', 'Bedroom 2', 'Living']) {
      const btn = realtor.getByRole('group', { name: 'Rooms for Unit 1' }).getByRole('button', { name: new RegExp(`^${roomName}`) });
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const matrixToggle = realtor.getByRole('button', { name: /All units progress/ });
    await expect(matrixToggle).toHaveAttribute('aria-expanded', 'false');
    const takePhotosBox = await realtor.getByRole('button', { name: 'Take photos', exact: true }).boundingBox();
    const matrixBox = await matrixToggle.boundingBox();
    expect(takePhotosBox.y).toBeLessThan(matrixBox.y);
  }
  await realtor.setViewportSize({ width: 390, height: 844 });

  // Concurrent voice recording + multi-photo rear camera session + room switch mid-transcription
  await realtor.getByRole('button', { name: 'Record voice note', exact: true }).click();
  await expect(realtor.getByText(/Recording Unit 1 — Kitchen/)).toBeVisible();
  await expect.poll(async () => {
    const txt = await realtor.getByText(/chunks .* saved locally/).textContent();
    return Number((txt || '').match(/(\d+)\s+chunks/)?.[1] || 0);
  }, { timeout: 10_000 }).toBeGreaterThan(0);

  await realtor.getByRole('button', { name: 'Take photos', exact: true }).click();
  const camDialog = realtor.getByRole('dialog');
  await expect(camDialog).toBeVisible();
  await expect(camDialog.getByText(/Voice active: Unit 1 — Kitchen/)).toBeVisible();
  const captureBtn = camDialog.getByRole('button', { name: 'Capture photo', exact: true });
  await expect(captureBtn).toBeEnabled({ timeout: 10_000 });
  for (let i = 0; i < 3; i++) {
    await captureBtn.click();
    await expect(camDialog.getByText(`${i + 1} shot${i === 0 ? '' : 's'}`, { exact: true })).toBeVisible();
  }
  await camDialog.getByRole('button', { name: 'Undo last', exact: true }).click();
  await expect(camDialog.getByText('2 shots', { exact: true })).toBeVisible();
  await camDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(realtor.getByText('2 photos saved.', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(realtor.getByText('QA realtor (Realtor)').first()).toBeVisible();

  // Stop narration & immediately switch to Unit 2 Bath mid-transcription to confirm immutable Unit 1 Kitchen binding
  await realtor.getByRole('button', { name: 'Stop & transcribe', exact: true }).click();
  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 2/ }).click();
  await realtor.getByRole('group', { name: 'Rooms for Unit 2' }).getByRole('button', { name: /^Bath/ }).click();
  await expect(realtor.getByRole('heading', { name: 'Unit 2 — Bath', exact: true })).toBeVisible();

  // Wait for transcription to finish while sitting on Unit 2 Bath, then assert zero leak into Unit 2 Bath
  await expect(realtor.getByText(/No voice notes for this room yet\./)).toBeVisible();
  await expect(realtor.getByLabel('Voice note transcript')).toHaveCount(0);

  // Return to Unit 1 Kitchen -> transcript & playable local audio are bound there!
  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 1\b/ }).click();
  await realtor.getByRole('group', { name: 'Rooms for Unit 1' }).getByRole('button', { name: /^Kitchen/ }).click();
  const transcriptBox = realtor.getByLabel('Voice note transcript', { exact: true });
  await expect(transcriptBox).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await transcriptBox.inputValue()).trim().length, { timeout: 90_000 }).toBeGreaterThan(5);
  const rawTranscript = await transcriptBox.inputValue();
  await expect(realtor.getByLabel('Local voice note audio', { exact: true })).toBeVisible();
  await realtor.getByRole('button', { name: 'Save voice note', exact: true }).click();
  await expect(realtor.getByText(/Voice note \+ original audio saved to Unit 1 Kitchen\./)).toBeVisible({ timeout: 20_000 });
  await expect(realtor.getByLabel('Voice note audio', { exact: true })).toBeVisible();
  log(`realtor walkthrough concurrent: 3 shots (-1 undo = 2 uploaded) + voice bound to Unit 1 Kitchen ("${rawTranscript.trim().slice(0, 50)}")`);

  // Interruption test on Unit 1 Bedroom 1: background visibilitychange -> Pause -> preserve chunks -> Resume -> Save stitched WAV
  await realtor.getByRole('group', { name: 'Rooms for Unit 1' }).getByRole('button', { name: /^Bedroom 1/ }).click();
  await realtor.getByRole('button', { name: 'Record voice note', exact: true }).click();
  await expect.poll(async () => {
    const txt = await realtor.getByText(/chunks .* saved locally/).textContent();
    return Number((txt || '').match(/(\d+)\s+chunks/)?.[1] || 0);
  }, { timeout: 10_000 }).toBeGreaterThan(0);

  await realtor.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(realtor.getByText('Paused · audio safe', { exact: true })).toBeVisible({ timeout: 10_000 });
  await realtor.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await realtor.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(realtor.getByText(/Recording Unit 1 — Bedroom 1/)).toBeVisible();
  await realtor.waitForTimeout(2200);
  await realtor.getByRole('button', { name: 'Stop & transcribe', exact: true }).click();
  await expect.poll(async () => (await realtor.getByLabel('Voice note transcript', { exact: true }).inputValue()).trim().length, { timeout: 60_000 }).toBeGreaterThan(5);
  await realtor.getByRole('button', { name: 'Save voice note', exact: true }).click();
  await expect(realtor.getByText(/Voice note \+ original audio saved to Unit 1 Bedroom 1\./)).toBeVisible({ timeout: 20_000 });
  log('realtor interruption: background pause preserved chunks, resumed, stitched WAV & synced');

  // Offline + Reload + Back/Reopen + Video capture + Retry on Unit 2 Living
  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 2/ }).click();
  await realtor.getByRole('group', { name: 'Rooms for Unit 2' }).getByRole('button', { name: /^Living/ }).click();
  await realtorCtx.setOffline(true);
  await expect(realtor.getByText('Offline', { exact: true })).toBeVisible();

  await realtor.getByLabel('Upload photos for Unit 2 Living').setInputFiles({ name: 'offline-living.png', mimeType: 'image/png', buffer: photoData });
  await expect(realtor.getByText(/kept on device for retry/)).toBeVisible();

  await realtor.getByRole('button', { name: 'Record video', exact: true }).click();
  const vidDialog = realtor.getByRole('dialog');
  await expect(vidDialog.getByText(/MP4 \/ WebM up to 50 MB/)).toBeVisible();
  const startVidBtn = vidDialog.getByRole('button', { name: 'Start recording', exact: true });
  await expect(startVidBtn).toBeEnabled({ timeout: 10_000 });
  await startVidBtn.click();
  await realtor.waitForTimeout(1600);
  await vidDialog.getByRole('button', { name: 'Stop & save video', exact: true }).click();
  await expect(realtor.getByText(/Video saved on device/)).toBeVisible({ timeout: 15_000 });

  await realtor.getByRole('button', { name: 'Record voice note', exact: true }).click();
  await realtor.waitForTimeout(2500);
  await realtor.getByRole('button', { name: 'Stop & transcribe', exact: true }).click();
  await expect.poll(async () => (await realtor.getByLabel('Voice note transcript', { exact: true }).inputValue()).trim().length, { timeout: 45_000 }).toBeGreaterThan(5);
  await realtor.getByRole('button', { name: 'Save voice note', exact: true }).click();
  await expect(realtor.getByText(/Sync failed · audio safe/)).toBeVisible();
  await expect(realtor.getByText(/saved to Unit 2 Living/)).toHaveCount(0);

  // SPA Back/reopen while offline -> ALL pending media & audio still intact!
  await realtor.getByRole('link', { name: 'Overview', exact: true }).click();
  await realtor.goBack();
  await expect(realtor.getByText(/3 pending items saved on this device/)).toBeVisible();
  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 2/ }).click();
  await realtor.getByRole('group', { name: 'Rooms for Unit 2' }).getByRole('button', { name: /^Living/ }).click();
  await expect(realtor.getByLabel('Pending room photos')).toBeVisible();
  await expect(realtor.getByLabel('Pending room videos')).toBeVisible();
  await expect(realtor.getByLabel('Pending voice notes')).toBeVisible();

  // Reconnect & hard reload BEFORE syncing -> IndexedDB preserves all 3 pending items across full refresh!
  await realtorCtx.setOffline(false);
  await realtor.reload();
  await expect(realtor.getByRole('heading', { name: 'Walkthrough inventory', exact: true })).toBeVisible();
  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 2/ }).click();
  await realtor.getByRole('group', { name: 'Rooms for Unit 2' }).getByRole('button', { name: /^Living/ }).click();
  await expect(realtor.getByLabel('Pending room photos')).toBeVisible();
  await expect(realtor.getByLabel('Pending room videos')).toBeVisible();
  await expect(realtor.getByLabel('Pending voice notes')).toBeVisible();
  await expect(realtor.getByLabel('Local voice note audio')).toBeVisible();

  // Sync all pending after reload!
  await expect(realtor.getByRole('button', { name: 'Sync all pending', exact: true })).toBeEnabled({ timeout: 10_000 });
  await realtor.getByRole('button', { name: 'Sync all pending', exact: true }).click();
  await expect(realtor.getByText(/Synced 2 media files and 1 voice note\./)).toBeVisible({ timeout: 30_000 });
  await realtor.getByRole('group', { name: 'Units' }).getByRole('button', { name: /^Unit 2/ }).click();
  await realtor.getByRole('group', { name: 'Rooms for Unit 2' }).getByRole('button', { name: /^Living/ }).click();
  await expect(realtor.getByText('Photos (1)')).toBeVisible();
  await expect(realtor.getByText('Videos (1)')).toBeVisible();
  await expect(realtor.getByLabel('Voice note audio')).toBeVisible();
  log('realtor offline/reload/Back recovery: photo + recorded video + voice note persisted and synced after reconnect');

  // Tenants + real Whisper dictation into a text box
  await realtor.getByRole('link', { name: 'Tenants', exact: true }).click();
  await expect(realtor.getByText('0 filled · 9 open of 9 units', { exact: false })).toBeVisible();
  await realtor.getByLabel('Lead name', { exact: true }).fill('QA Tenant Alice');
  await realtor.getByLabel('Lead phone', { exact: true }).fill('330-555-0199');
  await realtor.getByLabel('Lead email', { exact: true }).fill('alice@example.invalid');
  await realtor.getByRole('button', { name: 'Dictate Lead notes', exact: true }).click();
  await realtor.waitForTimeout(3000);
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
  const { page: reviewer } = await pageFor('reviewer');
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
  const { page: lender } = await pageFor('lender');
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
  const { page: viewer } = await pageFor('viewer');
  await expect(viewer.getByText('A proposed purchase of this nine-unit property.', { exact: false })).toBeVisible();
  await expect(viewer.getByRole('textbox')).toHaveCount(0);
  for (const hidden of ['Walkthrough', 'Tenants', 'Comps', 'Strategy ideas', 'Messages']) {
    await expect(viewer.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  }
  log('viewer: read-only overview, zero v5 tabs');

  // 6. OWNER (desktop 1440px + 360px mobile nav + Walkthrough mutual visibility + Unit 10 + See as)
  const { page: owner } = await pageFor('owner', 360, 800);
  await assertMobileNavAndOverflow(owner, 360, 'owner-mobile-360');
  await owner.getByRole('link', { name: 'Walkthrough', exact: true }).click();
  await assertMobileNavAndOverflow(owner, 360, 'owner-walkthrough-360');

  await owner.setViewportSize({ width: 1440, height: 900 });
  await owner.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(owner.getByRole('heading', { name: 'Deal at a glance', exact: true })).toBeVisible();

  // Walkthrough: owner sees realtor photos & voice note AND adds owner's own photo
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

  // Owner Units 9 -> 10 switch propagates to Walkthrough desktop matrix & Tenants
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
  log('owner: 360px nav + 1440px matrix, walkthrough mutual visibility, Unit 10, comps, strategy CRUD, all messages, See as');

  // 7. DIRECT RLS ISOLATION QUERIES
  const get = async (role, table) => check(await users[role].client.from(table).select('*').eq('deal_id', deal.id), `Read ${role} ${table}`);

  for (const role of ['seller', 'reviewer', 'lender', 'viewer']) {
    expect((await get(role, 'commercial_tenant_leads')).length).toBe(0);
    expect((await get(role, 'commercial_walkthrough_photos')).length).toBe(0);
    expect((await get(role, 'commercial_walkthrough_videos')).length).toBe(0);
    expect((await get(role, 'commercial_walkthrough_notes')).length).toBe(0);
    expect((await get(role, 'commercial_strategy_ideas')).length).toBe(0);
  }
  expect((await get('realtor', 'commercial_strategy_ideas')).length).toBe(0);
  expect((await get('realtor', 'commercial_tenant_leads')).length).toBeGreaterThan(0);
  expect((await get('realtor', 'commercial_walkthrough_photos')).length).toBeGreaterThanOrEqual(4);
  expect((await get('realtor', 'commercial_walkthrough_videos')).length).toBeGreaterThanOrEqual(1);
  expect((await get('realtor', 'commercial_walkthrough_notes')).length).toBeGreaterThanOrEqual(4);

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

  // Storage RLS: seller, reviewer, lender, viewer cannot sign v5 walkthrough photo, video or audio
  const wtPhotos = await get('owner', 'commercial_walkthrough_photos');
  const wtVideos = await get('owner', 'commercial_walkthrough_videos');
  const wtNotes = await get('owner', 'commercial_walkthrough_notes');
  const sampleV5Path = wtPhotos[0]?.storage_path;
  const sampleVideoPath = wtVideos[0]?.storage_path;
  expect(sampleV5Path).toBeTruthy();
  expect(sampleVideoPath).toBeTruthy();
  for (const role of ['seller', 'reviewer', 'lender', 'viewer']) {
    const signedP = await users[role].client.storage.from('commercial-files').createSignedUrl(sampleV5Path, 60);
    expect(signedP.error).toBeTruthy();
    const signedV = await users[role].client.storage.from('commercial-files').createSignedUrl(sampleVideoPath, 60);
    expect(signedV.error).toBeTruthy();
  }
  const ownerSigned = check(await users.owner.client.storage.from('commercial-files').createSignedUrl(sampleV5Path, 60), 'Owner sign v5 photo');
  expect((await fetch(ownerSigned.signedUrl)).ok).toBe(true);
  const realtorSignedV = check(await users.realtor.client.storage.from('commercial-files').createSignedUrl(sampleVideoPath, 60), 'Realtor sign v5 video');
  expect((await fetch(realtorSignedV.signedUrl)).ok).toBe(true);

  // Legacy RLS checks
  for (const role of ['seller', 'realtor', 'reviewer', 'lender', 'viewer']) {
    expect((await get(role, 'commercial_owner_notes')).length).toBe(0);
  }
  expect((await get('lender2', 'commercial_messages')).length).toBe(0);
  for (const role of ['realtor', 'reviewer', 'lender', 'viewer']) {
    expect((await get(role, 'commercial_seller_loans')).length).toBe(0);
  }
  log(`RLS isolation verified across all 6 roles + storage (${wtPhotos.length} photos, ${wtVideos.length} videos, ${wtNotes.length} notes)`);
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
    const [uFiles, wPhotos, wVideos, wNotes] = await Promise.all([
      admin.from('commercial_uploads').select('storage_path').eq('deal_id', deal.id),
      admin.from('commercial_walkthrough_photos').select('storage_path').eq('deal_id', deal.id),
      admin.from('commercial_walkthrough_videos').select('storage_path').eq('deal_id', deal.id),
      admin.from('commercial_walkthrough_notes').select('storage_path').eq('deal_id', deal.id),
    ]);
    const paths = [
      ...new Set([
        ...objects,
        ...(uFiles.data || []).map((f) => f.storage_path),
        ...(wPhotos.data || []).map((f) => f.storage_path),
        ...(wVideos.data || []).map((f) => f.storage_path),
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
