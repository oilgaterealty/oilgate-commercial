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
  for (const ag of data?.agencies || []) {
    checkText(ag.id || 'agency', 'agency', ag.agency);
    for (const item of ag.items || []) {
      checkText(item.id || 'item', 'label', item.label);
      checkText(item.id || 'item', 'value', item.value);
      for (const f of item.files || []) checkText(item.id || 'item', 'file.label', f.label);
    }
  }
  return hits;
}
