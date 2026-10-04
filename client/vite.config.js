import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En développement, /api est relayé vers le backend : même origine → cookies de session simples
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.{js,jsx}'] },
});
