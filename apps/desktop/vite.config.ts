import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Hosts the dev /px byte-proxy may fetch (allowlist — no open proxy).
const PX_ALLOW = /(^|\.)(imhentai\.xxx|paheal\.net|tbib\.org|xbooru\.com|redgifs\.com|konachan\.com|yande\.re|files\.yande\.re|realbooru\.com|booru\.org|eporner\.com|discordapp\.(com|net)|discord\.com|imgur\.com|redd\.it|twimg\.com|unsplash\.com|cloudinary\.com|postimg\.cc|imgbb\.com)$/

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
        target: 'https://gmatch.fly.dev',
        changeOrigin: true,
        secure: true,
        ws: true,
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
        target: 'https://api.redgifs.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rg-auth/, ''),
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
      '^/booru/eporner': {
        target: 'https://www.eporner.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/eporner/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
