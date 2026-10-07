import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  const port = parseInt(process.env.VITE_PORT || '7001');
  const apiUrl = process.env.VITE_API_URL || 'http://localhost:7000';

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 2000,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
    server: {
      port: port,
      strictPort: false,
      host: true,
      proxy: {
        '/merchant/v1': { target: apiUrl, changeOrigin: true },
        '/auth':         { target: apiUrl, changeOrigin: true },
        '/api':          { target: apiUrl, changeOrigin: true },
        '/wallet':       { target: apiUrl, changeOrigin: true },
        '/health':       { target: apiUrl, changeOrigin: true },
      },
    },
  };
});
