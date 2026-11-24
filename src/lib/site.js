// Which site this build serves. Set at build time only, never from the address bar.
//   'owner'  = the owner's private address: only the owner's page loads.
//   'public' = the guest site (seller, realtor, lender ...): the owner's page never loads here.
//   unset    = both (local dev and older builds).
export const SITE_KIND = import.meta.env?.VITE_SITE_KIND || '';

// The guest site. Role links and "Copy site link" always point here, never at the owner's address.
export const PUBLIC_SITE = 'https://2327charlotte.oilgateai.com/';

export const siteRules = (kind) => ({
  ownerAllowed: kind !== 'public',
  guestsAllowed: kind !== 'owner',
});

export const canAccessCityRecords = (kind, role, preview = false) =>
  Boolean(siteRules(kind).ownerAllowed && role === 'owner' && !preview);

export const canAccessDealPlan = canAccessCityRecords;

// Role links: #/join/<token>. 64 hex characters, made by the database.
export const isLinkToken = (t) => /^[a-f0-9]{64}$/.test(t || '');
export const roleLinkUrl = (token) => `${PUBLIC_SITE}#/join/${token}`;
