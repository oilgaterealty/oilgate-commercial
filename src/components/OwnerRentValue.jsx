import { useEffect, useState } from 'react';
import { useDealModel } from '../lib/useDealModel.js';
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

// The owner's Overview copy: driven by shared dealStore so Numbers updates reflect here right away.
export default function OwnerRentValue({ deal, onOpenNumbers = null }) {
  const model = useDealModel(deal, { owner: true });
  const [lib, setLib] = useState(null);

  useEffect(() => {
    if (!loadPlanLib) return () => {};
    let alive = true;
    loadPlanLib().then((m) => { if (alive) setLib(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!lib || !model.plan) return null;
  const lead = (model.offers || []).find((o) => o.is_lead) || model.offers?.[0] || {};
  const data = lib.rentValue(model.base, model.plan, lead);

  const onSave = async (units) => {
    model.setBase({ ...model.base, unitRents: mergeUnitRents(model.base?.unitRents, units) });
    return null;
  };

  return (
    <RentValue
      data={data}
      editable
      onSave={onSave}
      showMarket
      hideSlider={Boolean(onOpenNumbers)}
      onOpenNumbers={onOpenNumbers}
      sourceLines={model.plan.marketRent?.source ? [model.plan.marketRent.source] : null}
    />
  );
}
