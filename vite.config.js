import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative base so the same build works on the default GitHub Pages address and on a custom domain later.
export default defineConfig({ base: './', plugins: [react(), tailwindcss()] });
