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
    Promise.all([
      supabase.from('commercial_offers').select('*').eq('deal_id', deal.id).order('sort'),
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
    ]).then(([a, b]) => {
      const shared = (x) => !onlyShared || (x['share_' + onlyShared] ?? onlyShared === 'realtor');
      const list = (a.data || []).filter(shared);
      const loadedBase = { units: 9, ...b.data?.base };
      setOffers(list);
      setBaseState(loadedBase);
      original.current = { list, base: loadedBase };
      setError(a.error || b.error ? 'Some numbers could not load. Refresh to try again.' : '');
    });
  }, [deal.id, onlyShared]);

  const later = (key, fn) => {
    if (!owner) return;
    clearTimeout(timers.current[key]);
    setSaved('Saving…');
    timers.current[key] = setTimeout(async () => { const { error } = await fn(); setSaved(error ? 'Not saved. Check your connection.' : 'Saved'); }, 600);
  };
  const setBase = (b) => {
    setBaseState(b);
    later('base', () => supabase.from('commercial_models').upsert({ deal_id: deal.id, base: b, updated_at: new Date().toISOString() }));
  };
  const reset = () => { setOffers(original.current.list); setBaseState(original.current.base); };
  const touched = !owner && !!original.current && (offers !== original.current.list || base !== original.current.base);
  return { offers, setOffers, base, setBase, later, saved, error, reset, touched, original: original.current };
}
