import { buyerName } from '../lib/people.js';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Field, Button } from './Shell.jsx';
import { sendToOwner } from './Messages.jsx';

const FIELDS = [['balance', 'Remaining loan balance', 'number'], ['lender', 'Lender', 'text'], ['payment', 'Monthly loan payment', 'number'], ['rate', 'Interest rate (%)', 'number'], ['maturity', 'Maturity / payoff terms', 'text']];
export default function LoanPosition({ deal, role, preview, me }) {
  const [mine, setMine] = useState({});
  const [busy, setBusy] = useState(false);
  const [loan, setLoan] = useState({});
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const owner = role === 'owner' && !preview;
  useEffect(() => {
    supabase.from('commercial_seller_loans').select('details').eq('deal_id', deal.id).maybeSingle().then(({ data, error }) => {
      setLoan(data?.details || {}); if (error) setStatus('Loan details could not load. Please refresh.'); else setLoaded(true);
    });
  }, [deal.id]);
  const save = async e => {
    e.preventDefault(); if (!owner || !loaded) return;
    const { error } = await supabase.from('commercial_seller_loans').upsert({ deal_id: deal.id, details: loan, updated_at: new Date().toISOString() });
    setStatus(error ? 'Loan details not saved. Please try again.' : 'Loan saved. Only you and the seller can see it.');
  };
  const blank = (v) => v === undefined || v === '' || v === null;
  // The seller fills in what we don't have yet. It goes to the buyer as a message; the buyer enters it.
  const send = async e => {
    e.preventDefault(); if (preview || busy) return;
    const lines = FIELDS.filter(([k]) => !blank(mine[k])).map(([k, l]) => `${l}: ${mine[k]}`);
    if (!lines.length) return;
    setBusy(true);
    try {
      const error = await sendToOwner(deal, me, role, `My loan details:\n${lines.join('\n')}`, 'Loan details');
      setStatus(error ? 'Not sent. Your entries are still here; try again.' : `Sent to ${buyerName()}. They’ll be added here.`);
      if (!error) setMine({});
    } catch { setStatus('Not sent. Please try again.'); }
    finally { setBusy(false); }
  };
  const shown = (key, value) => {
    if (blank(value)) return 'Not entered yet';
    if (key === 'balance') {
      const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
      return `${formatted} (or what you owe)`;
    }
    if (key === 'payment') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
    return key === 'rate' ? `${value}%` : value;
  };
  return <Card><CardTitle>{owner ? 'Seller’s loan' : 'Your current loan'}</CardTitle>{owner ? <form onSubmit={save} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">{FIELDS.map(([key, label, type]) => <label key={key} className="text-sm">{label}<Field disabled={!loaded} type={type} inputMode={type === 'number' ? 'decimal' : undefined} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} value={loan[key] ?? ''} onChange={e => setLoan({ ...loan, [key]: e.target.value })} /></label>)}</div><Button type="submit" disabled={!loaded}>Save loan</Button></form> : <form onSubmit={send} className="space-y-4"><dl className="grid gap-4 text-sm sm:grid-cols-2">{FIELDS.map(([key, label, type]) => <div key={key}><dt className="text-ink-soft">{label}</dt>{blank(loan[key]) ? <dd><Field aria-label={label} disabled={preview || !loaded} type={type} inputMode={type === 'number' ? 'decimal' : undefined} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} placeholder="Not entered yet. Type it here" value={mine[key] ?? ''} onChange={e => setMine({ ...mine, [key]: e.target.value })} /></dd> : <dd className="font-medium">{shown(key, loan[key])}</dd>}</div>)}</dl>{FIELDS.some(([k]) => blank(loan[k])) && <Button type="submit" disabled={preview || busy || !FIELDS.some(([k]) => !blank(mine[k]))}>Send to {buyerName()}</Button>}</form>}<p role="status" className="mt-3 text-sm">{status}</p></Card>;
}
