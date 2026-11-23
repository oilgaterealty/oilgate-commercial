import { TARGET_SAMPLE_RATE, decodeSegmentsTo16kPcm } from './audioStitch.js';

export const MAX_RECORDING_MS = 30 * 60_000;
export const WHISPER_ENGINE_LABEL = 'Local Whisper (onnx-community/whisper-tiny.en, on-device)';

const SINGLE_PASS_SAMPLES = 90 * TARGET_SAMPLE_RATE;
const WINDOW_SAMPLES = 60 * TARGET_SAMPLE_RATE;

let worker = null;
let nextJobId = 1;
let queueTail = Promise.resolve();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./dictation-worker.js', import.meta.url), { type: 'module' });
  }
  return worker;
}

function runWorkerPart(pcmSlice, part, totalParts, progress, signal) {
  const jobId = nextJobId++;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve('');
      return;
    }
    const current = getWorker();
    const copy = new Float32Array(pcmSlice);
    let settled = false;

    function cleanup() {
      current.onmessage = null;
      current.onerror = null;
      signal?.removeEventListener('abort', onAbort);
    }

    function onAbort() {
      if (settled) return;
      settled = true;
      cleanup();
      current.terminate();
      if (worker === current) worker = null;
      resolve('');
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    current.onmessage = ({ data }) => {
      if (data.jobId !== jobId) return;
      if (data.phase) {
        progress?.(data.phase);
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.text || '');
    };

    current.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      current.terminate();
      if (worker === current) worker = null;
      reject(new Error('Local transcription could not run in this browser.'));
    };

    current.postMessage({ jobId, pcm: copy, part, totalParts }, [copy.buffer]);
  });
}

function enqueueTranscription(task) {
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => {});
  return run;
}

export async function transcribeAudio(blobOrSegments, progress, signal) {
  const segments = Array.isArray(blobOrSegments) ? blobOrSegments : [blobOrSegments];
  progress?.('Preparing audio for local Whisper…');
  const { pcm, durationSec } = await decodeSegmentsTo16kPcm(segments);
  if (signal?.aborted) return { text: '', durationSec, engine: WHISPER_ENGINE_LABEL };

  const slices = [];
  if (pcm.length <= SINGLE_PASS_SAMPLES) {
    slices.push(pcm);
  } else {
    for (let start = 0; start < pcm.length; start += WINDOW_SAMPLES) {
      const end = Math.min(pcm.length, start + WINDOW_SAMPLES);
      if (end > start) slices.push(pcm.subarray(start, end));
    }
  }

  const text = await enqueueTranscription(async () => {
    const parts = [];
    for (let i = 0; i < slices.length; i++) {
      if (signal?.aborted) return '';
      const partText = await runWorkerPart(slices[i], i + 1, slices.length, progress, signal);
      if (partText?.trim()) parts.push(partText.trim());
    }
    return parts.join(' ').trim();
  });

  return { text, durationSec, engine: WHISPER_ENGINE_LABEL };
}

export async function transcribe(blob, progress, signal) {
  const res = await transcribeAudio(blob, progress, signal);
  return res.text;
}
