// Pure helpers for owner-only City Records: newest-first sorting, path extraction, and subtext hygiene.

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}/;

export function sortRecordsNewestFirst(items) {
  return [...(items || [])]
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const da = String(a.item?.sortDate || a.item?.source?.documentDate || '');
      const db = String(b.item?.sortDate || b.item?.source?.documentDate || '');
      const va = ISO_DAY_RE.test(da) ? da.slice(0, 10) : '';
      const vb = ISO_DAY_RE.test(db) ? db.slice(0, 10) : '';
      if (va && vb && va !== vb) return vb.localeCompare(va);
      if (va && !vb) return -1;
      if (!va && vb) return 1;
      return a.idx - b.idx;
    })
    .map(({ item }) => item);
}

export function normalizeCityRecords(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { updatedAt: '', summary: [], agencies: [] };
  }
  const summary = Array.isArray(parsed.summary) ? parsed.summary : [];
  const agencies = Array.isArray(parsed.agencies)
    ? parsed.agencies.map((ag) => ({
        ...ag,
        items: sortRecordsNewestFirst(ag.items),
      }))
    : [];
  return {
    updatedAt: String(parsed.updatedAt || ''),
    summary,
    agencies,
  };
}

export function collectRecordPaths(data) {
  const paths = new Set();
  for (const item of data?.summary || []) {
    for (const f of item?.files || []) {
      if (f?.path) paths.add(f.path);
    }
  }
  for (const ag of data?.agencies || []) {
    for (const item of ag?.items || []) {
      for (const f of item?.files || []) {
        if (f?.path) paths.add(f.path);
      }
    }
  }
  return [...paths];
}

export const FORBIDDEN_VISIBLE_RE = /https?:\/\/|\bverified\s+from\b|\bunverified\b|\bretrieved\b|\bsource\s*:|\bdisclaimer\b/i;

export function findVisibleSubtextViolations(data) {
  const hits = [];
  const checkText = (id, field, val) => {
    const s = String(val || '');
    if (FORBIDDEN_VISIBLE_RE.test(s)) hits.push(`${id}.${field}`);
  };
  for (const item of data?.summary || []) {
    checkText(item.id || 'summary', 'label', item.label);
    checkText(item.id || 'summary', 'value', item.value);
    for (const f of item.files || []) checkText(item.id || 'summary', 'file.label', f.label);
  }
  for (const ag of data?.groups || data?.agencies || []) {
    checkText(ag.id || 'agency', 'agency', ag.label || ag.agency);
    for (const item of ag.items || []) {
      checkText(item.id || 'item', 'label', item.label);
      checkText(item.id || 'item', 'value', item.value);
      for (const f of item.files || []) checkText(item.id || 'item', 'file.label', f.label);
    }
  }
  return hits;
}

export const CITY_RECORD_TOPICS = [
  ['ownership', 'Ownership & sale history'],
  ['liens', 'Mortgages, liens & court cases'],
  ['taxes', 'Taxes, value & assessments'],
  ['building', 'Building, units & code'],
  ['zoning', 'Zoning & location'],
  ['other', 'Other'],
  ['offline', 'Not online yet'],
];

const TOPIC_IDS = {
  ownership: ['sf-deed-2021', 'sf-deed-2012-23c', 'sf-deed-2012-sheriff', 'sf-deed-2005', 'sf-deed-1994', 'sos-entity-ucc', 'other-sheriff-sales', 'sum-owner'],
  liens: ['sf-recorded-docs-captcha', 'clerk-23c-civil', 'clerk-23c-crim-appeals', 'clerk-2008-foreclosure', 'amc-captcha', 'sum-mortgages', 'sum-liens'],
  taxes: ['sf-tax-2025-paid', 'sf-valuation-2026', 'sf-tax-2026-summary', 'sf-sa-2026', 'sf-bor-bta', 'sf-sa-2019-junk', 'sf-sa-2012-utility', 'sf-sa-rental-2010-2017', 'sum-taxes'],
  building: ['sf-commercial-card', 'sf-rental-reg', 'ak-epa-water-line', 'ak-violation-2023-open', 'scbs-permit-po2200103', 'ak-violation-2018-closed', 'scbs-govwell-dashboards', 'ak-grass-311', 'ak-co-unit-count-request', 'ak-city-rental-file', 'ak-water-balance-request', 'sum-units', 'sum-violations'],
  zoning: ['ak-zoning-gis', 'other-fema', 'other-nrhp', 'other-oppzone-landbank'],
};
const TOPIC_BY_ID = Object.fromEntries(Object.entries(TOPIC_IDS).flatMap(([topic, ids]) => ids.map((id) => [id, topic])));
// The summary unit tile is also the single detailed unit record. Rental assessments
// remain explicit facts in the rental row rather than a second registration row.
const MERGE_BY_ID = {
  'sum-units': 'units', 'sf-commercial-card': 'units', 'ak-co-unit-count-request': 'units',
  'sf-rental-reg': 'rental', 'sf-sa-rental-2010-2017': 'rental', 'ak-city-rental-file': 'rental',
};
const OFFLINE_RE = /^(?:blocked\s+online|not\s+online|not\s+searchable\s+online|needs?\s+(?:a\s+)?request)\b/i;
// A value counts as "not online" only when every part of it is a request/blocked note,
// so a record that also carries real facts keeps them.
const segmentsOf = (value) => String(value || '').trim().split(/\s+\u00b7\s+/).map((s) => s.trim()).filter(Boolean);
const isOfflineValue = (value) => { const segs = segmentsOf(value); return segs.length > 0 && segs.every((s) => OFFLINE_RE.test(s)); };
// Facts tucked into a blocked note, e.g. "(0 delinquent charges certified ...)".
const offlineExtras = (item) => isOfflineValue(item.value)
  ? (String(item.value || '').match(/\((\d[^()]*)\)/g) || []).map((m) => visibleText(m.slice(1, -1))).filter(Boolean)
  : [];
