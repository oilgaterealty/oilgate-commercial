import { useEffect, useRef, useState } from 'react';
import { mediaCoordinator } from '../lib/mediaCoordinator.js';
import { Button } from './Shell.jsx';

const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_AUTO_STOP_BYTES = 47 * 1024 * 1024;

function formatTimer(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatMb(bytes) {
  return `${(Math.max(0, bytes || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WalkthroughCamera({
  mode, // 'photo' | 'video'
  unit,
  roomLabel,
  spaceLabel = `Unit ${unit}`,
  spaces = [], // [[number, label]] — every unit and building area
  rooms = [], // [[key, label]] for the current space
  room,
  onTargetChange, // (unit, room) — switch where the next shot saves without closing the camera
  onModeChange, // ('photo' | 'video')
  upload = null, // { waiting, uploading, failed, online }
  voiceBanner,
  sharedAudioStream,
  capturedPhotos = [],
  onPhotoCaptured,
  onPhotoUndo,
  onPhotoRemove,
  onVideoRecorded,
  onClose,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const bytesRef = useRef(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState('');
  const [busyShot, setBusyShot] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [videoSaving, setVideoSaving] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [videoNote, setVideoNote] = useState('');
  const [hasAudioTrack, setHasAudioTrack] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let localStream = null;

    async function openCamera() {
      setReady(false);
      setCamError('');
      setVideoNote('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('Camera is unavailable in this browser. Use Upload instead.');
        return;
      }
      const videoPreferred =
        mode === 'video'
          ? { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };

      try {
        if (mode === 'video') {
          const liveSharedTrack = sharedAudioStream?.getAudioTracks?.().find((t) => t.readyState === 'live');
          if (liveSharedTrack) {
            const vStream = await navigator.mediaDevices.getUserMedia({ video: videoPreferred, audio: false }).catch(
              () => navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            );
            localStream = new MediaStream([...vStream.getVideoTracks(), liveSharedTrack.clone()]);
          } else {
            try {
              localStream = await navigator.mediaDevices.getUserMedia({ video: videoPreferred, audio: true });
            } catch {
              localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
          }
        } else {
          try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: videoPreferred, audio: false });
          } catch {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
        }
      } catch {
        if (active) {
          setCamError('Could not open camera. Check camera permission or use Upload below.');
        }
        return;
      }

      if (!active) {
        localStream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = localStream;
      setHasAudioTrack(localStream.getAudioTracks().some((t) => t.readyState === 'live'));
      if (videoRef.current) {
        videoRef.current.srcObject = localStream;
        videoRef.current.play?.().catch(() => {});
      }
      setReady(true);
    }

    void openCamera();

    return () => {
      active = false;
      mountedRef.current = false;
      clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        try { recorderRef.current.stop(); } catch {}
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (mode === 'video') mediaCoordinator.release('walkthrough-video');
    };
  }, [mode, sharedAudioStream]);

  useEffect(() => {
    if (mode !== 'video') return undefined;
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && recorderRef.current?.state === 'recording') {
        setVideoNote('App backgrounded — saving recorded video clip…');
        try { recorderRef.current.requestData?.(); } catch {}
        recorderRef.current.stop();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [mode]);

  const snapPhoto = async () => {
    const video = videoRef.current;
    if (!ready || !video || busyShot) return;
    setBusyShot(true);
    try {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      if (!blob || !blob.size) {
        setCamError('Could not capture photo frame. Try again.');
        return;
      }
      await onPhotoCaptured?.(blob, `unit-${unit}-${Date.now()}.jpg`);
    } catch {
      setCamError('Photo capture failed. Try again.');
    } finally {
      if (mountedRef.current) setBusyShot(false);
    }
  };

  const startVideo = () => {
    const stream = streamRef.current;
    if (!stream || recordingVideo || videoSaving) return;
    if (typeof MediaRecorder === 'undefined') {
      setCamError('Video recording is unavailable in this browser. Use Upload video instead.');
      return;
    }
    const lock = mediaCoordinator.acquire('walkthrough-video', { unit, room: roomLabel });
    if (!lock.ok) {
      setCamError(lock.message);
      return;
    }
    const codec = [
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((t) => MediaRecorder.isTypeSupported?.(t));

    try {
      // ~2.5 Mbps keeps a 2-minute clip near 40 MB on a phone.
      const recorder = new MediaRecorder(stream, { ...(codec ? { mimeType: codec } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 });
      recorderRef.current = recorder;
      chunksRef.current = [];
      bytesRef.current = 0;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setRecordedBytes(0);
      setVideoNote('');

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
          bytesRef.current += e.data.size;
          if (mountedRef.current) setRecordedBytes(bytesRef.current);
          if (bytesRef.current >= VIDEO_AUTO_STOP_BYTES && recorder.state === 'recording') {
            setVideoNote('Reached near the 50 MB size limit — saving video…');
            recorder.stop();
          }
        }
      };

      recorder.onerror = () => {
        if (recorder.state === 'recording') recorder.stop();
      };

      recorder.onstop = async () => {
        clearInterval(timerRef.current);
        mediaCoordinator.release('walkthrough-video');
        if (mountedRef.current) {
          setRecordingVideo(false);
          setVideoSaving(true);
        }
        const mimeType = (recorder.mimeType || codec || 'video/webm').split(';')[0];
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        if (blob.size > VIDEO_MAX_BYTES) {
          if (mountedRef.current) {
            setVideoSaving(false);
            setCamError('Recorded clip exceeded 50 MB. Record a shorter clip.');
          }
          return;
        }
        if (blob.size > 0) {
          await onVideoRecorded?.(blob, {
            mimeType,
            durationSec,
            fileName: `unit-${unit}-${Date.now()}.${ext}`,
          });
        }
        // Stay on the camera so the next room can be shot right away.
        if (mountedRef.current) {
          setVideoSaving(false);
          setVideoNote(blob.size > 0 ? `Video saved to ${spaceLabel} — ${roomLabel}.` : '');
        }
      };

      recorder.start(2000);
      setRecordingVideo(true);
      timerRef.current = setInterval(() => {
        if (mountedRef.current) {
          setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));
        }
      }, 500);
    } catch {
      mediaCoordinator.release('walkthrough-video');
      setCamError('Could not start video recording in this browser. Use Upload video instead.');
    }
  };

  const stopVideo = () => {
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.requestData?.(); } catch {}
      recorderRef.current.stop();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'photo' ? `Camera photos for ${spaceLabel} ${roomLabel}` : `Record video for ${spaceLabel} ${roomLabel}`}
      className="fixed inset-0 z-50 flex flex-col bg-ink text-white"
    >
      <div className="space-y-2 border-b border-white/15 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-xl bg-white/10 p-0.5 text-sm font-semibold" role="group" aria-label="Camera mode">
            {[['photo', 'Photo'], ['video', 'Video']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={mode === k}
                disabled={(recordingVideo || videoSaving) || !onModeChange}
                onClick={() => mode !== k && onModeChange?.(k)}
                className={`min-h-[40px] rounded-lg px-4 ${mode === k ? 'bg-warm text-ink' : 'text-white/80'} disabled:opacity-60`}
              >
                {label}
              </button>
            ))}
          </div>
          {upload && (
            <span
              role="status"
              aria-live="polite"
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${upload.waiting ? 'bg-amber-400 text-ink' : 'bg-emerald-500 text-white'}`}
            >
              {upload.waiting ? `${upload.waiting} waiting to upload${upload.online ? '' : ' (offline)'}` : 'All uploaded ✓'}
            </span>
          )}
          <Button
            type="button"
            kind="secondary"
            disabled={(recordingVideo || videoSaving)}
            onClick={onClose}
            className="!min-h-[40px] !border-white/30 !bg-white !px-4 !text-ink"
          >
            Done
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="cam-space">Save to space</label>
          <select
            id="cam-space"
            value={unit}
            disabled={(recordingVideo || videoSaving) || !onTargetChange}
            onChange={(e) => onTargetChange?.(Number(e.target.value), room)}
            className="min-h-[40px] min-w-0 flex-1 rounded-xl border border-white/25 bg-white/10 px-2 text-sm font-semibold text-white [&>option]:text-ink"
          >
            {(spaces.length ? spaces : [[unit, spaceLabel]]).map(([n, label]) => (
              <option key={n} value={n}>{label}</option>
            ))}
          </select>
          {mode === 'photo' && (
            <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
              {capturedPhotos.length} here
            </span>
          )}
        </div>
        {rooms.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={`Room in ${spaceLabel}`}>
            {rooms.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={k === room}
                disabled={(recordingVideo || videoSaving)}
                onClick={() => onTargetChange?.(unit, k)}
                className={`min-h-[40px] shrink-0 rounded-xl px-3 text-sm font-medium ${k === room ? 'bg-white text-ink' : 'border border-white/25 text-white'} disabled:opacity-50`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {(recordingVideo || videoSaving) && <p className="text-[11px] text-warm">Room is locked while this video records and saves.</p>}
      </div>

      {voiceBanner}

      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-black p-2">
        {camError ? (
          <div className="max-w-sm space-y-3 rounded-2xl bg-white/10 p-5 text-center text-sm">
            <p>{camError}</p>
            <Button type="button" onClick={onClose} className="!min-h-[44px] !bg-white !text-ink">
              Close camera
            </Button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-h-full w-full max-w-2xl rounded-2xl bg-black object-contain"
          />
        )}
      </div>

      <div className="space-y-3 border-t border-white/15 bg-ink px-4 py-3">
        {mode === 'photo' ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={!ready || busyShot || Boolean(camError)}
                onClick={snapPhoto}
                className="min-h-[52px] flex-1 rounded-2xl bg-warm px-5 py-3 text-base font-semibold text-ink transition hover:opacity-95 disabled:opacity-40"
              >
                {busyShot ? 'Saving shot…' : 'Capture photo'}
              </button>
              <button
                type="button"
                disabled={capturedPhotos.length === 0 || busyShot}
                onClick={() => {
                  const last = capturedPhotos[0];
                  if (last) onPhotoUndo?.(last.id);
                }}
                className="min-h-[52px] shrink-0 rounded-2xl border border-white/25 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
              >
                Undo last
              </button>
            </div>

            {capturedPhotos.length > 0 && (
              <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Session photo thumbnails">
                {capturedPhotos.map((p, idx) => (
                  <li key={p.id} className="relative shrink-0 overflow-hidden rounded-xl border border-white/20 bg-black">
                    <img
                      src={p.previewUrl}
                      alt={`Captured shot ${capturedPhotos.length - idx}`}
                      className="h-16 w-20 object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove captured photo ${p.fileName}`}
                      onClick={() => onPhotoRemove?.(p.id)}
                      className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-xs font-bold text-white"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-white/75">
              Saves to {spaceLabel} — {roomLabel}. Up to about 2 min per clip (50 MB).{' '}
              {hasAudioTrack ? 'Video audio active.' : 'Video only (no mic permission).'}
            </p>
            {videoNote && <p role="status" className="text-xs text-warm">{videoNote}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-sm">
                {recordingVideo ? `REC ${formatTimer(elapsedSec)} · ${formatMb(recordedBytes)}` : videoSaving ? 'Saving video…' : 'Ready to record'}
              </span>
              {recordingVideo ? (
                <button
                  type="button"
                  onClick={stopVideo}
                  className="min-h-[48px] rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Stop & save video
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!ready || videoSaving || Boolean(camError)}
                  onClick={startVideo}
                  className="min-h-[48px] rounded-2xl bg-warm px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
                >
                  {videoSaving ? 'Saving…' : 'Start recording'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
