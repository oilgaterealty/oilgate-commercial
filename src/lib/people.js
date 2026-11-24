// Names come from the deal (owner edits them under Settings), never from the code.
// The seller never sees the buyer's name: on the seller's page (and the owner's "See as seller") he is "the buyer".
let current = { buyer_name: '', seller_name: '' };
let viewer = '';

export function setDealNames(deal, role) {
  if (deal) current = { buyer_name: deal.buyer_name || '', seller_name: deal.seller_name || '' };
  if (role !== undefined) viewer = role || '';
}
export const viewingRole = () => viewer;
const hideBuyer = (role = viewer) => role === 'seller';

const rawBuyer = (deal) => (hideBuyer() ? '' : (deal?.buyer_name || '').trim());
export const buyerName = (deal = current) => rawBuyer(deal) || 'the buyer';
export const sellerName = (deal = current) => (deal?.seller_name || '').trim();
export const buyerTag = (deal = current) => (rawBuyer(deal) ? `${rawBuyer(deal)} · Buyer` : 'Buyer');
// "Seller not named yet" shows only on the owner's own page; everyone else sees just "Seller" until a name is set.
export const sellerTag = (deal = current) => (sellerName(deal) ? `${sellerName(deal)} · Seller` : viewer === 'owner' ? 'Seller not named yet' : 'Seller');
export const possessive = (name) => (/['’]$/.test(name) ? `${name}s` : name.endsWith('s') ? `${name}’` : `${name}’s`);

const ROLE = { owner: 'Buyer', realtor: 'Realtor', seller: 'Seller', guest: 'Viewer', lender: 'Lender', reviewer: 'Reviewer', viewer: 'Viewer', system: 'System' };

// "Name · Buyer", "Dana · Realtor", or just "Realtor" when no name is on file. The seller sees just "Buyer".
export function actorLabel(row, deal = current) {
  const role = ROLE[row.actor_role] || row.actor_role || '';
  if (row.actor_role === 'owner' && hideBuyer()) return role;
  const name = (row.actor_name || '').trim() || (row.actor_role === 'owner' ? (deal?.buyer_name || '').trim() : '');
  return name ? `${name} · ${role}` : role;
}

// Who wrote a message or note, as this viewer may see it.
export function authorLabel(row) {
  const role = ROLE[row?.author_role] || row?.author_role || '';
  if (row?.author_role === 'owner') return hideBuyer() ? 'Buyer' : buyerTag();
  return (row?.author_name || '').trim() || role;
}

// Older activity lines start with the role word ("Owner uploaded…"); the name/role label now says who.
export function activityText(row) {
  const s = row.summary || '';
  const lead = (row.actor_role || '').replace(/^./, (c) => c.toUpperCase());
  if (lead && s.startsWith(lead + ' ')) return s.slice(lead.length + 1);
  if (row.actor_role === 'seller' && s.startsWith('Seller marked: ')) return s.slice(7);
  return s;
}
