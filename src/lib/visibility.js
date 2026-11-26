// What a role can read from uploads, mirroring the database rules. Used by "See as" previews,
// where the owner's own session can read everything.
export function seenBy(role, rows) {
  const list = rows || [];
  if (role === 'owner') return list;
  // The realtor sees what the owner shares with her, what she uploaded, and anything shared with the seller.
  if (role === 'realtor') return list.filter((r) => r.visibility === 'seller' || r.uploaded_by_role === 'realtor' || (r.audience || []).includes('realtor'));
  if (role === 'seller') return list.filter((r) => r.visibility === 'seller');
  if (role === 'viewer' || role === 'guest') return list.filter((r) => r.kind === 'photo' && (r.audience || []).includes('viewer'));
  return list.filter((r) => (r.audience || []).includes(role));
}
