import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Button, Card, CardTitle, Field } from './Shell.jsx';
import { normalizeProtections } from './LeadOfferCard.jsx';

export default function ProtectionsEditor({ deal, onSaved }) {
  const [items, setItems] = useState(() => normalizeProtections(deal.seller_content));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    setItems(normalizeProtections(deal.seller_content));
  }, [deal.id, deal.seller_content]);

  const updateItem = (idx, value) => {
    setMsg('');
    setErr('');
    setItems((list) => list.map((item, i) => (i === idx ? value : item)));
  };

  const removeItem = (idx) => {
    setMsg('');
    setErr('');
    setItems((list) => list.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    setMsg('');
    setErr('');
    setItems((list) => [...list, '']);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const cleaned = items.map((s) => s.trim()).filter(Boolean);
      const seller_content = { ...(deal.seller_content || {}), protections: cleaned };
      const { data, error } = await supabase
        .from('commercial_deals')
        .update({ seller_content })
        .eq('id', deal.id)
        .select()
        .single();
      if (error) {
        setErr(error.message || 'Could not save.');
        return;
      }
      setItems(cleaned);
      setMsg('Saved.');
      if (data) onSaved?.(data);
    } catch {
      setErr('Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>Your protections</CardTitle>
      <div className="space-y-2.5">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Field
              aria-label={`Protection ${idx + 1}`}
              value={item}
              maxLength={300}
              disabled={busy}
              placeholder="Plain seller-facing protection"
              onChange={(e) => updateItem(idx, e.target.value)}
            />
            <Button
              type="button"
              kind="secondary"
              disabled={busy}
              aria-label={`Remove protection ${idx + 1}`}
              onClick={() => removeItem(idx)}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" kind="secondary" disabled={busy} onClick={addItem}>
          Add item
        </Button>
        <Button type="button" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {msg && <span role="status" className="text-sm text-ink">{msg}</span>}
        {err && <span role="alert" className="text-sm text-red-700">{err}</span>}
      </div>
    </Card>
  );
}
