import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveWalkShare, walkShareButtons } from '../lib/walkShare.js';
import { buyerTag } from '../lib/people.js';
import { supabase, BUCKET } from '../lib/supabase.js';
import { ROOMS, AREA_ROOMS, WALK_SPACES, WALK_UNITS, spaceLabel, roomsFor, roomFits, stepSpace, canMoveMedia, uploadCounts, v5Access, visibleNotes } from '../lib/leaseUp.js';
import { when, roleLabel } from '../lib/format.js';
import { MAX_RECORDING_MS, transcribeAudio } from '../lib/dictation.js';
import { assembleSessionAudio } from '../lib/audioStitch.js';
import { mediaCoordinator } from '../lib/mediaCoordinator.js';
import {
  AUDIO_STATUS,
  MEDIA_STATUS,
  appendAudioChunk,
  canReportVoiceNoteSynced,
  createAudioSession,
  deleteAudioSession,
  deleteMediaItem,
  enqueueMediaItem,
  getSessionSegments,
  isUsingMemoryFallback,
  listAudioSessions,
  listMediaQueue,
  makeScopeKey,
  moveMediaItem,
  requestPersistentStorage,
  updateAudioSession,
  updateMediaItem,
} from '../lib/walkthroughStore.js';
import { Button, Card, CardTitle, Empty, InfoTip } from '../components/Shell.jsx';
import WalkthroughCamera from '../components/WalkthroughCamera.jsx';
import MoveBar, { MoveOneDialog } from '../components/WalkMoveBar.jsx';
import PhotoViewer, { ThumbOverlay } from '../components/PhotoViewer.jsx';
import { processVideo } from '../lib/videoPost.js';
import { VideoExtras } from '../components/UnitGallery.jsx';
import { SITE_KIND, canAccessDealPlan } from '../lib/site.js';

const loadReadinessLib =
  import.meta.env.VITE_SITE_KIND === 'public' || import.meta.env.VITE_SITE_KIND === 'seller'
    ? null
    : () => Promise.all([import('../lib/readiness.js'), import('../components/ReadinessBadge.jsx')]);

const PHOTO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
const VIDEO_EXT = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const voiceExt = (type) =>
  type?.includes('wav') ? 'wav' : type?.includes('mp4') ? 'm4a' : type?.includes('ogg') ? 'ogg' : 'webm';
const storagePathFor = (dealId, uid, ext) =>
  `commercial-v5/${dealId}/walkthrough/${uid}/${crypto.randomUUID()}.${ext}`;
