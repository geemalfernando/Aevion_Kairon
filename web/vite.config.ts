import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Kairon Operations',
        short_name: 'Kairon',
        description: 'Plan, load, deliver and recover — one shared logistics operation that keeps working offline.',
        start_url: '/login',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a1315',
        theme_color: '#106c6c',
        categories: ['business', 'productivity', 'navigation'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          { name: "Today's route", short_name: 'Route', url: '/driver/route', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Loading trips', short_name: 'Load', url: '/loader/trips', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Sync status', short_name: 'Sync', url: '/driver/sync', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        // The whole app shell is precached, so every screen opens without a network.
        // Fonts are bundled (no CDN), so even the first offline launch renders Latin, Sinhala and Tamil.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        globIgnores: ['figma/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Map tiles the driver has already seen stay available without signal.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.host === 'tile.openstreetmap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              fetchOptions: { referrerPolicy: 'strict-origin-when-cross-origin' },
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // The shared domain core (rules, planner, commands) lives next to the app and is used as source.
  resolve: { alias: { '@core': path.resolve(import.meta.dirname, '../core/src') } },
  server: {
    fs: { allow: ['..'] },
    // In development, /api goes to a locally running server (cd server && npm run dev).
    proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:8080', changeOrigin: true } },
  },
  // One bundle on purpose: after a single visit the whole app is cached for offline use.
  build: { chunkSizeWarningLimit: 1400 },
})
