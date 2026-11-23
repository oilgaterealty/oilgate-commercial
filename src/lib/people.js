// Names come from the deal (owner edits them under Settings), never from the code.
let current = { buyer_name: '', seller_name: '' };

export function setDealNames(deal) {
  if (deal) current = { buyer_name: deal.buyer_name || '', seller_name: deal.seller_name || '' };
}

export const buyerName = (deal = current) => (deal?.buyer_name || '').trim() || 'the buyer';
export const sellerName = (deal = current) => (deal?.seller_name || '').trim();
export const buyerTag = (deal = current) => `${(deal?.buyer_name || '').trim() || 'Not named yet'} · Buyer`;
export const sellerTag = (deal = current) => (sellerName(deal) ? `${sellerName(deal)} · Seller` : 'Seller: not named yet');
export const possessive = (name) => (/['’]$/.test(name) ? `${name}s` : name.endsWith('s') ? `${name}’` : `${name}’s`);

const ROLE = { owner: 'Buyer', realtor: 'Realtor', seller: 'Seller', guest: 'Viewer', lender: 'Lender', reviewer: 'Reviewer', viewer: 'Viewer', system: 'System' };

// "Name · Buyer", "Dana · Realtor", or just "Realtor" when no name is on file.
export function actorLabel(row, deal = current) {
  const role = ROLE[row.actor_role] || row.actor_role || '';
  const name = (row.actor_name || '').trim() || (row.actor_role === 'owner' ? (deal?.buyer_name || '').trim() : '');
  return name ? `${name} · ${role}` : role;
}

// Older activity lines start with the role word ("Owner uploaded…"); the name/role label now says who.
export function activityText(row) {
  const s = row.summary || '';
  const lead = (row.actor_role || '').replace(/^./, (c) => c.toUpperCase());
  if (lead && s.startsWith(lead + ' ')) return s.slice(lead.length + 1);
  if (row.actor_role === 'seller' && s.startsWith('Seller marked: ')) return s.slice(7);
  return s;
}
