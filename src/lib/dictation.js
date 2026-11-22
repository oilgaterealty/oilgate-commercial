export const MAX_RECORDING_MS = 120_000;
let worker;

export async function transcribe(blob, progress, signal) {
  const Context = window.AudioContext || window.webkitAudioContext;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Context || !Offline) throw new Error('This browser cannot decode audio.');
  const ctx = new Context();
  let original;
  try {
    original = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await ctx.close().catch(() => {});
  }
  if (!(original.duration > 0 && original.duration <= 125)) {
    throw new Error('Keep each recording under two minutes.');
  }
  const offline = new Offline(1, Math.max(1, Math.ceil(original.duration * 16000)), 16000);
  const source = offline.createBufferSource();
  source.buffer = original;
  source.connect(offline.destination);
  source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  if (signal?.aborted) return '';

  worker ??= new Worker(new URL('./dictation-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const current = worker;
    function clear() {
      current.onmessage = null;
      current.onerror = null;
      signal?.removeEventListener('abort', cancel);
    }
    function cancel() {
      clear();
      current.terminate();
      worker = null;
      resolve('');
    }
    signal?.addEventListener('abort', cancel, { once: true });
    current.onmessage = ({ data }) => {
      if (data.phase) {
        progress?.(data.phase);
        return;
      }
      clear();
      if (data.error) reject(new Error(data.error));
      else resolve(data.text || '');
    };
    current.onerror = () => {
      clear();
      current.terminate();
      worker = null;
      reject(new Error('Local transcription could not run in this browser.'));
    };
    current.postMessage({ pcm }, [pcm.buffer]);
  });
}
