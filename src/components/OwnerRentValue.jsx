import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import RentValue from './RentValue.jsx';

// Owner-only dynamic import so public and seller builds never bundle dealplan or deal_plan data.
const loadPlanLib =
  import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller'
    ? null
    : () => import('../lib/dealplan.js');

export function mergeUnitRents(prev = {}, units = []) {
  const next = { ...(prev && typeof prev === 'object' ? prev : {}) };
  for (const u of units) {
    const row = {};
    if (u.rentToday !== null && u.rentToday !== undefined) row.rentToday = u.rentToday;
    if (u.marketRent !== null && u.marketRent !== undefined) row.marketRent = u.marketRent;
    if (Object.keys(row).length) next[String(u.id)] = row; else delete next[String(u.id)];
  }
  return next;
}

// The owner's Overview copy: same three sections lenders and reviewers see, with rent today and market rent typed per unit.
export default function OwnerRentValue({ deal }) {
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    if (!loadPlanLib) return () => {};
    let alive = true;
    (async () => {
      try {
        const lib = await loadPlanLib();
        const [plan, { data: m }, { data: offers }, { data: comps }] = await Promise.all([
          lib.loadDealPlan(supabase, deal.slug),
          supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
          supabase.from('commercial_offers').select('*').eq('deal_id', deal.id).eq('is_lead', true).limit(1),
          supabase.from('commercial_comps').select('units,sale_price').eq('deal_id', deal.id),
        ]);
        if (!alive || !plan) return;
        setCtx({ lib, plan, base: { ...(m?.base || {}), units: 10, strUnits: 0 }, lead: offers?.[0] || null, comps: comps || [] });
      } catch {
        if (alive) setCtx(null);
      }
    })();
    return () => { alive = false; };
  }, [deal.id, deal.slug]);

  if (!ctx) return null;
  const data = ctx.lib.rentValue(ctx.base, ctx.plan, ctx.lead || {});

  const onSave = async (units) => {
    const { data: m, error: readErr } = await supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle();
    if (readErr) return readErr;
    const fresh = { ...(m?.base || {}), units: 10, strUnits: 0 };
    const nextBase = { ...fresh, unitRents: mergeUnitRents(fresh.unitRents, units) };
    const { error } = await supabase.from('commercial_models').upsert({ deal_id: deal.id, base: nextBase, updated_at: new Date().toISOString() });
    if (error) return error;
    if (ctx.lead) {
      const summary = ctx.lib.offerSellerSummary(ctx.lead, nextBase, ctx.plan, ctx.comps, false);
      const { error: e2 } = await supabase.from('commercial_offers').update({ seller_summary: summary, updated_at: new Date().toISOString() }).eq('id', ctx.lead.id);
      if (e2) return e2;
    }
    setCtx((c) => ({ ...c, base: nextBase }));
    return null;
  };

  return <RentValue data={data} editable onSave={onSave} showMarket sourceLines={ctx.plan.marketRent?.source ? [ctx.plan.marketRent.source] : null} />;
}
