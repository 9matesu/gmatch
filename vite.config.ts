import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so Electron can load dist/index.html over file://
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Dev-only CORS bypass: the browser cannot hit booru DAPIs directly
    // (no ACAO headers), and the Electron IPC bridge only exists in the
    // desktop app. /booru/* is rewritten to the mirror root, so the app
    // fetches same-origin and Vite forwards. Never used in packaged builds.
    proxy: {
      '^/booru/tbib': {
        target: 'https://tbib.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/tbib/, ''),
      },
      '^/booru/xbooru': {
        target: 'https://xbooru.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/xbooru/, ''),
      },
      '^/booru/paheal': {
        target: 'https://rule34.paheal.net',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/paheal/, ''),
      },
      '^/booru/imh': {
        target: 'https://imhentai.xxx',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/imh/, ''),
      },
      '^/rg-auth': {
        target: 'https://api.redgifs.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rg-auth/, ''),
      },
    },
  },
})
