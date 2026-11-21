import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Empty } from './Shell.jsx';
import { useUploads, Uploader, ShareChips } from './Files.jsx';

const IMAGES = 'image/jpeg,image/png,image/webp,image/heic';
export const photosOf = (rows) => (rows || []).filter((r) => r.kind === 'photo' && r.url).sort((a, b) => (b.featured - a.featured));

export function PhotoStrip({ photos }) {
  return <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Property photos">{photos.length ? photos.map(p => <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0"><img src={p.url} alt={p.note || 'Open property photo'} className="h-20 w-28 rounded-xl object-cover" /></a>) : <Empty>Photos will appear after the walkthrough.</Empty>}</div>;
}

// Big photo up top. Arrows, swipe-free thumbnails, full screen on tap.
export function Hero({ photos, empty = 'Photos are coming after our walkthrough.' }) {
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  useEffect(() => { if (i >= photos.length) setI(0); }, [photos.length]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % Math.max(1, photos.length));
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + photos.length) % Math.max(1, photos.length));
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [photos.length]);

  if (!photos.length) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-3xl border border-dashed border-line bg-warm-soft/60 text-center">
        <p className="px-6 text-lg text-ink-soft">{empty}</p>
      </div>
    );
  }
  const p = photos[i] || photos[0];
  const nav = (d) => (e) => { e.stopPropagation(); setI((i + d + photos.length) % photos.length); };
  const Arrow = ({ d, side }) => photos.length > 1 && (
    <button onClick={nav(d)} aria-label={d > 0 ? 'Next photo' : 'Previous photo'}
      className={`absolute top-1/2 ${side}-3 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-lg shadow hover:bg-white`}>{d > 0 ? '›' : '‹'}</button>
  );
  return (
    <div>
      <div className="relative overflow-hidden rounded-3xl bg-ink">
        <img src={p.url} alt={p.note || 'Property photo'} onClick={() => setFull(true)} className="aspect-[16/8] w-full cursor-zoom-in object-cover" />
        <Arrow d={-1} side="left" /><Arrow d={1} side="right" />
        <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{i + 1} / {photos.length}</span>
        {p.note && <span className="absolute bottom-3 left-3 max-w-[70%] rounded-full bg-black/60 px-3 py-1 text-xs text-white">{p.note}</span>}
      </div>
      {photos.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {photos.map((x, j) => (
            <button key={x.id} onClick={() => setI(j)} className={`shrink-0 overflow-hidden rounded-lg border-2 ${j === i ? 'border-ink' : 'border-transparent'}`}>
              <img src={x.url} alt="" className="h-16 w-24 object-cover" />
            </button>
          ))}
        </div>
      )}
      {full && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={() => setFull(false)}>
          <img src={p.url} alt={p.note || 'Property photo'} className="max-h-[92vh] max-w-[95vw] object-contain" />
          <Arrow d={-1} side="left" /><Arrow d={1} side="right" />
          <button className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm">Close</button>
        </div>
      )}
    </div>
  );
}

// Owner and realtor: upload photos, pick who sees each, star the ones that lead the seller page.
export default function Photos({ deal, role, me, preview }) {
  const [rows, load] = useUploads(deal);
  const photos = photosOf(rows);
  const owner = role === 'owner';
  const star = async (r) => { await supabase.from('commercial_uploads').update({ featured: !r.featured }).eq('id', r.id); load(); };
  return (
    <div className="space-y-5">
      <Hero photos={photos} empty="No photos yet. Upload the first ones below." />
      <Card>
        <CardTitle>All photos</CardTitle>
        <Uploader deal={deal} role={role} me={me} onDone={load} allowShare label="Upload photos" accept={IMAGES} preview={preview}
          hint="Tick “Seller can see” to put a photo on the seller page. Starred photos show first." />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows === null && <Empty>Loading…</Empty>}
          {rows && !photos.length && <Empty>Nothing here yet.</Empty>}
          {photos.map((r) => (
            <div key={r.id} className="overflow-hidden rounded-xl border border-line bg-white">
              <a href={r.url} target="_blank" rel="noreferrer"><img src={r.url} alt={r.note || ''} className="aspect-[4/3] w-full object-cover" /></a>
              <div className="space-y-2 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-ink-soft">{r.note || r.file_name}</p>
                  {!preview && <button onClick={() => star(r)} title="Show first" className={`text-lg leading-none ${r.featured ? 'text-warm' : 'text-line hover:text-warm'}`}>★</button>}
                </div>
                {!preview && <ShareChips r={r} owner={owner} onChange={load} />}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
