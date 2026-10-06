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
      // ── Obfuscation: minify with Terser (maximum compression + mangling) ──
      minify: 'terser',
      terserOptions: {
        compress: {
          // Remove all console.* calls from production build
          drop_console: true,
          drop_debugger: true,
          // Aggressive inlining and dead code removal
          passes: 3,
          unsafe: true,
          unsafe_arrows: true,
          unsafe_comps: true,
          unsafe_math: true,
          unsafe_methods: true,
          unsafe_proto: true,
          pure_getters: true,
          booleans_as_integers: true,
          collapse_vars: true,
          reduce_vars: true,
          sequences: true,
          toplevel: true,
        },
        mangle: {
          // Rename all variable/function/class names to meaningless short names
          toplevel: true,
          eval: true,
          properties: {
            // Mangle object properties too — makes code truly unreadable
            regex: /^_/,  // mangle anything starting with _
          },
        },
        format: {
          // Remove all comments including license headers
          comments: false,
          // Single line output — no formatting, no structure visible
          beautify: false,
          // Remove semicolons where possible
          semicolons: false,
          // Wrap in self-executing function to hide globals
          wrap_iife: true,
          // Remove source map references
          source_map: undefined,
        },
      },
      // ── No source maps in production (source maps = readable source) ──────
      sourcemap: false,
      // ── Aggressive code splitting to fragment the bundle ─────────────────
      rollupOptions: {
        output: {
          // Hash-based filenames — no readable names
          entryFileNames: 'assets/[hash].js',
          chunkFileNames: 'assets/[hash].js',
          assetFileNames: 'assets/[hash][extname]',
          // Split into many small chunks — harder to reconstruct
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              // Vendor chunks split by package to obscure structure
              const pkg = id.split('node_modules/')[1]?.split('/')[0] || 'vendor';
              return `v_${pkg.replace('@', '').replace('/', '_').substring(0, 8)}`;
            }
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
