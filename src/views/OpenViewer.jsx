import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isOpenViewerToken } from '../lib/site.js';
import { ROOMS, AREA_ROOMS, spaceLabel } from '../lib/leaseUp.js';
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
import { photosOf } from '../components/Photos.jsx';
import PhotoViewer from '../components/PhotoViewer.jsx';
import PropertyFacts from '../components/PropertyFacts.jsx';
import UnitGallery from '../components/UnitGallery.jsx';
import { InPagePanel } from '../components/OverlaySheet.jsx';

const roomName = (k) => [...ROOMS, ...AREA_ROOMS].find(([x]) => x === k)?.[1] || k;

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
  const [unitGalleryOpen, setUnitGalleryOpen] = useState(false);
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

  const snapshot = state.snapshot;
  const coverPhotos = photosOf(snapshot?.photos);
  const walkthroughPhotos = snapshot?.walkthroughPhotos || [];
  const featuredPhoto = snapshot ? selectFeaturedPhoto(coverPhotos, walkthroughPhotos) : null;

  const galleryItems = useMemo(() => {
    if (!snapshot) return [];
    const seen = new Set();
    const out = [];
    const pushItem = (item) => {
      if (!item?.url || seen.has(item.url)) return;
      seen.add(item.url);
      out.push(item);
    };
    if (featuredPhoto?.url) {
      pushItem({
        url: featuredPhoto.url,
        alt: featuredPhoto.alt || snapshot.deal.title || 'Property photo',
        group: 'property',
        groupLabel: 'Property',
        type: 'photo',
      });
    }
    for (const p of coverPhotos) {
      pushItem({
        url: p.url,
        alt: p.note || 'Property photo',
        group: 'property',
        groupLabel: 'Property',
        type: 'photo',
      });
    }
    for (const wp of walkthroughPhotos) {
      if (!wp?.url) continue;
      const u = wp.unit_number;
      const gLabel = u ? spaceLabel(u) : 'Property';
      pushItem({
        url: wp.url,
        alt: `${gLabel}${wp.room && wp.room !== 'general' ? ` · ${roomName(wp.room)}` : ''}`,
        group: u ? `unit-${u}` : 'property',
        groupLabel: gLabel,
        type: 'photo',
      });
    }
    return out;
  }, [snapshot, featuredPhoto, coverPhotos, walkthroughPhotos]);

  useEffect(() => {
    if (tab === 'photos') {
      if (walkthroughPhotos.length > 0) setUnitGalleryOpen(true);
      else if (galleryItems.length > 0) setHeroOpen(0);
    }
  }, [tab, galleryItems.length, walkthroughPhotos.length]);

  if (state.loading) {
    return <Shell><Empty>Loading…</Empty></Shell>;
  }

  if (!snapshot) {
    return (
      <Shell head={<h1 className="font-display text-3xl font-semibold">Link unavailable</h1>}>
        <Card><Empty>This link is no longer active.</Empty></Card>
      </Shell>
    );
  }

  const { deal } = snapshot;
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
        <InPagePanel open={unitGalleryOpen} kind="photos" title="Photos by unit" backLabel="Overview" onClose={() => setUnitGalleryOpen(false)}>
          <UnitGallery deal={deal} role="viewer" preview snapshotPhotos={walkthroughPhotos} />
        </InPagePanel>

        {!unitGalleryOpen && (
          <>
            <section aria-label="Property hero" className="overflow-hidden rounded-3xl border border-line bg-ink text-white shadow-[0_1px_0_rgba(20,33,61,0.04)]">
              {featuredPhoto && (
                <>
                  <button
                    type="button"
                    data-hero-photo
                    onClick={() => setHeroOpen(0)}
                    aria-label={galleryItems.length > 1 ? `Open all ${galleryItems.length} photos` : 'Open featured photo'}
                    className="relative block w-full cursor-zoom-in bg-ink"
                  >
                    <img
                      src={featuredPhoto.url}
                      alt={featuredPhoto.alt}
                      className="aspect-[16/10] max-h-[420px] w-full object-cover sm:aspect-[16/7]"
                    />
                    {galleryItems.length > 0 && (
                      <span
                        data-photo-count-badge
                        className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-3 py-1 text-xs font-semibold tabular-nums text-white shadow backdrop-blur"
                      >
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <rect x="2.5" y="4" width="15" height="12" rx="2" />
                          <circle cx="7.5" cy="8.5" r="1.25" fill="currentColor" stroke="none" />
                          <path d="M3.5 14l4.5-4 3 2.5 2.5-2 3 3.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>{galleryItems.length === 1 ? '1 photo' : `${galleryItems.length} photos`}</span>
                      </span>
                    )}
                  </button>
                  <PhotoViewer
                    items={galleryItems}
                    index={heroOpen}
                    onIndex={setHeroOpen}
                    onOpenUnitGallery={walkthroughPhotos.length > 0 ? () => setUnitGalleryOpen(true) : undefined}
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
          </>
        )}
      </div>
    </Shell>
  );
}
