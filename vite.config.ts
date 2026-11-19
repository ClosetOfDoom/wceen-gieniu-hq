import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import type { Plugin } from 'vite'

const commitHash = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() }
  catch { return 'dev' }
})()

const buildTime = new Date().toISOString()

// dist/version.json: the build hash the server serves. The app compares it with its own (src/lib/buildVersion.ts,
// reload once on a mismatch) and webinar-mail-health reports it (netlify/shared/buildInfo.js). Not precached by the SW.
const versionFile = (): Plugin => ({
  name: 'stanley-version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: commitHash, time: buildTime }) })
  },
})

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    versionFile(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'STANLEY HQ',
        short_name: 'STANLEY',
        description: 'Revenue and operations command center for WCEEN / Językozak',
        theme_color: '#0c1e23',
        background_color: '#0c1e23',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png?v=4', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png?v=4', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-192.png?v=4', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png?v=4', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      },
      workbox: {
        cacheId: 'gieniu-hq-v11',
        // Exclude large avatar PNGs from SW precache (served via HTTP cache)
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}', '**/icons/*.png'],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/phwhsteaqwrijoivqnif\.supabase\.co/,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-v5', networkTimeoutSeconds: 10 }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
