import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Hosts the dev /px byte-proxy may fetch (allowlist — no open proxy).
const PX_ALLOW = /(^|\.)(imhentai\.xxx|paheal\.net|tbib\.org|xbooru\.com|redgifs\.com)$/

const DEV_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

/**
 * Dev-only same-origin byte proxy: image hosts without ACAO headers
 * (booru mirrors, imhentai covers) can't be fetch()ed from the browser —
 * direct fetch is CORS-blocked. /px?u=<https-url> streams the bytes
 * same-origin so the IDB picture cache actually fills in `npm run dev`.
 */
function devPxPlugin(): Plugin {
  return {
    name: 'goongrid-dev-px',
    configureServer(server) {
      server.middlewares.use('/px', async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const u = new URL(req.url ?? '', 'http://local').searchParams.get('u') ?? ''
          const target = new URL(u)
          if (target.protocol !== 'https:' || !PX_ALLOW.test(target.hostname)) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }
          const r = await fetch(target.toString(), {
            headers: { 'User-Agent': DEV_UA },
            signal: AbortSignal.timeout(15000),
          })
          if (!r.ok) {
            res.statusCode = 502
            res.end('upstream')
            return
          }
          const buf = Buffer.from(await r.arrayBuffer())
          const ct = r.headers.get('content-type')
          if (ct) res.setHeader('content-type', ct)
          res.setHeader('content-length', buf.length)
          res.end(buf)
        } catch {
          res.statusCode = 502
          res.end('proxy error')
        }
      })
    },
  }
}

// base './' so Electron can load dist/index.html over file://
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), devPxPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Dev-only CORS bypass for the Grid feed's booru mirrors (kept from the
    // pre-merge goongrid config). Never used in packaged builds — Electron
    // does these fetches in main via IPC.
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
        // Cloudflare challenges the Node-proxied request when it carries a
        // foreign Origin/Referer — strip them so gallery pages return 200.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
      '^/rg-media': {
        // Same-origin RedGifs bytes: dodges host-based adblockers that
        // ERR_FAILED media.redgifs.com <video> loads in dev browsers.
        target: 'https://media.redgifs.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rg-media/, ''),
      },
      '^/rg-auth': {
        target: 'https://api.redgifs.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rg-auth/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
