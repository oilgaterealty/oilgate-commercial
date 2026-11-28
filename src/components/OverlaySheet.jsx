import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Modal sheet/drawer over the active view (full-screen on phone, drawer on desktop).
export default function OverlaySheet({ open, title, kind = 'sheet', onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-sheet={kind}
      className="fixed inset-0 z-[90] flex justify-end bg-black/50 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-paper shadow-2xl sm:max-w-2xl sm:border-l sm:border-line"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 sm:px-5">
          <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-line bg-white px-3 text-lg leading-none text-ink hover:border-ink"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// In-page panel rendered below the unchanged JumpNav (Overview stays highlighted in the tab bar).
export function InPagePanel({ open, kind, title, onClose, backLabel = 'Overview', children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section
      role="region"
      aria-label={title}
      data-panel={kind}
      data-sheet={kind}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-2.5 shadow-[0_1px_0_rgba(20,33,61,0.04)]">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-sm font-medium text-ink hover:border-ink"
          >
            <span aria-hidden="true">←</span>
            <span>{backLabel}</span>
          </button>
          <h2 className="truncate font-display text-xl font-semibold text-ink">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-line bg-white text-lg leading-none text-ink hover:border-ink"
        >
          ×
        </button>
      </div>
      <div className="space-y-5">
        {children}
      </div>
    </section>
  );
}

// Compact action buttons on Overview (Documents, Messages, City records, Comps) — never tabs.
export function OverviewActionButtons({
  onOpenDocuments,
  onOpenMessages,
  onOpenCityRecords,
  onOpenComps,
  docCount = 0,
  msgCount = 0,
  showDocuments = false,
  showMessages = false,
  showCityRecords = false,
  showComps = false,
  className = '',
}) {
  if (!showDocuments && !showMessages && !showCityRecords && !showComps) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} role="group" aria-label="Overview tools">
      {showDocuments && (
        <button
          type="button"
          data-sheet-trigger="documents"
          data-badge-count={docCount}
          onClick={onOpenDocuments}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink shadow-[0_1px_0_rgba(20,33,61,0.04)] transition hover:border-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="M5 2.5h6.5L15 6v11.5H5z" />
            <path d="M11.5 2.5V6H15" />
          </svg>
          <span>Documents</span>
          {docCount > 0 && (
            <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-ink px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">
              {docCount}
            </span>
          )}
        </button>
      )}
      {showMessages && (
        <button
          type="button"
          data-sheet-trigger="messages"
          data-badge-count={msgCount}
          onClick={onOpenMessages}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink shadow-[0_1px_0_rgba(20,33,61,0.04)] transition hover:border-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="M3.5 4.5h13a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H8l-4.5 3v-3h0a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
          </svg>
          <span>Messages</span>
          {msgCount > 0 && (
            <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-warm px-1.5 py-0.5 text-xs font-semibold tabular-nums text-ink">
              {msgCount}
            </span>
          )}
        </button>
      )}
      {showCityRecords && (
        <button
          type="button"
          data-sheet-trigger="city-records"
          onClick={onOpenCityRecords}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink shadow-[0_1px_0_rgba(20,33,61,0.04)] transition hover:border-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 16.5h14M4.5 16.5V8.5l5.5-4 5.5 4v8M8 16.5v-4h4v4" />
          </svg>
          <span>City records</span>
        </button>
      )}
      {showComps && (
        <button
          type="button"
          data-sheet-trigger="comps"
          onClick={onOpenComps}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink shadow-[0_1px_0_rgba(20,33,61,0.04)] transition hover:border-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 15.5V9.5M10 15.5V4.5M16 15.5V11.5" />
          </svg>
          <span>Comps</span>
        </button>
      )}
    </div>
  );
}
