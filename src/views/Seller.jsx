import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Empty } from '../components/Shell.jsx';
import Messages, { sendToOwner, useSellerMessagesTo } from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { Cover, useDealGallery } from '../components/Photos.jsx';
import OverlaySheet, { OverviewActionButtons } from '../components/OverlaySheet.jsx';
import { useSheetBadges } from '../lib/sheetBadges.js';
import LoanPosition from '../components/LoanPosition.jsx';
import { ExecutionPlanCard, LeadOfferCard, SellerProtectionsCard } from '../components/LeadOfferCard.jsx';
import { coveredLabelOf } from '../components/SellerOffer.jsx';

// The seller shares documents only (no photo uploads).
const DOCS = 'application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

const LEVELS = [
  ['interested', 'I’d like to talk'],
  ['questions', 'I have questions first'],
  ['not_now', 'Not right now'],
];

export default function Seller({ deal, me, preview, tab }) {
  const c = deal.seller_content || {};
  const [rows, load] = useUploads(deal);
  const [level, setLevel] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [sellerOffer, setSellerOffer] = useState(null);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(null);
  const [activeSheet, setActiveSheet] = useState(null);
  const sellerTo = useSellerMessagesTo(deal);

  const gallery = useDealGallery(deal, 'seller', preview, { includeVideos: true, externalRows: rows });
  const mine = (rows || []).filter((r) => r.uploaded_by_email === me.email && r.kind !== 'photo');
  const { docBadge, msgBadge, markDocsSeen, markMsgsSeen } = useSheetBadges({
    deal,
    me,
    role: 'seller',
    preview,
    docs: mine,
  });

  useEffect(() => {
    if (tab === 'photos' && gallery.items.length > 0) setPhotoViewerOpen(0);
    else if (tab === 'documents' || tab === 'files') {
      setActiveSheet('documents');
      markDocsSeen();
    } else if (tab === 'messages') {
      setActiveSheet('messages');
      markMsgsSeen();
    }
  }, [tab, gallery.items.length]);

  useEffect(() => {
    let live = true;
    supabase.rpc('commercial_get_seller_offer', { p_deal: deal.id })
      .then(({ data }) => {
        if (!live) return;
        const row = Array.isArray(data) ? data[0] : data;
        setSellerOffer(row || null);
      });
    return () => { live = false; };
  }, [deal.id]);

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

  const openDocs = () => {
    markDocsSeen();
    setActiveSheet('documents');
  };
  const openMsgs = () => {
    markMsgsSeen();
    setActiveSheet('messages');
  };

  const rawSummary = sellerOffer?.seller_summary;
  const summary = rawSummary && ((Array.isArray(rawSummary.sellerTable) && rawSummary.sellerTable.length > 0) || (Array.isArray(rawSummary.terms) && rawSummary.terms.length > 0))
    ? rawSummary
    : null;

  return (
    <div className="readable space-y-6">
      <Cover items={gallery.items} compact open={photoViewerOpen} onOpenChange={setPhotoViewerOpen} />

      <div className="space-y-4">
        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{c.headline || deal.title}</h1>
        <OverviewActionButtons
          showDocuments
          showMessages
          docCount={docBadge}
          msgCount={msgBadge}
          onOpenDocuments={openDocs}
          onOpenMessages={openMsgs}
        />
      </div>

      <LeadOfferCard
        deal={deal}
        content={c}
        summary={summary}
        preview={preview}
        sellerOnly
        coveredLabel={coveredLabelOf(sellerOffer?.structure)}
        onAsk={(q) => sendToOwner(deal, me, 'seller', q, 'Offer question')}
      />

      <SellerProtectionsCard content={c} />

      <ExecutionPlanCard content={c} summary={summary} sellerOnly />

      <LoanPosition deal={deal} role="seller" preview={preview} me={me} sendTo={sellerTo} collapsedByDefault />

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
        {level && <p role="status" className="mt-3 text-sm text-ink">Saved. We’ll follow your pace.</p>}
      </Card>

      <OverlaySheet open={activeSheet === 'documents'} kind="documents" title="Documents" onClose={() => setActiveSheet(null)}>
        <Card>
          <CardTitle>Share documents</CardTitle>
          <Uploader deal={deal} role="seller" me={me} onDone={load} label="Choose files" accept={DOCS} preview={preview} />
          <div className="mt-4">{mine.length ? <FileList rows={mine} /> : <Empty>No files shared yet.</Empty>}</div>
        </Card>
      </OverlaySheet>

      <OverlaySheet open={activeSheet === 'messages'} kind="messages" title="Messages" onClose={() => setActiveSheet(null)}>
        <Messages deal={deal} me={me} role="seller" preview={preview} sellerTo={sellerTo} />
      </OverlaySheet>
    </div>
  );
}
