// Walkthrough video: record small (480p, low bitrate), then on this device pull three still frames
// and a transcript of the audio. Free: nothing leaves the phone except the saved files and text.

export const VIDEO_480P = { width: { ideal: 854 }, height: { ideal: 480, max: 480 } };
export const VIDEO_BITRATE = { videoBitsPerSecond: 750_000, audioBitsPerSecond: 64_000 };
export const FRAME_WIDTH = 480;
export const FRAME_QUALITY = 0.72;

// Start, middle and end, kept just inside the clip so the decoder always has a picture.
export function frameTimes(durationSec) {
  const d = Number(durationSec);
  if (!Number.isFinite(d) || d <= 0) return [0];
  const end = Math.max(0, d - 0.25);
  const pick = [Math.min(0.1, end), d / 2, end];
  return pick.filter((t, i) => pick.findIndex((x) => Math.abs(x - t) < 0.05) === i);
}

// What to store after processing. A failed transcript never blocks the frames, and the other way round.
export function postResult({ text, transcriptError, framePaths }) {
  const clean = (text || '').trim().slice(0, 12000);
  return {
    transcript: clean || null,
    transcript_status: transcriptError ? 'failed' : clean ? 'ready' : 'none',
    frame_paths: (framePaths || []).filter(Boolean).slice(0, 3),
  };
}

// Browser only: seek a video blob and grab small JPEG frames.
export async function captureFrames(blob, { width = FRAME_WIDTH, quality = FRAME_QUALITY } = {}) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const once = (ev) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 15000);
    video.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    video.addEventListener('error', () => { clearTimeout(t); rej(new Error('video error')); }, { once: true });
  });
  try {
    await once('loadedmetadata');
    let duration = video.duration;
    // MediaRecorder WebM often reports Infinity until the end is seeked once.
    if (!Number.isFinite(duration)) {
      video.currentTime = 1e7;
      await once('seeked').catch(() => {});
      duration = Number.isFinite(video.duration) ? video.duration : 0;
    }
    const out = [];
    for (const t of frameTimes(duration)) {
      video.currentTime = t;
      await once('seeked').catch(() => {});
      const w = Math.min(width, video.videoWidth || width);
      const h = Math.round(w * ((video.videoHeight || 270) / (video.videoWidth || 480)));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      const jpg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
      if (jpg?.size) out.push(jpg);
    }
    return out;
  } finally {
    video.removeAttribute('src');
    video.load?.();
    URL.revokeObjectURL(url);
  }
}

// Runs both steps with injected helpers so the page decides where things go.
export async function processVideo(blob, { uploadFrame, transcribe, save }) {
  const framePaths = [];
  try {
    for (const jpg of await captureFrames(blob)) {
      const p = await uploadFrame(jpg).catch(() => null);
      if (p) framePaths.push(p);
    }
  } catch {
    // no frames; the video itself is saved
  }
  let text = '';
  let transcriptError = false;
  try {
    text = await transcribe(blob);
  } catch {
    transcriptError = true;
  }
  const result = postResult({ text, transcriptError, framePaths });
  await save(result);
  return result;
}
