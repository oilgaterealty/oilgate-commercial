export function createMediaCoordinator() {
  let state = {
    owner: 'none', // 'none' | 'walkthrough-voice' | 'walkthrough-video' | 'field-dictation'
    unit: null,
    room: null,
    onPauseRequest: null,
  };
  const listeners = new Set();

  const notify = () => {
    const snap = getState();
    for (const fn of listeners) {
      try { fn(snap); } catch {}
    }
  };

  function getState() {
    return { owner: state.owner, unit: state.unit, room: state.room };
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function acquire(owner, meta = {}) {
    if (state.owner !== 'none' && state.owner !== owner) {
      const msg =
        state.owner === 'walkthrough-voice'
          ? 'Walkthrough voice recording is active. Pause or stop it first.'
          : state.owner === 'walkthrough-video'
            ? 'Walkthrough video recording is active. Finish it first.'
            : 'Finish the active voice dictation first.';
      return { ok: false, activeOwner: state.owner, message: msg };
    }
    state = {
      owner,
      unit: meta.unit ?? null,
      room: meta.room ?? null,
      onPauseRequest: typeof meta.onPauseRequest === 'function' ? meta.onPauseRequest : null,
    };
    notify();
    return { ok: true };
  }

  function release(owner) {
    if (owner && state.owner !== owner) return;
    if (state.owner === 'none') return;
    state = { owner: 'none', unit: null, room: null, onPauseRequest: null };
    notify();
  }

  function canRunPhotoCamera() {
    // Photo capture uses audio: false so it can run concurrently with walkthrough voice narration.
    return true;
  }

  async function prepareVideoHandoff() {
    if (state.owner === 'walkthrough-voice' && state.onPauseRequest) {
      const stream = await state.onPauseRequest();
      return { handedOffFromVoice: true, stream: stream || null };
    }
    return { handedOffFromVoice: false, stream: null };
  }

  return {
    getState,
    subscribe,
    acquire,
    release,
    canRunPhotoCamera,
    prepareVideoHandoff,
  };
}

export const mediaCoordinator = createMediaCoordinator();
