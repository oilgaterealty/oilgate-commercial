import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Refuse to run inside another site's frame (GitHub Pages can't send a frame-blocking header).
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
const root = document.getElementById('root');
if (framed) root.textContent = 'Open this page directly.';
else createRoot(root).render(<StrictMode><App /></StrictMode>);
