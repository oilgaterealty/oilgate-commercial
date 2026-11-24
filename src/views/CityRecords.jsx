import { useEffect, useRef, useState } from 'react';
import { supabase, BUCKET } from '../lib/supabase.js';
import { SITE_KIND, canAccessCityRecords } from '../lib/site.js';
import { collectRecordPaths, normalizeCityRecords } from '../lib/cityRecords.js';
import { Card, Empty } from '../components/Shell.jsx';
import CityRecordsView from '../components/CityRecordsView.jsx';

export { CityRecordsView };

export default function CityRecords({ deal, role, preview = false }) {
  const allowed = canAccessCityRecords(SITE_KIND, role, preview);
  const [data, setData] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});
  const [pinnedId, setPinnedId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!allowed || !deal?.slug) return;
    let alive = true;
    (async () => {
      const { data: row } = await supabase
        .from('commercial_settings')
        .select('value')
        .eq('key', `city_records:${deal.slug}`)
        .maybeSingle();
      if (!alive) return;
      const parsed = normalizeCityRecords(row?.value);
      setData(parsed);
      const paths = collectRecordPaths(parsed);
      if (paths.length) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
        if (!alive) return;
        const map = {};
        for (const s of signed || []) {
          if (s?.path && s?.signedUrl) map[s.path] = s.signedUrl;
        }
        setSignedUrls(map);
      }
    })();
    return () => { alive = false; };
  }, [allowed, deal?.slug]);

  useEffect(() => {
    if (!pinnedId) return;
    const onDocDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setPinnedId(null);
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, [pinnedId]);

  if (!allowed) return null;
  if (!data) return <Card><Empty>Loading…</Empty></Card>;

  const activeId = pinnedId || hoverId;
  return (
    <div ref={rootRef}>
      <CityRecordsView
        data={data}
        signedUrls={signedUrls}
        activeId={activeId}
        onHover={(id) => { if (!pinnedId) setHoverId(id); }}
        onLeave={(id) => {
          if (id === null) { setPinnedId(null); setHoverId(null); }
          else if (!pinnedId && hoverId === id) setHoverId(null);
        }}
        onToggle={(id) => setPinnedId((cur) => (cur === id ? null : id))}
      />
    </div>
  );
}
