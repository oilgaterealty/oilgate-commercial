import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TARGET_SAMPLE_RATE, concatFloat32, encodeWav16kMono } from '../src/lib/audioStitch.js';
import { createMediaCoordinator } from '../src/lib/mediaCoordinator.js';
import {
  AUDIO_STATUS,
  applySessionPatch,
  canReportVoiceNoteSynced,
  makeScopeKey,
} from '../src/lib/walkthroughStore.js';
import { MAX_RECORDING_MS, WHISPER_ENGINE_LABEL } from '../src/lib/dictation.js';

test('audioStitch concatenates PCM segments and encodes valid 16 kHz mono WAV header', () => {
  const a = new Float32Array([0, 0.5, -0.5]);
  const b = new Float32Array([0.25, -1]);
  const merged = concatFloat32([a, new Float32Array(0), b]);
  assert.equal(merged.length, 5);
  assert.equal(merged[3], 0.25);

  const wav = encodeWav16kMono(merged, TARGET_SAMPLE_RATE);
  assert.equal(wav.byteLength, 44 + 5 * 2);
  const view = new DataView(wav);
  const tag = (off) => String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(12), 'fmt ');
  assert.equal(tag(36), 'data');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 10);
});

test('mediaCoordinator prevents competing audio recorders while permitting concurrent photo camera', async () => {
  const coord = createMediaCoordinator();
  let paused = false;
  const fakeStream = { id: 'mic-stream' };

  assert.equal(coord.acquire('walkthrough-voice', {
    unit: 1,
    room: 'kitchen',
    onPauseRequest: async () => {
      paused = true;
      coord.release('walkthrough-voice');
      return fakeStream;
    },
  }).ok, true);

  // Photo capture can run concurrently with active voice narration.
  assert.equal(coord.canRunPhotoCamera(), true);

  // Field dictation cannot compete while walkthrough voice holds the mic lock.
  const denied = coord.acquire('field-dictation');
  assert.equal(denied.ok, false);
  assert.match(denied.message, /Pause or stop/i);

  // Video capture triggers clean voice pause & handoff instead of starting a second mic recorder.
  const handoff = await coord.prepareVideoHandoff();
  assert.equal(paused, true);
  assert.equal(handoff.handedOffFromVoice, true);
  assert.equal(handoff.stream, fakeStream);

  assert.equal(coord.acquire('walkthrough-video', { unit: 1, room: 'kitchen' }).ok, true);
  coord.release('walkthrough-video');
  assert.equal(coord.getState().owner, 'none');
});

test('walkthroughStore scopes by user/deal, locks immutable unit/room, and blocks sync success without audio path', () => {
  assert.equal(makeScopeKey('deal-1', 'user-a'), 'deal-1:user-a');
  assert.notEqual(makeScopeKey('deal-1', 'user-a'), makeScopeKey('deal-1', 'user-b'));

  assert.equal(canReportVoiceNoteSynced(null), false);
  assert.equal(canReportVoiceNoteSynced({ remoteId: 'note-1', remoteStoragePath: null }), false);
  assert.equal(canReportVoiceNoteSynced({ remoteId: 'note-1', remoteStoragePath: '' }), false);
  assert.equal(canReportVoiceNoteSynced({ remoteId: null, remoteStoragePath: 'commercial-v5/x/y/z.webm' }), false);
  assert.equal(
    canReportVoiceNoteSynced({ remoteId: 'note-1', remoteStoragePath: 'commercial-v5/d/walkthrough/u/f.webm' }),
    true
  );

  const original = {
    id: 's1',
    dealId: 'd1',
    userUid: 'u1',
    scopeKey: 'd1:u1',
    unitNumber: 2,
    room: 'bath',
    status: AUDIO_STATUS.RECORDING,
    rawTranscript: '',
    createdAt: 100,
  };
  const patched = applySessionPatch(original, {
    unitNumber: 9,
    room: 'kitchen',
    userUid: 'attacker',
    status: AUDIO_STATUS.READY,
    rawTranscript: 'Bathroom vanity needs caulking',
  });
  assert.equal(patched.unitNumber, 2);
  assert.equal(patched.room, 'bath');
  assert.equal(patched.userUid, 'u1');
  assert.equal(patched.status, AUDIO_STATUS.READY);
  assert.equal(patched.rawTranscript, 'Bathroom vanity needs caulking');
});

test('dictation allows long continuous narration (no 2-minute cutoff) and declares local Whisper', () => {
  assert.ok(MAX_RECORDING_MS >= 1_800_000);
  assert.match(WHISPER_ENGINE_LABEL, /Local Whisper/i);
});

test('mobile CSS, Shell tabs, and Walkthrough enforce non-shrinking nav pills and room-first layout', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /\.nav-tabs\s*>\s*a[^}]*flex:\s*0 0 auto/);
  assert.match(css, /min-width:\s*max-content/);

  const shell = readFileSync(new URL('../src/components/Shell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /aria-label="Deal sections"/);
  assert.match(shell, /shrink-0/);
  assert.match(shell, /aria-current=\{active === k \? 'location' : undefined\}/);

  const walkthrough = readFileSync(new URL('../src/views/Walkthrough.jsx', import.meta.url), 'utf8');
  assert.match(walkthrough, /All units progress/);
  assert.match(walkthrough, /aria-expanded=\{showMatrix\}/);
  assert.match(walkthrough, /Take photos/);
  assert.match(walkthrough, /Record video/);
  assert.match(walkthrough, /50 MB/);
  assert.doesNotMatch(walkthrough, /good\/fix\/replace|condition score|checklist/i);
});
