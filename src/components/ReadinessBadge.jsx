import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { READINESS_PRESETS, readinessTone } from '../lib/readiness.js';

export default function ReadinessBadge({ unitNumber, label, editable = false, onSave, compact = false, className = '' }) {
  const text = String(label || '').trim() || 'Not entered';
  const tone = readinessTone(text);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(text); }, [text]);

  useEffect(() => {
    if (!pos) return undefined;
    const outside = (e) => {
      if (!triggerRef.current?.contains(e.target) && !popupRef.current?.contains(e.target)) setPos(null);
    };
    const escape = (e) => { if (e.key === 'Escape') setPos(null); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [pos]);

  const cls = `inline-flex items-center rounded-full border font-medium leading-tight ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'} ${tone} ${className}`;
  if (!editable) return <span className={cls}>{text}</span>;

  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 12));
    setPos({ width, left, top: r.bottom + window.scrollY + 6 });
  };

  const commit = async (val) => {
    if (busy || !onSave) return;
    setBusy(true);
    try {
      await onSave(unitNumber, val);
      setPos(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Unit ${unitNumber} readiness: ${text}`}
        aria-expanded={!!pos}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={`${cls} cursor-pointer hover:ring-2 hover:ring-ink/30`}
      >
        {text}
      </button>
      {pos && createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label={`Set Unit ${unitNumber} readiness`}
          style={pos}
          className="absolute z-50 rounded-2xl border border-line bg-white p-3 text-xs shadow-xl"
        >
          <div className="mb-2 font-semibold text-ink">Unit {unitNumber} readiness</div>
          <div className="flex flex-wrap gap-1.5">
            {READINESS_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={busy}
                onClick={() => void commit(preset)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${readinessTone(preset)} hover:ring-2 hover:ring-ink/30`}
              >
                {preset}
              </button>
            ))}
          </div>
          <form
            className="mt-2.5 flex gap-1.5"
            onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void commit(draft.trim()); }}
          >
            <input
              type="text"
              maxLength={80}
              aria-label={`Custom readiness for Unit ${unitNumber}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-xs text-ink outline-none focus:border-ink"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
          </form>
        </div>,
        document.body
      )}
    </>
  );
}
