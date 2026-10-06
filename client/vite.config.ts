import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  const port = parseInt(process.env.VITE_PORT || '7001');
  const apiUrl = process.env.VITE_API_URL || 'http://localhost:7000';

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 2000,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
          pure_getters: true,
          collapse_vars: true,
          reduce_vars: true,
          sequences: true,
          toplevel: true,
        },
        mangle: {
          toplevel: true,
        },
        format: {
          comments: false,
        },
      },
      sourcemap: false,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
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
