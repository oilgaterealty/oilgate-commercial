// Verified static public property facts for the unauthenticated visitor view, keyed by deal slug.
export const ALLOWED_FACT_KEYS = Object.freeze(['building', 'neighborhood', 'schools', 'nearby', 'map']);

export const OPEN_VIEWER_FACTS = Object.freeze({
  charlotte: Object.freeze({
    building: Object.freeze({
      stats: Object.freeze([
        Object.freeze({ key: 'built', label: 'Built', value: '1919' }),
        Object.freeze({ key: 'size', label: 'Building', value: '10,800 sq ft' }),
        Object.freeze({ key: 'units', label: 'Units', value: '10 apartments' }),
        Object.freeze({ key: 'avgSize', label: 'Average unit', value: '~810 sq ft avg' }),
      ]),
      sources: Object.freeze([
        'Summit County Fiscal Office commercial property card, parcel 6801234',
      ]),
    }),
    neighborhood: Object.freeze({
      name: 'Highland Square, Akron',
      walkScore: Object.freeze({ value: 79, label: 'Walk 79', rating: 'Very Walkable' }),
      transitScore: Object.freeze({ value: 35, label: 'Transit 35' }),
      highlight: "Steps from West Market Street's local restaurants, coffee shops and small businesses, and the historic Highland Theatre.",
      sources: Object.freeze([
        'walkscore.com',
        'Highland Square neighborhood listings',
      ]),
    }),
    schools: Object.freeze({
      district: 'Akron Public Schools',
      list: Object.freeze([
        'King Community Learning Center (K-5)',
        'Litchfield Community Learning Center',
        'Firestone High School',
      ]),
      sources: Object.freeze([
        'Zillow school assignment for 23-27 Charlotte St',
      ]),
    }),
    nearby: Object.freeze({
      walk: Object.freeze([
        Object.freeze({ name: "Frank's Place on Market", distance: '0.1 mi', time: '2 min walk' }),
        Object.freeze({ name: 'House Three Thirty and Buckets', distance: '0.2 mi', time: '4 min walk' }),
        Object.freeze({ name: 'I Promise School', distance: '0.4 mi', time: '8 min walk' }),
        Object.freeze({ name: 'Highland Theatre', distance: '0.5 mi', time: '10 min walk' }),
        Object.freeze({ name: 'Mustard Seed Market', distance: '0.6 mi', time: '12 min walk' }),
      ]),
      drive: Object.freeze([
        Object.freeze({ name: "Dr. Bob's Home", distance: '1.0 mi', time: '3 min drive' }),
        Object.freeze({ name: 'Cleveland Clinic Akron General', distance: '1.3 mi', time: '3 min drive' }),
        Object.freeze({ name: 'Downtown Akron (Lock 3)', distance: '1.6 mi', time: '4 min drive' }),
        Object.freeze({ name: 'University of Akron', distance: '2.0 mi', time: '5 min drive' }),
        Object.freeze({ name: 'Stan Hywet Hall & Gardens', distance: '2.3 mi', time: '6 min drive' }),
        Object.freeze({ name: 'Summa Akron City Hospital', distance: '2.4 mi', time: '7 min drive' }),
      ]),
      sources: Object.freeze([
        'Route distance from OpenStreetMap (OSRM), measured Nov 26, 2026',
      ]),
      transit: Object.freeze({
        label: 'METRO RTA',
        routes: Object.freeze([
          '1 West Market',
          '28 Merriman Valley',
        ]),
        sources: Object.freeze([
          'walkscore.com',
        ]),
      }),
    }),
    map: Object.freeze({
      embedUrl: 'https://www.openstreetmap.org/export/embed.html?bbox=-81.5458,41.0893,-81.5258,41.0993&layer=mapnik&marker=41.0943012,-81.5358543',
      directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=23-27+Charlotte+St+Akron+OH+44303',
    }),
  }),
});

/**
 * Returns verified static public facts for a deal slug, or null for any unknown slug.
 */
export function getOpenViewerFacts(slug) {
  const key = String(slug || '').trim().toLowerCase();
  return key && Object.hasOwn(OPEN_VIEWER_FACTS, key) ? OPEN_VIEWER_FACTS[key] : null;
}
