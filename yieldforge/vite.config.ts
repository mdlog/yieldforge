import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
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
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
  },
})
