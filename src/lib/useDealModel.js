import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';

// Offers and building numbers for one deal. The owner's changes save; everyone else's stay a local what-if.
export function useDealModel(deal, { owner, onlyShared } = {}) {
  const [offers, setOffers] = useState(null);
  const [base, setBaseState] = useState({});
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const original = useRef(null);
  const timers = useRef({});

  useEffect(() => {
    const offersQuery = owner || onlyShared
      ? supabase.from('commercial_offers').select('*').eq('deal_id', deal.id).order('sort')
      : supabase.rpc('commercial_get_lead_offer', { p_deal: deal.id });
    Promise.all([
      offersQuery,
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
    ]).then(([a, b]) => {
      let list = a.data || [];
      if (onlyShared) {
        list = list
          .filter((x) => x.is_lead && Boolean(x['share_' + onlyShared]))
          .slice(0, 1)
          .map(({ note: _n, ...rest }) => rest);
      } else if (!owner) {
        list = list.slice(0, 1).map(({ note: _n, ...rest }) => rest);
      }
      const loadedBase = { ...b.data?.base, units: 10, strUnits: 0 };
      setOffers(list);
      setBaseState(loadedBase);
      original.current = { list, base: loadedBase };
      setError(a.error || b.error ? 'Some numbers could not load. Refresh to try again.' : '');
    });
  }, [deal.id, owner, onlyShared]);

  const later = (key, fn) => {
    if (!owner) return;
    clearTimeout(timers.current[key]);
    setSaved('Saving…');
    timers.current[key] = setTimeout(async () => { const { error } = await fn(); setSaved(error ? 'Not saved. Check your connection.' : 'Saved'); }, 600);
  };
  const setBase = (b) => {
    const next = { ...b, units: 10, strUnits: 0 };
    setBaseState(next);
    later('base', () => supabase.from('commercial_models').upsert({ deal_id: deal.id, base: next, updated_at: new Date().toISOString() }));
  };
  const reset = () => { setOffers(original.current.list); setBaseState(original.current.base); };
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const touched = !owner && !!original.current && (!same(offers, original.current.list) || !same(base, original.current.base));
  return { offers, setOffers, base, setBase, later, saved, error, reset, touched, original: original.current };
}
