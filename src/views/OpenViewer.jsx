import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isOpenViewerToken } from '../lib/site.js';
import {
  OPEN_REQUEST_ROLES,
  filterOpenViewerSnapshot,
  getOrCreateVisitorId,
  mergeOpenViewerPhotoUrls,
  validateAccessRequest,
} from '../lib/openViewer.js';
import Shell, { Button, Card, CardTitle, Empty, Field, JumpNav, useSectionScroll } from '../components/Shell.jsx';
import { Cover, photosOf } from '../components/Photos.jsx';
import UnitGallery from '../components/UnitGallery.jsx';

const SECTIONS = [
  ['overview', 'Overview'],
  ['photos', 'Photos'],
];

const BUTTON_LABEL = {
  idle: 'Request access',
  sending: 'Sending…',
  sent: 'Request sent',
  rate_limited: 'Daily limit reached',
  invalid: 'Check fields',
  error: 'Try again',
};

export default function OpenViewer({ slug, token, tab }) {
  const [state, setState] = useState({ loading: true, snapshot: null });
  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', email: '', role: 'lender', note: '', honeypot: '' });
  const [submitState, setSubmitState] = useState('idle');
  const { activeSection, jumpTo } = useSectionScroll(tab, SECTIONS);

  useEffect(() => {
    let alive = true;
    if (!isOpenViewerToken(token) || !supabase) {
      setState({ loading: false, snapshot: null });
      return () => { alive = false; };
    }

    (async () => {
      const { data, error } = await supabase.rpc('commercial_open_viewer', { p_token: token });
      if (!alive) return;
      const snapshot = error ? null : filterOpenViewerSnapshot(data);
      if (!snapshot || snapshot.deal.slug !== slug) {
        setState({ loading: false, snapshot: null });
        return;
      }

      setState({ loading: false, snapshot });

      const loadPhotos = (async () => {
        try {
          const { data: signed, error: fnError } = await supabase.functions.invoke('open-viewer-photos', {
            body: { token },
          });
          if (!alive || fnError || !signed) return;
          setState((prev) => (prev.snapshot ? { ...prev, snapshot: mergeOpenViewerPhotoUrls(prev.snapshot, signed) } : prev));
        } catch {
          // render without photos when signing is unavailable
        }
      })();

      const logView = (async () => {
        try {
          const visitor = getOrCreateVisitorId();
          await supabase.rpc('commercial_open_log_view', { p_token: token, p_visitor: visitor });
        } catch {
          // view counter is best-effort
        }
      })();

      await Promise.allSettled([loadPhotos, logView]);
    })();

    return () => { alive = false; };
  }, [slug, token]);

  if (state.loading) {
    return <Shell><Empty>Loading…</Empty></Shell>;
  }

  if (!state.snapshot) {
    return (
      <Shell head={<h1 className="font-display text-3xl font-semibold">Link unavailable</h1>}>
        <Card><Empty>This link is no longer active.</Empty></Card>
      </Shell>
    );
  }

  const { deal, photos, walkthroughPhotos } = state.snapshot;
  const coverPhotos = photosOf(photos);
  const city = (deal.address || '').split(',').slice(1).join(',').trim();
  const basePath = `#/d/${deal.slug}/view/${token}`;

  const submitRequest = async (e) => {
    e.preventDefault();
    if (submitState === 'sending' || submitState === 'sent') return;
    const check = validateAccessRequest(form);
    if (!check.ok) {
      setSubmitState('invalid');
      return;
    }
    if (check.honeypot) {
      setSubmitState('sent');
      return;
    }
    setSubmitState('sending');
    const { data, error } = await supabase.rpc('commercial_open_request_access', {
      p_token: token,
      p_name: check.values.name,
      p_company: check.values.company,
      p_email: check.values.email,
      p_role: check.values.role,
      p_note: check.values.note,
    });
    if (error) {
      setSubmitState('error');
      return;
    }
    if (data === 'received') {
      setSubmitState('sent');
    } else if (data === 'rate_limited') {
      setSubmitState('rate_limited');
    } else if (data === 'invalid_name' || data === 'invalid_email' || data === 'invalid_role') {
      setSubmitState('invalid');
    } else {
      setSubmitState('error');
    }
  };

  const head = (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <a href={basePath} className="font-display text-2xl font-semibold tracking-tight break-words sm:text-4xl">{deal.title}</a>
        {city && <span className="text-xs uppercase tracking-[0.16em] text-warm sm:text-sm sm:tracking-[0.18em]">{city}</span>}
      </div>
      <Button
        type="button"
        kind="secondary"
        aria-expanded={requestOpen}
        onClick={() => setRequestOpen((v) => !v)}
      >
        Request access
      </Button>
    </div>
  );

  return (
    <Shell head={head}>
      <div className="space-y-6">
        {requestOpen && (
          <Card className="max-w-lg">
            <CardTitle>Request access</CardTitle>
            <form onSubmit={submitRequest} className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                name="website"
                value={form.honeypot}
                onChange={(e) => setForm({ ...form, honeypot: e.target.value })}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />
              <Field
                required
                maxLength={120}
                aria-label="Name"
                placeholder="Name"
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
              />
              <Field
                maxLength={120}
                aria-label="Company"
                placeholder="Company"
                value={form.company}
                onChange={(e) => { setForm({ ...form, company: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
              />
              <Field
                type="email"
                required
                maxLength={254}
                aria-label="Email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
              />
              <select
                aria-label="Role"
                value={form.role}
                onChange={(e) => { setForm({ ...form, role: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
                className="min-h-[40px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
              >
                {OPEN_REQUEST_ROLES.map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <Field
                maxLength={1000}
                aria-label="Note"
                placeholder="Note (optional)"
                className="sm:col-span-2"
                value={form.note}
                onChange={(e) => { setForm({ ...form, note: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
              />
              <div className="sm:col-span-2">
                <Button type="submit" disabled={submitState === 'sending' || submitState === 'sent'}>
                  {BUTTON_LABEL[submitState] || 'Request access'}
                </Button>
              </div>
            </form>
          </Card>
        )}

        <JumpNav sections={SECTIONS} active={activeSection} onJump={jumpTo} base={basePath} />

        <section id="sec-overview" data-section="overview" className="scroll-mt-20 space-y-4">
          <Cover rows={coverPhotos} compact />
          <Card>
            <CardTitle>The property</CardTitle>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Address</dt><dd className="font-semibold">{deal.address || deal.title}</dd></div>
              <div><dt className="text-ink-soft">Units</dt><dd className="font-semibold">10</dd></div>
              <div className="sm:col-span-2"><dt className="text-ink-soft">Summary</dt><dd className="font-medium leading-relaxed">{deal.summary}</dd></div>
            </dl>
          </Card>
        </section>

        <section id="sec-photos" data-section="photos" className="scroll-mt-20">
          <UnitGallery deal={deal} role="viewer" snapshotPhotos={walkthroughPhotos} />
        </section>
      </div>
    </Shell>
  );
}
