import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Button, Empty } from '../components/Shell.jsx';
import Messages, { sendToOwner } from '../components/Messages.jsx';
import { useUploads, Uploader, FileList } from '../components/Files.jsx';
import { Hero, photosOf } from '../components/Photos.jsx';

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

function Option({ o, open, onOpen, liked, onLike, onAsk, preview }) {
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
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg text-white">{o.key}</span>
          {liked && <span className="rounded-full bg-warm-soft px-2.5 py-1 text-xs font-medium">Your pick</span>}
        </div>
        <h3 className="mt-3 font-display text-2xl font-semibold leading-tight">{o.title}</h3>
        <p className="mt-1 text-ink-soft">{o.tagline}</p>
        {!open && <p className="mt-3 text-sm font-medium underline-offset-4 hover:underline">See how it works ›</p>}
      </button>
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
              <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} maxLength={4000} placeholder={`Your question about option ${o.key}`}
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

export default function Seller({ deal, me, preview }) {
  const c = deal.seller_content || {};
  const [rows, load] = useUploads(deal);
  const [level, setLevel] = useState(null);
  const [fav, setFav] = useState(null);
  const [open, setOpen] = useState((deal.seller_content?.options || [])[0]?.key ?? null);
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
    setLevel(l); setFav(f);
    await supabase.from('commercial_interest').upsert({ deal_id: deal.id, email: me.email, level: l, favorite_option: f, updated_at: new Date().toISOString() });
  };

  return (
    <div className="space-y-8">
      <Hero photos={photos} />

      <div>
        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{c.headline || deal.title}</h1>
        {c.intro && <p className="mt-3 max-w-2xl text-lg text-ink-soft">{c.intro}</p>}
      </div>

      {options.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-3xl font-semibold">{c.options_title || 'Three ways we could do this'}</h2>
            <p className="text-sm text-ink-soft">Tap one to see how it works.</p>
          </div>
          {c.options_note && <p className="mb-4 max-w-3xl rounded-2xl bg-warm-soft px-4 py-3 text-sm">{c.options_note}</p>}
          <div className="grid items-start gap-4 lg:grid-cols-3">
            {options.map((o) => (
              <Option key={o.key} o={o} open={open === o.key} onOpen={() => setOpen(open === o.key ? null : o.key)}
                liked={fav === o.key} onLike={() => save(level || 'interested', o.key)} preview={preview}
                onAsk={(q) => sendToOwner(deal, me, 'seller', q, `Option ${o.key}`)} />
            ))}
          </div>
        </section>
      )}

      {(c.carry_now?.length || c.with_us?.length) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Column title="What you carry now" rows={c.carry_now} />
          <Column title="What you’d have with us" rows={c.with_us} tone="warm" />
        </div>
      )}

      <Card>
        <CardTitle>Where are you at?</CardTitle>
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
