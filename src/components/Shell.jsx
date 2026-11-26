import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buyerTag, sellerTag, viewingRole } from '../lib/people.js';
import { supabase } from '../lib/supabase.js';
import { DictatedField } from './Dictation.jsx';

// One top row: the page's own heading on the left, who is signed in on the right. No brand bar.
export default function Shell({ children, session, head, role, wide }) {
  return (
    <div className="min-h-screen overflow-x-clip">
      <main className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-6xl'} px-4 pb-10 pt-4`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 max-w-full">{head}</div>
          {session && <Account session={session} role={role} />}
        </div>
        {children}
      </main>
    </div>
  );
}

export function Account({ session, role }) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-ink-soft">
      {role && <span className="shrink-0 rounded-full bg-warm-soft px-2.5 py-0.5 text-xs font-medium text-ink">{role}</span>}
      <span className="hidden sm:inline">{session.user.email}</span>
      <button className="inline-flex min-h-[36px] shrink-0 items-center underline-offset-4 hover:underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}

// Property name with the city beside it, wrapping cleanly on narrow screens.
export function PropertyHead({ deal }) {
  const city = (deal.address || '').split(',').slice(1).join(',').trim();
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <a href={`#/d/${deal.slug}`} className="font-display text-2xl font-semibold tracking-tight break-words sm:text-4xl">{deal.title}</a>
      {city && <span className="text-xs uppercase tracking-[0.16em] text-warm sm:text-sm sm:tracking-[0.18em]">{city}</span>}
      <span className="self-center"><InfoTip label="Buyer and seller" lines={viewingRole() === 'seller' ? [sellerTag(deal)] : [buyerTag(deal), sellerTag(deal)]} /></span>
    </div>
  );
}

export function Tabs({ tabs, active, base }) {
  const navRef = useRef(null);

  useEffect(() => {
    const el = navRef.current?.querySelector('[aria-current="page"]');
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      } catch {}
    }
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="Deal sections"
      className="nav-tabs mb-4 flex w-full max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto pb-1.5"
    >
      {tabs.map(([k, label]) => (
        <a
          key={k}
          href={`${base}/${k}`}
          aria-current={active === k ? 'page' : undefined}
          className={`inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition ${
            active === k ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'
          }`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export const Card = ({ children, className = '' }) => (
  <section className={`rounded-2xl border border-line bg-white p-4 sm:p-5 shadow-[0_1px_0_rgba(20,33,61,0.04)] ${className}`}>{children}</section>
);
export const CardTitle = ({ children, aside }) => (
  <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
    <h2 className="font-display text-xl font-semibold">{children}</h2>
    {aside}
  </div>
);
export const Button = ({ kind = 'primary', className = '', ...p }) => (
  <button
    {...p}
    className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
      kind === 'primary' ? 'bg-ink text-white hover:bg-ink-soft' : 'border border-line bg-white hover:bg-warm-soft'
    } ${className}`}
  />
);
export const Field = (p) => (
  <DictatedField {...p} className={`w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink ${p.className || ''}`} />
);
export const Empty = ({ children }) => <p className="text-sm text-ink">{children}</p>;

export const Badge = ({ tone = 'none', children }) => {
  const c = { pass: 'bg-good/10 text-good', close: 'bg-amber-100 text-amber-800', fail: 'bg-red-50 text-red-700', none: 'bg-warm-soft text-ink-soft' }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
};

function useNonScrollingOverlay(lines) {
  const id = useId();
  const trigger = useRef(null);
  const popup = useRef(null);
  const timer = useRef(null);
  const [position, setPosition] = useState(null);
  const [pinned, setPinned] = useState(false);
  const details = (lines || []).filter(Boolean);

  const open = () => {
    clearTimeout(timer.current);
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(480, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - width - 12));
    setPosition({ width, left, top: r.bottom + window.scrollY + 6 });
  };
  const close = () => { if (!pinned) timer.current = setTimeout(() => setPosition(null), 120); };

  useEffect(() => () => clearTimeout(timer.current), []);

  // Measure actual rendered height and flip above when more space exists above than below.
  useEffect(() => {
    if (!position || !popup.current || !trigger.current) return;
    const h = popup.current.offsetHeight;
    const r = trigger.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const wantTop = h > spaceBelow && spaceAbove > spaceBelow
      ? Math.max(12, r.top + window.scrollY - h - 6)
      : r.bottom + window.scrollY + 6;
    if (Math.abs(wantTop - position.top) > 1) {
      setPosition((prev) => (prev ? { ...prev, top: wantTop } : prev));
    }
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const outside = (e) => {
      if (!trigger.current?.contains(e.target) && !popup.current?.contains(e.target)) {
        setPinned(false); setPosition(null);
      }
    };
    const escape = (e) => { if (e.key === 'Escape') { setPinned(false); setPosition(null); } };
    const dismiss = () => { setPinned(false); setPosition(null); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
    };
  }, [position]);

  const portal = position && details.length > 0 ? createPortal(
    <div
      ref={popup}
      id={id}
      role="tooltip"
      style={position}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={close}
      className="absolute z-50 break-words rounded-xl border border-line bg-ink p-3 text-xs text-white shadow-xl"
    >
      {details.map((line, i) => <div key={i} className="py-1 first:pt-0 last:pb-0">{line}</div>)}
    </div>,
    document.body
  ) : null;

  return {
    id,
    trigger,
    details,
    isOpen: !!position,
    portal,
    triggerProps: {
      onMouseEnter: open,
      onMouseLeave: close,
      onFocus: open,
      onBlur: close,
      onClick: () => { if (pinned) { setPinned(false); setPosition(null); } else { open(); setPinned(true); } },
    },
  };
}

// Hover/tap info overlay so sources and secondary notes never sit on the page as visible subtext.
export function InfoTip({ label = 'Details', lines = [] }) {
  const { id, trigger, details, isOpen, portal, triggerProps } = useNonScrollingOverlay(lines);
  if (!details.length) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? id : undefined}
        {...triggerProps}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-xs font-semibold text-ink-soft hover:border-ink hover:text-ink"
      >
        i
      </button>
      {portal}
    </>
  );
}

// Wraps any number or plain label with a non-scrolling hover/tap overlay showing its math or source.
export function OverlayTrigger({ children, lines = [], label, className = '' }) {
  const { id, trigger, details, isOpen, portal, triggerProps } = useNonScrollingOverlay(lines);
  if (!details.length) return <span className={className}>{children}</span>;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? id : undefined}
        {...triggerProps}
        className={`rounded text-left decoration-dotted underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink ${className}`}
      >
        {children}
      </button>
      {portal}
    </>
  );
}