const normalizedText = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Only display facts; original provenance is retained separately for the overlay.
function visibleText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/\n|(?<=[.!?;])\s+/)
    .map((part) => part.replace(/\s*\(?\b(?:verified\s+from\b|unverified\b|retrieved\b|source\s*:|disclaimer\b).*$/i, '').trim())
    .filter(Boolean).join(' ').trim();
}

function topicFor(item) {
  if (TOPIC_BY_ID[item.id]) return TOPIC_BY_ID[item.id];
  const text = `${item.label} ${item.value} ${item.id}`.toLowerCase();
  if (/assessment|tax|valuation|\bbor\b|\bbta\b/.test(text)) return 'taxes';
  if (/mortgage|lien|court|foreclos|judgment|\bucc\b/.test(text)) return 'liens';
  if (/deed|transfer|sheriff|land contract|owner|entity/.test(text)) return 'ownership';
  if (/zoning|flood|fema|historic|nrhp|opportunity|land.?bank|location/.test(text)) return 'zoning';
  if (/building|unit|permit|violation|enforcement|rental|water|grass|311|commercial card/.test(text)) return 'building';
  return 'other';
}

function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

export function organizeCityRecords(raw) {
  const data = normalizeCityRecords(raw);
  const entries = [
    ...data.summary.map((item) => ({ ...item, isSummary: true, requestAt: 'the issuing office' })),
    ...data.agencies.flatMap((agency) => agency.items.map((item) => ({ ...item, requestAt: visibleText(agency.agency) || 'the issuing office' }))),
  ];
  // Union explicit families and exact normalized duplicates, including transitive
  // matches, so no input can be assigned to two rows.
  const parent = entries.map((_, i) => i);
  const root = (i) => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const seen = new Map();
  entries.forEach((item, i) => {
    const keys = [`text:${normalizedText(item.label)}|${normalizedText(item.value)}`];
    if (MERGE_BY_ID[item.id]) keys.push(`merge:${MERGE_BY_ID[item.id]}`);
    for (const key of keys) {
      if (seen.has(key)) parent[root(i)] = root(seen.get(key));
      else seen.set(key, i);
    }
  });
  const families = new Map();
  entries.forEach((item, i) => {
    const key = root(i);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(item);
  });
  const summary = [];
  const rows = [];
  for (const members of families.values()) {
    const available = members.filter((item) => !isOfflineValue(item.value));
    const lead = members.find((item) => item.isSummary) || available[0] || members[0];
    const offline = available.length === 0;
    const facts = uniqueBy(members.map((item) => ({
      text: isOfflineValue(item.value)
        ? `${visibleText(item.label)}: Request from ${item.requestAt}`
        : visibleText(item.value),
    })).filter((fact) => fact.text), (fact) => normalizedText(fact.text));
    const compactFacts = facts.filter((fact) => !facts.some((other) => other !== fact &&
      ` ${normalizedText(other.text)} `.includes(` ${normalizedText(fact.text)} `)));
    const sources = uniqueBy(members.flatMap((item) => [...(item.sources || []), ...(item.source ? [item.source] : [])]),
      (source) => JSON.stringify(Object.entries(source).sort(([a], [b]) => a.localeCompare(b))));
    const newest = sortRecordsNewestFirst(members)[0];
    const row = {
      id: lead.id,
      mergedIds: members.map((item) => item.id),
      label: MERGE_BY_ID[lead.id] === 'rental' ? 'Rental registration & assessments' : visibleText(lead.label),
      value: offline ? [...uniqueBy(members, (item) => item.requestAt).map((item) => `Request from ${item.requestAt}`), ...members.flatMap(offlineExtras)].join('; ') : compactFacts.map((fact) => fact.text).join(' · '),
      sortDate: newest.sortDate || newest.source?.documentDate || '',
      files: uniqueBy(members.flatMap((item) => item.files || []), (file) => file.path)
        .map((file) => ({ ...file, label: visibleText(file.label) || 'Document' })),
      sources,
      topic: offline ? 'offline' : MERGE_BY_ID[lead.id] === 'rental' ? 'building' : topicFor(lead),
    };
    if (members.some((item) => item.isSummary) && !offline) summary.push(row);
    else rows.push(row);
  }
  return {
    updatedAt: data.updatedAt,
    summary,
    groups: CITY_RECORD_TOPICS.map(([id, label]) => ({
      id, label, items: sortRecordsNewestFirst(rows.filter((row) => row.topic === id)),
    })).filter((group) => group.items.length).map((group) => ({ ...group, count: group.items.length })),
  };
}
