import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { autoStartBackend } from './scripts/vite-plugin-backend.mjs';

/**
 * Frontend build config.
 *
 * Note what is NOT here: no `define` block injecting API keys into the bundle.
 * Every provider call goes through the local backend, so no credential is ever
 * compiled into client-side JavaScript.
 */
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.', '');
  const clientPort = Number(env.CLIENT_PORT) || 3000;

  /*
   * Where the backend listens, so /api can be proxied to it.
   *
   * PORT is ambiguous: our .env uses it for the backend, but launchers and
   * process managers routinely set it to the port THIS dev server should bind.
   * Taking that value as the proxy target points /api back at Vite itself, and
   * the app then reports the backend as unreachable ("Failed to fetch") even
   * though it is running perfectly well on 8787. BACKEND_PORT is the
   * unambiguous override; a PORT that matches our own port is ignored.
   */
  const envBackendPort = Number(env.BACKEND_PORT) || Number(env.PORT) || 0;
  const serverPort = envBackendPort && envBackendPort !== clientPort ? envBackendPort : 8787;

  return {
    // Relative asset URLs let the built app work when served from a subpath
    // or loaded by the desktop shell.
    base: './',

    server: {
      port: clientPort,
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${serverPort}`,
          changeOrigin: true,
          // Transcribing a long recording can take several minutes.
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },

    preview: {
      port: clientPort,
      proxy: {
        '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true },
      },
    },

    plugins: [
      tailwindcss(),
      react(),
      /*
       * Starts the backend alongside the dev server, so `vite` on its own can
       * never serve a UI with nothing behind /api. Skipped when the port is
       * already answering, leaving an externally managed backend untouched.
       */
      autoStartBackend({
        root: __dirname,
        port: serverPort,
        // `--watch` in dev only: a preview run is checking a build, not editing it.
        watch: command === 'serve',
      }),
    ],

    build: {
      target: 'es2022',
      // Source maps would ship the full readable source to every user and
      // roughly double the download. Kept off for release builds.
      sourcemap: false,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          /*
           * Split the vendor libraries out of the app bundle. React and the
           * icon set almost never change, so a returning user re-downloads
           * only the app chunk after an update.
           */
          manualChunks: {
            react: ['react', 'react-dom', 'react-dom/client'],
            icons: ['lucide-react'],
            zip: ['jszip'],
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
