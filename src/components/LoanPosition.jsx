import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Field, Button } from './Shell.jsx';

const FIELDS = [['balance', 'Remaining loan balance', 'number'], ['lender', 'Lender', 'text'], ['payment', 'Monthly loan payment', 'number'], ['rate', 'Interest rate (%)', 'number'], ['maturity', 'Maturity / payoff terms', 'text']];
export default function LoanPosition({ deal, role, preview }) {
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
    setStatus(error ? 'Loan details not saved. Please try again.' : 'Loan saved. Visible only to the owner and seller.');
  };
  const shown = (key, value) => value === undefined || value === '' || value === null ? 'Awaiting owner entry' : ['balance', 'payment'].includes(key) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : key === 'rate' ? `${value}%` : value;
  return <Card><CardTitle>{owner ? 'Seller loan position · owner entry' : 'Your current loan'}</CardTitle><p className="mb-4 text-sm text-ink-soft">{owner ? 'Enter figures from the seller’s records. Blank means unconfirmed. Only you and the seller can read these fields.' : 'Entered by the owner from your records. Message us if anything needs correcting.'}</p>{owner ? <form onSubmit={save} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2">{FIELDS.map(([key, label, type]) => <label key={key} className="text-sm">{label}<Field disabled={!loaded} type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} value={loan[key] ?? ''} onChange={e => setLoan({ ...loan, [key]: e.target.value })} /></label>)}</div><Button type="submit" disabled={!loaded}>Save loan</Button></form> : <dl className="grid grid-cols-2 gap-4 text-sm">{FIELDS.map(([key, label]) => <div key={key}><dt className="text-ink-soft">{label}</dt><dd className="font-medium">{shown(key, loan[key])}</dd></div>)}</dl>}<p role="status" className="mt-3 text-sm">{status}</p></Card>;
}
