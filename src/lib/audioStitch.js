export const TARGET_SAMPLE_RATE = 16000;

export function concatFloat32(arrays) {
  const valid = (arrays || []).filter((a) => a && a.length > 0);
  const total = valid.reduce((sum, a) => sum + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const arr of valid) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

export function encodeWav16kMono(float32Pcm, sampleRate = TARGET_SAMPLE_RATE) {
  const samples = float32Pcm || new Float32Array(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let pos = 44;
  for (let i = 0; i < samples.length; i++, pos += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export async function decodeBlobTo16kPcm(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Context || !Offline) throw new Error('This browser cannot decode audio.');
  const ctx = new Context();
  let original;
  try {
    original = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await ctx.close().catch(() => {});
  }
  if (!(original?.duration > 0)) {
    throw new Error('Recorded audio has no playable sound.');
  }
  const frameCount = Math.max(1, Math.ceil(original.duration * TARGET_SAMPLE_RATE));
  const offline = new Offline(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = original;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

export async function decodeSegmentsTo16kPcm(segmentBlobs) {
  const valid = (segmentBlobs || []).filter((b) => b && b.size > 0);
  if (!valid.length) throw new Error('Nothing was recorded. Try again.');
  const parts = [];
  const errors = [];
  for (const blob of valid) {
    try {
      const pcm = await decodeBlobTo16kPcm(blob);
      if (pcm.length > 0) parts.push(pcm);
    } catch (e) {
      errors.push(e?.message || 'Segment decode failed');
    }
  }
  if (!parts.length) {
    throw new Error(errors[0] || 'This browser could not decode the recorded audio.');
  }
  const pcm = concatFloat32(parts);
  return {
    pcm,
    durationSec: Math.max(1, Math.round(pcm.length / TARGET_SAMPLE_RATE)),
    decodedCount: parts.length,
    errors,
  };
}

export async function assembleSessionAudio(segmentBlobs, primaryMime = 'audio/webm') {
  const valid = (segmentBlobs || []).filter((b) => b && b.size > 0);
  if (!valid.length) throw new Error('No recorded audio chunks found.');
  if (valid.length === 1) {
    return {
      blob: valid[0],
      mimeType: (valid[0].type || primaryMime || 'audio/webm').split(';')[0],
      stitched: false,
      durationSec: null,
    };
  }
  const { pcm, durationSec } = await decodeSegmentsTo16kPcm(valid);
  const wav = encodeWav16kMono(pcm, TARGET_SAMPLE_RATE);
  return {
    blob: new Blob([wav], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    stitched: true,
    durationSec,
  };
}
