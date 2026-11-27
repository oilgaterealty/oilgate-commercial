import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'commercial-files';
const EXPIRES_IN = 3600;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

type SnapshotRow = {
  id?: unknown;
  storage_path?: unknown;
};

type SignedItem = {
  id: string;
  url: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  try {
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      return json({ error: 'invalid_request' }, 400);
    }

    const token = typeof body?.token === 'string' ? body.token : '';
    if (!TOKEN_RE.test(token)) {
      return json({ error: 'invalid_token' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'unavailable' }, 500);
    }

    const client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: snapshot, error: rpcError } = await client.rpc('commercial_open_viewer', {
      p_token: token,
    });
    if (rpcError) {
      return json({ error: 'unavailable' }, 500);
    }
    if (!snapshot || typeof snapshot !== 'object') {
      return json({ photos: [] }, 404);
    }

    const rawPhotos = Array.isArray((snapshot as { photos?: unknown }).photos)
      ? ((snapshot as { photos: SnapshotRow[] }).photos)
      : [];
    const rawWalkthrough = Array.isArray((snapshot as { walkthrough_photos?: unknown }).walkthrough_photos)
      ? ((snapshot as { walkthrough_photos: SnapshotRow[] }).walkthrough_photos)
      : [];

    const uniquePaths: string[] = [];
    const seen = new Set<string>();
    for (const row of [...rawPhotos, ...rawWalkthrough]) {
      const p = typeof row?.storage_path === 'string' ? row.storage_path.trim() : '';
      if (p && !seen.has(p)) {
        seen.add(p);
        uniquePaths.push(p);
      }
    }

    if (uniquePaths.length === 0) {
      return json({ photos: [], walkthrough_photos: [] }, 200);
    }

    const { data: signed, error: signError } = await client.storage
      .from(BUCKET)
      .createSignedUrls(uniquePaths, EXPIRES_IN);
    if (signError) {
      return json({ error: 'unavailable' }, 500);
    }

    const urlByPath = new Map<string, string>();
    if (Array.isArray(signed)) {
      signed.forEach((entry, index) => {
        const pathKey = typeof entry?.path === 'string' && entry.path ? entry.path : uniquePaths[index];
        const signedUrl = typeof entry?.signedUrl === 'string' ? entry.signedUrl : '';
        if (pathKey && signedUrl) {
          urlByPath.set(pathKey, signedUrl);
        }
      });
    }

    const toSignedList = (rows: SnapshotRow[]): SignedItem[] => {
      const out: SignedItem[] = [];
      for (const row of rows) {
        const id = row?.id != null ? String(row.id) : '';
        const p = typeof row?.storage_path === 'string' ? row.storage_path.trim() : '';
        const url = p ? urlByPath.get(p) : undefined;
        if (id && url) {
          out.push({ id, url });
        }
      }
      return out;
    };

    return json(
      {
        photos: toSignedList(rawPhotos),
        walkthrough_photos: toSignedList(rawWalkthrough),
      },
      200,
    );
  } catch {
    return json({ error: 'unavailable' }, 500);
  }
});
