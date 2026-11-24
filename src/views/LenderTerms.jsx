import { DictatedField } from '../components/Dictation.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { lenderBoard } from '../lib/v63.js';
import { Card, CardTitle, Button, Empty } from '../components/Shell.jsx';
import { sendToOwner } from '../components/Messages.jsx';

export const LENDER_TYPES = {
  private: { label: 'Private money', intro: 'Relationship-based acquisition or bridge capital.', fields: ['Available amount', 'Interest rate / return', 'Term and extension options', 'Monthly payments or accrual', 'Lien position and collateral', 'Guarantee / security requirements'], questions: ['What funds can be available, and when?', 'What collateral and reporting do you need?', 'How should early payoff and extensions work?'] },
  hard: { label: 'Hard money', intro: 'Short-term acquisition and renovation financing.', fields: ['Maximum loan / LTC / LTV', 'Interest rate', 'Origination points and fees', 'Term / extension fees', 'Rehab holdback and draw process', 'Recourse / prepayment terms'], questions: ['What experience, liquidity, and down payment are required?', 'How are rehab draws inspected and funded?', 'What valuation and exit evidence are needed?'] },
  traditional: { label: 'Traditional', intro: 'Primarily the refinance after stabilization; shown now for exit planning.', fields: ['Maximum LTV', 'Minimum DSCR / debt yield', 'Interest rate and rate lock', 'Amortization / balloon term', 'Seasoning and occupancy requirements', 'Reserves, fees, and prepayment penalty'], questions: ['What stabilized rent roll and operating history are required?', 'How long must title and renovation costs season?', 'What appraisal, entity, and borrower documents are needed?'] },
};
// Every lender's submitted terms, by company. Lenders and the buyer read this; each lender writes only their own row.
export function LenderBoard({ deal, me, refresh = 0, role = 'lender' }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    supabase.from('commercial_lender_terms').select('*').eq('deal_id', deal.id).then(({ data, error }) => { if (live) setRows(error ? [] : lenderBoard(data)); });
    return () => { live = false; };
  }, [deal.id, refresh]);
  return (
    <Card>
      <CardTitle>Terms from every lender</CardTitle>
      <p className="-mt-2 mb-4 text-base text-ink-soft">{role === 'owner' ? 'What each lender has offered, by company.' : 'Every lender on this deal sees this list, by company name. The buyer sees it too.'}</p>
      {rows === null ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No terms submitted yet.</Empty> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">{r.company_name}{r.lender_uid === me?.uid ? ' (you)' : ''}</h3>
                <span className="text-sm text-ink-soft">{LENDER_TYPES[r.lender_type]?.label || ''} · {when(r.updated_at || r.created_at)}</span>
              </div>
              {Object.entries(r.terms || {}).map(([type, fields]) => (
                <div key={type} className="mt-3">
                  {Object.keys(r.terms).length > 1 && <p className="text-sm font-semibold">{LENDER_TYPES[type]?.label || type}</p>}
                  <dl className="mt-1 space-y-1">
                    {Object.entries(fields || {}).filter(([, v]) => String(v || '').trim()).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 text-base"><dt className="text-ink-soft">{k}</dt><dd className="font-medium break-words">{v}</dd></div>
                    ))}
                  </dl>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function LenderTerms({ deal, me, preview }) {
  const [type, setType] = useState('private');
  const [drafts, setDrafts] = useState({});
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const t = LENDER_TYPES[type];
  const values = drafts[type] || {};
  useEffect(() => {
    if (preview || !me?.uid) return;
    supabase.from('commercial_lender_terms').select('*').eq('deal_id', deal.id).eq('lender_uid', me.uid).maybeSingle().then(({ data }) => {
      if (!data) return;
      setMine(data);
      setCompany(data.company_name || '');
      setDrafts(data.terms || {});
    });
  }, [deal.id, me?.uid, preview]);
  const send = async e => {
    e.preventDefault(); if (preview || busy || !company.trim()) return;
    setBusy(true);
    try {
      const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
      // Questions stay private to the buyer; only the terms go on the shared lender list.
      const { Questions: _private, ...shared } = filled;
      const terms = { ...(mine?.terms || {}), [type]: shared };
      const saved = await supabase.from('commercial_lender_terms').upsert(
        { deal_id: deal.id, lender_uid: me.uid, company_name: company.trim(), lender_type: type, terms, updated_at: new Date().toISOString() },
        { onConflict: 'deal_id,lender_uid' },
      ).select().maybeSingle();
      if (saved.data) setMine(saved.data);
      const body = `${company.trim()} · ${t.label}: terms and questions\n${Object.entries(filled).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
      const error = await sendToOwner(deal, me, 'lender', body, t.label);
      setStatus(saved.error && error ? 'Not sent. Your entries are still here; try again.'
        : saved.error ? 'Sent to the buyer, but not added to the lender list. Try again.'
        : error ? 'Added to the lender list, but the message to the buyer did not send. Try again.'
        : 'Sent. It’s on the lender list below and in your messages with the buyer.');
      setRefresh((n) => n + 1);
    } catch { setStatus('Not sent. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5"><Card><CardTitle>Your terms</CardTitle><label className="mb-4 block text-sm font-medium">Company name<input required autoComplete="organization" disabled={preview} maxLength={160} value={company} onChange={e => setCompany(e.target.value)} placeholder="Shown to the buyer and the other lenders" className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2" /></label><div role="tablist" aria-label="Lender type" className="mb-4 flex flex-wrap gap-2">{Object.entries(LENDER_TYPES).map(([k, x]) => <Button key={k} role="tab" aria-selected={k === type} kind={k === type ? 'primary' : 'secondary'} onClick={() => { setType(k); setStatus(''); }}>{x.label}</Button>)}</div><div role="tabpanel"><h3 className="text-lg font-semibold">{t.label}</h3><p className="mb-4 text-sm text-ink-soft">{t.intro} All terms are indicative until quoted and approved.</p><form onSubmit={send} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">{t.fields.map(label => <label key={label} className="text-sm">{label}<DictatedField aria-label={label} disabled={preview} maxLength={300} value={values[label] || ''} onChange={e => setDrafts({ ...drafts, [type]: { ...values, [label]: e.target.value } })} className="mt-1 w-full rounded-xl border border-line px-3 py-2" /></label>)}</div><ul className="list-disc space-y-1 pl-5 text-sm">{t.questions.map(q => <li key={q}>{q}</li>)}</ul><label className="block text-sm">Questions / supporting requirements<DictatedField as="textarea" aria-label="Questions or supporting requirements" disabled={preview} value={values.Questions || ''} maxLength={1000} onChange={e => setDrafts({ ...drafts, [type]: { ...values, Questions: e.target.value } })} className="mt-1 w-full rounded-xl border border-line p-3" /></label><Button type="submit" disabled={preview || busy || !company.trim() || !Object.values(values).some(v => v.trim())}>Send terms to the buyer</Button><p className="text-sm text-ink-soft">Your terms go on the lender list below (every lender on this deal sees it, by company) and to the buyer as a private message. Questions you write here go only to the buyer.</p><p role="status" className="text-sm">{status}</p></form></div></Card><LenderBoard deal={deal} me={me} refresh={refresh} /></div>;
}
