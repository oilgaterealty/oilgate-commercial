import { createClient } from '@supabase/supabase-js';

// Public values only: the URL and the anon key are safe in the browser. Every rule lives in row-level security.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(SUPABASE_URL && KEY);

export const supabase = configured
  ? createClient(SUPABASE_URL, KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
  : null;

export const BUCKET = 'deal-files';
