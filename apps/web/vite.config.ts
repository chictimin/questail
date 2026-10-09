import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// W14 — outDir dist-ui(서버 tsc outDir dist와 분리). 개발 2프로세스: proxy /api → 4747.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-ui',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4747',
    },
  },
});
