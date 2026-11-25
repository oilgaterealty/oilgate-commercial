// Owner-only unit readiness labels stored in commercial_unit_notes (kind = 'readiness').
// Dynamically imported only under the owner + canAccessDealPlan gate so seller/public bundles never include it.

export const READINESS_PRESETS = [
  'Move-in ready',
  'Move-in ready (occupied)',
  'Near ready',
  'Medium',
  'Needs a lot',
  'Full gut',
  'Not entered',
  'Not assessed',
];

export function readinessTone(label) {
  const s = String(label || '').trim().toLowerCase();
  if (s.startsWith('move-in ready')) return 'border-emerald-300 bg-emerald-100 text-emerald-900';
  if (s === 'near ready') return 'border-lime-300 bg-lime-100 text-lime-900';
  if (s === 'medium') return 'border-amber-300 bg-amber-100 text-amber-900';
  if (s === 'needs a lot') return 'border-orange-300 bg-orange-100 text-orange-900';
  if (s === 'full gut') return 'border-red-300 bg-red-100 text-red-900';
  return 'border-stone-300 bg-stone-100 text-stone-700';
}

export async function loadReadinessMap(supabase, dealId) {
  const { data, error } = await supabase
    .from('commercial_unit_notes')
    .select('*')
    .eq('deal_id', dealId)
    .eq('kind', 'readiness')
    .order('updated_at', { ascending: false });
  if (error || !Array.isArray(data)) return {};
  const map = {};
  for (const row of data) {
    if (row.unit_number >= 1 && row.unit_number <= 10 && !map[row.unit_number]) {
      map[row.unit_number] = row;
    }
  }
  return map;
}

export async function saveUnitReadiness(supabase, { dealId, unitNumber, label, existingRow, uid, name }) {
  const body = String(label || '').trim().slice(0, 80) || 'Not entered';
  const now = new Date().toISOString();
  if (existingRow?.id) {
    return supabase
      .from('commercial_unit_notes')
      .update({ body, updated_at: now })
      .eq('id', existingRow.id)
      .select('*')
      .single();
  }
  return supabase
    .from('commercial_unit_notes')
    .insert({
      deal_id: dealId,
      unit_number: unitNumber,
      kind: 'readiness',
      body,
      author_uid: uid,
      author_role: 'owner',
      author_name: name || '',
      updated_at: now,
    })
    .select('*')
    .single();
}
