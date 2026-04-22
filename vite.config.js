import { defineConfig } from 'vite';

// Everything stays inside this folder.
// cacheDir keeps Vite's cache local (no writes to ~/.vite).
export default defineConfig({
  cacheDir: './.vite-cache',
  server: {
    port: 5173,
    host: '127.0.0.1',
    open: true
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false
  }
});
