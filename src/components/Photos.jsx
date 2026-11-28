import { useEffect, useMemo, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase.js';
import { Card, CardTitle, Empty, InfoTip } from './Shell.jsx';
import { useUploads, Uploader, ShareChips, uploadShareButtons } from './Files.jsx';
import { ROOMS, AREA_ROOMS, sharedPhotos, spaceLabel } from '../lib/leaseUp.js';
import { coverOf } from '../lib/v63.js';
import { seenBy } from '../lib/visibility.js';
import PhotoViewer, { ThumbOverlay } from './PhotoViewer.jsx';

const IMAGES = 'image/jpeg,image/png,image/webp,image/heic';
const roomName = (k) => [...ROOMS, ...AREA_ROOMS].find(([x]) => x === k)?.[1] || k;
export const photosOf = (rows) => (rows || []).filter((r) => r.kind === 'photo' && r.url).sort((a, b) => (b.featured - a.featured));

// Loads every photo (and shared video) permitted for this role, grouped by Property / Unit / Area.
export function useDealGallery(deal, role, preview = false, { includeWalkthrough = true, includeVideos = false, externalRows = null } = {}) {
  const [internalRows, reload] = useUploads(deal);
  const rows = externalRows ?? internalRows;
  const [walkPhotos, setWalkPhotos] = useState([]);
  const [walkVideos, setWalkVideos] = useState([]);

  useEffect(() => {
    if (!deal?.id || !includeWalkthrough) {
      setWalkPhotos([]);
      setWalkVideos([]);
      return undefined;
    }
    let live = true;
    (async () => {
      let pq = supabase
        .from('commercial_walkthrough_photos')
        .select(`id,unit_number,room,storage_path,created_at${role === 'owner' || preview ? ',share_seller,share_lender' : ''}`)
        .eq('deal_id', deal.id)
        .order('unit_number')
        .order('created_at');
      if (role === 'seller') pq = pq.eq('share_seller', true);
      if (role === 'lender') pq = pq.eq('share_lender', true);

      let vq = null;
      if (includeVideos) {
        vq = supabase
          .from('commercial_walkthrough_videos')
          .select('*')
          .eq('deal_id', deal.id)
          .order('unit_number')
          .order('created_at');
        if (role === 'seller') vq = vq.eq('share_seller', true);
        if (role === 'lender') vq = vq.eq('share_lender', true);
      }

      const [pRes, vRes] = await Promise.all([pq, vq || Promise.resolve({ data: [] })]);
      if (!live) return;
      const pList = (role === 'seller' || role === 'lender') ? sharedPhotos(role, pRes.data) : (pRes.data || []);
      const vList = (role === 'seller' || role === 'lender') ? sharedPhotos(role, vRes.data) : (vRes.data || []);
      const paths = [...pList.map((p) => p.storage_path), ...vList.map((v) => v.storage_path)].filter(Boolean);
      let urlMap = {};
      if (paths.length) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
        urlMap = Object.fromEntries((signed || []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
      }
      if (!live) return;
      setWalkPhotos(
        pList
          .filter((p) => urlMap[p.storage_path])
          .map((p) => ({
            id: `walk-${p.id}`,
            rawId: p.id,
            source: 'walkthrough',
            unitNumber: p.unit_number,
            group: `unit-${p.unit_number}`,
            groupLabel: spaceLabel(p.unit_number),
            url: urlMap[p.storage_path],
            alt: `${spaceLabel(p.unit_number)}${p.room && p.room !== 'general' ? ` · ${roomName(p.room)}` : ''}`,
            type: 'photo',
            share_seller: p.share_seller,
            share_lender: p.share_lender,
          })),
      );
      setWalkVideos(
        vList
          .filter((v) => urlMap[v.storage_path])
          .map((v) => ({
            id: `walkvid-${v.id}`,
            unitNumber: v.unit_number,
            group: `unit-${v.unit_number}`,
            groupLabel: spaceLabel(v.unit_number),
            url: urlMap[v.storage_path],
            alt: `${spaceLabel(v.unit_number)} video`,
            type: 'video',
          })),
      );
    })();
    return () => { live = false; };
  }, [deal?.id, role, preview, includeWalkthrough, includeVideos]);

  const visibleUploads = useMemo(() => {
    let base = rows || [];
    if (preview) base = seenBy(role, base);
    else if (role === 'seller') base = base.filter((r) => r.visibility === 'seller');
    return photosOf(base);
  }, [rows, preview, role]);

  const items = useMemo(() => {
    const uploadItems = visibleUploads.map((r) => ({
      id: r.id,
      upload: r,
      source: 'upload',
      group: 'property',
      groupLabel: 'Property',
      url: r.url,
      alt: r.note || r.file_name || 'Property photo',
      featured: Boolean(r.featured),
      type: 'photo',
    }));
    return [...uploadItems, ...walkPhotos, ...walkVideos];
  }, [visibleUploads, walkPhotos, walkVideos]);

  return { items, uploadRows: visibleUploads, allRows: rows, count: items.length, reload };
}

export function PhotoStrip({ photos }) {
  const [view, setView] = useState(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Property photos">
      {photos.length ? photos.map((p, j) => (
        <button key={p.id} type="button" onClick={() => setView(j)} aria-label={`Open photo ${j + 1} of ${photos.length}`}
          className="block shrink-0 cursor-zoom-in overflow-hidden rounded-2xl">
          <img src={p.url} alt={p.note || 'Property photo'} loading="lazy" className="h-28 w-40 object-cover transition hover:scale-[1.02] sm:h-40 sm:w-56" />
        </button>
      )) : <Empty>Photos will appear after the walkthrough.</Empty>}
      <PhotoViewer items={photos.map((p) => ({ url: p.url, alt: p.note || 'Property photo' }))} index={view} onIndex={setView} />
    </div>
  );
}

// Every photo at once in a grid. Tap one to open it full screen, then swipe or use the arrows.
export function PhotoGrid({ photos }) {
  const [view, setView] = useState(null);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((p, j) => (
          <button key={p.id || p.url} type="button" onClick={() => setView(j)} aria-label={`Open photo ${j + 1} of ${photos.length}`}
            className="block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-xl bg-ink/5">
            <img src={p.url} alt={p.note || 'Property photo'} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      <PhotoViewer items={photos.map((p) => ({ url: p.url, alt: p.note || 'Property photo' }))} index={view} onIndex={setView} />
    </div>
  );
}

// Tappable hero cover photo with photo count badge; opens the full-screen PhotoViewer across all permitted items.
export function Cover({ rows, items = null, empty, compact, open: controlledOpen, onOpenChange, actions, onOpenUnitGallery }) {
  const rowItems = useMemo(() => photosOf(rows).map((r) => ({
    id: r.id,
    upload: r,
    group: 'property',
    groupLabel: 'Property',
    url: r.url,
    alt: r.note || r.file_name || 'The property',
    featured: Boolean(r.featured),
    type: 'photo',
  })), [rows]);
  const gallery = (items && items.length > 0) ? items : rowItems;
  const hero = gallery.find((x) => x.featured && x.type !== 'video') || coverOf(photosOf(rows)) || gallery.find((x) => x.type !== 'video') || gallery[0] || null;
  const [internalOpen, setInternalOpen] = useState(null);
  const isControlled = controlledOpen !== undefined;
  const viewerIndex = isControlled ? controlledOpen : internalOpen;
  const setViewerIndex = isControlled ? (onOpenChange || (() => {})) : setInternalOpen;

  if (!hero) return empty ? <p className="rounded-2xl bg-warm-soft/60 px-5 py-4 text-base text-ink-soft">{empty}</p> : null;
  const count = gallery.length;
  return (
    <div className="overflow-hidden rounded-3xl bg-ink">
      <button
        type="button"
        data-hero-photo
        onClick={() => setViewerIndex(0)}
        aria-label={count > 1 ? `Open all ${count} photos` : 'Open the cover photo'}
        className="relative block w-full cursor-zoom-in"
      >
        <img src={hero.url} alt={hero.alt || hero.note || 'The property'} className={compact ? 'h-36 w-full object-cover sm:h-48' : 'aspect-[16/9] max-h-[460px] w-full object-cover sm:aspect-[16/7]'} />
        {count > 0 && (
          <span
            data-photo-count-badge
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-3 py-1 text-xs font-semibold tabular-nums text-white shadow backdrop-blur"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2.5" y="4" width="15" height="12" rx="2" />
              <circle cx="7.5" cy="8.5" r="1.25" fill="currentColor" stroke="none" />
              <path d="M3.5 14l4.5-4 3 2.5 2.5-2 3 3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{count === 1 ? '1 photo' : `${count} photos`}</span>
          </span>
        )}
      </button>
      <PhotoViewer items={gallery} index={viewerIndex} onIndex={setViewerIndex} actions={actions} onOpenUnitGallery={onOpenUnitGallery} />
    </div>
  );
}

// Owner and realtor: upload photos, pick who sees each, star the ones that lead the seller page.
export default function Photos({ deal, role, me, preview }) {
  const [rows, load] = useUploads(deal);
  const photos = photosOf(rows);
  const owner = role === 'owner';
  const [view, setView] = useState(null);
  const [shareError, setShareError] = useState('');
  const shareButtons = (r) => (preview ? [] : uploadShareButtons(r, owner, load, setShareError));
  const star = async (r) => {
    if (!r.featured) {
      const others = photos.filter((x) => x.featured && x.id !== r.id).map((x) => x.id);
      if (others.length) await supabase.from('commercial_uploads').update({ featured: false }).in('id', others);
    }
    await supabase.from('commercial_uploads').update({ featured: !r.featured }).eq('id', r.id);
    load();
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Cover photo</CardTitle>
        <Cover rows={photos} empty="No cover photo yet. Upload one below and star it." />
        <div className="mt-4">
        <Uploader deal={deal} role={role} me={me} onDone={load} allowShare label="Upload a photo" accept={IMAGES} preview={preview} />
        </div>
        {shareError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{shareError}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows === null && <Empty>Loading…</Empty>}
          {rows && !photos.length && <Empty>Nothing here yet.</Empty>}
          {photos.map((r, j) => (
            <div key={r.id} className="overflow-hidden rounded-xl border border-line bg-white">
              <div className="group relative">
                <button type="button" onClick={() => setView(j)} aria-label={`Open ${r.note || r.file_name || 'photo'}`} className="block w-full cursor-zoom-in"><img src={r.url} alt={r.note || ''} className="aspect-[4/3] w-full object-cover" /></button>
                <ThumbOverlay buttons={[{ key: 'open', icon: '⤢', label: 'Open', onClick: () => setView(j) }, ...shareButtons(r)]} />
              </div>
              <div className="space-y-2 p-2">
                <div className="flex items-center justify-between gap-2">
                  <InfoTip label="Photo details" lines={[r.note || r.file_name]} />
                  {!preview && <button onClick={() => star(r)} title={r.featured ? 'Cover photo' : 'Make this the cover'} aria-label={r.featured ? 'Cover photo' : 'Make this the cover'} aria-pressed={Boolean(r.featured)} className={`text-lg leading-none ${r.featured ? 'text-warm' : 'text-line hover:text-warm'}`}>★</button>}
                </div>
                {!preview && <ShareChips r={r} owner={owner} onChange={load} />}
              </div>
            </div>
          ))}
        </div>
        <PhotoViewer items={photos.map((r) => ({ url: r.url, alt: r.note || r.file_name || 'Property photo' }))} index={view} onIndex={setView}
          actions={(_, j) => (photos[j] ? shareButtons(photos[j]) : [])} />
      </Card>
    </div>
  );
}

// Walkthrough photos the owner switched on for this role (seller or lender). The database enforces it;
// the filter here only matters for the owner's own "See as" preview.
export function useSharedWalkPhotos(deal, role) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (role !== 'seller' && role !== 'lender') return;
    let live = true;
    (async () => {
      const flag = role === 'seller' ? 'share_seller' : 'share_lender';
      const { data } = await supabase.from('commercial_walkthrough_photos').select('*').eq('deal_id', deal.id).eq(flag, true).order('created_at', { ascending: false });
      const list = sharedPhotos(role, data);
      if (!list.length) { if (live) setRows([]); return; }
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(list.map((p) => p.storage_path), 3600);
      const url = Object.fromEntries((signed || []).map((s) => [s.path, s.signedUrl]));
      if (live) setRows(list.filter((p) => url[p.storage_path]).map((p) => ({ id: `walk-${p.id}`, kind: 'photo', url: url[p.storage_path], note: 'Walkthrough photo', featured: false })));
    })();
    return () => { live = false; };
  }, [deal.id, role]);
  return rows;
}

// Walkthrough videos the owner switched on for this role (seller or lender); the database enforces it.
export function useSharedWalkVideos(deal, role) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (role !== 'seller' && role !== 'lender') return;
    let live = true;
    (async () => {
      const flag = role === 'seller' ? 'share_seller' : 'share_lender';
      const { data } = await supabase.from('commercial_walkthrough_videos').select('*').eq('deal_id', deal.id).eq(flag, true).order('created_at', { ascending: false });
      const list = sharedPhotos(role, data);
      if (!list.length) { if (live) setRows([]); return; }
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(list.map((v) => v.storage_path), 3600);
      const url = Object.fromEntries((signed || []).map((s) => [s.path, s.signedUrl]));
      if (live) setRows(list.filter((v) => url[v.storage_path]).map((v) => ({ id: `walkvid-${v.id}`, url: url[v.storage_path] })));
    })();
    return () => { live = false; };
  }, [deal.id, role]);
  return rows;
}

export function WalkVideos({ videos }) {
  if (!videos.length) return null;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Walkthrough videos">
      {videos.map((v) => (
        <video key={v.id} src={v.url} controls playsInline preload="metadata" className="aspect-video w-72 shrink-0 rounded-xl bg-black" />
      ))}
    </div>
  );
}
