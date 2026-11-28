import { supabase } from './supabase.js';

// Owner-only dynamic import so public and seller builds never bundle dealplan or deal_plan data.
const loadPlanLib =
  import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller'
    ? null
    : () => import('./dealplan.js');

let cachedPlanLib = null;
async function getPlanLib() {
  if (cachedPlanLib) return cachedPlanLib;
  if (!loadPlanLib) return null;
  cachedPlanLib = await loadPlanLib();
  return cachedPlanLib;
}

const stores = new Map();

function buildSnapshot(entry) {
  return {
    dealId: entry.dealId,
    slug: entry.slug,
    loaded: entry.loaded,
    loadedOwner: entry.loadedOwner,
    base: entry.base,
    offers: entry.offers,
    plan: entry.plan,
    comps: entry.comps,
    saved: entry.saved,
    error: entry.error,
    dirtyByOwner: entry.dirtyByOwner,
    original: entry.original,
  };
}

function getOrCreateEntry(dealOrId) {
  const dealId = typeof dealOrId === 'string' ? dealOrId : dealOrId?.id;
  if (!dealId) return null;
  const slug = typeof dealOrId === 'object' ? dealOrId?.slug || '' : '';
  let entry = stores.get(dealId);
  if (!entry) {
    entry = {
      dealId,
      slug,
      loaded: false,
      loadedOwner: false,
      loadingPromise: null,
      base: { units: 10, strUnits: 0 },
      offers: null,
      plan: null,
      comps: [],
      saved: '',
      error: '',
      dirtyByOwner: false,
      original: null,
      timers: new Map(),
      listeners: new Set(),
      snapshot: null,
    };
    entry.snapshot = buildSnapshot(entry);
    stores.set(dealId, entry);
  } else if (slug && !entry.slug) {
    entry.slug = slug;
  }
  return entry;
}

function notify(entry) {
  entry.snapshot = buildSnapshot(entry);
  for (const listener of entry.listeners) {
    try {
      listener(entry.snapshot);
    } catch {
      // listener errors should not break store fan-out
    }
  }
}

export function getDealSnapshot(dealOrId) {
  const entry = getOrCreateEntry(dealOrId);
  return entry ? entry.snapshot : null;
}

