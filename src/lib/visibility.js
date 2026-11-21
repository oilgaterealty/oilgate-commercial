// What a role can read from uploads, mirroring the database rules. Used by "See as" previews,
// where the owner's own session can read everything.
export function seenBy(role, rows) {
  const list = rows || [];
  if (role === 'owner' || role === 'realtor') return list;
  if (role === 'seller') return list.filter((r) => r.visibility === 'seller');
  if (role === 'viewer' || role === 'guest') return list.filter((r) => r.kind === 'photo' && (r.audience || []).includes('viewer'));
  return list.filter((r) => (r.audience || []).includes(role));
}
