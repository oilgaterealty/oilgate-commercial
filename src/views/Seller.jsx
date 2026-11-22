import { DictatedField } from '../components/Dictation.jsx';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Button, Empty } from '../components/Shell.jsx';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { PhotoStrip, photosOf } from '../components/Photos.jsx';
import LoanPosition from '../components/LoanPosition.jsx';

const LEVELS = [
  ['interested', 'I’d like to talk'],
  ['questions', 'I have questions first'],
  ['not_now', 'Not right now'],
];

function Column({ title, rows, tone }) {
  return (
    <div className={`rounded-2xl p-6 ${tone === 'warm' ? 'bg-ink text-white' : 'border border-line bg-white'}`}>
      <p className={`text-xs uppercase tracking-[0.18em] ${tone === 'warm' ? 'text-warm' : 'text-ink-soft'}`}>{title}</p>
      <ul className="mt-4 space-y-4">
        {(rows || []).map((r, i) => (
          <li key={i} className={`flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0 ${tone === 'warm' ? 'border-white/10' : 'border-line'}`}>
            <span className="font-medium">{r.label}</span>
            <span className={`text-right text-sm ${tone === 'warm' ? 'text-white/75' : 'text-ink-soft'}`}>{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Option({ o, liked, onLike, onAsk, preview }) {
  const open = true;
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState('');
  const ask = async (e) => {
    e.preventDefault();
    if (!q.trim() || preview) return;
    const err = await onAsk(q.trim());
    setSent(err ? 'That didn’t send. Try again.' : 'Sent. We’ll answer in your messages below.');
    if (!err) { setQ(''); setAsking(false); }
  };
  return (
    <div className={`rounded-3xl border-2 p-5 transition ${open ? 'border-ink bg-white' : 'border-line bg-white hover:border-ink-soft'} ${liked ? 'ring-2 ring-warm' : ''}`}>
      <div className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg text-white">{o.key}</span>
          {liked && <span className="rounded-full bg-warm-soft px-2.5 py-1 text-xs font-medium">Your pick</span>}
        </div>
        <h3 className="mt-3 font-display text-2xl font-semibold leading-tight">{o.title}</h3>
        <p className="mt-1 text-ink-soft">{o.tagline}</p>
        {!open && <p className="mt-3 text-sm font-medium underline-offset-4 hover:underline">See how it works ›</p>}
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          {o.steps?.length > 0 && (
            <ol className="space-y-2">
              {o.steps.map((s, i) => <li key={i} className="flex gap-3 text-sm"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warm-soft text-xs">{i + 1}</span>{s}</li>)}
            </ol>
          )}
          {o.you_get?.length > 0 && (
            <div className="rounded-2xl bg-ink p-4 text-white">
              <p className="text-xs uppercase tracking-[0.18em] text-warm">What you’d get</p>
              <ul className="mt-2 space-y-2">
                {o.you_get.map((r, i) => <li key={i} className="flex justify-between gap-3 text-sm"><span>{r.label}</span><span className="text-right font-medium">{r.value}</span></li>)}
              </ul>
            </div>
          )}
          {o.ask && <p className="text-sm"><span className="font-medium">What we’d ask of you: </span>{o.ask}</p>}
          {o.watch && <p className="text-sm text-ink-soft"><span className="font-medium text-ink">Worth knowing: </span>{o.watch}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={onLike} disabled={preview}>{liked ? 'This is my pick' : 'This one looks good'}</Button>
            <Button kind="secondary" onClick={() => setAsking(!asking)} disabled={preview}>Ask about this option</Button>
          </div>
          {asking && (
            <form onSubmit={ask} className="space-y-2">
              <DictatedField as="textarea" rows={3} value={q} onChange={(e) => setQ(e.target.value)} maxLength={4000} placeholder={`Your question about option ${o.key}`}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
              <Button type="submit" disabled={!q.trim()}>Send question</Button>
            </form>
          )}
          {sent && <p className="text-sm text-ink-soft">{sent}</p>}
        </div>
      )}
    </div>
  );
}

function OptionActions({ o, liked, onLike, preview, onAsk }) {
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const send = async e => {
    e.preventDefault(); if (preview || busy || !question.trim()) return;
    setBusy(true);
    try { const error = await onAsk(question.trim()); setStatus(error ? 'Could not send. Please try again.' : 'Sent to the owner and realtor.'); if (!error) { setQuestion(''); setAsking(false); } }
    catch { setStatus('Could not send. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3"><Button disabled={preview} onClick={onLike}>{liked ? 'Your pick' : 'This one looks good'}</Button><Button kind="secondary" disabled={preview} onClick={() => setAsking(!asking)}>Ask about this option</Button>{asking && <form onSubmit={send} className="space-y-2"><DictatedField as="textarea" autoFocus aria-label={`Your question about option ${o.key}`} placeholder={`Your question about option ${o.key}`} value={question} onChange={e => setQuestion(e.target.value)} maxLength={4000} rows={3} className="w-full rounded-xl border border-line p-3" /><Button type="submit" disabled={busy || !question.trim()}>Send question</Button></form>}<p role="status" className="text-sm">{status}</p></div>;
}

export default function Seller({ deal, me, preview }) {
  const c = deal.seller_content || {};
  const [rows, load] = useUploads(deal);
  const [level, setLevel] = useState(null);
  const [fav, setFav] = useState(null);
  const [view, setView] = useState('table');
  const [saveError, setSaveError] = useState('');
  const photos = photosOf((rows || []).filter((r) => r.visibility === 'seller'));
  const mine = (rows || []).filter((r) => r.uploaded_by_email === me.email);
  const options = c.options || [];

  useEffect(() => {
    if (preview) return;
    supabase.from('commercial_interest').select('level,favorite_option').eq('deal_id', deal.id).eq('email', me.email).maybeSingle()
      .then(({ data }) => { setLevel(data?.level || null); setFav(data?.favorite_option || null); });
  }, [deal.id]);

  const save = async (l, f) => {
    if (preview) return;
    const { error } = await supabase.from('commercial_interest').upsert({ deal_id: deal.id, email: me.email, level: l, favorite_option: f, updated_at: new Date().toISOString() });
    setSaveError(error ? 'Your interest did not save. Please try again.' : '');
    if (!error) { setLevel(l); setFav(f); }
  };

  return (
    <div className="space-y-8">
      <PhotoStrip photos={photos} />

      <div>
        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{c.headline || deal.title}</h1>
        {c.intro && <p className="mt-3 max-w-2xl text-lg text-ink-soft">{c.intro}</p>}
      </div>

      {options.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-3xl font-semibold">{c.options_title || 'Three ways we could do this'}</h2>
            <div className="flex gap-2" aria-label="Option layout"><Button kind={view === 'table' ? 'primary' : 'secondary'} onClick={() => setView('table')} aria-pressed={view === 'table'}>Table view</Button><Button kind={view === 'cards' ? 'primary' : 'secondary'} onClick={() => setView('cards')} aria-pressed={view === 'cards'}>Card view</Button></div>
          </div>
          {c.options_note && <p className="mb-4 max-w-3xl rounded-2xl bg-warm-soft px-4 py-3 text-sm">{c.options_note}</p>}
          {view === 'table' && <div className="comparison-scroll" tabIndex={0} aria-label="Options comparison; scroll horizontally"><table className="comparison-table"><thead><tr><th>Compare</th>{options.map(o => <th key={o.key}>Option {o.key}<br />{o.title}</th>)}</tr></thead><tbody>
            {['tagline', 'steps', 'you_get', 'ask', 'watch'].map((key, i) => <tr key={key}><th>{['At a glance', 'How it works', 'What you get', 'What we ask', 'Worth knowing'][i]}</th>{options.map(o => <td key={o.key}>{key === 'steps' ? <ol className="list-decimal space-y-2 pl-4">{o.steps?.map((s, n) => <li key={n}>{s}</li>)}</ol> : key === 'you_get' ? o.you_get?.map((r, n) => <p key={n} className="mb-2"><strong>{r.label}:</strong> {r.value}</p>) : o[key] || 'To discuss'}</td>)}</tr>)}
            <tr><th>Your next step</th>{options.map(o => <td key={o.key}><OptionActions o={o} liked={fav === o.key} onLike={() => save(level || 'interested', o.key)} preview={preview} onAsk={q => sendToOwner(deal, me, 'seller', q, `Option ${o.key}`)} /></td>)}</tr>
          </tbody></table></div>}
          <div className={view === 'cards' ? 'grid items-start gap-4 lg:grid-cols-3' : 'hidden'}>
            {options.map((o) => (
              <Option key={o.key} o={o}
                liked={fav === o.key} onLike={() => save(level || 'interested', o.key)} preview={preview}
                onAsk={(q) => sendToOwner(deal, me, 'seller', q, `Option ${o.key}`)} />
            ))}
          </div>
        </section>
      )}

      <LoanPosition deal={deal} role="seller" preview={preview} me={me} />

      {(c.carry_now?.length || c.with_us?.length) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Column title="What you carry now" rows={c.carry_now} />
          <Column title="What you’d have with us" rows={c.with_us} tone="warm" />
        </div>
      )}

      <Card>
        <CardTitle>Where are you at?</CardTitle>
        {saveError && <p role="alert" className="mb-3 text-sm text-red-700">{saveError}</p>}
        <div className="flex flex-wrap gap-2">
          {LEVELS.map(([k, label]) => (
            <button key={k} onClick={() => save(k, fav)} disabled={preview}
              className={`rounded-full border px-4 py-2 text-sm transition ${level === k ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        {level && <p className="mt-3 text-sm text-ink-soft">Thanks. We’ll follow up.</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Messages deal={deal} me={me} role="seller" preview={preview} />
        <Card>
          <CardTitle>Share documents and photos</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-ink-soft">Rent roll, leases, bills, photos, anything you’d like us to see. Only our team can open them.</p>
          <Uploader deal={deal} role="seller" me={me} onDone={load} label="Upload files" preview={preview} />
          <div className="mt-4">{mine.length ? <FileList rows={mine} /> : <Empty>Nothing shared yet.</Empty>}</div>
        </Card>
      </div>
    </div>
  );
}
