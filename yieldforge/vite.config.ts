import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  // near-api-js / wallet-selector expect Node's `global`.
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Vite ≥6 rejects unknown Host headers (DNS-rebinding protection); allow the Cloudflare tunnel hostname.
  server: { port: 3000, host: '0.0.0.0', allowedHosts: ['near.mdloglabs.org'] },
  preview: { port: 3000, host: '0.0.0.0', allowedHosts: ['near.mdloglabs.org'] },
  build: {
    target: 'esnext',
    sourcemap: true,
    // The wallet-selector chunk is loaded lazily after first paint; it is large by nature.
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'buffer'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
        // @near-js/accounts (bundled by meteor-wallet) reads process.env.DEFAULT_FINALITY at import time.
        // Production builds replace process.env already; the dev pre-bundler needs it spelled out.
        'process.env': '{}',
      },
    },
  },
})
