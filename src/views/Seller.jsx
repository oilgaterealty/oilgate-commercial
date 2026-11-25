import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Empty } from '../components/Shell.jsx';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { Cover, PhotoStrip, photosOf, useSharedWalkPhotos, useSharedWalkVideos, WalkVideos } from '../components/Photos.jsx';
import LoanPosition from '../components/LoanPosition.jsx';
import { ExecutionPlanCard, LeadOfferCard } from '../components/LeadOfferCard.jsx';

// The seller shares documents only (no photo uploads).
const DOCS = 'application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

const LEVELS = [
  ['interested', 'I’d like to talk'],
  ['questions', 'I have questions first'],
  ['not_now', 'Not right now'],
];

export default function Seller({ deal, me, preview }) {
  const c = deal.seller_content || {};
  const [rows, load] = useUploads(deal);
  const [level, setLevel] = useState(null);
  const [saveError, setSaveError] = useState('');
  // The seller sees one cover photo (the starred upload) and only the walkthrough photos and videos shared with him.
  const walk = useSharedWalkPhotos(deal, 'seller');
  const walkVideos = useSharedWalkVideos(deal, 'seller');
  const coverRows = photosOf((rows || []).filter((r) => r.visibility === 'seller'));
  const mine = (rows || []).filter((r) => r.uploaded_by_email === me.email);

  useEffect(() => {
    if (preview) return;
    supabase.from('commercial_interest').select('level').eq('deal_id', deal.id).eq('email', me.email).maybeSingle()
      .then(({ data }) => { setLevel(data?.level || null); });
  }, [deal.id]);

  const save = async (l) => {
    if (preview) return;
    const { error } = await supabase.from('commercial_interest').upsert({ deal_id: deal.id, email: me.email, level: l, updated_at: new Date().toISOString() });
    setSaveError(error ? 'Your interest did not save. Please try again.' : '');
    if (!error) setLevel(l);
  };

  return (
    <div className="readable space-y-8">
      <Cover rows={coverRows} compact />

      <div>
        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{c.headline || deal.title}</h1>
      </div>

      {(walk.length > 0 || walkVideos.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl font-semibold">Photos</h2>
          {walk.length > 0 && <PhotoStrip photos={walk} />}
          <WalkVideos videos={walkVideos} />
        </section>
      )}

      <LeadOfferCard
        deal={deal}
        content={c}
        preview={preview}
        onAsk={(q) => sendToOwner(deal, me, 'seller', q, 'Offer question')}
      />

      <ExecutionPlanCard content={c} />

      <LoanPosition deal={deal} role="seller" preview={preview} me={me} />

      <Card>
        <CardTitle>How do you feel about it?</CardTitle>
        {saveError && <p role="alert" className="mb-3 text-sm text-red-700">{saveError}</p>}
        <div className="flex flex-wrap gap-2">
          {LEVELS.map(([k, label]) => (
            <button key={k} onClick={() => save(k)} disabled={preview}
              className={`min-h-[44px] rounded-full border px-4 py-2 text-sm transition ${level === k ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        {level && <p role="status" className="mt-3 text-sm text-ink-soft">Saved. We’ll follow your pace.</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Messages deal={deal} me={me} role="seller" preview={preview} />
        <Card>
          <CardTitle>Share documents</CardTitle>
          <Uploader deal={deal} role="seller" me={me} onDone={load} label="Choose files" accept={DOCS} preview={preview} />
          <div className="mt-4">{mine.length ? <FileList rows={mine} /> : <Empty>No files shared yet.</Empty>}</div>
        </Card>
      </div>
    </div>
  );
}
