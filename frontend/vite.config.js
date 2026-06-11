import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['react-simple-maps', 'prop-types'],
  },
  server: {
    proxy: {
      // Redirige /api/v1/... → http://127.0.0.1:8080/api/v1/...
      // Esto evita CORS en desarrollo sin modificar el backend
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
      },
      // Proxy WebSocket para SockJS (dev mode)
      '/ws': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
