import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Card, CardTitle, Empty } from '../components/Shell.jsx';
import Thread from '../components/Thread.jsx';
import { useUploads, Uploader, PhotoGrid, FileList } from '../components/Files.jsx';

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

export default function Seller({ deal, me, preview }) {
  const c = deal.seller_content || {};
  const [rows, load] = useUploads(deal);
  const [level, setLevel] = useState(null);
  const visible = (rows || []).filter((r) => r.visibility === 'seller' || r.uploaded_by_email === me.email);
  const mine = visible.filter((r) => r.uploaded_by_email === me.email);

  useEffect(() => {
    if (preview) return;
    supabase.from('commercial_interest').select('level').eq('deal_id', deal.id).eq('email', me.email).maybeSingle().then(({ data }) => setLevel(data?.level || null));
  }, [deal.id]);

  const mark = async (l) => {
    if (preview) return;
    setLevel(l);
    await supabase.from('commercial_interest').upsert({ deal_id: deal.id, email: me.email, level: l, updated_at: new Date().toISOString() });
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-[0.18em] text-warm">{deal.address}</p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{c.headline || deal.title}</h1>
        {c.intro && <p className="mt-4 max-w-2xl text-lg text-ink-soft">{c.intro}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Column title="What you carry now" rows={c.carry_now} />
        <Column title="What you’d have with us" rows={c.with_us} tone="warm" />
      </div>

      <Card>
        <CardTitle>The building today</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-ink-soft">Photos from our walkthrough, so you can see what we saw.</p>
        <PhotoGrid rows={visible.filter((r) => r.uploaded_by_email !== me.email)} />
      </Card>

      <Card>
        <CardTitle>Where are you at?</CardTitle>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map(([k, label]) => (
            <button key={k} onClick={() => mark(k)}
              className={`rounded-full border px-4 py-2 text-sm transition ${level === k ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        {level && <p className="mt-3 text-sm text-ink-soft">Thanks. We’ll follow up.</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Thread deal={deal} channel="seller" role="seller" me={me} title="Ask us anything" hint="Your questions go straight to our team." readOnly={preview} />
        <Card>
          <CardTitle>Share documents</CardTitle>
          <p className="-mt-2 mb-4 text-sm text-ink-soft">Rent roll, leases, bills or anything you’d like us to see. Only our team can open them.</p>
          {!preview && <Uploader deal={deal} role="seller" me={me} onDone={load} label="Upload documents" />}
          <div className="mt-4">{mine.length ? <FileList rows={mine} /> : <Empty>Nothing shared yet.</Empty>}</div>
        </Card>
      </div>
    </div>
  );
}
