import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Iron Fost MVP',
        short_name: 'CoreGym',
        description: 'Elite Gym Management System',
        theme_color: '#0a0a0b',
        background_color: '#0a0a0b',
        display: 'standalone',
        icons: [] // Re-enable once icon files are created in public/
      },
      workbox: {
        // Force immediate activation of new service worker
        skipWaiting: true,
        clientsClaim: true,
        // Clean up old precached assets
        cleanupOutdatedCaches: true,
        // Only precache app shell assets (JS/CSS have content hashes, so new builds = new files)
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // CRITICAL: Prevent the NavigationRoute from caching API responses
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // CRITICAL: API calls must ALWAYS go to network, NEVER be cached
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
})
