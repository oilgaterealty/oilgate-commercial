import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;

let recognizer;

self.onmessage = async ({ data: { jobId, pcm, part = 1, totalParts = 1 } }) => {
  try {
    if (!recognizer) {
      self.postMessage({ jobId, phase: 'Loading local Whisper model…' });
      recognizer = pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: ({ status, progress }) => {
          if (status === 'initiate' || status === 'download' || status === 'progress') {
            const pct = typeof progress === 'number' && Number.isFinite(progress) ? ` (${Math.round(progress)}%)` : '';
            self.postMessage({ jobId, phase: `Loading local Whisper model${pct}…` });
          }
        },
      });
    }
    const transcribe = await recognizer;
    self.postMessage({
      jobId,
      phase: totalParts > 1 ? `Transcribing part ${part}/${totalParts} with local Whisper…` : 'Transcribing with local Whisper…',
    });
    const { text } = await transcribe(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    self.postMessage({ jobId, text: (text || '').trim() });
  } catch (err) {
    recognizer = undefined;
    self.postMessage({
      jobId,
      error: err?.message
        ? `Local Whisper could not finish (${err.message.slice(0, 80)}). Check connection and retry.`
        : 'Local Whisper could not finish. Check connection for the first download and try again.',
    });
  }
};
