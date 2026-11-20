import { supabase } from '../lib/supabase.js';

export default function Shell({ children, session, title, subtitle, role }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <a href="#/" className="font-display text-lg font-semibold tracking-tight">Deal Room</a>
          {session && (
            <div className="flex items-center gap-3 text-sm text-ink-soft">
              {role && <span className="rounded-full bg-warm-soft px-2.5 py-0.5 text-xs font-medium text-ink">{role}</span>}
              <span className="hidden sm:inline">{session.user.email}</span>
              <button className="underline-offset-4 hover:underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {title && (
          <div className="mb-8">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-2 text-ink-soft">{subtitle}</p>}
          </div>
        )}
        {children}
      </main>
    </div>
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
