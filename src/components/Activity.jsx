import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { formatPhoenixDateTime } from '../lib/signinActivity.js';
import { buildOwnerActivityTimeline, buildRealtorSellerTimeline } from '../lib/activityTimeline.js';
import { InviteSeller } from './SellerOffer.jsx';
import { Card, CardTitle, Empty } from './Shell.jsx';

async function safeQuery(fn) {
  try {
    const res = await fn();
    if (!res || res.error) return null;
    return res.data ?? null;
  } catch {
    return null;
  }
}

export function ActivityTimelineList({ rows }) {
  return (
    <ol className="divide-y divide-line">
      {(rows || []).map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium">{item.name}</span>
            {item.role && <span className="rounded-full bg-warm-soft px-2 py-0.5 text-xs">{item.role}</span>}
            <span className="min-w-0 break-words text-ink">{item.what}</span>
          </div>
          <time dateTime={item.at} className="shrink-0 tabular-nums text-xs text-ink-soft">
            {formatPhoenixDateTime(item.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export default function Activity({ deal, title = 'Activity', mode = 'owner', preview = false, empty = 'Nothing yet.' }) {
  const [rows, setRows] = useState(null);
  const [hasSeller, setHasSeller] = useState(null);

  const load = useCallback(async () => {
    if (mode === 'realtor-seller') {
      if (preview) {
        const [members, activity, messages, signins] = await Promise.all([
          safeQuery(() => supabase.from('commercial_members').select('id').eq('deal_id', deal.id).eq('role', 'seller').eq('status', 'active').limit(1)),
          safeQuery(() => supabase.from('commercial_activity').select('id,actor_email,actor_role,actor_name,kind,summary,created_at').eq('deal_id', deal.id).eq('actor_role', 'seller').order('created_at', { ascending: false }).limit(200)),
          safeQuery(() => supabase.from('commercial_messages').select('id,author_email,author_role,author_name,topic,body,created_at').eq('deal_id', deal.id).eq('author_role', 'seller').order('created_at', { ascending: false }).limit(200)),
          safeQuery(() => supabase.rpc('commercial_signin_activity', { p_deal: deal.id, p_limit: 200 })),
        ]);
        setHasSeller(Array.isArray(members) ? members.length > 0 : null);
        setRows(buildRealtorSellerTimeline({ deal, fallbackActivity: activity, fallbackMessages: messages, fallbackSignins: signins }));
        return;
      }

      const [sellerCheck, rpcRows] = await Promise.all([
        safeQuery(() => supabase.rpc('commercial_realtor_has_seller', { p_deal: deal.id })),
        safeQuery(() => supabase.rpc('commercial_realtor_seller_activity', { p_deal: deal.id, p_limit: 200 })),
      ]);
      setHasSeller(typeof sellerCheck === 'boolean' ? sellerCheck : null);

      if (Array.isArray(rpcRows)) {
        setRows(buildRealtorSellerTimeline({ deal, rpcRows }));
        return;
      }

      const [activity, messages] = await Promise.all([
        safeQuery(() => supabase.from('commercial_activity').select('id,actor_email,actor_role,actor_name,kind,summary,created_at').eq('deal_id', deal.id).eq('actor_role', 'seller').order('created_at', { ascending: false }).limit(200)),
        safeQuery(() => supabase.from('commercial_messages').select('id,author_email,author_role,author_name,topic,body,created_at').eq('deal_id', deal.id).eq('author_role', 'seller').order('created_at', { ascending: false }).limit(200)),
      ]);
      setRows(buildRealtorSellerTimeline({ deal, fallbackActivity: activity, fallbackMessages: messages }));
      return;
    }

    const [signins, activity, members, openLinks, accessRequests, messages, uploads] = await Promise.all([
      safeQuery(() => supabase.rpc('commercial_signin_activity', { p_deal: deal.id, p_limit: 200 })),
      safeQuery(() => supabase.from('commercial_activity').select('id,actor_email,actor_role,actor_name,kind,summary,created_at').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(200)),
      safeQuery(() => supabase.from('commercial_members').select('email,display_name,role').eq('deal_id', deal.id)),
      safeQuery(() => supabase.from('commercial_open_links').select('id').eq('deal_id', deal.id)),
      safeQuery(() => supabase.from('commercial_access_requests').select('id,email,status,requested_role,approved_role,requester_name,requester_company,source,created_at,decided_at').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(200)),
      safeQuery(() => supabase.from('commercial_messages').select('id,author_email,author_role,author_name,topic,body,created_at').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(200)),
      safeQuery(() => supabase.from('commercial_uploads').select('id,file_name,kind,uploaded_by_email,uploaded_by_role,created_at').eq('deal_id', deal.id).order('created_at', { ascending: false }).limit(200)),
    ]);

    const linkIds = (openLinks || []).map((l) => l.id).filter(Boolean);
    const openViews = linkIds.length
      ? await safeQuery(() => supabase.from('commercial_open_views').select('id,link_id,visitor,viewed_at').in('link_id', linkIds).order('viewed_at', { ascending: false }).limit(200))
      : [];

    setHasSeller(null);
    setRows(buildOwnerActivityTimeline({
      deal,
      members: members || [],
      signins: signins || [],
      activity: activity || [],
      openViews: openViews || [],
      accessRequests: accessRequests || [],
      messages: messages || [],
      uploads: uploads || [],
    }));
  }, [deal, mode, preview]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`${Math.random().toString(36).slice(2, 8)}-a-${deal.id}-${mode}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_activity', filter: `deal_id=eq.${deal.id}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_messages', filter: `deal_id=eq.${deal.id}` }, load);
    if (mode !== 'realtor-seller') {
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_uploads', filter: `deal_id=eq.${deal.id}` }, load)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'commercial_access_requests', filter: `deal_id=eq.${deal.id}` }, load);
    }
    const sub = channel.subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [deal.id, mode, load]);

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {rows === null ? (
        <Empty>Loading…</Empty>
      ) : mode === 'realtor-seller' && hasSeller === false && rows.length === 0 ? (
        <div>
          <Empty>The seller hasn’t been invited yet.</Empty>
          <InviteSeller deal={deal} preview={preview} inline onInvited={load} />
        </div>
      ) : rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ActivityTimelineList rows={rows} />
      )}
    </Card>
  );
}
