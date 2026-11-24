import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative URLs keep both GitHub Pages and custom domains working.
export default defineConfig(({ mode }) => {
  const { VITE_SITE_KIND } = loadEnv(mode, process.cwd(), 'VITE_SITE_KIND');
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'charlotte-owner-install',
        transformIndexHtml() {
          if (VITE_SITE_KIND !== 'owner') return;
          return [
            { tag: 'link', attrs: { rel: 'manifest', href: './charlotte.webmanifest' } },
            { tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: './icons/charlotte-192.png' } },
          ];
        },
      },
    ],
    worker: { format: 'es' },
  };
});
