import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the Vite server proxies /proxy to the local Express proxy server
// so the frontend can always call a same-origin endpoint.
const PROXY_TARGET = process.env.PROXY_TARGET || 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/proxy': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
      '/jobs': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
      '/healthz': {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})