const roomLabel = (key) => [...ROOMS, ...AREA_ROOMS].find(([k]) => k === key)?.[1] || key;
const authorTag = (row) => {
  if (row.author_role === 'owner') return buyerTag();
  const role = roleLabel[row.author_role] || row.author_role;
  return row.author_name && row.author_name.toLowerCase() !== role.toLowerCase()
    ? `${row.author_name} (${role})`
    : role;
};
const fmtClock = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const fmtBytes = (bytes) => {
  const b = Math.max(0, bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const Tick = ({ on }) => (
  <span
    aria-hidden="true"
    className={`absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold ${
      on ? 'border-white bg-ink text-white' : 'border-white bg-black/30 text-transparent'
    }`}
  >
    ✓
  </span>
);

const PickRow = ({ on, onToggle }) => (
  <label className="flex min-h-[40px] items-center gap-2 text-sm font-medium">
    <input type="checkbox" className="h-5 w-5" checked={on} onChange={onToggle} />
    {on ? 'Selected to move' : 'Select to move'}
  </label>
);

function useSignedUrls(paths) {
  const [urls, setUrls] = useState({});
  const key = JSON.stringify(paths);
  useEffect(() => {
    let active = true;
    const list = JSON.parse(key);
    if (!list.length) {
      setUrls({});
      return;
    }
    const load = () =>
      supabase.storage
        .from(BUCKET)
        .createSignedUrls(list, 900)
        .then(({ data }) => {
          if (active) setUrls(Object.fromEntries((data || []).map((r) => [r.path, r.signedUrl])));
        });
    void load();
    const t = setInterval(load, 13 * 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [key]);
  return urls;
}

export default function Walkthrough({ deal, me, role, preview }) {
  const access = v5Access(role);
  const edit = access.editWalkthrough && !preview && Boolean(me?.uid);
  const scopeKey = edit ? makeScopeKey(deal.id, me.uid) : '';

  const units = WALK_UNITS;
  const [selectedUnit, setSelectedUnit] = useState(1);
  const [selectedRoom, setSelectedRoom] = useState(ROOMS[0][0]);
  const [showMatrix, setShowMatrix] = useState(false);

  const [photos, setPhotos] = useState(null);
  const [videos, setVideos] = useState(null);
  const [notes, setNotes] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  const [localSessions, setLocalSessions] = useState([]);
  const [localMedia, setLocalMedia] = useState([]);
  const [whisperPhases, setWhisperPhases] = useState({});
  const [localAudioUrls, setLocalAudioUrls] = useState({});
  const [cameraModal, setCameraModal] = useState(null); // { mode: 'photo' | 'video', unit, room, sharedStream }
  const [activeVoiceUi, setActiveVoiceUi] = useState(null); // { sessionId, unitNumber, room, elapsedMs, chunkCount, totalBytes }
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [openTranscripts, setOpenTranscripts] = useState({});
  const [retranscribingId, setRetranscribingId] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set()); // 'p:<id>' remote photo, 'v:<id>' remote video, 'l:<id>' on this device
  const [moving, setMoving] = useState(false);
  const [viewKey, setViewKey] = useState(null); // photo open in the in-app viewer: 'l:<id>' on this device, 'p:<id>' uploaded
  const [moveOne, setMoveOne] = useState(null); // one photo key ('l:' / 'p:') whose "Move to…" picker is open
  const [readinessState, setReadinessState] = useState({ lib: null, Badge: null, map: {} });
  const canReadiness = Boolean(loadReadinessLib && role === 'owner' && !preview && canAccessDealPlan(SITE_KIND, role, preview));

  const mountedRef = useRef(true);
  const inFlightRef = useRef(new Set());
  const chunkWriteQueueRef = useRef(Promise.resolve());
  const activeVoiceRef = useRef(null);
  const handoffStreamRef = useRef(null);
  const localSessionsRef = useRef([]);
  const localMediaRef = useRef([]);
  const mediaPreviewCacheRef = useRef(new Map());
  const audioPreviewCacheRef = useRef(new Map());

  localSessionsRef.current = localSessions;
  localMediaRef.current = localMedia;

  useEffect(() => {
    mountedRef.current = true;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      for (const entry of mediaPreviewCacheRef.current.values()) URL.revokeObjectURL(entry.url);
      mediaPreviewCacheRef.current.clear();
      for (const url of audioPreviewCacheRef.current.values()) URL.revokeObjectURL(url);
      audioPreviewCacheRef.current.clear();
      handoffStreamRef.current?.getTracks().forEach((t) => t.stop());
      handoffStreamRef.current = null;
    };
  }, []);

  // Load remote Supabase data.
  useEffect(() => {
    if (!access.walkthrough) return;
    let live = true;
    Promise.all([
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('commercial_walkthrough_photos').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
      supabase.from('commercial_walkthrough_videos').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
      supabase.from('commercial_walkthrough_notes').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
    ]).then(([m, p, v, n]) => {
      if (!live) return;
      
      setPhotos(p.data || []);
      setVideos(v.data || []);
      setNotes(visibleNotes(role, n.data));
      setLoadErr(p.error || v.error || n.error ? 'Walkthrough could not load. Refresh to try again.' : '');
    });
    return () => {
      live = false;
    };
  }, [deal.id, access.walkthrough, refresh, role]);

  // Load owner-only unit readiness badges.
  useEffect(() => {
    let live = true;
    if (!canReadiness || !loadReadinessLib) return () => { live = false; };
    loadReadinessLib().then(async ([lib, mod]) => {
      const map = await lib.loadReadinessMap(supabase, deal.id);
      if (live) setReadinessState({ lib, Badge: mod.default, map });
    }).catch(() => {});
    return () => { live = false; };
  }, [deal.id, canReadiness, refresh]);

  const updateReadiness = async (unitNumber, label) => {
    if (!canReadiness || !readinessState.lib || !me?.uid) return;
    const { data, error } = await readinessState.lib.saveUnitReadiness(supabase, {
      dealId: deal.id,
      unitNumber,
      label,
      existingRow: readinessState.map[unitNumber],
      uid: me.uid,
      name: me.name,
    });
    if (!error && data) {
      setReadinessState((prev) => ({ ...prev, map: { ...prev.map, [unitNumber]: data } }));
    }
  };

  // Load user-scoped local IndexedDB audio sessions and pending media queue.
  const reloadLocalState = useCallback(async () => {
    if (!scopeKey) {
      setLocalSessions([]);
      setLocalMedia([]);
      return;
    }
    const [sessions, queue] = await Promise.all([listAudioSessions(scopeKey), listMediaQueue(scopeKey)]);
    if (!mountedRef.current) return;
    setLocalSessions(sessions);
    setLocalMedia(queue);
  }, [scopeKey]);

  useEffect(() => {
    void reloadLocalState();
  }, [reloadLocalState]);

  // Maintain preview URLs for queued local photos & videos without leaking object URLs.
  const localMediaWithUrls = useMemo(() => {
    const seenIds = new Set();
    const out = localMedia.map((item) => {
      seenIds.add(item.id);
      const cached = mediaPreviewCacheRef.current.get(item.id);
      let previewUrl = cached?.url;
      if (!cached || cached.blob !== item.blob) {
        if (cached) URL.revokeObjectURL(cached.url);
        previewUrl = URL.createObjectURL(item.blob);
        mediaPreviewCacheRef.current.set(item.id, { blob: item.blob, url: previewUrl });
      }
      return { ...item, previewUrl };
    });
    for (const [id, entry] of mediaPreviewCacheRef.current.entries()) {
      if (!seenIds.has(id)) {
        URL.revokeObjectURL(entry.url);
        mediaPreviewCacheRef.current.delete(id);
      }
    }
    return out;
  }, [localMedia]);

  const unit = WALK_SPACES.includes(selectedUnit) ? selectedUnit : 1;
  useEffect(() => {
    if (!roomsFor(unit).some(([k]) => k === selectedRoom)) setSelectedRoom(roomsFor(unit)[0][0]);
  }, [unit, selectedRoom]);
  useEffect(() => {
    setPicked(new Set());
  }, [unit, selectedRoom]);

  // Hydrate playable <audio> URLs for paused/ready/failed sessions in the current room.
  const loadSessionAudioPreview = useCallback(async (sessionId) => {
    try {
      const { segmentBlobs, session } = await getSessionSegments(sessionId);
      if (!segmentBlobs.length) return;
      let playableBlob;
      try {
        const assembled = await assembleSessionAudio(segmentBlobs, session?.mimeType || 'audio/webm');
        playableBlob = assembled.blob;
      } catch {
        playableBlob = segmentBlobs[0];
      }
      const nextUrl = URL.createObjectURL(playableBlob);
      const prev = audioPreviewCacheRef.current.get(sessionId);
      if (prev) URL.revokeObjectURL(prev);
      audioPreviewCacheRef.current.set(sessionId, nextUrl);
      if (mountedRef.current) {
        setLocalAudioUrls((m) => ({ ...m, [sessionId]: nextUrl }));
      }
    } catch {}
  }, []);

  const roomLocalSessions = useMemo(
    () => localSessions.filter((s) => s.unitNumber === unit && s.room === selectedRoom),
    [localSessions, unit, selectedRoom]
  );

  useEffect(() => {
    for (const s of roomLocalSessions) {
      if (s.status !== AUDIO_STATUS.RECORDING && s.chunkCount > 0 && !localAudioUrls[s.id]) {
        void loadSessionAudioPreview(s.id);
      }
    }
  }, [roomLocalSessions, localAudioUrls, loadSessionAudioPreview]);

  const roomPhotos = useMemo(
    () => (photos || []).filter((x) => x.unit_number === unit && x.room === selectedRoom),
    [photos, unit, selectedRoom]
  );
  const roomVideos = useMemo(
    () => (videos || []).filter((x) => x.unit_number === unit && x.room === selectedRoom),
    [videos, unit, selectedRoom]
  );
  const roomNotes = useMemo(
    () => (notes || []).filter((x) => x.unit_number === unit && x.room === selectedRoom),
    [notes, unit, selectedRoom]
  );

  const roomPendingPhotos = useMemo(
    () => localMediaWithUrls.filter((x) => x.kind === 'photo' && x.unitNumber === unit && x.room === selectedRoom),
    [localMediaWithUrls, unit, selectedRoom]
  );
  const roomPendingVideos = useMemo(
    () => localMediaWithUrls.filter((x) => x.kind === 'video' && x.unitNumber === unit && x.room === selectedRoom),
    [localMediaWithUrls, unit, selectedRoom]
  );

  const signedPaths = useMemo(
    () => [
      ...roomPhotos.map((p) => p.storage_path),
      ...roomVideos.map((v) => v.storage_path),
      ...roomNotes.map((n) => n.storage_path).filter(Boolean),
    ],
    [roomPhotos, roomVideos, roomNotes]
  );
  const urls = useSignedUrls(signedPaths);

  const counts = useMemo(() => {
    const map = {};
    const add = (u, r, key) => {
      const k = `${u}:${r}`;
      map[k] = map[k] || { p: 0, v: 0, n: 0, pending: 0 };
      map[k][key]++;
    };
    for (const p of photos || []) add(p.unit_number, p.room, 'p');
    for (const v of videos || []) add(v.unit_number, v.room, 'v');
    for (const n of notes || []) add(n.unit_number, n.room, 'n');
    for (const q of localMedia) add(q.unitNumber, q.room, 'pending');
    for (const s of localSessions) add(s.unitNumber, s.room, 'pending');
    return map;
  }, [photos, videos, notes, localMedia, localSessions]);

  const unitTotals = useMemo(() => {
    const map = {};
    for (const u of WALK_SPACES) {
      let total = 0;
      let pending = 0;
      for (const [r] of roomsFor(u)) {
        const c = counts[`${u}:${r}`];
        if (c) {
          total += c.p + c.v + c.n;
          pending += c.pending;
        }
      }
      map[u] = { total, pending };
    }
    return map;
  }, [counts, units]);

  const totalPendingCount = localSessions.length + localMedia.length;
  const upload = { ...uploadCounts(localMedia, localSessions), online };

  // Warn before leaving the page while anything is still only on this phone.
  useEffect(() => {
    if (!edit || totalPendingCount === 0) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edit, totalPendingCount]);

  // Pause active voice recording cleanly while preserving every written chunk.
  const pauseActiveVoice = useCallback(
    async (reason = 'Paused — audio saved on device.', keepStreamForHandoff = false) => {
      const active = activeVoiceRef.current;
      if (!active) return null;
      activeVoiceRef.current = null;

      clearInterval(active.timer);
      clearTimeout(active.maxTimer);

      const { sessionId, recorder, stream, startedAt, elapsedBaseMs } = active;
      const durationMs = elapsedBaseMs + Math.max(0, Date.now() - startedAt);

      if (recorder && recorder.state === 'recording') {
        await new Promise((resolve) => {
          const prevOnStop = recorder.onstop;
          recorder.onstop = async (ev) => {
            try {
              await prevOnStop?.(ev);
            } finally {
              resolve();
            }
          };
          try {
            recorder.requestData?.();
          } catch {}
          try {
            recorder.stop();
          } catch {
            resolve();
          }
        });
      }

      await chunkWriteQueueRef.current;

      if (keepStreamForHandoff) {
        handoffStreamRef.current?.getTracks().forEach((t) => t.stop());
        handoffStreamRef.current = stream;
      } else {
        stream?.getTracks().forEach((t) => t.stop());
      }
      mediaCoordinator.release('walkthrough-voice');

      const updated = await updateAudioSession(sessionId, {
        status: AUDIO_STATUS.PAUSED,
        pauseReason: reason,
        durationMs,
      });
      if (mountedRef.current) {
        setActiveVoiceUi(null);
        setLocalSessions((prev) => prev.map((s) => (s.id === sessionId && updated ? updated : s)));
        void loadSessionAudioPreview(sessionId);
      }
      return keepStreamForHandoff ? stream : null;
    },
    [loadSessionAudioPreview]
  );

  // Stop voice recording when navigating away (SPA unmount) without losing chunks.
  useEffect(() => {
    return () => {
      const active = activeVoiceRef.current;
      if (!active) return;
      activeVoiceRef.current = null;
      clearInterval(active.timer);
      clearTimeout(active.maxTimer);
      try {
        if (active.recorder?.state === 'recording') {
          active.recorder.requestData?.();
          active.recorder.stop();
        }
      } catch {}
      active.stream?.getTracks().forEach((t) => t.stop());
      mediaCoordinator.release('walkthrough-voice');
      void chunkWriteQueueRef.current.then(() =>
        updateAudioSession(active.sessionId, {
          status: AUDIO_STATUS.PAUSED,
          pauseReason: 'Navigated away — audio preserved.',
          durationMs: active.elapsedBaseMs + Math.max(0, Date.now() - active.startedAt),
        })
      );
    };
  }, []);

  // Pause cleanly if app is backgrounded/locked on Android or iOS.
  useEffect(() => {
    const handleInterrupt = () => {
      if (document.visibilityState === 'hidden' && activeVoiceRef.current) {
        void pauseActiveVoice('App backgrounded or screen locked — audio preserved.');
      }
    };
    const handlePageHide = () => {
      if (activeVoiceRef.current) {
        void pauseActiveVoice('Page left — audio preserved.');
      }
    };
    document.addEventListener('visibilitychange', handleInterrupt);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleInterrupt);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [pauseActiveVoice]);

  const runWhisperOnSession = useCallback(
    async (sessionId, { overwriteExisting = false } = {}) => {
      const { session, segmentBlobs, totalBytes } = await getSessionSegments(sessionId);
      if (!session) return;
      if (!segmentBlobs.length || !totalBytes) {
        const failed = await updateAudioSession(sessionId, {
          status: AUDIO_STATUS.MODEL_FAILED,
          transcriptError: 'No audio chunks were recorded. Try recording again.',
        });
        if (mountedRef.current && failed) {
          setLocalSessions((prev) => prev.map((s) => (s.id === sessionId ? failed : s)));
        }
        return;
      }

      void loadSessionAudioPreview(sessionId);

      const transcribing = await updateAudioSession(sessionId, {
        status: AUDIO_STATUS.TRANSCRIBING,
        pauseReason: '',
        transcriptError: '',
      });
      if (mountedRef.current && transcribing) {
        setLocalSessions((prev) => prev.map((s) => (s.id === sessionId ? transcribing : s)));
        setWhisperPhases((m) => ({ ...m, [sessionId]: 'Loading local Whisper model…' }));
      }

      try {
        const res = await transcribeAudio(segmentBlobs, (phase) => {
          if (mountedRef.current) setWhisperPhases((m) => ({ ...m, [sessionId]: phase }));
        });
        const spoken = (res.text || '').trim();
        const latest = localSessionsRef.current.find((x) => x.id === sessionId) || session;
        if (!spoken) {
          const emptyFail = await updateAudioSession(sessionId, {
            status: AUDIO_STATUS.MODEL_FAILED,
            transcriptError: 'No speech detected. Original audio is safe — type notes, Retry Whisper, or save audio backup.',
          });
          if (mountedRef.current && emptyFail) {
            setLocalSessions((prev) => prev.map((s) => (s.id === sessionId ? emptyFail : s)));
          }
          return;
        }
        const existingText = overwriteExisting ? '' : (latest.rawTranscript || '').trim();
        const combined = existingText ? `${existingText} ${spoken}` : spoken;
        const ready = await updateAudioSession(sessionId, {
          status: AUDIO_STATUS.READY,
          rawTranscript: combined,
          transcriptError: '',
          syncError: '',
        });
        if (mountedRef.current && ready) {
          setLocalSessions((prev) => prev.map((s) => (s.id === sessionId ? ready : s)));
        }
      } catch (err) {
        const failed = await updateAudioSession(sessionId, {
          status: AUDIO_STATUS.MODEL_FAILED,
          transcriptError:
            err?.message || 'Local Whisper could not finish. Original audio is safe — tap Retry Whisper.',
        });
        if (mountedRef.current && failed) {
          setLocalSessions((prev) => prev.map((s) => (s.id === sessionId ? failed : s)));
        }
      } finally {
        if (mountedRef.current) {
          setWhisperPhases((m) => {
            const copy = { ...m };
            delete copy[sessionId];
            return copy;
          });
        }
      }
    },
    [loadSessionAudioPreview]
  );

  const startVoiceSession = async (resumeSession = null) => {
    if (!edit || activeVoiceRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Microphone recording is unavailable in this browser.');
      return;
    }

    const targetUnit = resumeSession ? resumeSession.unitNumber : unit;
    const targetRoom = resumeSession ? resumeSession.room : selectedRoom;

    const lock = mediaCoordinator.acquire('walkthrough-voice', {
      unit: targetUnit,
      room: targetRoom,
      onPauseRequest: () => pauseActiveVoice('Paused for video recording — audio saved.', true),
    });
    if (!lock.ok) {
      setStatus(lock.message);
      return;
    }

    setStatus('');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      mediaCoordinator.release('walkthrough-voice');
      setStatus('Could not access microphone. Check browser permission.');
      return;
    }

    void requestPersistentStorage();

    const codec = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(
      (x) => MediaRecorder.isTypeSupported?.(x)
    );

    let session = resumeSession;
    if (!session) {
      session = await createAudioSession({
        dealId: deal.id,
        userUid: me.uid,
        authorRole: role,
        authorName: me.name || roleLabel[role],
        unitNumber: targetUnit,
        room: targetRoom,
        mimeType: (codec || 'audio/webm').split(';')[0],
      });
      if (mountedRef.current) {
        setLocalSessions((prev) => [session, ...prev]);
      }
    } else {
      session = await updateAudioSession(session.id, {
        status: AUDIO_STATUS.RECORDING,
        pauseReason: '',
        transcriptError: '',
        syncError: '',
      });
      if (mountedRef.current && session) {
        setLocalSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
      }
    }

    const segmentIndex = session.nextSegmentIndex || 0;
    let seq = 0;
    const recorder = new MediaRecorder(stream, codec ? { mimeType: codec } : undefined);
    const startedAt = Date.now();
    const elapsedBaseMs = session.durationMs || 0;

    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const chunkBlob = e.data;
      const chunkSeq = seq++;
      chunkWriteQueueRef.current = chunkWriteQueueRef.current
        .then(() => appendAudioChunk(session.id, segmentIndex, chunkSeq, chunkBlob))
        .then((saved) => {
          if (!saved || !mountedRef.current) return;
          setLocalSessions((prev) =>
            prev.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    chunkCount: (s.chunkCount || 0) + 1,
                    totalBytes: (s.totalBytes || 0) + chunkBlob.size,
                    nextSegmentIndex: Math.max(s.nextSegmentIndex || 0, segmentIndex + 1),
                    updatedAt: Date.now(),
                  }
                : s
            )
          );
          if (activeVoiceRef.current?.sessionId === session.id) {
            setActiveVoiceUi((ui) =>
              ui
                ? {
                    ...ui,
                    chunkCount: ui.chunkCount + 1,
                    totalBytes: ui.totalBytes + chunkBlob.size,
                  }
                : ui
            );
          }
        })
        .catch(() => {});
    };

    recorder.onerror = () => {
      if (activeVoiceRef.current?.sessionId === session.id) {
        void pauseActiveVoice('Microphone interrupted — saved all captured audio.');
      }
    };

    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (activeVoiceRef.current?.sessionId === session.id) {
          void pauseActiveVoice('Microphone disconnected or interrupted — saved all captured audio.');
        }
      };
    }

    const timer = setInterval(() => {
      if (!mountedRef.current || activeVoiceRef.current?.sessionId !== session.id) return;
      setActiveVoiceUi((ui) =>
        ui ? { ...ui, elapsedMs: elapsedBaseMs + Math.max(0, Date.now() - startedAt) } : ui
      );
    }, 500);

    const maxTimer = setTimeout(() => {
      if (activeVoiceRef.current?.sessionId === session.id) {
        void pauseActiveVoice('30-minute segment saved — tap Resume to keep narrating.');
      }
    }, MAX_RECORDING_MS);

    activeVoiceRef.current = {
      sessionId: session.id,
      unitNumber: targetUnit,
      room: targetRoom,
      recorder,
      stream,
      startedAt,
      elapsedBaseMs,
      timer,
      maxTimer,
    };

    setActiveVoiceUi({
      sessionId: session.id,
      unitNumber: targetUnit,
      room: targetRoom,
      elapsedMs: elapsedBaseMs,
      chunkCount: session.chunkCount || 0,
      totalBytes: session.totalBytes || 0,
    });

    recorder.start(1000);
  };

  const stopAndTranscribeActiveVoice = async () => {
    const active = activeVoiceRef.current;
    if (!active) return;
    const targetSessionId = active.sessionId;
    await pauseActiveVoice('Processing with local Whisper…', false);
    await Promise.race([
      runWhisperOnSession(targetSessionId),
      new Promise((r) => setTimeout(r, 90000)),
    ]);
    // Always push to the server: transcript if Whisper worked, audio backup if not.
    try {
      const { session: latest } = await getSessionSegments(targetSessionId);
      if (latest && navigator.onLine) {
        const hasText = !!(latest.rawTranscript || '').trim();
        await syncVoiceSession(latest, !hasText);
      }
    } catch {}
  };

  const syncVoiceSession = async (session, allowAudioOnlyBackup = false) => {
    if (!edit || !session) return;
    const transcriptText = (session.rawTranscript || '').trim();
    if (!transcriptText && !allowAudioOnlyBackup) {
      setStatus('Transcribe or type a note before saving, or choose Save audio backup.');
      return;
    }
    if (!navigator.onLine) {
      const off = await updateAudioSession(session.id, {
        status: AUDIO_STATUS.SYNC_FAILED,
        syncError: 'Offline — original audio and draft stay safe on this device.',
      });
      if (mountedRef.current && off) {
        setLocalSessions((prev) => prev.map((s) => (s.id === session.id ? off : s)));
      }
      setStatus('Offline. Original audio stays saved locally until connection returns.');
      return false;
    }

    let uploadedPath = null;
    try {
      const { segmentBlobs } = await getSessionSegments(session.id);
      if (!segmentBlobs.length) {
        throw new Error('Original audio chunks are missing.');
      }
      const assembled = await assembleSessionAudio(segmentBlobs, session.mimeType || 'audio/webm');
      if (!assembled.blob || !assembled.blob.size) {
        throw new Error('Original audio could not be assembled.');
      }
      if (assembled.blob.size > MAX_VIDEO_BYTES) {
        throw new Error('Audio recording exceeds 50 MB limit.');
      }

      const ext = voiceExt(assembled.mimeType);
      const candidatePath = storagePathFor(deal.id, me.uid, ext);
      const up = await supabase.storage.from(BUCKET).upload(candidatePath, assembled.blob, {
        contentType: assembled.mimeType,
      });
      if (up.error) {
        throw new Error('Could not upload original audio to private storage.');
      }
      uploadedPath = candidatePath;

      const durationSec =
        assembled.durationSec || Math.max(1, Math.round((session.durationMs || 1000) / 1000));

      const { data: inserted, error: insErr } = await supabase
        .from('commercial_walkthrough_notes')
        .insert({
          deal_id: deal.id,
          unit_number: session.unitNumber,
          room: session.room,
          raw_transcript: transcriptText,
          transcript_status: transcriptText ? 'ready' : 'failed',
          storage_path: uploadedPath,
          audio_mime: assembled.mimeType,
          audio_size_bytes: assembled.blob.size,
          duration_sec: durationSec,
          client_id: session.id,
          author_uid: me.uid,
          author_role: role,
          author_name: session.authorName || me.name || roleLabel[role],
        })
        .select('*')
        .single();

      if (insErr) {
        await supabase.storage.from(BUCKET).remove([uploadedPath]).catch(() => {});
        throw new Error(insErr.message || 'Voice note record could not save.');
      }

      if (!canReportVoiceNoteSynced({ remoteId: inserted?.id, remoteStoragePath: inserted?.storage_path })) {
        throw new Error('Original audio path did not verify after upload.');
      }

      await deleteAudioSession(session.id);
      const cachedUrl = audioPreviewCacheRef.current.get(session.id);
      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
        audioPreviewCacheRef.current.delete(session.id);
      }
      if (mountedRef.current) {
        setLocalSessions((prev) => prev.filter((s) => s.id !== session.id));
        setRefresh((r) => r + 1);
        setStatus(`Voice note + original audio saved to ${spaceLabel(session.unitNumber)} ${roomLabel(session.room)}.`);
      }
      return true;
    } catch (err) {
      const msg = err?.message || 'Could not sync voice note. Audio remains safe on this device.';
      const failed = await updateAudioSession(session.id, {
        status: AUDIO_STATUS.SYNC_FAILED,
        syncError: msg,
      });
      if (mountedRef.current && failed) {
        setLocalSessions((prev) => prev.map((s) => (s.id === session.id ? failed : s)));
        setStatus(msg);
      }
      return false;
    }
  };

  const syncMediaItem = useCallback(
    async (item) => {
      if (!edit || !item) return false;
      // One upload per item at a time: auto-sync, camera close and Sync all can overlap.
      if (inFlightRef.current.has(item.id)) return false;
      inFlightRef.current.add(item.id);
      try {
        return await syncMediaItemOnce(item);
      } finally {
        inFlightRef.current.delete(item.id);
      }
    },
    [deal.id, edit, me.name, me.uid, role] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const syncMediaItemOnce = useCallback(
    async (item) => {
      if (!navigator.onLine) {
        const off = await updateMediaItem(item.id, {
          status: MEDIA_STATUS.FAILED,
          error: 'Offline — kept on device until connection returns.',
        });
        if (mountedRef.current && off) {
          setLocalMedia((prev) => prev.map((m) => (m.id === item.id ? off : m)));
        }
        return false;
      }

      const uploading = await updateMediaItem(item.id, { status: MEDIA_STATUS.UPLOADING, error: '' });
      if (!uploading) {
        // Already uploaded (or removed) by another pass: never upload a stale copy twice.
        if (mountedRef.current) setLocalMedia((prev) => prev.filter((m) => m.id !== item.id));
        return false;
      }
      if (mountedRef.current) {
        setLocalMedia((prev) => prev.map((m) => (m.id === item.id ? uploading : m)));
      }
      // Use the stored copy: it carries any move made after this item was queued.
      item = uploading;

      const ext =
        item.kind === 'video'
          ? VIDEO_EXT[item.mimeType] || item.fileName.split('.').pop()?.toLowerCase() || 'mp4'
          : PHOTO_EXT[item.mimeType] || item.fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
      const path = storagePathFor(deal.id, me.uid, normalizedExt);

      const up = await supabase.storage.from(BUCKET).upload(path, item.blob, {
        contentType: item.mimeType,
      });
      if (up.error) {
        const failed = await updateMediaItem(item.id, {
          status: MEDIA_STATUS.FAILED,
          error: `Upload failed (${up.error.message || 'network'}). Kept locally for retry.`,
        });
        if (mountedRef.current && failed) {
          setLocalMedia((prev) => prev.map((m) => (m.id === item.id ? failed : m)));
        }
        return false;
      }

      const table = item.kind === 'video' ? 'commercial_walkthrough_videos' : 'commercial_walkthrough_photos';
      const row =
        item.kind === 'video'
          ? {
              deal_id: deal.id,
              unit_number: item.unitNumber,
              room: item.room,
              storage_path: path,
              mime: item.mimeType,
              size_bytes: item.sizeBytes,
              duration_sec: item.durationSec,
              author_uid: me.uid,
              author_role: role,
              author_name: item.authorName || me.name || roleLabel[role],
            }
          : {
              deal_id: deal.id,
              unit_number: item.unitNumber,
              room: item.room,
              storage_path: path,
              author_uid: me.uid,
              author_role: role,
              author_name: item.authorName || me.name || roleLabel[role],
            };

      const ins = await supabase.from(table).insert(row).select('id').maybeSingle();
      if (ins.error) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        const failed = await updateMediaItem(item.id, {
          status: MEDIA_STATUS.FAILED,
          error: 'Could not save media record. Kept locally for retry.',
        });
        if (mountedRef.current && failed) {
          setLocalMedia((prev) => prev.map((m) => (m.id === item.id ? failed : m)));
        }
        return false;
      }

      // Keep the clip in memory for the after-save steps (frames + transcript) before the phone copy is cleared.
      const savedBlob = item.blob;
      await deleteMediaItem(item.id);
      if (mountedRef.current) {
        setLocalMedia((prev) => prev.filter((m) => m.id !== item.id));
        setRefresh((r) => r + 1);
      }
      if (item.kind === 'video' && ins.data?.id) void afterVideoSaved(ins.data.id, savedBlob);
      return true;
    },
    [deal.id, edit, me.name, me.uid, role]
  );

  // After a video saves: three small still frames and a transcript, made on this device, stored on the video row.
  async function afterVideoSaved(videoId, blob) {
    const table = supabase.from('commercial_walkthrough_videos');
    await table.update({ transcript_status: 'pending' }).eq('id', videoId).eq('deal_id', deal.id);
    try {
      await processVideo(blob, {
        uploadFrame: async (jpg) => {
          const p = storagePathFor(deal.id, me.uid, 'jpg');
          const up = await supabase.storage.from(BUCKET).upload(p, jpg, { contentType: 'image/jpeg' });
          return up.error ? null : p;
        },
        transcribe: async (b) => (await transcribeAudio(b)).text,
        save: (result) => supabase.from('commercial_walkthrough_videos').update(result).eq('id', videoId).eq('deal_id', deal.id),
      });
    } catch {
      await supabase.from('commercial_walkthrough_videos').update({ transcript_status: 'failed' }).eq('id', videoId).eq('deal_id', deal.id);
    }
    if (mountedRef.current) setRefresh((r) => r + 1);
  }

  const enqueueAndMaybeSyncFiles = async (files, kind, targetUnit = unit, targetRoom = selectedRoom) => {
    if (!edit || !files.length) return;
    setStatus('');
    let queued = 0;
    let synced = 0;
    const errs = [];

    for (const f of files) {
      const extFromName = (f.name || '').split('.').pop()?.toLowerCase();
      if (kind === 'photo') {
        const ext = PHOTO_EXT[f.type] || (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(extFromName) ? extFromName : null);
        if (!ext || !f.size || f.size > MAX_PHOTO_BYTES) {
          errs.push('Photos must be JPEG, PNG, WebP or HEIC under 20 MB.');
          continue;
        }
        const item = await enqueueMediaItem({
          dealId: deal.id,
          userUid: me.uid,
          authorRole: role,
          authorName: me.name || roleLabel[role],
          unitNumber: targetUnit,
          room: targetRoom,
          kind: 'photo',
          fileName: f.name || `photo.${ext}`,
          mimeType: f.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          blob: f,
        });
        queued++;
        if (mountedRef.current) setLocalMedia((prev) => [item, ...prev]);
        if (await syncMediaItem(item)) synced++;
      } else {
        const ext = VIDEO_EXT[f.type] || (['mp4', 'webm', 'mov', 'm4v'].includes(extFromName) ? extFromName : null);
        if (!ext || !f.size || f.size > MAX_VIDEO_BYTES) {
          errs.push('Videos must be MP4, WebM or MOV under 50 MB.');
          continue;
        }
        const item = await enqueueMediaItem({
          dealId: deal.id,
          userUid: me.uid,
          authorRole: role,
          authorName: me.name || roleLabel[role],
          unitNumber: targetUnit,
          room: targetRoom,
          kind: 'video',
          fileName: f.name || `video.${ext}`,
          mimeType: f.type || (ext === 'mov' ? 'video/quicktime' : `video/${ext}`),
          blob: f,
        });
        queued++;
        if (mountedRef.current) setLocalMedia((prev) => [item, ...prev]);
        if (await syncMediaItem(item)) synced++;
      }
    }

    const parts = [];
    if (synced > 0) parts.push(`${synced} ${kind}${synced === 1 ? '' : 's'} saved.`);
    if (queued > synced) parts.push(`${queued - synced} kept on device for retry.`);
    if (errs.length) parts.push(...new Set(errs));
    if (mountedRef.current && parts.length) setStatus(parts.join(' '));
  };

  const openMultiPhotoCamera = () => {
    if (!edit || !mediaCoordinator.canRunPhotoCamera()) return;
    setCameraModal({ mode: 'photo', unit, room: selectedRoom, sharedStream: null });
  };

  // Change where the next shot saves without leaving the camera; the page follows along.
  const setCameraTarget = (nextUnit, nextRoom) => {
    const r = roomFits(nextUnit, nextRoom) ? nextRoom : roomsFor(nextUnit)[0][0];
    setCameraModal((m) => (m ? { ...m, unit: nextUnit, room: r } : m));
    setSelectedUnit(nextUnit);
    setSelectedRoom(r);
  };

  const switchCameraMode = async (mode) => {
    if (!cameraModal || cameraModal.mode === mode) return;
    if (mode === 'video') {
      const handoff = await mediaCoordinator.prepareVideoHandoff();
      setCameraModal((m) => (m ? { ...m, mode: 'video', sharedStream: handoff.stream } : m));
    } else {
      handoffStreamRef.current?.getTracks().forEach((t) => t.stop());
      handoffStreamRef.current = null;
      setCameraModal((m) => (m ? { ...m, mode: 'photo', sharedStream: null } : m));
    }
  };

  // On close, push everything still on the phone (every room shot this session), never drop it.
  const closeCamera = async () => {
    handoffStreamRef.current?.getTracks().forEach((t) => t.stop());
    handoffStreamRef.current = null;
    setCameraModal(null);
    const waiting = localMediaRef.current.filter((m) => m.status !== MEDIA_STATUS.UPLOADING);
    if (!waiting.length) return;
    if (!navigator.onLine) {
      setStatus(`${waiting.length} item${waiting.length === 1 ? '' : 's'} kept on this phone until you are back online.`);
      return;
    }
    let saved = 0;
    for (const item of [...waiting].reverse()) {
      if (await syncMediaItem(item)) saved++;
    }
    if (mountedRef.current) {
      const left = localMediaRef.current.length;
      setStatus(left === 0 ? '' : `${saved} uploaded, ${left} still waiting. They retry every 15 seconds.`);
    }
  };

  const openVideoRecorder = async () => {
    if (!edit) return;
    const handoff = await mediaCoordinator.prepareVideoHandoff();
    setCameraModal({ mode: 'video', unit, room: selectedRoom, sharedStream: handoff.stream });
  };

  const handleVideoRecorded = async (blob, meta) => {
    const targetUnit = cameraModal?.unit || unit;
    const targetRoom = cameraModal?.room || selectedRoom;
    const item = await enqueueMediaItem({
      dealId: deal.id,
      userUid: me.uid,
      authorRole: role,
      authorName: me.name || roleLabel[role],
      unitNumber: targetUnit,
      room: targetRoom,
      kind: 'video',
      fileName: meta.fileName || 'walkthrough.webm',
      mimeType: meta.mimeType || blob.type || 'video/webm',
      durationSec: meta.durationSec,
      blob,
    });
    if (mountedRef.current) setLocalMedia((prev) => [item, ...prev]);
    const ok = await syncMediaItem(item);
    if (mountedRef.current) {
      setStatus(ok ? 'Video saved.' : 'Video saved on device. Tap Retry upload when ready.');
    }
  };

  const autoSyncRef = useRef(false);
  useEffect(() => {
    if (!edit) return undefined;
    const tick = async () => {
      if (!navigator.onLine || autoSyncRef.current || activeVoiceRef.current) return;
      const media = localMediaRef.current.filter((m) => m.status !== MEDIA_STATUS.UPLOADING);
      const notes = localSessionsRef.current.filter(
        (x) => x.status === AUDIO_STATUS.READY || (x.status === AUDIO_STATUS.SYNC_FAILED && x.rawTranscript?.trim())
      );
      if (!media.length && !notes.length) return;
      autoSyncRef.current = true;
      try {
        for (const m of [...media].reverse()) await syncMediaItem(m);
        for (const x of [...notes].reverse()) await syncVoiceSession(x);
      } catch {
        // items stay on device; next tick retries
      } finally {
        autoSyncRef.current = false;
      }
    };
    const t = setInterval(() => void tick(), 15000);
    const onOn = () => void tick();
    window.addEventListener('online', onOn);
    void tick();
    return () => {
      clearInterval(t);
      window.removeEventListener('online', onOn);
    };
  }, [edit, syncMediaItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncAllPending = async () => {
    if (!edit || syncingAll || !navigator.onLine) return;
    setSyncingAll(true);
    setStatus('');
    let syncedMedia = 0;
    let syncedNotes = 0;
    try {
      for (const item of [...localMediaRef.current].reverse()) {
        if (await syncMediaItem(item)) syncedMedia++;
      }
      for (const s of [...localSessionsRef.current].reverse()) {
        if (s.status === AUDIO_STATUS.READY || (s.status === AUDIO_STATUS.SYNC_FAILED && s.rawTranscript?.trim())) {
          if (await syncVoiceSession(s)) syncedNotes++;
        }
      }
      if (mountedRef.current) {
        setStatus(`Synced ${syncedMedia} media file${syncedMedia === 1 ? '' : 's'} and ${syncedNotes} voice note${syncedNotes === 1 ? '' : 's'}.`);
      }
    } finally {
      if (mountedRef.current) setSyncingAll(false);
    }
  };

  // Owner only: show this photo or video on the seller's or lender's page. Off by default.
  const toggleShare = async (p, field, kind = 'photo') => {
    if (role !== 'owner' || preview || busy) return;
    const next = !p[field];
    const setRows = kind === 'video' ? setVideos : setPhotos;
    setRows((rows) => (rows || []).map((x) => (x.id === p.id ? { ...x, [field]: next } : x)));
    const error = await saveWalkShare(supabase, deal.id, p, field, next, kind);
    if (error) {
      setRows((rows) => (rows || []).map((x) => (x.id === p.id ? { ...x, [field]: !next } : x)));
      setStatus('Sharing did not save. Try again.');
    }
  };

  // Batch move: pick photos and videos in this room, send them to another unit/space and room.
  const movableKeys = useMemo(() => {
    if (!edit) return [];
    return [
      ...localMediaWithUrls
        .filter((m) => m.unitNumber === unit && m.room === selectedRoom && m.status !== MEDIA_STATUS.UPLOADING)
        .map((m) => `l:${m.id}`),
      ...roomPhotos.filter((p) => canMoveMedia(role, p, me?.uid)).map((p) => `p:${p.id}`),
      ...roomVideos.filter((v) => canMoveMedia(role, v, me?.uid)).map((v) => `v:${v.id}`),
    ];
  }, [edit, localMediaWithUrls, unit, selectedRoom, roomPhotos, roomVideos, role, me?.uid]);
  const movable = useMemo(() => new Set(movableKeys), [movableKeys]);

  const togglePick = (k) => {
    if (!movable.has(k)) return;
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  // In-app photo viewer: this room's photos in the order shown (on this device first, then uploaded).
  const viewerPhotos = [
    ...roomPendingPhotos.filter((m) => m.previewUrl).map((m) => ({ key: `l:${m.id}`, url: m.previewUrl, alt: `Pending ${m.fileName}` })),
    ...roomPhotos.filter((p) => urls[p.storage_path]).map((p) => ({ key: `p:${p.id}`, url: urls[p.storage_path], alt: `${spaceLabel(unit)} ${roomLabel(selectedRoom)} photo` })),
  ];
  const viewIndex = viewKey ? viewerPhotos.findIndex((x) => x.key === viewKey) : -1;

  // only: move just these keys (one photo's "Move to…"), keeping the rest of the batch selection as it was.
  const moveSelected = async (toUnit, toRoom, only) => {
    if (!edit || moving || !roomFits(toUnit, toRoom) || (only ? only.length : picked.size) === 0) return;
    const keys = (only || [...picked]).filter((k) => movable.has(k));
    const ids = (prefix) => keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(2));
    setMoving(true);
    setStatus('');
    let moved = 0;
    let skipped = 0;
    try {
      for (const id of ids('l:')) {
        const m = await moveMediaItem(id, toUnit, toRoom);
        if (m) {
          moved++;
          if (mountedRef.current) setLocalMedia((prev) => prev.map((x) => (x.id === id ? m : x)));
        } else skipped++;
      }
      for (const [prefix, table] of [['p:', 'commercial_walkthrough_photos'], ['v:', 'commercial_walkthrough_videos']]) {
        const list = ids(prefix);
        for (let i = 0; i < list.length; i += 100) {
          const chunk = list.slice(i, i + 100);
          const { data, error } = await supabase
            .from(table)
            .update({ unit_number: toUnit, room: toRoom })
            .in('id', chunk)
            .eq('deal_id', deal.id)
            .select('id');
          const n = error ? 0 : (data || []).length;
          moved += n;
          skipped += chunk.length - n;
        }
      }
    } catch {
      // whatever did not move stays where it was
    } finally {
      if (mountedRef.current) {
        setMoving(false);
        if (only) {
          setPicked((prev) => new Set([...prev].filter((k) => !only.includes(k))));
        } else {
          setPicked(new Set());
          setSelecting(false);
        }
        setStatus(
          `${moved} moved to ${spaceLabel(toUnit)} — ${roomLabel(toRoom)}.` +
            (skipped ? ` ${skipped} did not move; try those again.` : '')
        );
        setRefresh((r) => r + 1);
      }
    }
  };

  // "Move to…" on one photo. If it was open in the viewer, the viewer moves on to the next photo, or closes if none.
  const moveOnePhoto = async (toUnit, toRoom) => {
    const k = moveOne;
    if (!k) return;
    const viewing = viewKey === k;
    const i = viewerPhotos.findIndex((x) => x.key === k);
    const nextKey = i >= 0 ? viewerPhotos[i + 1]?.key ?? null : null;
    await moveSelected(toUnit, toRoom, [k]);
    if (!mountedRef.current) return;
    setMoveOne(null);
    if (viewing) setViewKey(nextKey);
  };

  // "Select" on one photo: adds it to (or removes it from) the batch-move selection, starting select mode if needed.
  const selectOne = (k) => {
    if (!movable.has(k)) return;
    if (!selecting) {
      setSelecting(true);
      setPicked(new Set([k]));
    } else togglePick(k);
  };

  // Actions for one photo, shown on its thumbnail overlay and in the viewer's bottom bar. Only what this role can do.
  const photoButtons = (k, row, withOpen) => {
    const list = [];
    if (withOpen) list.push({ key: 'open', icon: '⤢', label: 'Open', onClick: () => setViewKey(k) });
    if (movable.has(k)) {
      list.push({ key: 'move', icon: '⇄', label: 'Move this one', disabled: moving, onClick: () => setMoveOne(k) });
      list.push({ key: 'select', icon: '✓', label: 'Select', pressed: picked.has(k), onClick: () => selectOne(k) });
    }
    if (row && role === 'owner' && !preview) {
      list.push(...walkShareButtons(row, toggleShare, busy));
    }
    return list;
  };
  const viewerActions = (item) => photoButtons(item.key, roomPhotos.find((p) => `p:${p.id}` === item.key) || null, false);

  const removeRemotePhoto = async (p) => {
    if (!edit || busy || !window.confirm('Remove this photo?')) return;
    setBusy(true);
    setStatus('');
    try {
      await supabase.storage.from(BUCKET).remove([p.storage_path]);
      const { error } = await supabase.from('commercial_walkthrough_photos').delete().eq('id', p.id).eq('deal_id', deal.id);
      setStatus(error ? 'Photo could not be removed.' : 'Photo removed.');
    } catch {
      setStatus('Photo could not be removed.');
    } finally {
      setBusy(false);
      setRefresh((x) => x + 1);
    }
  };

  const removeRemoteVideo = async (v) => {
    if (!edit || busy || !window.confirm('Remove this video?')) return;
    setBusy(true);
    setStatus('');
    try {
      await supabase.storage.from(BUCKET).remove([v.storage_path]);
      const { error } = await supabase.from('commercial_walkthrough_videos').delete().eq('id', v.id).eq('deal_id', deal.id);
      setStatus(error ? 'Video could not be removed.' : 'Video removed.');
    } catch {
      setStatus('Video could not be removed.');
    } finally {
      setBusy(false);
      setRefresh((x) => x + 1);
    }
  };

  const removeRemoteNote = async (n) => {
    if (!edit || busy || !window.confirm('Remove this voice note?')) return;
    setBusy(true);
    setStatus('');
    try {
      if (n.storage_path) await supabase.storage.from(BUCKET).remove([n.storage_path]);
      const { error } = await supabase.from('commercial_walkthrough_notes').delete().eq('id', n.id).eq('deal_id', deal.id);
      setStatus(error ? 'Voice note could not be removed.' : 'Voice note removed.');
    } catch {
      setStatus('Voice note could not be removed.');
    } finally {
      setBusy(false);
      setRefresh((x) => x + 1);
    }
  };

  const saveEditedRemoteNote = async (n) => {
    if (!edit || busy) return;
    const text = editingNoteText.trim();
    if (!text && !n.storage_path) {
      setStatus('Transcript cannot be empty without stored audio.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from('commercial_walkthrough_notes')
        .update({ raw_transcript: text, transcript_status: text ? 'ready' : 'failed' })
        .eq('id', n.id)
        .eq('deal_id', deal.id);
      if (error) setStatus('Could not update transcript.');
      else {
        setEditingNoteId(null);
        setStatus('Transcript updated.');
        setRefresh((x) => x + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const retranscribeRemoteNote = async (n) => {
    if (!edit || !n.storage_path || !urls[n.storage_path] || retranscribingId) return;
    setRetranscribingId(n.id);
    setStatus('Downloading audio for local Whisper retranscribe…');
    try {
      const resp = await fetch(urls[n.storage_path]);
      if (!resp.ok) throw new Error('Audio download failed.');
      const blob = await resp.blob();
      const res = await transcribeAudio(blob, (phase) => {
        if (mountedRef.current) setStatus(phase);
      });
      const text = (res.text || '').trim();
      if (!text) throw new Error('No speech detected.');
      const { error } = await supabase
        .from('commercial_walkthrough_notes')
        .update({ raw_transcript: text, transcript_status: 'ready' })
        .eq('id', n.id)
        .eq('deal_id', deal.id);
      if (error) throw new Error('Could not save retranscribed text.');
      setStatus('Transcript refreshed with local Whisper.');
      setRefresh((x) => x + 1);
    } catch (e) {
      setStatus(e?.message || 'Retranscribe failed. Original audio is still intact.');
    } finally {
      if (mountedRef.current) setRetranscribingId(null);
    }
  };

  if (!access.walkthrough) return null;

  const cameraCapturedPhotos = cameraModal?.mode === 'photo'
    ? localMediaWithUrls.filter(
        (m) => m.kind === 'photo' && m.unitNumber === cameraModal.unit && m.room === cameraModal.room
      )
    : [];

  const matrixTable = (
    <div className="overflow-x-auto max-w-full">
      <table className="w-full min-w-[560px] border-separate border-spacing-1 text-left text-xs">
        <thead>
          <tr>
            <th className="w-16 px-2 py-1 font-medium text-ink-soft">Unit</th>
            {ROOMS.map(([r, label]) => (
              <th key={r} className="px-2 py-1 font-medium text-ink-soft">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WALK_SPACES.map((u) => (
            <tr key={u}>
              <th scope="row" className="px-2 py-1 font-semibold text-ink">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{spaceLabel(u)}</span>
                  {readinessState.Badge && u <= WALK_UNITS && readinessState.map[u]?.body && (
                    <readinessState.Badge unitNumber={u} label={readinessState.map[u].body} compact />
                  )}
                </div>
              </th>
              {roomsFor(u).map(([r, label]) => {
                const c = counts[`${u}:${r}`] || { p: 0, v: 0, n: 0, pending: 0 };
                const active = u === unit && r === selectedRoom;
                const empty = c.p === 0 && c.v === 0 && c.n === 0 && c.pending === 0;
                return (
                  <td key={r} colSpan={u > WALK_UNITS ? ROOMS.length : undefined}>
                    <button
                      type="button"
                      aria-label={`${spaceLabel(u)} ${label}: ${c.p} photos, ${c.v} videos, ${c.n} voice notes`}
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedUnit(u);
                        setSelectedRoom(r);
                        setStatus('');
                      }}
                      className={`min-h-[40px] w-full rounded-lg border px-2 py-1.5 text-center transition ${
                        active
                          ? 'border-ink bg-ink font-medium text-white'
                          : empty
                            ? 'border-dashed border-line bg-paper text-ink-soft hover:border-ink'
                            : 'border-line bg-warm-soft/70 font-medium text-ink hover:border-ink'
                      }`}
                    >
                      {empty ? '—' : `${c.p}p${c.v ? ` · ${c.v}v` : ''} · ${c.n}n${c.pending ? ` (+${c.pending})` : ''}`}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={`space-y-4 ${selecting ? 'pb-44' : ''}`}>
      {selecting && !cameraModal && (
        <MoveBar
          count={picked.size}
          total={movableKeys.length}
          fromUnit={unit}
          fromRoom={selectedRoom}
          busy={moving}
          onSelectAll={() => setPicked(new Set(movableKeys))}
          onClear={() => setPicked(new Set())}
          onCancel={() => {
            setSelecting(false);
            setPicked(new Set());
          }}
          onMove={(u, r) => void moveSelected(u, r)}
        />
      )}
      {cameraModal && (
        <WalkthroughCamera
          mode={cameraModal.mode}
          unit={cameraModal.unit}
          roomLabel={roomLabel(cameraModal.room)}
          sharedAudioStream={cameraModal.sharedStream}
          capturedPhotos={cameraCapturedPhotos}
          voiceBanner={
            activeVoiceUi && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-red-950/90 px-4 py-2 text-xs text-white">
                <span>
                  Voice active: <strong>{spaceLabel(activeVoiceUi.unitNumber)} — {roomLabel(activeVoiceUi.room)}</strong> · {fmtClock(activeVoiceUi.elapsedMs)} · {activeVoiceUi.chunkCount} chunks saved
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void pauseActiveVoice('Paused from camera — audio safe.')}
                    className="rounded-lg border border-white/30 px-2.5 py-1 font-medium"
                  >
                    Pause voice
                  </button>
                  <button
                    type="button"
                    onClick={() => void stopAndTranscribeActiveVoice()}
                    className="rounded-lg bg-white px-2.5 py-1 font-semibold text-ink"
                  >
                    Stop & save
                  </button>
                </div>
              </div>
            )
          }
          onPhotoCaptured={async (blob, fileName) => {
            const item = await enqueueMediaItem({
              dealId: deal.id,
              userUid: me.uid,
              authorRole: role,
              authorName: me.name || roleLabel[role],
              unitNumber: cameraModal.unit,
              room: cameraModal.room,
              kind: 'photo',
              fileName,
              mimeType: 'image/jpeg',
              blob,
            });
            if (mountedRef.current) setLocalMedia((prev) => [item, ...prev]);
          }}
          onPhotoUndo={async (id) => {
            await deleteMediaItem(id);
            if (mountedRef.current) setLocalMedia((prev) => prev.filter((m) => m.id !== id));
          }}
          onPhotoRemove={async (id) => {
            await deleteMediaItem(id);
            if (mountedRef.current) setLocalMedia((prev) => prev.filter((m) => m.id !== id));
          }}
          onVideoRecorded={handleVideoRecorded}
          onClose={() => void closeCamera()}
          spaceLabel={spaceLabel(cameraModal.unit)}
          spaces={WALK_SPACES.map((u) => [u, spaceLabel(u)])}
          rooms={roomsFor(cameraModal.unit)}
          room={cameraModal.room}
          onTargetChange={setCameraTarget}
          onModeChange={(m) => void switchCameraMode(m)}
          upload={upload}
        />
      )}
      {activeVoiceUi && !cameraModal && (
        <>
          <div className="h-24" aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-2 bg-red-800 px-4 pt-3 text-white shadow-2xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
            <span className="min-w-0 truncate text-sm">
              <strong>Recording</strong> {spaceLabel(activeVoiceUi.unitNumber)} {roomLabel(activeVoiceUi.room)} {fmtClock(activeVoiceUi.elapsedMs)}
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void pauseActiveVoice('Paused by user. Audio safe on device.')}
                className="min-h-[44px] rounded-xl border border-white/50 px-3 text-sm font-medium"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => void stopAndTranscribeActiveVoice()}
                className="min-h-[44px] rounded-xl bg-white px-4 text-sm font-bold text-red-800"
              >
                Stop & save
              </button>
            </div>
          </div>
        </>
      )}


      {/* Room-first mobile selector + desktop summary */}
      <Card className="!p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-semibold">Walkthrough inventory</h2>
          {!online && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">Offline</span>
          )}
        </div>

        {loadErr && <p role="alert" className="mb-3 text-sm text-red-700">{loadErr}</p>}
        {isUsingMemoryFallback() && (
          <p role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Browser storage is restricted in this session; unsaved recordings stay in memory until synced.
          </p>
        )}

        {activeVoiceUi && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-900">
            <div className="flex min-w-0 items-center gap-2">
              <p className="font-semibold">
                Recording {spaceLabel(activeVoiceUi.unitNumber)} — {roomLabel(activeVoiceUi.room)} ({fmtClock(activeVoiceUi.elapsedMs)})
              </p>
              <InfoTip label="Recording details" lines={[`${activeVoiceUi.chunkCount} chunks (${fmtBytes(activeVoiceUi.totalBytes)}) saved locally · bound to ${spaceLabel(activeVoiceUi.unitNumber)} ${roomLabel(activeVoiceUi.room)}`]} />
            </div>
            <div className="flex flex-wrap gap-2">
              {(activeVoiceUi.unitNumber !== unit || activeVoiceUi.room !== selectedRoom) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUnit(activeVoiceUi.unitNumber);
                    setSelectedRoom(activeVoiceUi.room);
                  }}
                  className="min-h-[40px] rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-900"
                >
                  Jump to room
                </button>
              )}
              <button
                type="button"
                onClick={() => void pauseActiveVoice('Paused by user — audio safe on device.')}
                className="min-h-[40px] rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-900"
              >
                Pause
              </button>
              <button
                type="button"
                onClick={() => void stopAndTranscribeActiveVoice()}
                className="min-h-[40px] rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Stop & save
              </button>
            </div>
          </div>
        )}

        {edit && (upload.waiting > 0 || upload.failed > 0 || !online) && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            <span className="font-semibold">
              {upload.waiting
                ? `${upload.waiting} waiting to upload${upload.uploading ? ` · ${upload.uploading} uploading` : ''}${upload.failed ? ` · ${upload.failed} failed` : ''}`
                : 'Offline — new items stay on this phone until connected.'}
            </span>
            {upload.waiting > 0 && (
              <button
                type="button"
                disabled={!online || syncingAll}
                onClick={() => void syncAllPending()}
                className="min-h-[40px] rounded-lg bg-ink px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                {syncingAll ? 'Uploading…' : online ? 'Upload now' : 'Waiting for connection'}
              </button>
            )}
          </div>
        )}

        {/* Unit selector (always visible, mobile-first) */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous unit"
                disabled={unit === WALK_SPACES[0]}
                onClick={() => setSelectedUnit((u) => stepSpace(u, -1))}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-line bg-white px-3 text-sm font-medium disabled:opacity-40"
              >
                ‹
              </button>
              <select
                aria-label="Choose unit"
                value={unit}
                onChange={(e) => setSelectedUnit(Number(e.target.value))}
                className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold"
              >
                {WALK_SPACES.map((u) => (
                  <option key={u} value={u}>
                    {spaceLabel(u)} ({unitTotals[u]?.total || 0} saved{unitTotals[u]?.pending ? `, +${unitTotals[u].pending} pending` : ''})
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Next unit"
                disabled={unit === WALK_SPACES[WALK_SPACES.length - 1]}
                onClick={() => setSelectedUnit((u) => stepSpace(u, 1))}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-line bg-white px-3 text-sm font-medium disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Units">
            {WALK_SPACES.map((u) => {
              const t = unitTotals[u] || { total: 0, pending: 0 };
              const active = u === unit;
              return (
                <button
                  key={u}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedUnit(u)}
                  className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-1.5 text-center text-xs font-medium transition sm:px-3 ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : t.total + t.pending > 0
                        ? 'border-line bg-warm-soft/70 text-ink hover:border-ink'
                        : 'border-line bg-paper text-ink-soft hover:border-ink'
                  }`}
                >
                  <span>{spaceLabel(u)}{t.pending > 0 ? '*' : ''}</span>
                  {readinessState.Badge && u <= WALK_UNITS && readinessState.map[u]?.body && (
                    <readinessState.Badge unitNumber={u} label={readinessState.map[u].body} compact />
                  )}
                </button>
              );
            })}
          </div>

          {/* All 5 named room choices — full labels, >= 44px tap targets, zero horizontal clipping */}
          <div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5" role="group" aria-label={`Rooms for ${spaceLabel(unit)}`}>
              {roomsFor(unit).map(([r, label]) => {
                const c = counts[`${unit}:${r}`] || { p: 0, v: 0, n: 0, pending: 0 };
                const active = r === selectedRoom;
                return (
                  <button
                    key={r}
                    type="button"
                    aria-label={`${spaceLabel(unit)} ${label}: ${c.p} photos, ${c.v} videos, ${c.n} voice notes`}
                    aria-pressed={active}
                    onClick={() => setSelectedRoom(r)}
                    className={`flex min-h-[44px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition ${
                      active
                        ? 'border-ink bg-ink text-white'
                        : 'border-line bg-paper text-ink hover:border-ink'
                    }`}
                  >
                    <span className="text-sm font-semibold leading-tight">{label}</span>
                    {c.pending > 0 && (
                      <span className={`text-[11px] ${active ? 'text-white/80' : 'text-amber-800'}`}>
                        {c.pending} waiting
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Active Unit & Room Capture First */}
      <Card>
        <CardTitle
          aside={readinessState.Badge && unit <= WALK_UNITS ? (
            <readinessState.Badge
              unitNumber={unit}
              label={readinessState.map[unit]?.body || 'Not entered'}
              editable
              onSave={updateReadiness}
            />
          ) : null}
        >
          {spaceLabel(unit)} — {roomLabel(selectedRoom)}
        </CardTitle>
        {preview && (
          <div className="mb-3">
            <InfoTip label="Preview mode" lines={['Preview mode. Adding photos, videos, and voice notes works on a real sign-in.']} />
          </div>
        )}
        {status && (
          <p role="status" className="mb-3 rounded-xl bg-paper px-3 py-2 text-sm text-ink">
            {status}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Voice narration + raw transcript + playback */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">
                Voice notes ({roomNotes.length}
                {roomPendingVideos.length + roomLocalSessions.length > 0 && roomLocalSessions.length > 0
                  ? ` · ${roomLocalSessions.length} local`
                  : ''})
              </h3>
              {edit && (
                <div className="flex flex-wrap gap-2">
                  {activeVoiceUi ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void pauseActiveVoice('Paused by user. Audio safe on device.')}
                        className="min-h-[44px] rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-900"
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        onClick={() => void stopAndTranscribeActiveVoice()}
                        className="min-h-[44px] rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white"
                      >
                        Stop & save
                      </button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void startVoiceSession(null)}
                      className="!min-h-[44px]"
                    >
                      Record voice note
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Local pending / paused / transcribing / failed voice sessions for THIS room */}
            {edit && roomLocalSessions.length > 0 && (
              <ul className="space-y-3" aria-label="Pending voice notes">
                {roomLocalSessions.map((s) => {
                  const phase = whisperPhases[s.id];
                  const isRecordingThis = activeVoiceUi?.sessionId === s.id;
                  const audioUrl = localAudioUrls[s.id];
                  const statusLabel =
                    s.status === AUDIO_STATUS.RECORDING
                      ? 'Recording'
                      : s.status === AUDIO_STATUS.PAUSED
                        ? 'Paused · audio safe'
                        : s.status === AUDIO_STATUS.TRANSCRIBING
                          ? phase || 'Transcribing with local Whisper…'
                          : s.status === AUDIO_STATUS.READY
                            ? 'Ready to sync'
                            : s.status === AUDIO_STATUS.MODEL_FAILED
                              ? 'Whisper needs retry · audio safe'
                              : 'Sync failed · audio safe';

                  return (
                    <li key={s.id} className="space-y-2.5 rounded-xl border border-warm bg-paper p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-ink">
                          {spaceLabel(s.unitNumber)} {roomLabel(s.room)} · {s.chunkCount || 0} chunks ({fmtBytes(s.totalBytes)})
                        </span>
                        <span className="rounded-full bg-warm-soft px-2.5 py-0.5 font-medium text-ink">
                          {statusLabel}
                        </span>
                      </div>

                      {s.pauseReason && <p className="text-sm text-ink">{s.pauseReason}</p>}
                      {s.transcriptError && <p role="alert" className="text-xs text-red-700">{s.transcriptError}</p>}
                      {s.syncError && <p role="alert" className="text-xs text-red-700">{s.syncError}</p>}

                      {!isRecordingThis && audioUrl && (
                        <audio src={audioUrl} controls preload="metadata" className="h-9 w-full" aria-label="Local voice note audio" />
                      )}

                      {!isRecordingThis && (
                        <>
                          <label className="block text-xs font-medium text-ink">
                            Raw transcript (edit if needed, then sync)
                            <textarea
                              aria-label="Voice note transcript"
                              rows={3}
                              maxLength={12000}
                              value={s.rawTranscript || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setLocalSessions((prev) =>
                                  prev.map((row) => (row.id === s.id ? { ...row, rawTranscript: val } : row))
                                );
                                void updateAudioSession(s.id, { rawTranscript: val });
                              }}
                              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                            />
                          </label>

                          <div className="flex flex-wrap gap-2">
                            {s.status === AUDIO_STATUS.PAUSED && !activeVoiceUi && (
                              <Button
                                type="button"
                                kind="secondary"
                                className="!min-h-[40px]"
                                onClick={() => void startVoiceSession(s)}
                              >
                                Resume
                              </Button>
                            )}

                            {(s.status === AUDIO_STATUS.PAUSED ||
                              s.status === AUDIO_STATUS.MODEL_FAILED ||
                              s.status === AUDIO_STATUS.READY ||
                              s.status === AUDIO_STATUS.SYNC_FAILED) && (
                              <Button
                                type="button"
                                kind="secondary"
                                className="!min-h-[40px]"
                                disabled={s.status === AUDIO_STATUS.TRANSCRIBING}
                                onClick={() =>
                                  void runWhisperOnSession(s.id, { overwriteExisting: Boolean(s.rawTranscript?.trim()) })
                                }
                              >
                                {s.status === AUDIO_STATUS.MODEL_FAILED
                                  ? 'Retry Whisper'
                                  : s.rawTranscript?.trim()
                                    ? 'Retranscribe'
                                    : 'Transcribe with Whisper'}
                              </Button>
                            )}

                            {Boolean(s.rawTranscript?.trim()) && (
                              <Button
                                type="button"
                                className="!min-h-[40px]"
                                disabled={s.status === AUDIO_STATUS.TRANSCRIBING || s.chunkCount === 0}
                                onClick={() => void syncVoiceSession(s, false)}
                              >
                                {s.status === AUDIO_STATUS.SYNC_FAILED ? 'Retry sync' : 'Save voice note'}
                              </Button>
                            )}

                            {!s.rawTranscript?.trim() && s.chunkCount > 0 && s.status !== AUDIO_STATUS.TRANSCRIBING && (
                              <Button
                                type="button"
                                kind="secondary"
                                className="!min-h-[40px]"
                                onClick={() => void syncVoiceSession(s, true)}
                              >
                                Save audio backup
                              </Button>
                            )}

                            <Button
                              type="button"
                              kind="secondary"
                              className="!min-h-[40px] !text-red-700"
                              onClick={async () => {
                                if (!window.confirm('Discard this unsynced voice recording and audio?')) return;
                                await deleteAudioSession(s.id);
                                const cachedUrl = audioPreviewCacheRef.current.get(s.id);
                                if (cachedUrl) {
                                  URL.revokeObjectURL(cachedUrl);
                                  audioPreviewCacheRef.current.delete(s.id);
                                }
                                setLocalSessions((prev) => prev.filter((x) => x.id !== s.id));
                              }}
                            >
                              Discard
                            </Button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Synced remote voice notes */}
            {notes === null ? (
              <Empty>Loading…</Empty>
            ) : roomNotes.length === 0 && roomLocalSessions.length === 0 ? (
              <Empty>No voice notes for this room yet.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {roomNotes.map((n) => (
                  <li key={n.id} className="space-y-2 rounded-xl border border-line bg-paper p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                      <InfoTip label="Voice note details" lines={[`${authorTag(n)} · ${when(n.created_at)}${n.duration_sec ? ` · ${n.duration_sec}s` : ''}`]} />
                      <div className="flex flex-wrap items-center gap-3">
                        {edit && (role === 'owner' || n.author_uid === me.uid) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditingNoteId(n.id);
                              setEditingNoteText(n.raw_transcript || '');
                            }}
                            className="inline-flex min-h-[40px] items-center px-1.5 underline hover:text-ink"
                          >
                            Edit
                          </button>
                        )}
                        {edit && n.storage_path && urls[n.storage_path] && (role === 'owner' || n.author_uid === me.uid) && (
                          <button
                            type="button"
                            disabled={Boolean(retranscribingId)}
                            onClick={() => void retranscribeRemoteNote(n)}
                            className="inline-flex min-h-[40px] items-center px-1.5 underline hover:text-ink"
                          >
                            {retranscribingId === n.id ? 'Retranscribing…' : 'Retranscribe'}
                          </button>
                        )}
                        {edit && (role === 'owner' || n.author_uid === me.uid) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeRemoteNote(n)}
                            className="inline-flex min-h-[40px] items-center px-1.5 underline hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {n.storage_path ? (
                      urls[n.storage_path] ? (
                        <audio src={urls[n.storage_path]} controls preload="none" className="h-9 w-full" aria-label="Voice note audio" />
                      ) : (
                        <p className="text-sm text-ink">Loading audio…</p>
                      )
                    ) : (
                      <InfoTip label="Audio unavailable" lines={['Original audio file unavailable on this older note.']} />
                    )}

                    {editingNoteId === n.id ? (
                      <div className="space-y-2">
                        <textarea
                          aria-label="Edit voice note transcript"
                          rows={3}
                          maxLength={12000}
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
                        />
                        <div className="flex gap-2">
                          <Button type="button" disabled={busy} onClick={() => void saveEditedRemoteNote(n)}>
                            Save text
                          </Button>
                          <Button type="button" kind="secondary" onClick={() => setEditingNoteId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {n.polished && String(n.polished).trim() ? (
                          <p className="whitespace-pre-wrap break-words text-sm text-ink">
                            {String(n.polished).trim()}
                          </p>
                        ) : null}
                        {n.raw_transcript ? (
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              aria-expanded={Boolean(openTranscripts[n.id])}
                              onClick={() => setOpenTranscripts((prev) => ({ ...prev, [n.id]: !prev[n.id] }))}
                              className="text-xs font-medium text-ink underline underline-offset-2 hover:text-ink-soft"
                            >
                              {openTranscripts[n.id] ? 'Hide transcript' : 'View transcript'}
                            </button>
                            {openTranscripts[n.id] && (
                              <p className="whitespace-pre-wrap break-words rounded-lg bg-white px-3 py-2 text-sm text-ink">
                                {n.raw_transcript}
                              </p>
                            )}
                          </div>
                        ) : !n.polished || !String(n.polished).trim() ? (
                          <InfoTip label="No transcript yet" lines={['No transcript yet — tap Retranscribe or Edit.']} />
                        ) : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Photos & Videos */}
          <div className="space-y-5">
            {/* Photos section */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  Photos ({roomPhotos.length}
                  {roomPendingPhotos.length ? ` · ${roomPendingPhotos.length} pending` : ''})
                </h3>
                {edit && (
                  <div className="flex flex-wrap gap-2">
                    {movableKeys.length > 0 && (
                      <button
                        type="button"
                        aria-pressed={selecting}
                        onClick={() => {
                          setSelecting((x) => !x);
                          setPicked(new Set());
                        }}
                        className={`inline-flex min-h-[44px] items-center rounded-xl border px-3.5 py-2 text-sm font-semibold ${
                          selecting ? 'border-ink bg-ink text-white' : 'border-ink bg-white text-ink hover:bg-warm-soft'
                        }`}
                      >
                        {selecting ? 'Done selecting' : 'Select to move'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={openMultiPhotoCamera}
                      className="inline-flex min-h-[44px] items-center rounded-xl bg-ink px-3.5 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
                    >
                      Take photos
                    </button>
                    <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-line bg-white px-3.5 py-2 text-sm font-medium hover:bg-warm-soft">
                      Upload photos
                      <input
                        aria-label={`Upload photos for ${spaceLabel(unit)} ${roomLabel(selectedRoom)}`}
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={busy}
                        onChange={(e) => {
                          const files = [...(e.target.files || [])];
                          e.target.value = '';
                          void enqueueAndMaybeSyncFiles(files, 'photo');
                        }}
                        className="sr-only"
                      />
                    </label>
                    <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-line bg-paper px-3 py-2 text-xs font-medium text-ink-soft hover:border-ink">
                      Single camera
                      <input
                        aria-label={`Take photo for ${spaceLabel(unit)} ${roomLabel(selectedRoom)}`}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={busy}
                        onChange={(e) => {
                          const files = [...(e.target.files || [])];
                          e.target.value = '';
                          void enqueueAndMaybeSyncFiles(files, 'photo');
                        }}
                        className="sr-only"
                      />
                    </label>
                  </div>
                )}
              </div>

              {roomPendingPhotos.length > 0 && (
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label="Pending room photos">
                  {roomPendingPhotos.map((m) => (
                    <li key={m.id} className={`relative overflow-hidden rounded-xl border bg-paper ${picked.has(`l:${m.id}`) ? 'border-ink ring-2 ring-ink' : 'border-warm'}`}>
                      {selecting && movable.has(`l:${m.id}`) ? (
                        <button type="button" aria-pressed={picked.has(`l:${m.id}`)} aria-label={`Select ${m.fileName}`} onClick={() => togglePick(`l:${m.id}`)} className="block w-full">
                          <img src={m.previewUrl} alt={`Pending ${m.fileName}`} className="aspect-[4/3] w-full object-cover" />
                          <Tick on={picked.has(`l:${m.id}`)} />
                        </button>
                      ) : (
                        <div className="group relative">
                          <button type="button" onClick={() => setViewKey(`l:${m.id}`)} aria-label={`Open ${m.fileName}`} className="block w-full cursor-zoom-in">
                            <img src={m.previewUrl} alt={`Pending ${m.fileName}`} className="aspect-[4/3] w-full object-cover" />
                          </button>
                          <ThumbOverlay buttons={photoButtons(`l:${m.id}`, null, true)} />
                        </div>
                      )}
                      <div className="space-y-1 p-2 text-xs">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-medium text-ink">
                            {m.status === MEDIA_STATUS.UPLOADING ? 'Uploading…' : m.status === MEDIA_STATUS.FAILED ? 'Failed' : 'Pending'}
                          </span>
                          <button
                            type="button"
                            onClick={() => void deleteMediaItem(m.id).then(() => setLocalMedia((prev) => prev.filter((x) => x.id !== m.id)))}
                            className="inline-flex min-h-[40px] items-center px-1.5 text-ink-soft underline hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                        {m.error && <p className="text-[11px] text-red-700">{m.error}</p>}
                        {m.status !== MEDIA_STATUS.UPLOADING && (
                          <button
                            type="button"
                            onClick={() => void syncMediaItem(m)}
                            className="w-full rounded-lg bg-ink px-2 py-1 text-[11px] font-medium text-white"
                          >
                            {m.status === MEDIA_STATUS.FAILED ? 'Retry upload' : 'Upload now'}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {photos === null ? (
                <Empty>Loading…</Empty>
              ) : roomPhotos.length === 0 && roomPendingPhotos.length === 0 ? (
                <Empty>No photos for this room yet.</Empty>
              ) : roomPhotos.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {roomPhotos.map((p, i) => (
                    <li key={p.id} className={`relative overflow-hidden rounded-xl border bg-white ${picked.has(`p:${p.id}`) ? 'border-ink ring-2 ring-ink' : 'border-line'}`}>
                      {selecting && movable.has(`p:${p.id}`) ? (
                        <button type="button" aria-pressed={picked.has(`p:${p.id}`)} aria-label={`Select photo ${i + 1}`} onClick={() => togglePick(`p:${p.id}`)} className="block w-full">
                          {urls[p.storage_path] ? (
                            <img src={urls[p.storage_path]} alt={`${spaceLabel(unit)} ${roomLabel(selectedRoom)} photo ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                          ) : (
                            <div className="flex aspect-[4/3] items-center justify-center bg-paper text-xs text-ink-soft">Loading…</div>
                          )}
                          <Tick on={picked.has(`p:${p.id}`)} />
                        </button>
                      ) : urls[p.storage_path] ? (
                        <div className="group relative">
                          <button type="button" onClick={() => setViewKey(`p:${p.id}`)} aria-label={`Open photo ${i + 1}`} className="block w-full cursor-zoom-in">
                            <img
                              src={urls[p.storage_path]}
                              alt={`${spaceLabel(unit)} ${roomLabel(selectedRoom)} photo ${i + 1}`}
                              loading="lazy"
                              className="aspect-[4/3] w-full object-cover"
                            />
                          </button>
                          <ThumbOverlay buttons={photoButtons(`p:${p.id}`, p, true)} />
                        </div>
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-paper text-xs text-ink-soft">Loading…</div>
                      )}
                      <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs text-ink-soft">
                        <InfoTip label="Photo details" lines={[authorTag(p)]} />
                        {edit && (role === 'owner' || p.author_uid === me.uid) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeRemotePhoto(p)}
                            className="inline-flex min-h-[40px] shrink-0 items-center px-1.5 underline hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {role === 'owner' && !preview && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-2 py-1.5 text-xs">
                          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" checked={Boolean(p.share_seller)} onChange={() => void toggleShare(p, 'share_seller')} />Share with seller</label>
                          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" checked={Boolean(p.share_lender)} onChange={() => void toggleShare(p, 'share_lender')} />Share with lender</label>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              <PhotoViewer
                items={viewerPhotos}
                index={viewIndex >= 0 ? viewIndex : null}
                onIndex={(n) => setViewKey(n === null ? null : viewerPhotos[n]?.key ?? null)}
                actions={viewerActions}
              />
              {moveOne && (
                <MoveOneDialog
                  fromUnit={unit}
                  fromRoom={selectedRoom}
                  busy={moving}
                  onCancel={() => setMoveOne(null)}
                  onMove={(u, r) => void moveOnePhoto(u, r)}
                />
              )}
            </div>

            {/* Videos section */}
            <div className="space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  Videos ({roomVideos.length}
                  {roomPendingVideos.length ? ` · ${roomPendingVideos.length} pending` : ''})
                </h3>
                {edit && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openVideoRecorder()}
                      className="inline-flex min-h-[44px] items-center rounded-xl border border-ink bg-white px-3.5 py-2 text-sm font-medium text-ink hover:bg-warm-soft disabled:opacity-50"
                    >
                      Record video
                    </button>
                    <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border border-line bg-white px-3.5 py-2 text-sm font-medium hover:bg-warm-soft">
                      Upload video
                      <input
                        aria-label={`Upload video for ${spaceLabel(unit)} ${roomLabel(selectedRoom)}`}
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime,video/*"
                        disabled={busy}
                        onChange={(e) => {
                          const files = [...(e.target.files || [])];
                          e.target.value = '';
                          void enqueueAndMaybeSyncFiles(files, 'video');
                        }}
                        className="sr-only"
                      />
                    </label>
                  </div>
                )}
              </div>

              {roomPendingVideos.length > 0 && (
                <ul className="space-y-2.5" aria-label="Pending room videos">
                  {roomPendingVideos.map((v) => (
                    <li key={v.id} className={`space-y-2 rounded-xl border bg-paper p-3 text-xs ${picked.has(`l:${v.id}`) ? 'border-ink ring-2 ring-ink' : 'border-warm'}`}>
                      {selecting && movable.has(`l:${v.id}`) && <PickRow on={picked.has(`l:${v.id}`)} onToggle={() => togglePick(`l:${v.id}`)} />}
                      <video
                        src={v.previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="aspect-video w-full rounded-lg bg-black"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ink">
                          {v.fileName} ({fmtBytes(v.sizeBytes)}) ·{' '}
                          {v.status === MEDIA_STATUS.UPLOADING ? 'Uploading…' : v.status === MEDIA_STATUS.FAILED ? 'Failed' : 'Pending'}
                        </span>
                        <div className="flex gap-2">
                          {!selecting && movable.has(`l:${v.id}`) && (
                            <button type="button" disabled={moving} onClick={() => setMoveOne(`l:${v.id}`)} className="rounded-lg border border-line bg-white px-2.5 py-1 font-medium">
                              ⇄ Move this one
                            </button>
                          )}
                          {v.status !== MEDIA_STATUS.UPLOADING && (
                            <button
                              type="button"
                              onClick={() => void syncMediaItem(v)}
                              className="rounded-lg bg-ink px-2.5 py-1 font-medium text-white"
                            >
                              {v.status === MEDIA_STATUS.FAILED ? 'Retry upload' : 'Upload now'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void deleteMediaItem(v.id).then(() => setLocalMedia((prev) => prev.filter((x) => x.id !== v.id)))}
                            className="inline-flex min-h-[40px] items-center px-1.5 underline hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {v.error && <p className="text-red-700">{v.error}</p>}
                    </li>
                  ))}
                </ul>
              )}

              {videos === null ? (
                <Empty>Loading…</Empty>
              ) : roomVideos.length === 0 && roomPendingVideos.length === 0 ? (
                <Empty>No videos for this room yet.</Empty>
              ) : roomVideos.length > 0 ? (
                <ul className="space-y-2.5">
                  {roomVideos.map((v) => (
                    <li key={v.id} className={`space-y-2 rounded-xl border bg-white p-3 ${picked.has(`v:${v.id}`) ? 'border-ink ring-2 ring-ink' : 'border-line'}`}>
                      {selecting && movable.has(`v:${v.id}`) && <PickRow on={picked.has(`v:${v.id}`)} onToggle={() => togglePick(`v:${v.id}`)} />}
                      {urls[v.storage_path] ? (
                        <video
                          src={urls[v.storage_path]}
                          controls
                          playsInline
                          preload="metadata"
                          className="aspect-video w-full rounded-lg bg-black"
                        />
                      ) : (
                        <div className="flex aspect-video items-center justify-center rounded-lg bg-paper text-xs text-ink-soft">
                          Loading video…
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                        <InfoTip label="Video details" lines={[`${authorTag(v)} · ${when(v.created_at)}${v.size_bytes ? ` · ${fmtBytes(v.size_bytes)}` : ''}`]} />
                        {!selecting && movable.has(`v:${v.id}`) && (
                          <button type="button" disabled={moving} onClick={() => setMoveOne(`v:${v.id}`)} className="inline-flex min-h-[40px] items-center rounded-lg border border-line bg-white px-3 font-medium text-ink hover:border-ink">
                            ⇄ Move this one
                          </button>
                        )}
                        {edit && (role === 'owner' || v.author_uid === me.uid) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeRemoteVideo(v)}
                            className="inline-flex min-h-[40px] items-center px-1.5 underline hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {role === 'owner' && !preview && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-1.5 text-xs">
                          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" checked={Boolean(v.share_seller)} onChange={() => void toggleShare(v, 'share_seller', 'video')} />Share with seller</label>
                          <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5"><input type="checkbox" className="h-5 w-5 rounded border-line accent-ink" checked={Boolean(v.share_lender)} onChange={() => void toggleShare(v, 'share_lender', 'video')} />Share with lender</label>
                        </div>
                      )}
                      <VideoExtras video={v} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* Desktop full matrix (always shown on md+), Phone optional collapsible matrix */}
      <Card className="!p-4 hidden md:block">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-lg font-semibold">All units progress</h3>
        </div>
        {matrixTable}
      </Card>

      <Card className="!p-4 md:hidden">
        <button
          type="button"
          aria-expanded={showMatrix}
          onClick={() => setShowMatrix((x) => !x)}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
        >
          <span className="font-display text-lg font-semibold">All units progress</span>
          <span className="text-xs font-medium text-ink-soft">{showMatrix ? 'Hide' : 'Show'}</span>
        </button>
        {showMatrix && <div className="mt-3">{matrixTable}</div>}
      </Card>
    </div>
  );
}
