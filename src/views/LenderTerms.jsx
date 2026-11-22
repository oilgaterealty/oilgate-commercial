import { DictatedField } from '../components/Dictation.jsx';
import { useState } from 'react';
import { Card, CardTitle, Button } from '../components/Shell.jsx';
import { sendToOwner } from '../components/Messages.jsx';

export const LENDER_TYPES = {
  private: { label: 'Private money', intro: 'Relationship-based acquisition or bridge capital.', fields: ['Available amount', 'Interest rate / return', 'Term and extension options', 'Monthly payments or accrual', 'Lien position and collateral', 'Guarantee / security requirements'], questions: ['What funds can be available, and when?', 'What collateral and reporting do you need?', 'How should early payoff and extensions work?'] },
  hard: { label: 'Hard money', intro: 'Short-term acquisition and renovation financing.', fields: ['Maximum loan / LTC / LTV', 'Interest rate', 'Origination points and fees', 'Term / extension fees', 'Rehab holdback and draw process', 'Recourse / prepayment terms'], questions: ['What experience, liquidity, and down payment are required?', 'How are rehab draws inspected and funded?', 'What valuation and exit evidence are needed?'] },
  traditional: { label: 'Traditional', intro: 'Primarily the refinance after stabilization; shown now for exit planning.', fields: ['Maximum LTV', 'Minimum DSCR / debt yield', 'Interest rate and rate lock', 'Amortization / balloon term', 'Seasoning and occupancy requirements', 'Reserves, fees, and prepayment penalty'], questions: ['What stabilized rent roll and operating history are required?', 'How long must title and renovation costs season?', 'What appraisal, entity, and borrower documents are needed?'] },
};
export default function LenderTerms({ deal, me, preview }) {
  const [type, setType] = useState('private');
  const [drafts, setDrafts] = useState({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const t = LENDER_TYPES[type];
  const values = drafts[type] || {};
  const send = async e => {
    e.preventDefault(); if (preview || busy) return;
    setBusy(true);
    try {
      const body = `${t.label} — indicative terms / questions\n${Object.entries(values).filter(([,v]) => v.trim()).map(([k,v]) => `${k}: ${v}`).join('\n')}`;
      const error = await sendToOwner(deal, me, 'lender', body, t.label);
      setStatus(error ? 'Not sent. Your entries are still here; try again.' : 'Sent privately to the owner. Find it in Messages.');
    } catch { setStatus('Not sent. Please try again.'); }
    finally { setBusy(false); }
  };
  return <Card><CardTitle>Financing desk</CardTitle><div role="tablist" aria-label="Lender type" className="mb-4 flex flex-wrap gap-2">{Object.entries(LENDER_TYPES).map(([k, x]) => <Button key={k} role="tab" aria-selected={k === type} kind={k === type ? 'primary' : 'secondary'} onClick={() => { setType(k); setStatus(''); }}>{x.label}</Button>)}</div><div role="tabpanel"><h3 className="text-lg font-semibold">{t.label}</h3><p className="mb-4 text-sm text-ink-soft">{t.intro} All terms are indicative until quoted and approved.</p><form onSubmit={send} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">{t.fields.map(label => <label key={label} className="text-sm">{label}<DictatedField aria-label={label} disabled={preview} maxLength={300} value={values[label] || ''} onChange={e => setDrafts({ ...drafts, [type]: { ...values, [label]: e.target.value } })} className="mt-1 w-full rounded-xl border border-line px-3 py-2" /></label>)}</div><ul className="list-disc space-y-1 pl-5 text-sm">{t.questions.map(q => <li key={q}>{q}</li>)}</ul><label className="block text-sm">Questions / supporting requirements<DictatedField as="textarea" aria-label="Questions or supporting requirements" disabled={preview} value={values.Questions || ''} maxLength={1000} onChange={e => setDrafts({ ...drafts, [type]: { ...values, Questions: e.target.value } })} className="mt-1 w-full rounded-xl border border-line p-3" /></label><Button type="submit" disabled={preview || busy || !Object.values(values).some(v => v.trim())}>Send terms to owner</Button><p className="text-xs text-ink-soft">Only the owner receives your comments. Each lender has a private conversation.</p><p role="status" className="text-sm">{status}</p></form></div></Card>;
}
