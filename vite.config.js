import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // Use /stock-analyzer-final/ for GitHub Pages, '/' for Vercel
  base: process.env.GITHUB_PAGES ? '/stock-analyzer-final/' : '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
