import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// In-app viewer for photos and videos. Opens over the page instead of a new tab.
// items: [{ url, alt?, type?: 'photo' | 'video' }]. index: number to show, or null when closed.
// onIndex(n) moves to another item; onIndex(null) closes.
// actions(item, index): optional list of buttons for the bottom action bar,
//   [{ key, label, onClick, pressed?: boolean, disabled?: boolean }]. Callers only pass what the role can do.
// Closes on a tap outside the picture, the X button, or Escape. Previous/Next buttons, arrow keys and swipe step through the list.
export default function PhotoViewer({ items, index, onIndex, actions }) {
  const open = index !== null && index !== undefined && items && items[index];
  const touch = useRef(null);
  const count = items ? items.length : 0;
  const close = () => onIndex(null);
  const hasPrev = index > 0;
  const hasNext = index < count - 1;
  const step = (d) => {
    const n = index + d;
    if (n >= 0 && n < count) onIndex(n);
  };

  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  });

  if (!open) return null;
  const item = items[index];
  const stop = (e) => e.stopPropagation();
  const onTouchStart = (e) => { touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touch.current === null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  };
  const bar = (actions ? actions(item, index) : null) || [];
  // Large Previous / Next buttons, always visible on phone and desktop, hidden at the ends of the list.
  const navButton = (d) => {
    const show = d > 0 ? hasNext : hasPrev;
    if (!show) return null;
    return (
      <button type="button" onClick={(e) => { stop(e); step(d); }} aria-label={d > 0 ? 'Next photo' : 'Previous photo'}
        className={`absolute top-1/2 z-10 ${d > 0 ? 'right-2 sm:right-5' : 'left-2 sm:left-5'} flex h-14 w-14 min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-4xl leading-none text-ink shadow-lg hover:bg-white sm:h-16 sm:w-16`}>
        <span aria-hidden="true">{d > 0 ? '›' : '‹'}</span>
      </button>
    );
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={close} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-2 sm:p-6 ${bar.length ? 'pb-24' : ''}`}>
      {item.type === 'video' ? (
        <video key={item.url} src={item.url} controls autoPlay playsInline onClick={stop} className="max-h-[80vh] max-w-full rounded-lg bg-black" />
      ) : (
        <img src={item.url} alt={item.alt || 'Photo'} onClick={stop} className={`${bar.length ? 'max-h-[78vh]' : 'max-h-[90vh]'} max-w-full select-none object-contain`} />
      )}
      {navButton(-1)}{navButton(1)}
      <button type="button" onClick={(e) => { stop(e); close(); }} aria-label="Close"
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-xl leading-none text-ink shadow hover:bg-white">
        ×
      </button>
      {count > 1 && (
        <span className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white ${bar.length ? 'top-4' : 'bottom-3'}`}>
          {index + 1} / {count}
        </span>
      )}
      {bar.length > 0 && (
        <div role="toolbar" aria-label="Photo actions" data-viewer-actions onClick={stop}
          className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-2 bg-black/70 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          {bar.map((a) => (
            <button key={a.key} type="button" disabled={a.disabled} aria-pressed={a.pressed === undefined ? undefined : Boolean(a.pressed)}
              onClick={(e) => { stop(e); a.onClick(); }}
              className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold disabled:opacity-40 ${a.pressed ? 'bg-white text-ink' : 'border border-white/60 text-white hover:bg-white/15'}`}>
              {a.pressed ? '✓ ' : ''}{a.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

// Overlay bar along the bottom of a photo thumbnail. Put it inside a `relative group` wrapper around the image.
// Shows on hover (or keyboard focus) on desktop; always visible, subtle, on touch devices.
// buttons: [{ key, icon, label, onClick, pressed?: boolean, disabled?: boolean }]. Clicks never reach the thumbnail.
export function ThumbOverlay({ buttons }) {
  if (!buttons || !buttons.length) return null;
  return (
    // The bar itself lets taps through (pointer-events-none), so a tap anywhere on the photo opens it;
    // only the small buttons catch their own taps.
    <div data-thumb-overlay
      className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1.5 pt-5 opacity-90 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
      {buttons.map((b) => (
        <button key={b.key} type="button" title={b.label} aria-label={b.label} disabled={b.disabled}
          aria-pressed={b.pressed === undefined ? undefined : Boolean(b.pressed)}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); b.onClick(); }}
          className={`pointer-events-auto flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-xs font-semibold shadow disabled:opacity-40 ${b.pressed ? 'bg-ink text-white ring-1 ring-white' : 'bg-white/90 text-ink hover:bg-white'}`}>
          <span aria-hidden="true">{b.icon}</span>
        </button>
      ))}
    </div>
  );
}
