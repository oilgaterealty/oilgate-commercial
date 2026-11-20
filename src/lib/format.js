export const when = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
export const roleLabel = { owner: 'Owner', realtor: 'Realtor', seller: 'Seller', guest: 'Viewer', lender: 'Lender', reviewer: 'Reviewer', viewer: 'Viewer' };
export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
