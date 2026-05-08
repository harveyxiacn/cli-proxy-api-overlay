import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Base path: served from `/cpa-management/` in production (embedded in Go binary).
// Renamed from `/management/` so it doesn't collide with 1Panel's static
// management.html on the VPS reverse proxy.
// Dev server uses '/' so paths work without prefix when running `pnpm dev`.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/cpa-management/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    proxy: {
      '/v0': {
        target: 'http://127.0.0.1:8317',
        changeOrigin: true,
      },
      '/extended.html': {
        target: 'http://127.0.0.1:8317',
        changeOrigin: true,
      },
    },
  },
}))
