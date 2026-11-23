export const DB_NAME = 'oilgate-walkthrough-v1';
export const DB_VERSION = 1;

export const AUDIO_STATUS = {
  RECORDING: 'recording',
  PAUSED: 'paused',
  TRANSCRIBING: 'transcribing',
  READY: 'ready',
  MODEL_FAILED: 'model_failed',
  SYNC_FAILED: 'sync_failed',
};

export const MEDIA_STATUS = {
  PENDING: 'pending',
  UPLOADING: 'uploading',
  FAILED: 'failed',
};

export const IMMUTABLE_SESSION_KEYS = [
  'id',
  'dealId',
  'userUid',
  'scopeKey',
  'authorRole',
  'authorName',
  'unitNumber',
  'room',
  'createdAt',
];

export const makeScopeKey = (dealId, userUid) => `${dealId || ''}:${userUid || ''}`;

export function canReportVoiceNoteSynced(record) {
  return Boolean(
    record &&
      typeof record.remoteStoragePath === 'string' &&
      record.remoteStoragePath.trim().length > 0 &&
      record.remoteId
  );
}

export function applySessionPatch(existing, patch) {
  if (!existing) return null;
  const safePatch = { ...(patch || {}) };
  for (const key of IMMUTABLE_SESSION_KEYS) {
    delete safePatch[key];
  }
  return {
    ...existing,
    ...safePatch,
    updatedAt: safePatch.updatedAt || Date.now(),
  };
}

let dbPromise = null;
let memoryFallback = false;
const memStores = {
  audio_sessions: new Map(),
  audio_chunks: new Map(),
  media_queue: new Map(),
};

function openDb() {
  if (memoryFallback) return Promise.resolve(null);
  if (typeof indexedDB === 'undefined') {
    memoryFallback = true;
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('audio_sessions')) {
          const s = db.createObjectStore('audio_sessions', { keyPath: 'id' });
          s.createIndex('scopeKey', 'scopeKey', { unique: false });
          s.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('audio_chunks')) {
          const c = db.createObjectStore('audio_chunks', { keyPath: 'id' });
          c.createIndex('sessionId', 'sessionId', { unique: false });
        }
        if (!db.objectStoreNames.contains('media_queue')) {
          const m = db.createObjectStore('media_queue', { keyPath: 'id' });
          m.createIndex('scopeKey', 'scopeKey', { unique: false });
          m.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        memoryFallback = true;
        resolve(null);
      };
    } catch {
      memoryFallback = true;
      resolve(null);
    }
  });
  return dbPromise;
}

export function isUsingMemoryFallback() {
  return memoryFallback;
}

