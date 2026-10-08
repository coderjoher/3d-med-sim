import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';

const publicDir = fileURLToPath(new URL('./public', import.meta.url));

/**
 * Dev only: MediaPipe's module-worker loader does `import('/mediapipe/wasm/*.js')`, which the
 * Vite dev server rejects for files in /public (it appends `?import`). Serve those files raw.
 * Production builds serve /public statically, so nothing is needed there.
 */
function mediapipeDevAssets(): Plugin {
  return {
    name: 'medsim-mediapipe-dev-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/mediapipe/')) return next();
        const path = normalize(join(publicDir, decodeURIComponent(url.split('?')[0])));
        if (!path.startsWith(publicDir) || !existsSync(path)) return next();
        const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(path).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [mediapipeDevAssets(), react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  worker: { format: 'es' },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  build: {
    // the Babylon.js engine chunk is large by nature; it is code-split away from the portal
    chunkSizeWarningLimit: 7000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
} as never);
