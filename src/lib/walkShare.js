// Sharing for walkthrough photos and videos: one switch per item for the seller and one for the lender.
// Used by the Walkthrough and by Photos by unit so both work the same way.
export const WALK_SHARES = [
  ['share_seller', 'seller', 'S', 'Share with seller'],
  ['share_lender', 'lender', 'L', 'Share with lender'],
];

export const walkTable = (kind) => (kind === 'video' ? 'commercial_walkthrough_videos' : 'commercial_walkthrough_photos');

// Saves one switch. Returns the error, or null.
export async function saveWalkShare(supabase, dealId, row, field, next, kind = 'photo') {
  if (!WALK_SHARES.some(([f]) => f === field)) return new Error('Unknown share');
  const { error } = await supabase.from(walkTable(kind)).update({ [field]: next }).eq('id', row.id).eq('deal_id', dealId);
  return error || null;
}

// Overlay and viewer buttons for one item.
export function walkShareButtons(row, onToggle, busy = false) {
  return WALK_SHARES.map(([field, key, icon, label]) => ({ key, icon, label, pressed: Boolean(row?.[field]), disabled: busy, onClick: () => void onToggle(row, field) }));
}
