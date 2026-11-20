import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { slugify } from '../lib/format.js';
import Shell, { Card, CardTitle, Button, Field, Empty } from '../components/Shell.jsx';

export default function Home({ session }) {
  const [deals, setDeals] = useState(null);
  const [owner, setOwner] = useState(false);
  const [form, setForm] = useState({ title: '', address: '', slug: '', folder: '' });
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [{ data }, { data: o }] = await Promise.all([
      supabase.from('deals').select('id,slug,title,address,status,created_at').order('created_at', { ascending: false }),
      supabase.from('owners').select('email'),
    ]);
    setDeals(data || []);
    setOwner((o || []).length > 0);
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    const slug = slugify(form.slug || form.title);
    const folder = (form.folder.match(/[A-Za-z0-9_-]{20,}/) || [''])[0];
    setMsg('Creating…');
    const { data, error } = await supabase.from('deals').insert({ slug, title: form.title.trim(), address: form.address.trim() }).select('id,slug').single();
    if (error) return setMsg(error.code === '23505' ? 'That page name is taken. Pick another.' : 'Couldn’t create the deal.');
    if (folder) await supabase.from('deal_private').insert({ deal_id: data.id, drive_folder_id: folder });
    setForm({ title: '', address: '', slug: '', folder: '' });
    setMsg('');
    window.location.hash = `#/d/${data.slug}`;
  };

  return (
    <Shell session={session} title="Your properties" subtitle={owner ? 'Every deal you run, in one place.' : 'Properties you’ve been invited to.'}>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {deals === null && <Empty>Loading…</Empty>}
          {deals?.length === 0 && <Card><Empty>{owner ? 'No deals yet. Add the first one.' : 'You haven’t been added to a property yet. Ask the person who invited you to add this email.'}</Empty></Card>}
          {deals?.map((d) => (
            <a key={d.id} href={`#/d/${d.slug}`} className="group rounded-2xl border border-line bg-white p-5 transition hover:border-ink">
              <p className="text-xs uppercase tracking-wider text-warm">{d.status === 'active' ? 'Active' : d.status}</p>
              <h3 className="mt-1 font-display text-2xl font-semibold group-hover:underline">{d.title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{d.address}</p>
            </a>
          ))}
        </div>
        {owner && (
          <Card>
            <CardTitle>Add a deal</CardTitle>
            <form onSubmit={create} className="space-y-3">
              <Field required placeholder="Name, e.g. 2293 Quayle Dr" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Field required placeholder="Full address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <Field placeholder={`Page name (${slugify(form.title) || 'auto'})`} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
              <Field placeholder="Drive folder link for uploads (optional)" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
              <Button type="submit" className="w-full">Create deal page</Button>
              {msg && <p className="text-sm text-ink-soft">{msg}</p>}
            </form>
            <p className="mt-3 text-xs text-ink-soft">Each deal gets the same owner, realtor and seller pages. Nobody sees it until you add them.</p>
          </Card>
        )}
      </div>
    </Shell>
  );
}
