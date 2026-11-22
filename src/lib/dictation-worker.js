import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;

let recognizer;

self.onmessage = async ({ data: { pcm } }) => {
  try {
    if (!recognizer) {
      self.postMessage({ phase: 'Loading voice model…' });
      recognizer = pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: ({ status }) => {
          if (status === 'initiate' || status === 'download' || status === 'progress') {
            self.postMessage({ phase: 'Loading voice model…' });
          }
        },
      });
    }
    const transcribe = await recognizer;
    self.postMessage({ phase: 'Transcribing…' });
    const { text } = await transcribe(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    self.postMessage({ text: (text || '').trim() });
  } catch (err) {
    recognizer = undefined;
    self.postMessage({
      error: err?.message
        ? `Voice model could not finish (${err.message.slice(0, 80)}). Check connection and retry.`
        : 'Voice model could not finish. Check connection for the first download and try again.',
    });
  }
};
