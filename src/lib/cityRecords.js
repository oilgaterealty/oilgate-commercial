// Pure helpers for owner-only City Records: newest-first sorting, path extraction,
// ADHD-friendly answer/details splitting, request extraction, and subtext hygiene.

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
    checkText(item.id || 'summary', 'answer', item.answer);
    checkText(item.id || 'summary', 'line', item.line);
    checkText(item.id || 'summary', 'value', item.value);
    for (const detail of item.details || []) checkText(item.id || 'summary', 'detail', detail);
    for (const f of item.files || []) checkText(item.id || 'summary', 'file.label', f.label);
  }
  for (const ag of data?.groups || data?.agencies || []) {
    checkText(ag.id || 'agency', 'agency', ag.label || ag.agency);
    for (const item of ag.items || []) {
      checkText(item.id || 'item', 'label', item.label);
      checkText(item.id || 'item', 'answer', item.answer);
      checkText(item.id || 'item', 'line', item.line);
      checkText(item.id || 'item', 'value', item.value);
      for (const detail of item.details || []) checkText(item.id || 'item', 'detail', detail);
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
  ['offline', 'Records to request'],
];

const TOPIC_IDS = {
  ownership: ['sf-deed-2021', 'sf-deed-2012-23c', 'sf-deed-2012-sheriff', 'sf-deed-2005', 'sf-deed-1994', 'sos-entity-ucc', 'other-sheriff-sales', 'sum-owner'],
  liens: ['sf-recorded-docs-captcha', 'clerk-23c-civil', 'clerk-23c-crim-appeals', 'clerk-2008-foreclosure', 'amc-captcha', 'sum-mortgages', 'sum-liens'],
  taxes: ['sf-tax-2025-paid', 'sf-valuation-2026', 'sf-tax-2026-summary', 'sf-sa-2026', 'sf-bor-bta', 'sf-sa-2019-junk', 'sf-sa-2012-utility', 'sf-sa-rental-2010-2017', 'sum-taxes'],
  building: ['sf-commercial-card', 'sf-rental-reg', 'ak-epa-water-line', 'ak-violation-2023-open', 'scbs-permit-po2200103', 'ak-violation-2018-closed', 'scbs-govwell-dashboards', 'ak-grass-311', 'ak-co-unit-count-request', 'ak-city-rental-file', 'ak-water-balance-request', 'sum-units', 'sum-violations'],
  zoning: ['ak-zoning-gis', 'other-fema', 'other-nrhp', 'other-oppzone-landbank'],
};
const TOPIC_BY_ID = Object.fromEntries(Object.entries(TOPIC_IDS).flatMap(([topic, ids]) => ids.map((id) => [id, topic])));

// The summary unit tile merges with the commercial property card; rental registration merges with rental assessments.
const MERGE_BY_ID = {
  'sum-units': 'units',
  'sf-commercial-card': 'units',
  'sf-rental-reg': 'rental',
  'sf-sa-rental-2010-2017': 'rental',
};

const REQUEST_BODY_RE = /^(?:blocked\s+online|not\s+online|not\s+searchable\s+online|needs?\s+(?:a\s+)?request|request\s+from)\b/i;
const CODE_PREFIX_RE = /^(?:parcel|alt|ppn|apn|luc|structure|class\s+[a-z]|legal:)\b/i;

const splitSegments = (value) =>
  String(value || '')
    .trim()
    .split(/\s+\u00b7\s+|;\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

const normalizedText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const singularWord = (w) =>
  w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w;

const normAnswerText = (value) =>
  normalizedText(String(value || '').replace(/(\$\d[\d,]*)\.00\b/g, '$1'));

// Only display facts; original provenance is retained separately for the overlay.
function visibleText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .split(/\n|(?<=[.!?;])\s+/)
    .map((part) => part.replace(/\s*\(?\b(?:verified\s+from\b|unverified\b|retrieved\b|source\s*:|disclaimer\b).*$/i, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function parseRequestSegment(rawSeg, fallbackLabel, fallbackOffice) {
  let subject = '';
  let body = '';
  const colonMatch = String(rawSeg || '').trim().match(/^([^:]{2,120}):\s*(.+)$/);
  if (colonMatch && REQUEST_BODY_RE.test(colonMatch[2].trim())) {
    subject = visibleText(colonMatch[1]);
    body = colonMatch[2].trim();
  } else if (REQUEST_BODY_RE.test(String(rawSeg || '').trim())) {
    subject = visibleText(fallbackLabel);
    body = String(rawSeg || '').trim();
  } else {
    return null;
  }

  const extras = (body.match(/\((\d[^()]*)\)/g) || [])
    .map((m) => visibleText(m.slice(1, -1)))
    .filter(Boolean);

  let office = '';
  const reqFromMatch = body.match(/^request\s+from\s+(.+)$/i);
  const needsReqFromMatch = body.match(/needs?\s+(?:a\s+)?request\s+from\s+(.+)$/i);
  if (reqFromMatch) {
    office = visibleText(reqFromMatch[1].replace(/\(\d[^()]*\)/g, ''));
  } else if (needsReqFromMatch) {
    office = visibleText(needsReqFromMatch[1].replace(/\(\d[^()]*\)/g, ''));
  } else {
    for (const paren of body.matchAll(/\(([^()]+)\)/g)) {
      const inner = paren[1].trim();
      if (!/^\d/.test(inner)) {
        office = visibleText(inner);
        break;
      }
    }
  }
  if (!office) office = visibleText(fallbackOffice);
  office = office.replace(/[.;:,]+$/, '').trim() || 'the issuing office';

  return {
    label: subject || visibleText(fallbackLabel),
    office,
    extras,
  };
}

// A parenthetical that only names where a fact came from ("(County commercial card)") is source, not fact.
export const SOURCE_PAREN_RE = /\s*\((?![^)]*\d)[^)]*\b(?:card|office|division|dept\.?|department|dashboard|portal)\b[^)]*\)/gi;

function splitEntryValue(item, fallbackOffice) {
  const factSegments = [];
  const requestSegments = [];
  for (const rawSeg of splitSegments(item.value)) {
    const req = parseRequestSegment(rawSeg, item.label, fallbackOffice);
    if (req) {
      requestSegments.push(req);
    } else {
      const cleaned = visibleText(rawSeg)
        .replace(SOURCE_PAREN_RE, '')
        .replace(/[;]+$/, '')
        .trim();
      if (cleaned) factSegments.push(cleaned);
    }
  }
  return { factSegments, requestSegments };
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

function itemSources(item) {
  return [...(item.sources || []), ...(item.source ? [item.source] : [])];
}

function restatesAnswer(detail, answer, rowLabel) {
  const na = normAnswerText(answer);
  const nd = normAnswerText(detail);
  if (!nd) return true;
  if (!na) return false;
  if (nd === na) return true;
  if (!detail.includes('(') && ` ${na} `.includes(` ${nd} `)) return true;

  const labelTokens = new Set(
    normalizedText(rowLabel)
      .split(' ')
      .filter(Boolean)
      .flatMap((w) => [w, singularWord(w)])
  );
  const fillerTokens = new Set([
    'unit', 'units', 'due', 'owed', 'total', 'found', 'open',
    'none', 'no', 'currently', 'active', 'record', 'records',
  ]);

  if ((na === 'none found' || na === 'none') && !detail.includes('(')) {
    const dTokens = nd.split(' ').filter(Boolean);
    if (dTokens.every((t) => t === 'no' || t === 'none' || t === 'found' || labelTokens.has(t) || labelTokens.has(singularWord(t)))) {
      return true;
    }
  }

  if (!detail.includes('(') && ` ${nd} `.includes(` ${na} `)) {
    const escaped = na.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rest = nd.replace(new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`), ' ').trim();
    const restTokens = rest.split(' ').filter(Boolean);
    if (restTokens.every((t) => labelTokens.has(t) || labelTokens.has(singularWord(t)) || fillerTokens.has(t))) {
      return true;
    }
  }

  return false;
}

function mergeOfflineCandidates(pool) {
  if (!pool.length) return [];

  const needMeta = (label) => ({
    full: normalizedText(label),
    base: normalizedText(String(label || '').replace(/\([^)]*\)/g, '')),
  });
  const phraseMatch = (a, b) => {
    if (!a || !b) return false;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return shorter.length >= 4 && ` ${longer} `.includes(` ${shorter} `);
  };

  const parent = pool.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const metas = pool.map((c) => needMeta(c.label));

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const ma = metas[i];
      const mb = metas[j];
      const match =
        (ma.full && ma.full === mb.full) ||
        (ma.base && ma.base === mb.base) ||
        phraseMatch(ma.base, mb.base);
      if (match) parent[root(i)] = root(j);
    }
  }

  const clusters = new Map();
  pool.forEach((c, i) => {
    const r = root(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(c);
  });

  const normOffice = (office) =>
    normalizedText(office)
      .replace(/\b(?:dept|department)\b(?:\s+of)?/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const mergedRows = [];
  for (const cluster of clusters.values()) {
    const uniqueOffices = uniqueBy(
      cluster.map((c) => c.office).filter(Boolean),
      (o) => normOffice(o) || normalizedText(o)
    );
    const hasSpecific = uniqueOffices.some((o) => o.toLowerCase() !== 'the issuing office');
    const filteredOffices = hasSpecific
      ? uniqueOffices.filter((o) => o.toLowerCase() !== 'the issuing office')
      : uniqueOffices;
    const compactOffices = filteredOffices.filter((office) => {
      const no = normOffice(office);
      if (!no) return false;
      return !filteredOffices.some((other) => {
        if (other === office) return false;
        const nother = normOffice(other);
        return nother.length > no.length && ` ${nother} `.includes(` ${no} `);
      });
    });

    const offices = compactOffices.length ? compactOffices : ['the issuing office'];
    const extras = uniqueBy(cluster.flatMap((c) => c.extras || []), normalizedText);

    const sortedLabels = [...cluster]
      .filter((c) => c.label)
      .sort((a, b) => {
        if (b.label.length !== a.label.length) return b.label.length - a.label.length;
        return Number(Boolean(b.isStandalone)) - Number(Boolean(a.isStandalone));
      });
    const label = sortedLabels[0]?.label || 'Record';

    const mergedIds = uniqueBy(
      cluster.flatMap((c) => c.mergedIds || []),
      (id) => id
    );
    const id = mergedIds[0] || cluster[0].id;
    const value = [`Request from ${offices.join('; ')}`, ...extras].join('; ');
    const newest = sortRecordsNewestFirst(cluster)[0];

    mergedRows.push({
      id,
      mergedIds,
      label,
      answer: value,
      line: '',
      details: [],
      value,
      sortDate: newest?.sortDate || '',
      files: uniqueBy(cluster.flatMap((c) => c.files || []), (f) => f.path)
        .map((file) => ({ ...file, label: visibleText(file.label) || 'Document' })),
      sources: uniqueBy(
        cluster.flatMap((c) => c.sources || []),
        (source) => JSON.stringify(Object.entries(source).sort(([a], [b]) => a.localeCompare(b)))
      ),
      topic: 'offline',
    });
  }

  return mergedRows;
}

export function answerTone(label, answer) {
  const l = String(label || '').trim();
  const a = String(answer || '').trim();
  if (!a) return 'neutral';
  if (/^\$0(?:\.00)?(?:\s+(?:due|owed))?$/i.test(a)) return 'good';
  if (/^(?:none(?:\s+found)?|no\s+(?:open|liens?|judgments?|mortgages?|violations?|cases?|active|scheduled|bor\b).*|0\s+open|clear|paid(?:\s+in\s+full)?|satisfied|closed)$/i.test(a)) {
    return 'good';
  }
  if (/\b(?:open|overdue|delinquent|past\s+due|unpaid|outstanding|violation|foreclos\w*|pending|needs?\s+(?:a\s+)?(?:request|check)|unknown|not\s+online)\b/i.test(a)) {
    return 'warn';
  }
  if (/open|violation|case/i.test(l) && /^[1-9]\d*$/.test(a)) return 'warn';
  if (/tax|owed|balance|delinquent/i.test(l) && /^\$[1-9][\d,]*(?:\.\d{2})?(?:\s+(?:due|owed))?$/i.test(a)) {
    return 'warn';
  }
  return 'neutral';
}

export function organizeCityRecords(raw) {
  const data = normalizeCityRecords(raw);
  const rawEntries = [
    ...data.summary.map((item) => ({ ...item, isSummary: true, requestAt: 'the issuing office' })),
    ...data.agencies.flatMap((agency) =>
      (agency.items || []).map((item) => ({
        ...item,
        requestAt: visibleText(agency.agency) || 'the issuing office',
      }))
    ),
  ];

  const factualEntries = [];
  const offlinePool = [];

  for (const item of rawEntries) {
    const explicitAnswer = visibleText(item.answer);
    const explicitLine = visibleText(item.line);
    const { factSegments, requestSegments } = splitEntryValue(item, item.requestAt);
    const offlineOnly =
      !explicitAnswer &&
      factSegments.length === 0 &&
      (requestSegments.length > 0 || REQUEST_BODY_RE.test(String(item.value || '').trim()));

    const sources = itemSources(item);
    const sortDate = item.sortDate || item.source?.documentDate || '';

    if (offlineOnly) {
      const reqs = requestSegments.length
        ? requestSegments
        : [{ label: visibleText(item.label), office: item.requestAt || 'the issuing office', extras: [] }];
      reqs.forEach((req, idx) => {
        offlinePool.push({
          id: idx === 0 ? item.id : `offline:${item.id}:${idx}`,
          mergedIds: idx === 0 ? [item.id] : [],
          isStandalone: true,
          label: req.label || visibleText(item.label),
          office: req.office,
          extras: req.extras,
          files: idx === 0 ? item.files || [] : [],
          sources: idx === 0 ? sources : [],
          sortDate,
        });
      });
    } else {
      factualEntries.push({
        ...item,
        explicitAnswer,
        explicitLine,
        factSegments,
        sortDate,
      });
      requestSegments.forEach((req, idx) => {
        offlinePool.push({
          id: `offline:${item.id}:${idx}`,
          mergedIds: [],
          isStandalone: false,
          label: req.label,
          office: req.office,
          extras: req.extras,
          files: [],
          sources,
          sortDate,
        });
      });
    }
  }

  // Union explicit families and exact normalized duplicates, including transitive
  // matches, so no input can be assigned to two rows.
  const parent = factualEntries.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const seen = new Map();
  factualEntries.forEach((item, i) => {
    const keys = [];
    const normLabel = normalizedText(item.label);
    const normVal = normalizedText(item.explicitAnswer || item.factSegments.join(' · '));
    if (normLabel || normVal) keys.push(`text:${normLabel}|${normVal}`);
    if (MERGE_BY_ID[item.id]) keys.push(`merge:${MERGE_BY_ID[item.id]}`);
    for (const key of keys) {
      if (seen.has(key)) parent[root(i)] = root(seen.get(key));
      else seen.set(key, i);
    }
  });

  const families = new Map();
  factualEntries.forEach((item, i) => {
    const key = root(i);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(item);
  });

  const summary = [];
  const rows = [];

  for (const members of families.values()) {
    const lead = members.find((item) => item.isSummary) || members[0];
    const ordered = [lead, ...members.filter((item) => item !== lead)];
    const rowLabel = MERGE_BY_ID[lead.id] === 'rental' ? 'Rental registration & assessments' : visibleText(lead.label);
    const allSegments = ordered.flatMap((item) => item.factSegments);

    let answer = '';
    let line = '';
    if (lead.explicitAnswer) {
      answer = lead.explicitAnswer;
      line = lead.explicitLine || '';
    } else {
      const plainSeg = allSegments.find((seg) => !CODE_PREFIX_RE.test(seg));
      answer = plainSeg || allSegments[0] || '';
      line = lead.explicitLine || '';
    }

    const dedupedSegments = uniqueBy(allSegments, normalizedText);
    const compactSegments = dedupedSegments.filter((seg) => {
      const ns = normalizedText(seg);
      return !dedupedSegments.some((other) => {
        if (other === seg) return false;
        const no = normalizedText(other);
        return no.length > ns.length && ` ${no} `.includes(` ${ns} `);
      });
    });

    const details = compactSegments.filter((seg) => !restatesAnswer(seg, answer, rowLabel));
    const value = [answer, ...details].filter(Boolean).join(' · ');

    const sources = uniqueBy(
      members.flatMap((item) => itemSources(item)),
      (source) => JSON.stringify(Object.entries(source).sort(([a], [b]) => a.localeCompare(b)))
    );
    const newest = sortRecordsNewestFirst(members)[0];

    const row = {
      id: lead.id,
      mergedIds: members.map((item) => item.id),
      label: rowLabel,
      answer,
      line,
      details,
      value,
      sortDate: newest.sortDate || newest.source?.documentDate || '',
      files: uniqueBy(members.flatMap((item) => item.files || []), (file) => file.path)
        .map((file) => ({ ...file, label: visibleText(file.label) || 'Document' })),
      sources,
      topic: MERGE_BY_ID[lead.id] === 'rental' ? 'building' : topicFor(lead),
    };

    if (members.some((item) => item.isSummary)) summary.push(row);
    else rows.push(row);
  }

  for (const offlineRow of mergeOfflineCandidates(offlinePool)) {
    rows.push(offlineRow);
  }

  return {
    updatedAt: data.updatedAt,
    summary,
    groups: CITY_RECORD_TOPICS.map(([id, label]) => ({
      id,
      label,
      items: sortRecordsNewestFirst(rows.filter((row) => row.topic === id)),
    }))
      .filter((group) => group.items.length)
      .map((group) => ({ ...group, count: group.items.length })),
  };
}
