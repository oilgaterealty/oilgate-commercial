import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function distanceBetween(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

// Full-screen in-app viewer for photos and videos: swipe left/right, pinch/double-tap zoom,
// swipe down or X/Escape to close, unit/area grouping, and thumbnail grid toggle.
// items: [{ url, alt?, type?: 'photo' | 'video', group?: string, groupLabel?: string }].
// index: number to show, or null when closed. onIndex(n) steps; onIndex(null) closes.
// actions(item, index): optional list of buttons for the bottom action bar.
export default function PhotoViewer({ items, index, onIndex, actions, onOpenUnitGallery }) {
  const open = index !== null && index !== undefined && items && items[index];
  const count = items ? items.length : 0;
  const [gridOpen, setGridOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState('all');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragY, setDragY] = useState(0);

  const gesture = useRef({
    mode: null,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    pinchStartDist: 0,
    pinchStartScale: 1,
    lastTapAt: 0,
  });

  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragY(0);
  };

  const close = () => {
    setGridOpen(false);
    setActiveGroup('all');
    resetZoom();
    onIndex(null);
  };

  const hasPrev = index > 0;
  const hasNext = index < count - 1;
  const step = (d) => {
    const n = index + d;
    if (n >= 0 && n < count) {
      resetZoom();
      onIndex(n);
    }
  };

  const groups = useMemo(() => {
    const seen = new Map();
    (items || []).forEach((it, idx) => {
      const key = it?.group || it?.groupLabel || '';
      const label = it?.groupLabel || it?.group || '';
      if (!key || !label) return;
      if (!seen.has(key)) seen.set(key, { key, label, firstIndex: idx, count: 1 });
      else seen.get(key).count += 1;
    });
    return [...seen.values()];
  }, [items]);

  useEffect(() => {
    resetZoom();
  }, [index]);

  useEffect(() => {
    if (!open) {
      setGridOpen(false);
      setActiveGroup('all');
      resetZoom();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => {
      if (e.key === 'Escape') {
        if (gridOpen) setGridOpen(false);
        else close();
      }
      if (!gridOpen) {
        if (e.key === 'ArrowRight') step(1);
        if (e.key === 'ArrowLeft') step(-1);
      }
    };
    window.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  });

  if (!open) return null;
  const item = items[index];
  const stop = (e) => e.stopPropagation();

  const toggleZoom = () => {
    if (item.type === 'video') return;
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2.5);
      setOffset({ x: 0, y: 0 });
    }
  };

  const onTouchStart = (e) => {
    if (gridOpen) return;
    if (e.touches.length === 2) {
      gesture.current.mode = 'pinch';
      gesture.current.pinchStartDist = distanceBetween(e.touches[0], e.touches[1]);
      gesture.current.pinchStartScale = scale;
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const now = Date.now();
    if (now - gesture.current.lastTapAt < 280 && item.type !== 'video') {
      gesture.current.lastTapAt = 0;
      gesture.current.mode = null;
      toggleZoom();
      return;
    }
    gesture.current.lastTapAt = now;
    gesture.current.startX = t.clientX;
    gesture.current.startY = t.clientY;
    gesture.current.startOffsetX = offset.x;
    gesture.current.startOffsetY = offset.y;
    gesture.current.mode = scale > 1 ? 'pan' : 'swipe';
  };

  const onTouchMove = (e) => {
    if (gridOpen) return;
    if (gesture.current.mode === 'pinch' && e.touches.length === 2) {
      const dist = distanceBetween(e.touches[0], e.touches[1]);
      if (gesture.current.pinchStartDist > 0) {
        const nextScale = Math.min(4, Math.max(1, gesture.current.pinchStartScale * (dist / gesture.current.pinchStartDist)));
        setScale(nextScale);
        if (nextScale <= 1.02) setOffset({ x: 0, y: 0 });
      }
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - gesture.current.startX;
    const dy = t.clientY - gesture.current.startY;
    if (gesture.current.mode === 'pan' && scale > 1) {
      setOffset({
        x: Math.max(-240, Math.min(240, gesture.current.startOffsetX + dx)),
        y: Math.max(-240, Math.min(240, gesture.current.startOffsetY + dy)),
      });
    } else if (gesture.current.mode === 'swipe' && dy > 16 && dy > Math.abs(dx)) {
      setDragY(Math.min(180, dy));
    }
  };

  const onTouchEnd = (e) => {
    if (gridOpen) return;
    if (gesture.current.mode === 'pinch') {
      if (scale < 1.1) resetZoom();
      gesture.current.mode = null;
      return;
    }
    if (gesture.current.mode === 'swipe' && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const dx = t.clientX - gesture.current.startX;
      const dy = t.clientY - gesture.current.startY;
      setDragY(0);
      gesture.current.mode = null;
      if (dy > 80 && dy > Math.abs(dx) * 1.2) {
        close();
        return;
      }
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        step(dx < 0 ? 1 : -1);
      }
      return;
    }
    gesture.current.mode = null;
    setDragY(0);
  };

  const bar = (actions ? actions(item, index) : null) || [];
  const navButton = (d) => {
    if (gridOpen || scale > 1) return null;
    const show = d > 0 ? hasNext : hasPrev;
    if (!show) return null;
    return (
      <button type="button" onClick={(e) => { stop(e); step(d); }} aria-label={d > 0 ? 'Next photo' : 'Previous photo'}
        className={`absolute top-1/2 z-10 ${d > 0 ? 'right-2 sm:right-5' : 'left-2 sm:left-5'} flex h-14 w-14 min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-4xl leading-none text-ink shadow-lg hover:bg-white sm:h-16 sm:w-16`}>
        <span aria-hidden="true">{d > 0 ? '›' : '‹'}</span>
      </button>
    );
  };

  const visibleGridGroups = activeGroup === 'all'
    ? groups
    : groups.filter((g) => g.key === activeGroup);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={close} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 p-2 sm:p-6 ${bar.length && !gridOpen ? 'pb-24' : ''}`}>

      {/* Top bar: count, current unit/area label, thumbnail grid toggle, and Close */}
      <div onClick={stop} className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/75 to-transparent px-3 pt-3 pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <span data-viewer-count className="shrink-0 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold tabular-nums text-white">
            {index + 1} / {count}
          </span>
          {item.groupLabel && (
            <span className="truncate rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white">
              {item.groupLabel}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onOpenUnitGallery && (
            <button
              type="button"
              data-open-unit-gallery
              onClick={(e) => {
                stop(e);
                close();
                onOpenUnitGallery();
              }}
              className="inline-flex h-11 items-center justify-center rounded-full bg-white/90 px-3 text-xs font-semibold text-ink shadow hover:bg-white"
            >
              All photos by unit
            </button>
          )}
          {count > 1 && (
            <button
              type="button"
              data-viewer-grid-toggle
              aria-label={gridOpen ? 'Back to photo' : 'Photo grid'}
              aria-pressed={gridOpen}
              onClick={(e) => { stop(e); setGridOpen((v) => !v); }}
              className={`flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow ${
                gridOpen ? 'bg-ink text-white ring-1 ring-white' : 'bg-white/90 text-ink hover:bg-white'
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
                <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
                <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
                <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
              </svg>
              <span className="hidden sm:inline">{gridOpen ? 'Single' : 'All'}</span>
            </button>
          )}
          <button type="button" onClick={(e) => { stop(e); close(); }} aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-xl leading-none text-ink shadow hover:bg-white">
            ×
          </button>
        </div>
      </div>

      {gridOpen ? (
        <div data-viewer-grid onClick={stop} className="mt-14 flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-black/40 p-3 sm:p-4">
          {groups.length > 1 && (
            <div className="mb-3 flex shrink-0 gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter photos by area">
              <button
                type="button"
                aria-pressed={activeGroup === 'all'}
                onClick={() => setActiveGroup('all')}
                className={`min-h-[38px] shrink-0 rounded-full px-3 text-xs font-semibold ${activeGroup === 'all' ? 'bg-white text-ink' : 'bg-white/15 text-white hover:bg-white/25'}`}
              >
                All ({count})
              </button>
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  aria-pressed={activeGroup === g.key}
                  onClick={() => setActiveGroup(g.key)}
                  className={`min-h-[38px] shrink-0 rounded-full px-3 text-xs font-semibold ${activeGroup === g.key ? 'bg-white text-ink' : 'bg-white/15 text-white hover:bg-white/25'}`}
                >
                  {g.label} ({g.count})
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 space-y-5 overflow-y-auto pr-1">
            {groups.length > 0 ? visibleGridGroups.map((g) => {
              const groupItems = items
                .map((it, i) => ({ it, i }))
                .filter(({ it }) => (it.group || it.groupLabel) === g.key);
              return (
                <section key={g.key}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/80">{g.label}</h3>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {groupItems.map(({ it, i }) => (
                      <button
                        key={it.url + '-' + i}
                        type="button"
                        onClick={() => { setGridOpen(false); onIndex(i); }}
                        aria-label={`View photo ${i + 1}`}
                        className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-white/10 ${i === index ? 'ring-2 ring-warm' : ''}`}
                      >
                        {it.type === 'video'
                          ? <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-white">Video</span>
                          : <img src={it.url} alt={it.alt || `Photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />}
                      </button>
                    ))}
                  </div>
                </section>
              );
            }) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {items.map((it, i) => (
                  <button
                    key={it.url + '-' + i}
                    type="button"
                    onClick={() => { setGridOpen(false); onIndex(i); }}
                    aria-label={`View photo ${i + 1}`}
                    className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-white/10 ${i === index ? 'ring-2 ring-warm' : ''}`}
                  >
                    {it.type === 'video'
                      ? <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-white">Video</span>
                      : <img src={it.url} alt={it.alt || `Photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            data-zoom-scale={scale}
            onClick={stop}
            onDoubleClick={(e) => { stop(e); toggleZoom(); }}
            style={{
              transform: `translate3d(${offset.x}px, ${offset.y + dragY}px, 0) scale(${scale})`,
              transition: gesture.current.mode ? 'none' : 'transform 160ms ease-out',
            }}
            className="flex max-h-full max-w-full items-center justify-center touch-none"
          >
            {item.type === 'video' ? (
              <video key={item.url} src={item.url} controls autoPlay playsInline className="max-h-[78vh] max-w-full rounded-lg bg-black" />
            ) : (
              <img
                src={item.url}
                alt={item.alt || 'Photo'}
                draggable={false}
                className={`${bar.length ? 'max-h-[76vh]' : 'max-h-[84vh]'} max-w-full select-none object-contain`}
              />
            )}
          </div>

          {groups.length > 1 && scale === 1 && (
            <div onClick={stop} className={`absolute inset-x-0 ${bar.length ? 'bottom-16' : 'bottom-3'} z-10 flex justify-center px-3`}>
              <div className="flex max-w-full gap-1.5 overflow-x-auto rounded-full bg-black/60 p-1 backdrop-blur" role="group" aria-label="Jump to area">
                {groups.map((g) => {
                  const active = (item.group || item.groupLabel) === g.key;
                  return (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => onIndex(g.firstIndex)}
                      className={`min-h-[34px] shrink-0 rounded-full px-3 text-xs font-medium transition ${active ? 'bg-white text-ink' : 'text-white/85 hover:bg-white/15'}`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {navButton(-1)}{navButton(1)}
        </>
      )}

      {bar.length > 0 && !gridOpen && (
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
