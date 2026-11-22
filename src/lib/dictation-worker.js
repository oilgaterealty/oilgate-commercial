import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
let recognizer;
self.onmessage = async ({ data: { pcm } }) => {
  try {
    recognizer ??= pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      device: 'wasm', dtype: 'q8', revision: '794207fec2761281fe63a23a94b7e9f53a4efbc1',
      progress_callback: ({ status }) => {
        if (status === 'progress') self.postMessage({ phase: 'Downloading Whisper the first time…' });
      },
    });
    const transcribe = await recognizer;
    self.postMessage({ phase: 'Transcribing locally…' });
    const { text } = await transcribe(pcm, { chunk_length_s: 25, stride_length_s: 3, return_timestamps: false });
    self.postMessage({ text });
  } catch {
    recognizer = undefined;
    self.postMessage({ error: 'Whisper could not finish. Check your connection for the first download and try again.' });
  }
};
