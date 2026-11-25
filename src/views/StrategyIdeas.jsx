import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { when } from '../lib/format.js';
import { Button, Card, CardTitle, Empty, Field } from '../components/Shell.jsx';
import { DictatedField } from '../components/Dictation.jsx';
import { canDeleteIdea, canEditIdea } from '../lib/v63.js';

const BLANK = { title: '', notes: '' };

// Strategy cards, shown under Tenants. The buyer (owner) adds, edits and deletes any card; the realtor reads all,
// adds her own and deletes only her own. Never rendered for any other role or in a "See as" preview.
export default function StrategyIdeas({ deal, me, role, preview }) {
  const allowed = (role === 'owner' || role === 'realtor') && !preview;
  const owner = role === 'owner';
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    supabase
      .from('commercial_strategy_ideas')
      .select('*')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!live) return;
        setRows(data || []);
        setLoadErr(error ? 'Strategy ideas could not load. Refresh to try again.' : '');
      });
    return () => { live = false; };
  }, [deal.id, allowed, refresh]);

  if (!allowed) return null;

  const save = async (e) => {
    e.preventDefault();
    if (pending || !form.title.trim()) return;
    setPending(true);
    setStatus('');
    try {
      const payload = { title: form.title.trim(), notes: form.notes.trim(), updated_at: new Date().toISOString() };
      const q = supabase.from('commercial_strategy_ideas');
      const res = editingId && owner
        ? await q.update(payload).eq('id', editingId).eq('deal_id', deal.id).select('id').maybeSingle()
        : await q.insert({ ...payload, deal_id: deal.id, author_uid: me?.uid, author_role: role, author_name: me?.name || '' }).select('id').maybeSingle();
      if (res.error || !res.data) {
        setStatus('Could not save. Check your connection.');
        return;
      }
      setForm(BLANK);
      setEditingId(null);
      setStatus(editingId ? 'Card updated.' : 'Card added.');
      setRefresh((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  const remove = async (row) => {
    if (pending || !window.confirm(`Delete "${row.title}"?`)) return;
    setPending(true);
    setStatus('');
    try {
      const { error } = await supabase.from('commercial_strategy_ideas').delete().eq('id', row.id).eq('deal_id', deal.id);
      if (editingId === row.id) { setEditingId(null); setForm(BLANK); }
      setStatus(error ? 'Could not delete card.' : 'Card deleted.');
      setRefresh((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>
          Strategy ideas
        </CardTitle>
        {loadErr && <p role="alert" className="mb-3 text-sm text-red-700">{loadErr}</p>}

        <form onSubmit={save} className="space-y-2.5 rounded-2xl bg-paper p-4">
          <label className="block text-xs text-ink-soft">
            Idea title
            <Field
              required
              aria-label="Strategy idea title"
              placeholder="Short title for this idea"
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1"
            />
          </label>
          <label className="block text-xs text-ink-soft">
            Notes
            <DictatedField
              as="textarea"
              rows={3}
              aria-label="Strategy idea notes"
              placeholder="Your notes…"
              maxLength={6000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || !form.title.trim()}>
              {editingId ? 'Save card' : 'Add idea card'}
            </Button>
            {editingId && (
              <Button type="button" kind="secondary" onClick={() => { setEditingId(null); setForm(BLANK); }}>
                Cancel
              </Button>
            )}
            {status && <span role="status" className="text-sm text-ink-soft">{status}</span>}
          </div>
        </form>

        <div className="mt-4">
          {rows === null ? (
            <Empty>Loading…</Empty>
          ) : rows.length === 0 ? (
            <Empty>No strategy cards yet.</Empty>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-white p-4">
                  <div className="space-y-1.5">
                    <h3 className="font-display text-lg font-semibold leading-snug break-words">{r.title}</h3>
                    {r.notes && <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">{r.notes}</p>}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-soft">
                    <span>{r.author_role === 'realtor' ? `${r.author_name || 'Realtor'} · ` : ''}{when(r.updated_at || r.created_at)}</span>
                    <div className="flex gap-3">
                      {canEditIdea(role) && (
                        <button
                          type="button"
                          className="underline hover:text-ink"
                          onClick={() => { setEditingId(r.id); setForm({ title: r.title, notes: r.notes || '' }); }}
                        >
                          Edit
                        </button>
                      )}
                      {canDeleteIdea(role, r, me?.uid) && (
                        <button
                          type="button"
                          disabled={pending}
                          className="underline hover:text-red-700"
                          onClick={() => remove(r)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
