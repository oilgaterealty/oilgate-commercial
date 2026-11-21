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

1. Use the designated Supabase project and apply the SQL files in `supabase/migrations` in numeric order (0001 through 0007). On an existing deployment, apply only missing migrations; 0004 adds the workspace and private loan table, 0005 seeds the Charlotte realtor due-diligence desk, 0006 adds scoped task completion, and 0007 restricts viewer documents while sharing the existing listing photos. Verify RLS and the routing triggers after applying. These files do not delete existing history.
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
