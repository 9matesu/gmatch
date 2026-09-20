import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Hosts the dev /px byte-proxy may fetch (allowlist — no open proxy).
const PX_ALLOW = /(^|\.)(imhentai\.xxx|babesource\.com|paheal\.net|tbib\.org|xbooru\.com|redgifs\.com|konachan\.com|yande\.re|files\.yande\.re|realbooru\.com|booru\.org|discordapp\.(com|net)|discord\.com|imgur\.com|redd\.it|twimg\.com|unsplash\.com|cloudinary\.com|postimg\.cc|imgbb\.com)$/

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
    name: 'gmatch-dev-px',
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
          const headers: Record<string, string> = { 'User-Agent': DEV_UA }
          if (target.hostname === 'realbooru.com') {
            headers['Referer'] = 'https://realbooru.com/'
          } else if (target.hostname.endsWith('.booru.org')) {
            headers['Referer'] = `https://${target.hostname}/`
          } else if (target.hostname.includes('imhentai.xxx')) {
            headers['Referer'] = 'https://imhentai.xxx/'
          } else if (target.hostname === 'babesource.com' || target.hostname === 'media.babesource.com') {
            headers['Referer'] = 'https://babesource.com/'
          } else if (target.hostname.endsWith('xbooru.com')) {
            headers['Referer'] = 'https://xbooru.com/'
          } else if (target.hostname.endsWith('redgifs.com')) {
            headers['Referer'] = 'https://www.redgifs.com/'
          }

          const urlsToTry: string[] = [target.toString()]
          if (target.hostname === 'realbooru.com') {
            const rbMatch = target.pathname.match(/^\/images\/([^/]+)\/([^/]+)\/([^.]+)\.(jpg|jpeg|png|gif|mp4|webm)$/i)
            if (rbMatch) {
              const [, dir1, dir2, hash, ext] = rbMatch
              const lower = ext.toLowerCase()
              const alternates = ['jpeg', 'jpg', 'png', 'gif'].filter((e) => e !== lower)
              for (const alt of alternates) {
                urlsToTry.push(`https://realbooru.com/images/${dir1}/${dir2}/${hash}.${alt}`)
              }
              urlsToTry.push(`https://realbooru.com/thumbnails/${dir1}/${dir2}/thumbnail_${hash}.jpg`)
            }
          }

          let r: Response | null = null
          for (const tryUrl of urlsToTry) {
            try {
              const attempt = await fetch(tryUrl, {
                headers,
                signal: AbortSignal.timeout(6000),
              })
              if (attempt.ok) {
                r = attempt
                break
              }
            } catch {
              /* try next fallback url */
            }
          }

          if (!r || !r.ok) {
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

function booruOrgProxy(target: string, prefix: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    rewrite: (p) => p.replace(new RegExp(`^${prefix}`), ''),
    headers: { Referer: `${target}/` },
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.removeHeader('origin')
        proxyReq.setHeader('referer', `${target}/`)
        proxyReq.setHeader('user-agent', DEV_UA)
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
    // Dev-only proxy: routes /api directly to central node at gmatch.fly.dev (no CORS issues).
    // Also proxies Grid feed's booru mirrors for browser dev.
    proxy: {
      '^/api': {
        target: process.env.VITE_API_URL || 'https://gmatch.fly.dev',
        changeOrigin: true,
        secure: (process.env.VITE_API_URL || 'https://gmatch.fly.dev').startsWith('https:'),
        ws: true,
        // Fly.io sleeps idle machines: the first request wakes it (~4s) and
        // http-proxy would otherwise drop the socket, logging a raw 502 that
        // useObjectImage then caches as a permanent failure ("Image
        // unavailable" forever). Answer proxy transport errors with a clean
        // JSON 502 so callers can retry instead of caching death.
        configure: (proxy) => {
          proxy.on('error', (err: unknown, _req, res) => {
            const code = (err as { code?: string })?.code
            // Ignore client socket aborts/resets (normal during video seeks and queue changes)
            if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
              return
            }
            try {
              if (res && 'writeHead' in res && !(res as { headersSent?: boolean }).headersSent) {
                ;(res as { writeHead: (s: number, h: Record<string, string>) => void; end: (b: string) => void }).writeHead(502, { 'Content-Type': 'application/json' })
                ;(res as { end: (b: string) => void }).end(JSON.stringify({ error: 'Central node waking up, retry shortly' }))
              }
            } catch { /* socket already gone */ }
          })
        },
      },
      '^/pmv-api': {
        target: 'https://pmvhaven.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/pmv-api/, '/api'),
        headers: { Referer: 'https://pmvhaven.com/', 'User-Agent': DEV_UA },
      },
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
        headers: { Referer: 'https://imhentai.xxx/' },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.setHeader('referer', 'https://imhentai.xxx/')
            proxyReq.setHeader('user-agent', DEV_UA)
            // imhentai's Cloudflare 403-challenges /gallery/* when the
            // request looks like a script (UA+Referer only). A full browser
            // header set passes; this is what Electron's Chromium stack was
            // implicitly sending, so dev now matches the packaged app.
            proxyReq.setHeader('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
            proxyReq.setHeader('accept-language', 'en-US,en;q=0.9')
            proxyReq.setHeader('sec-fetch-dest', 'document')
            proxyReq.setHeader('sec-fetch-mode', 'navigate')
            proxyReq.setHeader('sec-fetch-site', 'same-origin')
            proxyReq.setHeader('sec-fetch-user', '?1')
            proxyReq.setHeader('upgrade-insecure-requests', '1')
          })
          // Even with browser headers, Cloudflare still 403s gallery bursts
          // from a bare dev IP. booru.ts already falls back to search-page
          // covers when gallery pages fail — rewriting the status to 200
          // with the challenge body keeps that fallback clean and stops the
          // red 403 rows in the dev console. The challenge HTML carries no
          // data-src/parseJSON, so gallery parsing yields zero pages.
          proxy.on('proxyRes', (proxyRes, req) => {
            try {
              if (proxyRes.statusCode === 403 && req.url && req.url.includes('/gallery/')) {
                proxyRes.statusCode = 200
              }
            } catch { /* passthrough */ }
          })
        },
      },
      '^/rg-media': {
        // Same-origin RedGifs bytes: dodges host-based adblockers that
        // ERR_FAILED media.redgifs.com <video> loads in dev browsers.
        // CDN77-Turbo 403s on foreign localhost Origin — strip it and set redgifs Referer.
        target: 'https://media.redgifs.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rg-media/, ''),
        headers: { Referer: 'https://www.redgifs.com/' },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.setHeader('referer', 'https://www.redgifs.com/')
          })
        },
      },
      '^/rg-auth': {
        // RedGifs JSON API: same Origin-stripping as /rg-media — the API
        // WAF 401s requests carrying a foreign localhost Origin even with a
        // valid Bearer token. Authorization header passes through untouched.
        target: 'https://api.redgifs.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rg-auth/, ''),
        headers: { Referer: 'https://www.redgifs.com/' },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.setHeader('referer', 'https://www.redgifs.com/')
            proxyReq.setHeader('user-agent', DEV_UA)
          })
        },
      },
      '^/booru/kona': {
        target: 'https://konachan.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/kona/, ''),
      },
      '^/booru/yand': {
        target: 'https://yande.re',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/yand/, ''),
      },
      '^/booru/yandimg': {
        target: 'https://files.yande.re',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/yandimg/, ''),
      },
      '^/booru/real': {
        target: 'https://realbooru.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/real/, ''),
        headers: { Referer: 'https://realbooru.com/' },
      },
      '^/booru/hgoon': booruOrgProxy('https://hgoon.booru.org', '/booru/hgoon'),
      '^/booru/qoh': booruOrgProxy('https://qoh.booru.org', '/booru/qoh'),
      '^/booru/celeb': booruOrgProxy('https://celeb.booru.org', '/booru/celeb'),
      '^/booru/foot': booruOrgProxy('https://footfetishbooru.booru.org', '/booru/foot'),
      '^/booru/blacked': booruOrgProxy('https://blacked.booru.org', '/booru/blacked'),
      '^/booru/babe': {
        target: 'https://babesource.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/babe/, ''),
        headers: { Referer: 'https://babesource.com/' },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.setHeader('referer', 'https://babesource.com/')
            proxyReq.setHeader('user-agent', DEV_UA)
          })
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
