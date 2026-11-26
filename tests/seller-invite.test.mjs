// Realtor invites the seller to the existing seller page; seller messages go to the realtor;
// seller table shows the note and bills; photos share with the seller the same way as the walkthrough.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WALK_SHARES, walkShareButtons, walkTable, saveWalkShare } from '../src/lib/walkShare.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

test('invite: realtor only, seller role only, owner told, no new page', () => {
  const mig = read('supabase/migrations/0021_realtor_invites_seller.sql');
  assert.match(mig, /if r is distinct from 'realtor' then raise exception/);
  assert.match(mig, /values \(p_deal, e, 'seller', n, 'active', me\)/);
  assert.doesNotMatch(mig, /insert into commercial_members[^;]*'(lender|reviewer|realtor|viewer|guest)'/);
  assert.match(mig, /commercial_record\(p_deal, 'invite',[^;]*'owner'\)/);
  assert.match(mig, /from public, anon/);
  const realtor = read('src/views/Realtor.jsx');
  assert.match(realtor, /<SellerOffer [^>]*canInvite/);
  const offer = read('src/components/SellerOffer.jsx');
  assert.match(offer, /commercial_realtor_invite_seller/);
  assert.match(offer, /PUBLIC_SITE/);
  assert.doesNotMatch(read('src/views/Seller.jsx'), /InviteSeller|canInvite|invite_seller/);
  assert.match(read('src/views/Owner.jsx'), /Invited by \{r\.invited_by_email\}/);
});

test('seller messages go to the realtor', () => {
  const msg = read('src/components/Messages.jsx');
  assert.match(msg, /commercial_seller_messages_to/);
  assert.match(msg, /'Message the realtor'/);
  assert.match(msg, /sellerTo === 'buyer' \? `\$\{buyerName\(\)\} and the realtor` : 'The realtor'/);
  const loan = read('src/components/LoanPosition.jsx');
  assert.match(loan, /'Send to realtor'/);
  const seller = read('src/views/Seller.jsx');
  assert.match(seller, /sendTo=\{sellerTo\}/);
  assert.match(seller, /sellerTo=\{sellerTo\}/);
  const mig = read('supabase/migrations/0023_seller_messages_to_realtor.sql');
  assert.match(mig, /'seller_messages_to:' \|\| slug, 'realtor'/);
  assert.match(mig, /if new\.author_role <> 'owner' and not skip_owner then/);
});

test('seller table: note payment, bills I pay, "covered"', () => {
  const card = read('src/components/LeadOfferCard.jsx');
  assert.match(card, /Your note payment/);
  assert.match(card, /Taxes, insurance, utilities \(I pay\)/);
  assert.match(card, /coveredWord = \(c\) => \(c === 'yes' \? 'covered' : c\)/);
  const mig = read('supabase/migrations/0022_seller_table_costs.sql');
  assert.match(mig, /'note', t->'note', 'bills', t->'bills', 'billsLines', t->'billsLines'/);
  assert.doesNotMatch(mig, /buyerNet|interest|reserve/);
});

test('photos by unit share the same way as the walkthrough', async () => {
  assert.deepEqual(WALK_SHARES.map(([f]) => f), ['share_seller', 'share_lender']);
  assert.equal(walkTable('video'), 'commercial_walkthrough_videos');
  assert.equal(walkTable('photo'), 'commercial_walkthrough_photos');
  const calls = [];
  const btns = walkShareButtons({ id: 'a', share_seller: true }, (row, field) => calls.push([row.id, field]));
  assert.deepEqual(btns.map((b) => [b.key, b.pressed]), [['seller', true], ['lender', false]]);
  btns[1].onClick();
  assert.deepEqual(calls, [['a', 'share_lender']]);
  const seen = [];
  const fake = { from: (t) => ({ update: (v) => ({ eq: (k1, v1) => ({ eq: async (k2, v2) => { seen.push([t, v, v1, v2]); return { error: null }; } }) }) }) };
  assert.equal(await saveWalkShare(fake, 'd', { id: 'p' }, 'share_seller', true), null);
  assert.deepEqual(seen, [['commercial_walkthrough_photos', { share_seller: true }, 'p', 'd']]);
  assert.ok(await saveWalkShare(fake, 'd', { id: 'p' }, 'owner_id', true));
  const gallery = read('src/components/UnitGallery.jsx');
  assert.match(gallery, /walkShareButtons\(p, toggleShare, shareBusy\)/);
  assert.match(gallery, /shareBoxes\(v, 'video'\)/);
  assert.match(gallery, /const canShare = role === 'owner' && !preview/);
  assert.match(read('src/views/Walkthrough.jsx'), /walkShareButtons\(row, toggleShare, busy\)/);
  const seller = read('src/views/Seller.jsx');
  assert.match(seller, /const shownPhotos = \[\.\.\.coverRows\.filter\(\(r\) => r !== cover\), \.\.\.walk\]/);
});
