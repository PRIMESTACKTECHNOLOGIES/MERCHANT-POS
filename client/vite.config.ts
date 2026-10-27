import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  const port = parseInt(process.env.VITE_PORT || '7001');
  const apiUrl = process.env.VITE_API_URL || 'http://localhost:7000';
  
  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 1000,
    },
    server: {
      port: port,
      strictPort: false,
      host: true,
      proxy: {
        '/merchant': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/auth': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
