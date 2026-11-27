# Oilgate Commercial

One private site for every commercial deal. Each property gets its own page
(`#/d/<page-name>`) with role-specific views:

- **Owner** sees everything: activity, both message threads, every upload,
  people and access, the seller page editor, Drive folder, private notes, and
  "See as seller / realtor" previews.
- **Realtor** posts team updates, answers the seller, uploads photos and
  documents (and chooses which ones the seller can see), and watches seller
  engagement.
- **Seller** reads the side-by-side page, sees shared condition photos, asks
  questions, uploads documents, and marks interest.
- **Reviewer** sees explicitly shared offers/research, tasks, uploads and a private owner thread.
- **Lender** has Private money, Hard money and Traditional financing desks. Terms and comments go only to the owner.
- **Viewer / guest** sees property photos and a general purchase overview, without underwriting, internal research or editing.

The owner overview is a dashboard with current numbers, the latest message per role,
recent file previews, seller interest and working items. Activity is a side panel.
Seller options default to a horizontally scrolling comparison with a sticky label
column; all cards remain expanded in the secondary layout. Seller loan fields are
owner-entered in a separate owner/seller-only table, never in general deal copy.
Seller questions reach the owner and active realtors. Private realtor threads and
existing conversation audiences cannot be repurposed to expose their history.
Underwriting remains nine units; the possible tenth unit requires verification.

The seller can only ever read the seller thread, the files marked "Show to
seller", their own uploads and the seller page copy. Owner numbers belong in
owner notes, which only the owner can read (enforced in the database, not the UI).

## Adding a new deal

Owner home page → **Add a deal** → name, address, page name, Drive folder link.
That's it: same pages, no code changes.

## Stack (all free)

- GitHub Pages hosts the static site (`.github/workflows/pages.yml`).
- Supabase free tier: sign-in (Google + email link), database with row-level
  security, private file storage, realtime.
- Alerts: free ntfy push (owner topic covers every property; each realtor gets
  their own topic). No SMS.
- Drive: `drive-relay/Code.gs` runs in the owner's own Google account and
  copies every upload into that property's Drive folder each minute, so Super
  Lab sees it.

## Setup

### Phase 1 owner snapshot bridge

Apply all missing migrations in numeric order through `0019_bridge.sql` (including
0010–0018 on older installations). 0019 is additive and changes no existing policy.
It adds private, deal-scoped `commercial_bridge_tokens` and owner-readable
`commercial_erwin_facts`. Only `commercial_bridge_snapshot(text,text)` is executable
by anon. Tokens are 32 random bytes represented as 64 hex characters; store only
SHA-256 in the database and the raw value only in the Super Lab host secret.
Only the `superlab_owner` read scope exists. No business-data write RPC is included.
Accepted reads update the token's last-used timestamp and call counter, with a
60-accepted-reads-per-minute per-token limit. Revocation is `active=false` on the token row.
Uploads contain metadata only; no storage paths, file bytes or signed URLs.

`node tests/bridge.db.mjs` runs opt-in isolated PostgreSQL checks with PGlite
(`PGLITE_MODULE` can identify an external installation). It applies migrations
0001–0019 in memory and verifies grants, non-owner denial and token revocation.
Existing role policies remain intact, including the seller's existing loan access
and reviewer/lender model access where currently allowed; the bridge grants them
no new access. Rollback: set the bridge token inactive, then revert the release
commit. Retain the additive tables and history.

1. Use the designated Supabase project and apply the SQL files in `supabase/migrations` in numeric order (0001 through 0009). On an existing deployment, apply only missing migrations; 0004 adds the workspace and private loan table, 0005 seeds the Charlotte realtor due-diligence desk, 0006 adds scoped task completion, 0007 restricts viewer documents while sharing the existing listing photos, 0008 adds v3 roles and tasks, and 0009 adds v5 lease-up CRM tables (walkthrough photos/voice notes, tenant pipeline, owner-only strategy ideas, comps/ARV) and role-scoped storage policies. Verify RLS and the routing triggers after applying. These files do not delete existing history.
2. In SQL, add the owner: `insert into commercial_owners(email) values ('you@example.com');`
   and set the first deal's Drive folder:
   `insert into commercial_deal_private(deal_id, drive_folder_id) select id, '<folder id>' from commercial_deals where slug='charlotte';`
   Every table, function and the storage bucket start with `commercial_` / `commercial-`, so the
   site can share a Supabase project with other apps without touching their tables.
3. Supabase → Auth → URL configuration: ADD the GitHub Pages address to Redirect URLs.
   If the project is shared with another app, do not change its Site URL.
   Google sign-in works if the project already has the Google provider on.
4. `.env.production` holds the project URL and the public anon key (browser-safe).
   Repo variables with the same names override it.
5. GitHub repo → Settings → Pages → Source: GitHub Actions. Push to `main`.
6. Optional Drive copy: new Apps Script project, paste `drive-relay/Code.gs`,
   set the two Script properties, run `installTrigger()` once.

Never put the service/secret key in this repo or in GitHub variables.

## Develop

```
npm install
cp .env.example .env   # fill in your project URL and publishable key
npm run dev
npm test
```

## Role verification

`npm test` runs the offline privacy, routing, math and workspace regressions.
`npm run build` verifies the production bundle. To test the production build locally,
run `npm run preview`; the plain development mode does not load `.env.production`.

`node tests/live-role-check.mjs http://localhost:4173/` runs an opt-in real Supabase
and browser check. It requires authenticated administrative Supabase CLI access and
Playwright Chromium. It creates temporary owner/seller/realtor/reviewer/lender/viewer
accounts and a temporary deal, tests sending, uploading/downloading, BIA persistence,
loan entry, phone layouts and denied cross-role reads/writes, then removes its
fixtures. Credentials and sessions stay in process memory. Pass the live site URL
after publication to repeat the same checks against the deployed bundle.

Owner **See as** pages are visibly read-only previews. Invite actual members in
Settings to enable role messaging and uploads; previews never impersonate a member
or send as one. Unconfirmed loan details remain blank until the owner enters them.

### Charlotte lease-up

Migration 0009 adds private tenant, walkthrough, realtor media, valuation and owner-only sections. It does not change the auth configuration or existing records. Dictation downloads Whisper on first use and transcribes on-device; only explicitly saved walkthrough recordings and data are uploaded to the existing private Supabase project. The owner’s units switch controls access to a tenth walkthrough and tenant assignment. The comp calculator does not change the underlying underwriting model.

## Database migrations ship themselves

Put a numbered `.sql` file in `supabase/migrations/` (for example `0030_description.sql`) and push to `main`. GitHub Actions (`.github/workflows/db-migrate.yml`) runs `npm test` and then executes `scripts/apply-migrations.mjs` to apply any pending migrations in filename order through the Supabase Management API. The `SUPABASE_ACCESS_TOKEN` secret is already set on the repo, so no manual approval or database password is needed. You can also trigger the workflow manually via `workflow_dispatch`, or preview pending files locally with `node scripts/apply-migrations.mjs --dry-run`.
Migrations numbered `<= baseline` in `supabase/migrations-baseline.json` are treated as already applied; bump `baseline` only on purpose.
