import { supabase } from '../lib/supabase.js';

// One top row: the page's own heading on the left, who is signed in on the right. No brand bar.
export default function Shell({ children, session, head, role, wide }) {
  return (
    <div className="min-h-screen">
      <main className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-6xl'} px-4 pb-10 pt-4`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">{head}</div>
          {session && <Account session={session} role={role} />}
        </div>
        {children}
      </main>
    </div>
  );
}

export function Account({ session, role }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-soft">
      {role && <span className="rounded-full bg-warm-soft px-2.5 py-0.5 text-xs font-medium text-ink">{role}</span>}
      <span className="hidden sm:inline">{session.user.email}</span>
      <button className="underline-offset-4 hover:underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}

// Property name with the city beside it, on one line.
export function PropertyHead({ deal }) {
  const city = (deal.address || '').split(',').slice(1).join(',').trim();
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <a href={`#/d/${deal.slug}`} className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{deal.title}</a>
      {city && <span className="text-sm uppercase tracking-[0.18em] text-warm">{city}</span>}
    </div>
  );
}

export function Tabs({ tabs, active, base }) {
  return (
    <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1">
      {tabs.map(([k, label]) => (
        <a key={k} href={`${base}/${k}`}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition ${active === k ? 'bg-ink text-white' : 'text-ink-soft hover:bg-warm-soft'}`}>{label}</a>
      ))}
    </nav>
  );
}

export const Card = ({ children, className = '' }) => (
  <section className={`rounded-2xl border border-line bg-white p-5 shadow-[0_1px_0_rgba(20,33,61,0.04)] ${className}`}>{children}</section>
);
export const CardTitle = ({ children, aside }) => (
  <div className="mb-4 flex items-center justify-between gap-3">
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
  <input {...p} className={`w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink ${p.className || ''}`} />
);
export const Empty = ({ children }) => <p className="text-sm text-ink-soft">{children}</p>;

export const Badge = ({ tone = 'none', children }) => {
  const c = { pass: 'bg-good/10 text-good', close: 'bg-amber-100 text-amber-800', fail: 'bg-red-50 text-red-700', none: 'bg-warm-soft text-ink-soft' }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
};
