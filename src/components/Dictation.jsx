import { useEffect, useRef, useState } from 'react';
import { spokenNumber } from '../lib/spokenNumber.js';

let activeMic;
const glyph = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6"/></svg>;

export function DictationMic({ label = 'this field', disabled, onText }) {
  const [state, setState] = useState('idle');
  const [status, setStatus] = useState('');
  const scope = useRef({ recorder: null, stream: null, timer: null, abort: null });
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => {
    const s = scope.current;
    s.abort?.abort();
    clearTimeout(s.timer);
    if (s.recorder?.state === 'recording') s.recorder.stop();
    s.stream?.getTracks().forEach((x) => x.stop());
    if (activeMic === s) activeMic = null;
  }, []);

  const toggle = async () => {
    const s = scope.current;
    if (state === 'recording') { s.recorder?.stop(); return; }
    if (state !== 'idle') return;
    if (activeMic && activeMic !== s) return setStatus('Finish the other recording first.');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return setStatus('Microphone is unavailable in this browser.');
    activeMic = s;
    const abort = s.abort = new AbortController();
    setStatus(''); setState('opening');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (abort.signal.aborted) { stream.getTracks().forEach((x) => x.stop()); return; }
      s.stream = stream;
      const codec = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((x) => MediaRecorder.isTypeSupported?.(x));
      const recorder = s.recorder = new MediaRecorder(stream, codec ? { mimeType: codec } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { if (recorder.state === 'recording') recorder.stop(); };
      recorder.onstop = async () => {
        clearTimeout(s.timer);
        stream.getTracks().forEach((x) => x.stop());
        if (abort.signal.aborted) return;
        setState('working');
        setStatus('Loading local Whisper…');
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (!blob.size) throw new Error('Nothing was recorded. Try again.');
          const { transcribe } = await import('../lib/dictation.js');
          const result = await transcribe(blob, setStatus, abort.signal);
          if (abort.signal.aborted) return;
          if (!result.trim()) throw new Error('No speech detected. Try again.');
          await cb.current(result, blob);
          if (!abort.signal.aborted) setStatus('Dictation ready.');
        } catch (e) { if (!abort.signal.aborted) setStatus(e.message); }
        finally {
          if (activeMic === s) activeMic = null;
          if (!abort.signal.aborted) setState('idle');
        }
      };
      recorder.start();
      setState('recording'); setStatus('Recording · tap to stop');
      s.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 60_000);
    } catch {
      s.stream?.getTracks().forEach((x) => x.stop());
      if (activeMic === s) activeMic = null;
      if (!abort.signal.aborted) { setState('idle'); setStatus('Could not start the microphone. Check browser permission.'); }
    }
  };
  return <span className="contents">
    <button type="button" aria-label={state === 'recording' ? `Stop dictating ${label}` : `Dictate ${label}`}
      title={state === 'recording' ? 'Stop recording' : 'Dictate with local Whisper'}
      disabled={disabled || (state !== 'idle' && state !== 'recording')} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggle(); }}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line disabled:opacity-40 ${state === 'recording' ? 'bg-red-50 text-red-700' : 'bg-white hover:bg-warm-soft'}`}>
      {state === 'recording' ? <span aria-hidden="true">■</span> : glyph}
    </button>
    <span role="status" className={`basis-full text-xs text-ink-soft ${status ? '' : 'sr-only'}`}>{status}</span>
  </span>;
}

export function DictatedField({ as: Tag = 'input', className, ref: outerRef, onChange, ...props }) {
  const input = useRef(null);
  const writable = !props.disabled && !props.readOnly && Boolean(onChange);
  const setRef = (el) => {
    input.current = el;
    if (typeof outerRef === 'function') outerRef(el);
    else if (outerRef) outerRef.current = el;
  };
  const write = (text) => {
    if (!writable || !input.current) return;
    const el = input.current;
    const old = el.value;
    let result;
    if (props.type === 'number') {
      result = spokenNumber(text);
      if (result === null) throw new Error('No single number detected. Try dictating the value again.');
    } else if (['email','url','tel'].includes(props.type)) {
      result = text.trim().replace(/[.?!]+$/, '').replace(/\s+/g, '');
    } else {
      const spoken = text.trim();
      result = old.trim() ? `${old.trimEnd()} ${spoken}` : spoken;
    }
    if (props.maxLength > 0) result = result.slice(0, props.maxLength);
    onChange({ target: { value: result }, currentTarget: { value: result } });
  };
  return <span className={`inline-flex max-w-full min-w-0 flex-wrap items-start gap-1.5 align-middle ${className?.includes('w-full') ? 'w-full' : ''}`}>
    <Tag {...props} ref={setRef} onChange={onChange} className={`min-w-0 ${className?.includes('w-full') ? 'flex-1' : ''} ${className || ''}`}/>
    <DictationMic label={props['aria-label'] || props.placeholder || 'this field'} disabled={!writable} onText={write} />
  </span>;
}
