# Oilgate Commercial

One private site for every commercial deal. Each property gets its own page
(`#/d/<page-name>`) with three role views:

- **Owner** sees everything: activity, both message threads, every upload,
  people and access, the seller page editor, Drive folder, private notes, and
  "See as seller / realtor" previews.
- **Realtor** posts team updates, answers the seller, uploads photos and
  documents (and chooses which ones the seller can see), and watches seller
  engagement.
- **Seller** reads the side-by-side page, sees shared condition photos, asks
  questions, uploads documents, and marks interest.
- Guest (read-only) is built in. Lender is reserved for later.

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

1. Create a Supabase project and run `supabase/migrations/0001_commercial.sql` then `0002_commercial_hardening.sql`.
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
