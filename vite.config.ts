import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// La PWA (src/web) se compila a dist/web; el proceso de la API la sirve desde ahí (H7, 10-SDD §5.8).
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5183,
    // Mismo origen en dev: la cookie httpOnly del refresh (H7) viaja sin CORS.
    proxy: { '/api': { target: 'http://127.0.0.1:3010', changeOrigin: false } },
  },
});
