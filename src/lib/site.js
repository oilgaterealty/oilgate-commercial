// Which site this build serves. Set at build time only, never from the address bar.
//   'owner'  = the owner's private address: only the owner's page loads.
//   'seller' = 2327charlotte: the seller's page only.
//   'public' = the shared private address for realtor, lender, reviewer and viewer: no owner or seller page here.
//   unset    = both (local dev and older builds).
export const SITE_KIND = import.meta.env?.VITE_SITE_KIND || '';

// The guest site. Role links and "Copy site link" always point here, never at the owner's address.
export const PUBLIC_SITE = 'https://2327charlotte.oilgateai.com/';
export const GUEST_SITE = import.meta.env?.VITE_GUEST_SITE || PUBLIC_SITE;

export const siteRules = (kind) => ({
  ownerAllowed: kind !== 'public' && kind !== 'seller',
  guestsAllowed: kind !== 'owner',
});

export const canAccessCityRecords = (kind, role, preview = false) =>
  role === 'lender' || Boolean(siteRules(kind).ownerAllowed && role === 'owner' && !preview);

export const canAccessDealPlan = (kind, role, preview = false) =>
  Boolean(siteRules(kind).ownerAllowed && role === 'owner' && !preview);

// Role links: #/join/<token>. 64 hex characters, made by the database.
export const isLinkToken = (t) => /^[a-f0-9]{64}$/.test(t || '');
export const roleLinkUrl = (token, role) => `${role === 'seller' ? PUBLIC_SITE : GUEST_SITE}#/join/${token}`;
export const memberPageUrl = (role, slug) => role === 'seller' ? PUBLIC_SITE : `${GUEST_SITE}#/d/${slug}${role === 'realtor' ? '/offers' : ''}`;

// Open viewer links: #/d/<slug>/view/<token>. 32+ URL-safe chars made server-side.
export const isOpenViewerToken = (t) => /^[A-Za-z0-9_-]{32,128}$/.test(t || '');
export const openViewerUrl = (slug, token) => `${GUEST_SITE}#/d/${slug}/view/${token}`;
export const openViewerAllowed = (kind) => kind !== 'seller' && kind !== 'owner';

// Which roles may open their page on this build.
export const roleAllowedHere = (kind, role) => {
  if (kind === 'seller') return role === 'seller';
  if (kind === 'public') return role !== 'seller' && role !== 'owner';
  return true;
};
export const requestAccessAllowed = (kind) => kind !== 'seller' && kind !== 'owner';
