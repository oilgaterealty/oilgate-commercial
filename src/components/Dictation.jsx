import { useEffect, useRef, useState } from 'react';
import { MAX_RECORDING_MS } from '../lib/dictation.js';
import { mediaCoordinator } from '../lib/mediaCoordinator.js';

const NON_TEXT_TYPES = new Set(['number', 'email', 'password', 'tel', 'url', 'date', 'time', 'hidden', 'checkbox', 'radio', 'file']);

export function isFreeTextField(as, type, inputMode, noDictation) {
  if (noDictation) return false;
  if (as === 'textarea') return true;
  if (type && NON_TEXT_TYPES.has(String(type).toLowerCase())) return false;
  if (inputMode && ['decimal', 'numeric'].includes(String(inputMode).toLowerCase())) return false;
  return true;
}

export function insertAtCursor(current, spoken, start, end, maxLength) {
  const clean = String(spoken || '').trim();
  const base = String(current || '');
  if (!clean) return { value: base, cursor: end ?? base.length };
  const s = Number.isInteger(start) && start >= 0 && start <= base.length ? start : base.length;
  const e = Number.isInteger(end) && end >= s && end <= base.length ? end : s;
  const before = base.slice(0, s);
  const after = base.slice(e);
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  const inserted = `${lead}${clean}${trail}`;
  let next = before + inserted + after;
  let cursor = before.length + lead.length + clean.length;
  if (maxLength > 0 && next.length > maxLength) {
    next = next.slice(0, maxLength);
    cursor = Math.min(cursor, maxLength);
  }
  return { value: next, cursor };
}

const MicIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="9" y="2" width="6" height="13" rx="3" />
    <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6" />
  </svg>
);

export function DictationMic({ label = 'this field', buttonText, disabled, onText }) {
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
    mediaCoordinator.release('field-dictation');
  }, []);

  const toggle = async () => {
    const s = scope.current;
    if (state === 'recording') {
      s.recorder?.stop();
      return;
    }
    if (state !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Microphone is unavailable in this browser.');
      return;
    }
    const lock = mediaCoordinator.acquire('field-dictation');
    if (!lock.ok) {
      setStatus(lock.message);
      return;
    }
    const abort = (s.abort = new AbortController());
    setStatus('');
    setState('opening');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (abort.signal.aborted) {
        stream.getTracks().forEach((x) => x.stop());
        mediaCoordinator.release('field-dictation');
        return;
      }
      s.stream = stream;
      const codec = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(
        (x) => MediaRecorder.isTypeSupported?.(x)
      );
      const recorder = (s.recorder = new MediaRecorder(stream, codec ? { mimeType: codec } : undefined));
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { if (recorder.state === 'recording') recorder.stop(); };
      recorder.onstop = async () => {
        clearTimeout(s.timer);
        stream.getTracks().forEach((x) => x.stop());
        mediaCoordinator.release('field-dictation');
        if (abort.signal.aborted) return;
        setState('working');
        setStatus('Loading voice model…');
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || codec || 'audio/webm' });
          if (!blob.size) throw new Error('Nothing was recorded. Try again.');
          const { transcribe } = await import('../lib/dictation.js');
          const result = await transcribe(blob, setStatus, abort.signal);
          if (abort.signal.aborted) return;
          if (!result.trim()) throw new Error('No speech detected. Try again.');
          await cb.current(result, blob);
          if (!abort.signal.aborted) setStatus('Done.');
        } catch (e) {
          if (!abort.signal.aborted) setStatus(e.message || 'Dictation failed.');
        } finally {
          if (!abort.signal.aborted) setState('idle');
        }
      };
      recorder.start(1000);
      setState('recording');
      setStatus('Recording… tap to stop');
      s.timer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, MAX_RECORDING_MS);
    } catch {
      s.stream?.getTracks().forEach((x) => x.stop());
      mediaCoordinator.release('field-dictation');
      if (!abort.signal.aborted) {
        setState('idle');
        setStatus('Could not start the microphone. Check browser permission.');
      }
    }
  };

  return (
    <span className="contents">
      <button
        type="button"
        aria-label={state === 'recording' ? `Stop dictating ${label}` : `Dictate ${label}`}
        title={state === 'recording' ? 'Stop recording' : 'Dictate with voice'}
        disabled={disabled || (state !== 'idle' && state !== 'recording')}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line disabled:opacity-40 ${
          buttonText ? 'h-9 px-3 text-sm font-medium' : 'h-8 w-8'
        } ${state === 'recording' ? 'border-red-300 bg-red-50 text-red-700' : 'bg-white text-ink hover:bg-warm-soft'}`}
      >
        {state === 'recording' ? <span aria-hidden="true">■</span> : MicIcon}
        {buttonText && <span>{state === 'recording' ? 'Stop' : buttonText}</span>}
      </button>
      <span role="status" className={`basis-full text-xs text-ink-soft ${status ? '' : 'sr-only'}`}>{status}</span>
    </span>
  );
}

export function DictatedField({ as: Tag = 'input', className = '', ref: outerRef, onChange, noDictation, ...props }) {
  const input = useRef(null);
  const sel = useRef({ start: null, end: null });
  const allowDictation = isFreeTextField(Tag, props.type, props.inputMode, noDictation);
  const writable = !props.disabled && !props.readOnly && Boolean(onChange);

  const setRef = (el) => {
    input.current = el;
    if (typeof outerRef === 'function') outerRef(el);
    else if (outerRef) outerRef.current = el;
  };

  if (!allowDictation) {
    return <Tag {...props} ref={setRef} onChange={onChange} className={className} />;
  }

  const rememberCursor = (e) => {
    const el = e.currentTarget;
    if (typeof el.selectionStart === 'number') {
      sel.current = { start: el.selectionStart, end: el.selectionEnd };
    }
  };

  const write = (text) => {
    if (!writable || !input.current) return;
    const el = input.current;
    const { value, cursor } = insertAtCursor(el.value, text, sel.current.start, sel.current.end, props.maxLength);
    onChange({ target: { value }, currentTarget: { value } });
    sel.current = { start: cursor, end: cursor };
    requestAnimationFrame(() => {
      try {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      } catch {}
    });
  };

  const stretch = className.includes('w-full') || className.includes('flex-1');
  return (
    <span className={`inline-flex max-w-full min-w-0 flex-wrap items-start gap-1.5 align-middle ${stretch ? 'w-full flex-1' : ''}`}>
      <Tag
        {...props}
        ref={setRef}
        onChange={onChange}
        onSelect={(e) => { rememberCursor(e); props.onSelect?.(e); }}
        onKeyUp={(e) => { rememberCursor(e); props.onKeyUp?.(e); }}
        onClick={(e) => { rememberCursor(e); props.onClick?.(e); }}
        onBlur={(e) => { rememberCursor(e); props.onBlur?.(e); }}
        className={`min-w-0 ${stretch ? 'flex-1' : ''} ${className}`}
      />
      <DictationMic label={props['aria-label'] || props.placeholder || 'this field'} disabled={!writable} onText={write} />
    </span>
  );
}
