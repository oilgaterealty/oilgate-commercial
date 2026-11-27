import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isOpenViewerToken } from '../lib/site.js';
import {
  OPEN_REQUEST_ROLES,
  filterOpenViewerSnapshot,
  getOpenViewerFacts,
  getOrCreateVisitorId,
  mergeOpenViewerPhotoUrls,
  selectFeaturedPhoto,
  validateAccessRequest,
} from '../lib/openViewer.js';
import Shell, { Button, Card, CardTitle, Empty, Field } from '../components/Shell.jsx';
import { PhotoGrid, photosOf } from '../components/Photos.jsx';
import PhotoViewer from '../components/PhotoViewer.jsx';
import PropertyFacts from '../components/PropertyFacts.jsx';
import UnitGallery from '../components/UnitGallery.jsx';

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
  const [heroOpen, setHeroOpen] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', email: '', role: 'lender', note: '', honeypot: '' });
  const [submitState, setSubmitState] = useState('idle');

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

  useEffect(() => {
    if (tab === 'photos' && state.snapshot) {
      document.getElementById('sec-photos')?.scrollIntoView?.();
    }
  }, [tab, Boolean(state.snapshot)]);

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
  const featuredPhoto = selectFeaturedPhoto(coverPhotos, walkthroughPhotos);
  const facts = getOpenViewerFacts(deal.slug);
  const city = (deal.address || '').split(',').slice(1).join(',').trim();

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
      p_company: check.values.role === 'lender' ? check.values.company : '',
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

  return (
    <Shell>
      <div className="space-y-6">
        <section aria-label="Property hero" className="overflow-hidden rounded-3xl border border-line bg-ink text-white shadow-[0_1px_0_rgba(20,33,61,0.04)]">
          {featuredPhoto && (
            <>
              <button
                type="button"
                onClick={() => setHeroOpen(0)}
                aria-label="Open featured photo"
                className="block w-full cursor-zoom-in bg-ink"
              >
                <img
                  src={featuredPhoto.url}
                  alt={featuredPhoto.alt}
                  className="aspect-[16/10] max-h-[420px] w-full object-cover sm:aspect-[16/7]"
                />
              </button>
              <PhotoViewer
                items={[{ url: featuredPhoto.url, alt: featuredPhoto.alt }]}
                index={heroOpen}
                onIndex={setHeroOpen}
              />
            </>
          )}
          <div className="p-5 sm:p-8">
            {city && (
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-warm sm:text-sm">
                {city}
              </p>
            )}
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight break-words sm:text-5xl">
              {deal.title || deal.address}
            </h1>
            {deal.address && deal.address !== deal.title && !city && (
              <p className="mt-1 text-sm font-medium text-white/85">{deal.address}</p>
            )}
          </div>
        </section>

        {facts ? (
          <PropertyFacts slug={deal.slug} />
        ) : (
          <Card>
            <CardTitle>The property</CardTitle>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Address</dt><dd className="font-semibold">{deal.address || deal.title}</dd></div>
              <div><dt className="text-ink-soft">Units</dt><dd className="font-semibold">{deal.units}</dd></div>
              <div className="sm:col-span-2"><dt className="text-ink-soft">Summary</dt><dd className="font-medium leading-relaxed">{deal.summary}</dd></div>
            </dl>
          </Card>
        )}

        <section id="sec-photos" data-section="photos" className="scroll-mt-6 space-y-4">
          {coverPhotos.length > 1 && (
            <Card>
              <CardTitle>Property photos</CardTitle>
              <PhotoGrid photos={coverPhotos} />
            </Card>
          )}
          <UnitGallery deal={deal} role="viewer" snapshotPhotos={walkthroughPhotos} />
        </section>

        <section aria-label="Request access">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">Request access</h2>
              <Button
                type="button"
                kind={requestOpen ? 'secondary' : 'primary'}
                aria-expanded={requestOpen}
                onClick={() => setRequestOpen((v) => !v)}
              >
                {requestOpen ? 'Close' : 'Request access'}
              </Button>
            </div>

            {requestOpen && (
              <form onSubmit={submitRequest} className="mt-4 grid gap-3 sm:grid-cols-2">
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
                <label className="grid gap-1 text-xs font-medium text-ink-soft">
                  Name
                  <Field
                    required
                    maxLength={120}
                    aria-label="Name"
                    placeholder="Name"
                    value={form.name}
                    onChange={(e) => { setForm({ ...form, name: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium text-ink-soft">
                  Email
                  <Field
                    type="email"
                    required
                    maxLength={254}
                    aria-label="Email"
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) => { setForm({ ...form, email: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
                  />
                </label>
                <label className={`grid gap-1 text-xs font-medium text-ink-soft ${form.role === 'lender' ? '' : 'sm:col-span-2'}`}>
                  Role
                  <select
                    aria-label="Role"
                    value={form.role}
                    onChange={(e) => {
                      const role = e.target.value;
                      setForm((prev) => ({ ...prev, role, company: role === 'lender' ? prev.company : '' }));
                      if (submitState !== 'idle') setSubmitState('idle');
                    }}
                    className="min-h-[40px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                  >
                    {OPEN_REQUEST_ROLES.map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </label>
                {form.role === 'lender' && (
                  <label className="grid gap-1 text-xs font-medium text-ink-soft">
                    Company
                    <Field
                      maxLength={120}
                      aria-label="Company"
                      placeholder="Company"
                      value={form.company}
                      onChange={(e) => { setForm({ ...form, company: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
                    />
                  </label>
                )}
                <label className="grid gap-1 text-xs font-medium text-ink-soft sm:col-span-2">
                  Note
                  <Field
                    maxLength={1000}
                    aria-label="Note"
                    placeholder="Note"
                    value={form.note}
                    onChange={(e) => { setForm({ ...form, note: e.target.value }); if (submitState !== 'idle') setSubmitState('idle'); }}
                  />
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={submitState === 'sending' || submitState === 'sent'}>
                    {BUTTON_LABEL[submitState] || 'Request access'}
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </section>
      </div>
    </Shell>
  );
}
