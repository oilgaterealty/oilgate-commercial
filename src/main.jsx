import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { SITE_KIND } from './lib/site.js';
import { isAllowedFrameParent } from './lib/frameAuth.js';

// Refuse to run inside another site's frame (GitHub Pages can't send a frame-blocking header).
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
const allowedParent = import.meta.env?.VITE_FRAME_PARENT || '';
const allowedFramedOwner = framed && isAllowedFrameParent({
  siteKind: SITE_KIND,
  allowedParent,
  framed,
  ancestorOrigins: window.location?.ancestorOrigins,
  referrer: document.referrer,
});

const root = document.getElementById('root');
if (framed && !allowedFramedOwner) {
  if (SITE_KIND === 'owner') root.replaceChildren();
  else root.textContent = 'Open this page directly.';
} else {
  createRoot(root).render(<StrictMode><App framedOwner={allowedFramedOwner} /></StrictMode>);
}