export async function requestPersistentStorage() {
  try {
    if (navigator?.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB operation failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function createAudioSession({
  id = crypto.randomUUID(),
  dealId,
  userUid,
  authorRole,
  authorName,
  unitNumber,
  room,
  mimeType = 'audio/webm',
}) {
  const now = Date.now();
  const session = {
    id,
    dealId,
    userUid,
    scopeKey: makeScopeKey(dealId, userUid),
    authorRole,
    authorName: authorName || '',
    unitNumber: Number(unitNumber),
    room,
    mimeType,
    status: AUDIO_STATUS.RECORDING,
    pauseReason: '',
    rawTranscript: '',
    transcriptError: '',
    syncError: '',
    remoteId: null,
    remoteStoragePath: null,
    chunkCount: 0,
    totalBytes: 0,
    nextSegmentIndex: 0,
    durationMs: 0,
    createdAt: now,
    updatedAt: now,
  };
  const db = await openDb();
  if (!db) {
    memStores.audio_sessions.set(id, session);
    return session;
  }
  const tx = db.transaction('audio_sessions', 'readwrite');
  tx.objectStore('audio_sessions').put(session);
  await txDone(tx);
  return session;
}

export async function appendAudioChunk(sessionId, segmentIndex, seq, blob) {
  if (!blob || !blob.size) return null;
  const now = Date.now();
  const chunk = {
    id: `${sessionId}:${segmentIndex}:${seq}`,
    sessionId,
    segmentIndex,
    seq,
    size: blob.size,
    type: blob.type || '',
    blob,
    createdAt: now,
  };
  const db = await openDb();
  if (!db) {
    memStores.audio_chunks.set(chunk.id, chunk);
    const s = memStores.audio_sessions.get(sessionId);
    if (s) {
      s.chunkCount = (s.chunkCount || 0) + 1;
      s.totalBytes = (s.totalBytes || 0) + blob.size;
      s.nextSegmentIndex = Math.max(s.nextSegmentIndex || 0, segmentIndex + 1);
      s.updatedAt = now;
    }
    return chunk;
  }
  const tx = db.transaction(['audio_chunks', 'audio_sessions'], 'readwrite');
  tx.objectStore('audio_chunks').put(chunk);
  const sStore = tx.objectStore('audio_sessions');
  const existing = await idbReq(sStore.get(sessionId));
  if (existing) {
    sStore.put({
      ...existing,
      chunkCount: (existing.chunkCount || 0) + 1,
      totalBytes: (existing.totalBytes || 0) + blob.size,
      nextSegmentIndex: Math.max(existing.nextSegmentIndex || 0, segmentIndex + 1),
      updatedAt: now,
    });
  }
  await txDone(tx);
  return chunk;
}

export async function updateAudioSession(sessionId, patch) {
  const db = await openDb();
  if (!db) {
    const existing = memStores.audio_sessions.get(sessionId);
    const updated = applySessionPatch(existing, patch);
    if (updated) memStores.audio_sessions.set(sessionId, updated);
    return updated;
  }
  const tx = db.transaction('audio_sessions', 'readwrite');
  const store = tx.objectStore('audio_sessions');
  const existing = await idbReq(store.get(sessionId));
  const updated = applySessionPatch(existing, patch);
  if (updated) store.put(updated);
  await txDone(tx);
  return updated;
}

export async function getSessionSegments(sessionId) {
  const db = await openDb();
  let session;
  let chunks;
  if (!db) {
    session = memStores.audio_sessions.get(sessionId);
    chunks = [...memStores.audio_chunks.values()].filter((c) => c.sessionId === sessionId);
  } else {
    const tx = db.transaction(['audio_sessions', 'audio_chunks'], 'readonly');
    const [s, c] = await Promise.all([
      idbReq(tx.objectStore('audio_sessions').get(sessionId)),
      idbReq(tx.objectStore('audio_chunks').index('sessionId').getAll(sessionId)),
    ]);
    session = s;
    chunks = c || [];
  }
  chunks.sort((a, b) => (a.segmentIndex - b.segmentIndex) || (a.seq - b.seq));
  const bySegment = new Map();
  for (const ch of chunks) {
    if (!bySegment.has(ch.segmentIndex)) bySegment.set(ch.segmentIndex, []);
    bySegment.get(ch.segmentIndex).push(ch);
  }
  const segmentBlobs = [];
  let totalBytes = 0;
  for (const segChunks of bySegment.values()) {
    const type = segChunks.find((x) => x.type)?.type || session?.mimeType || 'audio/webm';
    const blob = new Blob(segChunks.map((x) => x.blob), { type });
    totalBytes += blob.size;
    if (blob.size > 0) segmentBlobs.push(blob);
  }
  return { session, segmentBlobs, totalBytes, chunkCount: chunks.length };
}

export async function listAudioSessions(scopeKey) {
  const db = await openDb();
  const rows = !db
    ? [...memStores.audio_sessions.values()].filter((r) => r.scopeKey === scopeKey)
    : await (async () => {
        const tx = db.transaction('audio_sessions', 'readonly');
        return (await idbReq(tx.objectStore('audio_sessions').index('scopeKey').getAll(scopeKey))) || [];
      })();

  const recovered = [];
  for (const row of rows) {
    if (row.status === AUDIO_STATUS.RECORDING) {
      const next = await updateAudioSession(row.id, {
        status: AUDIO_STATUS.PAUSED,
        pauseReason: row.pauseReason || 'Interrupted by reload — audio preserved.',
      });
      recovered.push(next || row);
    } else if (row.status === AUDIO_STATUS.TRANSCRIBING) {
      const next = await updateAudioSession(row.id, {
        status: AUDIO_STATUS.MODEL_FAILED,
        transcriptError: 'Transcription was interrupted by reload. Tap Retry Whisper.',
      });
      recovered.push(next || row);
    } else {
      recovered.push(row);
    }
  }
  return recovered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAudioSession(sessionId) {
  const db = await openDb();
  if (!db) {
    memStores.audio_sessions.delete(sessionId);
    for (const [k, v] of memStores.audio_chunks.entries()) {
      if (v.sessionId === sessionId) memStores.audio_chunks.delete(k);
    }
    return;
  }
  const tx = db.transaction(['audio_sessions', 'audio_chunks'], 'readwrite');
  tx.objectStore('audio_sessions').delete(sessionId);
  const cStore = tx.objectStore('audio_chunks');
  const chunkKeys = await idbReq(cStore.index('sessionId').getAllKeys(sessionId));
  for (const k of chunkKeys || []) cStore.delete(k);
  await txDone(tx);
}

export async function enqueueMediaItem({
  id = crypto.randomUUID(),
  dealId,
  userUid,
  authorRole,
  authorName,
  unitNumber,
  room,
  kind,
  fileName,
  mimeType,
  durationSec = null,
  blob,
}) {
  const now = Date.now();
  const item = {
    id,
    dealId,
    userUid,
    scopeKey: makeScopeKey(dealId, userUid),
    authorRole,
    authorName: authorName || '',
    unitNumber: Number(unitNumber),
    room,
    kind,
    fileName: fileName || `${kind}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    mimeType: mimeType || blob.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    sizeBytes: blob.size,
    durationSec,
    blob,
    status: MEDIA_STATUS.PENDING,
    error: '',
    createdAt: now,
    updatedAt: now,
  };
  const db = await openDb();
  if (!db) {
    memStores.media_queue.set(id, item);
    return item;
  }
  const tx = db.transaction('media_queue', 'readwrite');
  tx.objectStore('media_queue').put(item);
  await txDone(tx);
  return item;
}

export async function updateMediaItem(id, patch) {
  const db = await openDb();
  if (!db) {
    const existing = memStores.media_queue.get(id);
    const updated = applySessionPatch(existing, patch);
    if (updated) memStores.media_queue.set(id, updated);
    return updated;
  }
  const tx = db.transaction('media_queue', 'readwrite');
  const store = tx.objectStore('media_queue');
  const existing = await idbReq(store.get(id));
  const updated = applySessionPatch(existing, patch);
  if (updated) store.put(updated);
  await txDone(tx);
  return updated;
}

export async function listMediaQueue(scopeKey) {
  const db = await openDb();
  const rows = !db
    ? [...memStores.media_queue.values()].filter((r) => r.scopeKey === scopeKey)
    : await (async () => {
        const tx = db.transaction('media_queue', 'readonly');
        return (await idbReq(tx.objectStore('media_queue').index('scopeKey').getAll(scopeKey))) || [];
      })();

  const recovered = [];
  for (const row of rows) {
    if (row.status === MEDIA_STATUS.UPLOADING) {
      const next = await updateMediaItem(row.id, {
        status: MEDIA_STATUS.FAILED,
        error: 'Upload was interrupted. Tap Retry upload.',
      });
      recovered.push(next || row);
    } else {
      recovered.push(row);
    }
  }
  return recovered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteMediaItem(id) {
  const db = await openDb();
  if (!db) {
    memStores.media_queue.delete(id);
    return;
  }
  const tx = db.transaction('media_queue', 'readwrite');
  tx.objectStore('media_queue').delete(id);
  await txDone(tx);
}
