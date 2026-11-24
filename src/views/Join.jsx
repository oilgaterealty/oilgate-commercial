import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isLinkToken } from '../lib/site.js';
import Shell, { Card, Empty } from '../components/Shell.jsx';

// Opens a role link the owner shared. The token is checked by the database; this page only passes it on.
export default function Join({ token, session }) {
  const [msg, setMsg] = useState('Opening your page…');

  useEffect(() => {
    if (!isLinkToken(token)) { setMsg('This link isn’t complete. Copy the whole link and try again.'); return; }
    (async () => {
      const { data: slug, error } = await supabase.rpc('commercial_redeem_role_link', { p_token: token });
      if (error || !slug) {
        setMsg(/removed/.test(error?.message || '')
          ? 'Your access to this property was removed. Ask the person who sent the link.'
          : 'This link was turned off or has expired. Ask the person who sent it for a new one.');
        return;
      }
      window.location.replace(`${window.location.pathname}#/d/${slug}`);
    })();
  }, [token]);

  return (
    <Shell session={session} head={<h1 className="font-display text-3xl font-semibold">Welcome</h1>}>
      <Card><Empty>{msg}</Empty></Card>
    </Shell>
  );
}
