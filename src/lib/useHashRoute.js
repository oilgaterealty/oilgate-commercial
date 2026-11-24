import { useEffect, useState } from 'react';

export function parseHash(hash) {
  const parts = hash.split('?')[0].replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'request-access') return { name: 'request-access' };
  if (parts[0] === 'join' && parts[1]) return { name: 'join', token: parts[1].toLowerCase() };
  if (parts[0] === 'd' && parts[1]) return { name: 'deal', slug: parts[1].toLowerCase(), tab: parts[2] || '', sub: parts[3] || '' };
  return { name: 'home' };
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path) => { window.location.hash = path; };