export function subscribeDealStore(dealOrId, listener) {
  const entry = getOrCreateEntry(dealOrId);
  if (!entry || typeof listener !== 'function') return () => {};
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

export function resetDealStore(dealId = null) {
  if (dealId) {
    const entry = stores.get(dealId);
    if (entry) {
      for (const timer of entry.timers.values()) clearTimeout(timer);
      entry.timers.clear();
      stores.delete(dealId);
    }
    return;
  }
  for (const entry of stores.values()) {
    for (const timer of entry.timers.values()) clearTimeout(timer);
    entry.timers.clear();
  }
  stores.clear();
}

export function filterOffersForRole(offers, { owner, onlyShared } = {}) {
  if (!Array.isArray(offers)) return offers;
  if (onlyShared) {
    return offers
      .filter((x) => x.is_lead && Boolean(x['share_' + onlyShared]))
      .slice(0, 1)
      .map(({ note: _n, ...rest }) => rest);
  }
  if (!owner) {
    return offers.slice(0, 1).map(({ note: _n, ...rest }) => rest);
  }
  return offers;
}

export function getLiveSellerSummary(dealOrId) {
  const entry = getOrCreateEntry(dealOrId);
  if (!entry || !entry.dirtyByOwner || !Array.isArray(entry.offers)) return null;
  const lead = entry.offers.find((o) => o.is_lead) || entry.offers[0];
  return lead?.seller_summary || null;
}

export function getLiveLeadGuide(dealOrId) {
  const summary = getLiveSellerSummary(dealOrId);
  return summary?.guide || null;
}

export function scheduleDealPersist(dealOrId, key, fn, { delayMs = 600 } = {}) {
  const entry = getOrCreateEntry(dealOrId);
  if (!entry) return;
  const prev = entry.timers.get(key);
  if (prev) clearTimeout(prev);
  entry.saved = 'Saving…';
  notify(entry);
  const run = async () => {
    entry.timers.delete(key);
    try {
      const res = await fn();
      const error = res?.error || null;
      entry.saved = error ? 'Not saved. Check your connection.' : 'Saved';
      notify(entry);
      return error;
    } catch {
      entry.saved = 'Not saved. Check your connection.';
      notify(entry);
      return new Error('Save failed');
    }
  };
  if (delayMs <= 0) return run();
  entry.timers.set(key, setTimeout(run, delayMs));
  return null;
}

function mergeBaseWithPlan(baseIn, plan, lib) {
  const next = { ...(baseIn || {}), units: 10, strUnits: 0 };
  if (plan) {
    const budget = lib ? lib.overallRepairBudget(plan) : 0;
    if (budget > 0) next.rehab = budget;
    if (plan.opex && !next.opex) next.opex = plan.opex;
    if (plan.laundry && !next.laundry) next.laundry = plan.laundry;
    if (plan.upside && !next.upside) next.upside = plan.upside;
  }
  return next;
}

function recomputeOffersSummaries(entry, lib, { persist = false, client = supabase, delayMs = 600 } = {}) {
  if (!lib || !entry.plan || !Array.isArray(entry.offers) || entry.offers.length === 0) return;
  const updates = [];
  entry.offers = entry.offers.map((o) => {
    const summary = lib.offerSellerSummary(o, entry.base, entry.plan, entry.comps, false);
    if (!summary) return o;
    updates.push([o.id, summary]);
    return { ...o, seller_summary: summary };
  });
  if (persist && client && updates.length > 0) {
    for (const [id, summary] of updates) {
      if (!id) continue;
      scheduleDealPersist(
        entry.dealId,
        `summary:${id}`,
        () => client.from('commercial_offers').update({ seller_summary: summary, updated_at: new Date().toISOString() }).eq('id', id),
        { delayMs },
      );
    }
  }
}

export async function loadDealStore(deal, { owner = false, onlyShared = undefined, client = supabase, force = false } = {}) {
  const entry = getOrCreateEntry(deal);
  if (!entry) return null;

  // If the owner already edited numbers in this session, keep live in-memory values for "See as" previews.
  if (!force && entry.dirtyByOwner && !owner) {
    return entry.snapshot;
  }
  if (!force && entry.loaded && (!owner || entry.loadedOwner)) {
    return entry.snapshot;
  }
  if (!force && entry.loadingPromise && (!owner || entry.loadedOwner)) {
    return entry.loadingPromise;
  }

  const run = (async () => {
    const offersQuery = (owner || onlyShared)
      ? client.from('commercial_offers').select('*').eq('deal_id', deal.id).order('sort')
      : client.rpc('commercial_get_lead_offer', { p_deal: deal.id });

    const planPromise = owner && loadPlanLib && deal?.slug
      ? getPlanLib().then(async (lib) => (lib ? { lib, plan: await lib.fetchPlan(client, deal.slug) } : { lib: null, plan: null }))
      : Promise.resolve({ lib: cachedPlanLib, plan: null });

    const compsPromise = owner
      ? client.from('commercial_comps').select('units,sale_price').eq('deal_id', deal.id)
      : Promise.resolve({ data: [] });

    const [offersRes, modelRes, planRes, compsRes] = await Promise.all([
      offersQuery,
      client.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      planPromise,
      compsPromise,
    ]);

    if (entry.dirtyByOwner && !owner) {
      return entry.snapshot;
    }

    const lib = planRes?.lib || cachedPlanLib;
    const loadedPlan = planRes?.plan || entry.plan;
    const rawOffers = offersRes?.data || [];
    const loadedComps = Array.isArray(compsRes?.data) ? compsRes.data : entry.comps;
    const loadedBase = mergeBaseWithPlan(modelRes?.data?.base || {}, loadedPlan, lib);

    entry.offers = Array.isArray(rawOffers) ? rawOffers : [];
    entry.base = loadedBase;
    if (loadedPlan) entry.plan = loadedPlan;
    entry.comps = loadedComps;
    entry.loaded = true;
    entry.loadedOwner = Boolean(owner || entry.loadedOwner);
    entry.error = offersRes?.error || modelRes?.error ? 'Some numbers could not load. Refresh to try again.' : '';

    if (owner && lib && loadedPlan && entry.offers.length > 0) {
      const lead = entry.offers.find((x) => x.is_lead);
      if (lead) {
        const nextSummary = lib.offerSellerSummary(lead, entry.base, loadedPlan, entry.comps, false);
        if (nextSummary && JSON.stringify(nextSummary) !== JSON.stringify(lead.seller_summary)) {
          entry.offers = entry.offers.map((x) => (x.id === lead.id ? { ...x, seller_summary: nextSummary } : x));
          void client.from('commercial_offers').update({ seller_summary: nextSummary, updated_at: new Date().toISOString() }).eq('id', lead.id);
        }
      }
    }

    entry.original = {
      list: filterOffersForRole(entry.offers, { owner, onlyShared }),
      base: loadedBase,
      plan: loadedPlan,
    };
    entry.loadingPromise = null;
    notify(entry);
    return entry.snapshot;
  })();

  entry.loadingPromise = run;
  return run;
}

export function updateDealBase(deal, nextBaseIn, { owner = true, persist = true, client = supabase, delayMs = 600 } = {}) {
  const entry = getOrCreateEntry(deal);
  if (!entry) return null;
  const resolved = typeof nextBaseIn === 'function' ? nextBaseIn(entry.base) : nextBaseIn;
  const nextBase = { ...(resolved || {}), units: 10, strUnits: 0 };
  entry.base = nextBase;

  let planChanged = false;
  if (entry.plan) {
    const nextPlan = { ...entry.plan };
    if (nextBase.opex && JSON.stringify(nextBase.opex) !== JSON.stringify(entry.plan.opex)) {
      nextPlan.opex = nextBase.opex;
      planChanged = true;
    }
    if (nextBase.laundry && JSON.stringify(nextBase.laundry) !== JSON.stringify(entry.plan.laundry)) {
      nextPlan.laundry = nextBase.laundry;
      planChanged = true;
    }
    if (nextBase.upside && JSON.stringify(nextBase.upside) !== JSON.stringify(entry.plan.upside)) {
      nextPlan.upside = nextBase.upside;
      planChanged = true;
    }
    if (planChanged) {
      entry.plan = cachedPlanLib ? cachedPlanLib.normalizePlan(nextPlan) : nextPlan;
      if (cachedPlanLib) {
        const total = cachedPlanLib.overallRepairBudget(entry.plan);
        if (total > 0) entry.base = { ...entry.base, rehab: total };
      }
    }
  }

  if (owner) {
    entry.dirtyByOwner = true;
    entry.loaded = true;
    entry.loadedOwner = true;
    if (cachedPlanLib && entry.plan) {
      recomputeOffersSummaries(entry, cachedPlanLib, { persist, client, delayMs });
    } else if (loadPlanLib) {
      getPlanLib().then((lib) => {
        if (!lib || !entry.plan) return;
        recomputeOffersSummaries(entry, lib, { persist, client, delayMs });
        notify(entry);
      });
    }
    if (persist && client) {
      scheduleDealPersist(
        entry.dealId,
        'base',
        () => client.from('commercial_models').upsert({ deal_id: entry.dealId, base: entry.base, updated_at: new Date().toISOString() }),
        { delayMs },
      );
      if (planChanged && entry.slug && cachedPlanLib?.persistPlan) {
        const savedPlan = entry.plan;
        const savePlanFn = cachedPlanLib.persistPlan;
        scheduleDealPersist(
          entry.dealId,
          'plan',
          () => savePlanFn(client, entry.slug, savedPlan),
          { delayMs },
        );
      }
    }
  }

  notify(entry);
  return entry.snapshot;
}

export function updatePlanState(deal, nextPlanIn, { owner = true, persist = true, client = supabase, delayMs = 600 } = {}) {
  const entry = getOrCreateEntry(deal);
  if (!entry) return null;
  const resolved = typeof nextPlanIn === 'function' ? nextPlanIn(entry.plan || {}) : nextPlanIn;
  const normalized = cachedPlanLib ? cachedPlanLib.normalizePlan(resolved) : resolved;
  entry.plan = normalized;

  if (cachedPlanLib) {
    const budget = cachedPlanLib.overallRepairBudget(normalized);
    entry.base = {
      ...entry.base,
      units: 10,
      strUnits: 0,
      ...(budget > 0 ? { rehab: budget } : {}),
      ...(normalized.opex ? { opex: normalized.opex } : {}),
      ...(normalized.laundry ? { laundry: normalized.laundry } : {}),
      ...(normalized.upside ? { upside: normalized.upside } : {}),
    };
  }

  if (owner) {
    entry.dirtyByOwner = true;
    entry.loaded = true;
    entry.loadedOwner = true;
    if (cachedPlanLib) {
      recomputeOffersSummaries(entry, cachedPlanLib, { persist, client, delayMs });
    } else if (loadPlanLib) {
      getPlanLib().then((lib) => {
        if (!lib) return;
        const budget = lib.overallRepairBudget(entry.plan);
        entry.base = { ...entry.base, ...(budget > 0 ? { rehab: budget } : {}) };
        recomputeOffersSummaries(entry, lib, { persist, client, delayMs });
        notify(entry);
      });
    }
    if (persist && client && entry.slug && cachedPlanLib?.persistPlan) {
      const savePlanFn = cachedPlanLib.persistPlan;
      const savedPlan = entry.plan;
      scheduleDealPersist(
        entry.dealId,
        'plan',
        () => savePlanFn(client, entry.slug, savedPlan),
        { delayMs },
      );
      scheduleDealPersist(
        entry.dealId,
        'base',
        () => client.from('commercial_models').upsert({ deal_id: entry.dealId, base: entry.base, updated_at: new Date().toISOString() }),
        { delayMs },
      );
    } else if (persist && client) {
      if (entry.slug && loadPlanLib) {
        getPlanLib().then((lib) => {
          if (!lib?.persistPlan) return;
          scheduleDealPersist(entry.dealId, 'plan', () => lib.persistPlan(client, entry.slug, entry.plan), { delayMs });
        });
      }
      scheduleDealPersist(
        entry.dealId,
        'base',
        () => client.from('commercial_models').upsert({ deal_id: entry.dealId, base: entry.base, updated_at: new Date().toISOString() }),
        { delayMs },
      );
    }
  }

  notify(entry);
  return entry.snapshot;
}

export function updateDealOffer(deal, offerId, patch, { owner = true, persist = true, client = supabase, delayMs = 600 } = {}) {
  const entry = getOrCreateEntry(deal);
  if (!entry || !Array.isArray(entry.offers)) return null;
  const existing = entry.offers.find((o) => o.id === offerId);
  if (!existing) return entry.snapshot;
  const nextPatch = { ...patch };
  if (owner && 'inputs' in patch && !('seller_summary' in patch) && cachedPlanLib && entry.plan) {
    const summary = cachedPlanLib.offerSellerSummary({ ...existing, inputs: patch.inputs }, entry.base, entry.plan, entry.comps, false);
    if (summary) nextPatch.seller_summary = summary;
  }
  entry.offers = entry.offers.map((o) => (o.id === offerId ? { ...o, ...nextPatch } : o));
  if (owner) {
    entry.dirtyByOwner = true;
    if (owner && 'inputs' in patch && !('seller_summary' in patch) && !cachedPlanLib && loadPlanLib) {
      getPlanLib().then((lib) => {
        if (!lib || !entry.plan) return;
        const fresh = entry.offers.find((o) => o.id === offerId);
        if (!fresh) return;
        const summary = lib.offerSellerSummary(fresh, entry.base, entry.plan, entry.comps, false);
        if (!summary) return;
        entry.offers = entry.offers.map((o) => (o.id === offerId ? { ...o, seller_summary: summary } : o));
        notify(entry);
        if (persist && client && offerId) {
          scheduleDealPersist(
            entry.dealId,
            offerId,
            () => client.from('commercial_offers').update({ ...nextPatch, seller_summary: summary, updated_at: new Date().toISOString() }).eq('id', offerId),
            { delayMs },
          );
        }
      });
    } else if (persist && client && offerId) {
      scheduleDealPersist(
        entry.dealId,
        offerId,
        () => client.from('commercial_offers').update({ ...nextPatch, updated_at: new Date().toISOString() }).eq('id', offerId),
        { delayMs },
      );
    }
  }
  notify(entry);
  return entry.snapshot;
}

export function setDealOffers(deal, nextOffersOrFn) {
  const entry = getOrCreateEntry(deal);
  if (!entry) return null;
  entry.offers = typeof nextOffersOrFn === 'function' ? nextOffersOrFn(entry.offers) : nextOffersOrFn;
  entry.loaded = true;
  notify(entry);
  return entry.snapshot;
}
