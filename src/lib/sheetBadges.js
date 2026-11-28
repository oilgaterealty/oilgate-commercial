import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

const keyFor = (kind, dealId, identity) =>
  `og_seen:${kind}:${dealId || 'deal'}:${String(identity || 'anon').toLowerCase()}`;

export function readLastSeen(kind, dealId, identity) {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(keyFor(kind, dealId, identity));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function markSeen(kind, dealId, identity, ts = Date.now()) {
  try {
    if (typeof localStorage === 'undefined') return ts;
    localStorage.setItem(keyFor(kind, dealId, identity), String(ts));
  } catch {
    // ignore storage errors in restricted contexts
  }
  return ts;
}

export function countUnreadMessages(messages, myEmail, lastSeenMs = 0) {
  const mine = String(myEmail || '').trim().toLowerCase();
  return (messages || []).filter((m) => {
    if (!m) return false;
    const author = String(m.author_email || '').trim().toLowerCase();
    if (mine && author === mine) return false;
    if (!lastSeenMs) return true;
    const created = Date.parse(m.created_at || '');
    return Number.isFinite(created) ? created > lastSeenMs : true;
  }).length;
}

export function countNewDocuments(docs, lastSeenMs = 0) {
  return (docs || []).filter((d) => {
    if (!d) return false;
    if (!lastSeenMs) return true;
    const created = Date.parse(d.created_at || '');
    return Number.isFinite(created) ? created > lastSeenMs : true;
  }).length;
}

// Tracks unread message count and new document count for Overview compact action buttons.
export function useSheetBadges({ deal, me, role, preview, docs = null }) {
  const dealId = deal?.id;
  const identity = preview ? `preview:${role}` : (me?.email || role);
  const [docSeenAt, setDocSeenAt] = useState(() => readLastSeen('docs', dealId, identity));
  const [msgSeenAt, setMsgSeenAt] = useState(() => readLastSeen('msgs', dealId, identity));
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    setDocSeenAt(readLastSeen('docs', dealId, identity));
    setMsgSeenAt(readLastSeen('msgs', dealId, identity));
  }, [dealId, identity]);

  useEffect(() => {
    if (!dealId || preview) {
      setMessages([]);
      return undefined;
    }
    let live = true;
    const load = async () => {
      try {
        const { data } = await supabase
          .from('commercial_messages')
          .select('id,author_email,created_at')
          .eq('deal_id', dealId)
          .order('created_at', { ascending: false })
          .limit(100);
        if (live) setMessages(data || []);
      } catch {
        if (live) setMessages([]);
      }
    };
    load();
    const sub = supabase
      .channel(`${Math.random().toString(36).slice(2, 8)}-badges-${dealId}-${role}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'commercial_messages', filter: `deal_id=eq.${dealId}` }, load)
      .subscribe();
    return () => {
      live = false;
      supabase.removeChannel(sub);
    };
  }, [dealId, role, preview]);

  const docBadge = countNewDocuments(docs, docSeenAt);
  const msgBadge = preview ? 0 : countUnreadMessages(messages, me?.email, msgSeenAt);

  const markDocsSeen = () => {
    const ts = Date.now();
    if (!preview) markSeen('docs', dealId, identity, ts);
    setDocSeenAt(ts);
  };
  const markMsgsSeen = () => {
    const ts = Date.now();
    if (!preview) markSeen('msgs', dealId, identity, ts);
    setMsgSeenAt(ts);
  };

  return { docBadge, msgBadge, markDocsSeen, markMsgsSeen };
}
