import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const resolveFromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Portal-only build.
 *
 * The customer wallet portal is deployed to Netlify separately from the merchant
 * dashboard, so this config builds ONLY portal-root/index.html — none of the
 * dashboard pages are reachable from (or bundled into) this output.
 *
 *   npm run build:portal   →   client/dist-portal/
 *
 * `publicDir` stays client/public so the output picks up `_redirects`
 * (`/* /index.html 200`), which is what makes the /portal/* deep links resolve.
 */
export default defineConfig({
  root: resolveFromHere('./portal-root'),
  publicDir: resolveFromHere('./public'),
  plugins: [react()],
  build: {
    outDir: resolveFromHere('./dist-portal'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
})
