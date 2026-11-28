import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  filterOffersForRole,
  getDealSnapshot,
  loadDealStore,
  scheduleDealPersist,
  setDealOffers,
  subscribeDealStore,
  updateDealBase,
  updateDealOffer,
  updatePlanState,
} from './dealStore.js';

// Shared per-deal state across Owner views & "See as" previews. The owner's changes save; real non-owners stay a local what-if.
export function useDealModel(deal, { owner, onlyShared } = {}) {
  const dealId = deal?.id;
  const snapshot = useSyncExternalStore(
    (cb) => (dealId ? subscribeDealStore(dealId, cb) : () => {}),
    () => (dealId ? getDealSnapshot(dealId) : null),
    () => (dealId ? getDealSnapshot(dealId) : null),
  );

  // Real non-owners (not in an owner preview session) keep local what-if edits isolated from the shared store.
  const [localWhatIf, setLocalWhatIf] = useState(null);

  useEffect(() => {
    if (!dealId) return undefined;
    loadDealStore(deal, { owner, onlyShared });
    return undefined;
  }, [dealId, deal?.slug, owner, onlyShared]);

  const useStoreState = Boolean(owner || snapshot?.dirtyByOwner);
  const storeOffers = snapshot?.offers ?? null;
  const filteredStoreOffers = filterOffersForRole(storeOffers, { owner, onlyShared });

  const offers = useStoreState
    ? filteredStoreOffers
    : (localWhatIf?.offers ?? filteredStoreOffers);
  const base = useStoreState
    ? (snapshot?.base || { units: 10, strUnits: 0 })
    : (localWhatIf?.base ?? (snapshot?.base || { units: 10, strUnits: 0 }));

  const later = (key, fn) => {
    if (!owner || !dealId) return;
    scheduleDealPersist(dealId, key, fn);
  };

  const setBase = (nextBaseOrFn) => {
    if (!dealId) return;
    if (owner) {
      updateDealBase(deal, nextBaseOrFn, { owner: true, persist: true });
      return;
    }
    const curBase = localWhatIf?.base ?? base;
    const resolved = typeof nextBaseOrFn === 'function' ? nextBaseOrFn(curBase) : nextBaseOrFn;
    setLocalWhatIf({
      offers: localWhatIf?.offers ?? filteredStoreOffers,
      base: { ...(resolved || {}), units: 10, strUnits: 0 },
    });
  };

  const setOffers = (nextOffersOrFn) => {
    if (!dealId) return;
    if (owner) {
      setDealOffers(deal, nextOffersOrFn);
      return;
    }
    const curOffers = localWhatIf?.offers ?? filteredStoreOffers;
    const resolved = typeof nextOffersOrFn === 'function' ? nextOffersOrFn(curOffers) : nextOffersOrFn;
    setLocalWhatIf({
      offers: resolved,
      base: localWhatIf?.base ?? base,
    });
  };

  const setPlan = (nextPlanOrFn) => {
    if (!owner || !dealId) return null;
    return updatePlanState(deal, nextPlanOrFn, { owner: true, persist: true });
  };

  const patchOffer = (offerId, patch) => {
    if (!dealId) return;
    if (owner) {
      updateDealOffer(deal, offerId, patch, { owner: true, persist: true });
      return;
    }
    setOffers((list) => (list || []).map((o) => (o.id === offerId ? { ...o, ...patch } : o)));
  };

  const reset = () => {
    if (!owner) setLocalWhatIf(null);
  };

  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const original = snapshot?.original || null;
  const touched = !owner && !snapshot?.dirtyByOwner && !!original && (!same(offers, original.list) || !same(base, original.base));
  const lead = Array.isArray(storeOffers) ? (storeOffers.find((o) => o.is_lead) || storeOffers[0]) : null;
  const liveSummary = useStoreState ? (lead?.seller_summary || null) : null;
  const liveGuide = liveSummary?.guide || null;

  return {
    offers,
    setOffers,
    patchOffer,
    base,
    setBase,
    plan: snapshot?.plan || null,
    setPlan,
    comps: snapshot?.comps || [],
    liveSummary,
    liveGuide,
    later,
    saved: snapshot?.saved || '',
    error: snapshot?.error || '',
    reset,
    touched,
    original,
  };
}
