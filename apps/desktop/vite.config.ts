import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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

// ---------------------------------------------------------------------------
// Dev parity with the Electron shell. `npm run dev` in a browser used to
// proxy /api straight to the production node (gmatch.fly.dev), so every
// debug session read live data while the packaged app talked to a local
// sidecar on 127.0.0.1:8790 — different code paths, different DB. Boot the
// same local Bun sidecar (apps/api) and point the proxy at it.
// Escape hatch: GMATCH_DEV_API=remote restores the central-node behaviour.
// The renderer bridge (gmcache://, vault://, native dialogs) still only
// exists in the real shell — use `npm run dev:electron` when you need those.
const DEV_API_PORT = Number(process.env.GMATCH_API_PORT || 8790)
const DEV_API_BASE = `http://127.0.0.1:${DEV_API_PORT}`
const DEV_API_REMOTE = process.env.GMATCH_DEV_API === 'remote'

/** True when a sidecar already answers /api/health on the dev port. */
async function isSidecarHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`${DEV_API_BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

function devBunBin(): string {
  const candidates = [
    join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ]
  for (const c of candidates) {
    try {
      if (c && existsSync(c)) return c
    } catch {
      /* keep looking */
    }
  }
  return 'bun'
}

function devApiPlugin(): Plugin {
  let proc: ReturnType<typeof spawn> | null = null
  let killed = false
  const stop = () => {
    if (killed) return
    killed = true
    try {
      proc?.kill()
    } catch {
      /* already dead */
    }
    proc = null
  }
  return {
    name: 'gmatch-dev-api',
    async configureServer(server) {
      if (DEV_API_REMOTE) return
      // Adopt a healthy sidecar before spawning: a second window, a leftover
      // process, or `npm run dev:electron` may already own the port. A doomed
      // duplicate would crash with EADDRINUSE while this plugin's health poll
      // happily reported "ready" against the OTHER process (observed live).
      if (await isSidecarHealthy()) {
        console.log(`[dev-api] adopting existing sidecar at ${DEV_API_BASE}`)
        return
      }
      const apiDir = fileURLToPath(new URL('../api', import.meta.url))
      proc = spawn(devBunBin(), ['run', 'src/serve.ts'], {
        cwd: apiDir,
        env: { ...process.env, PORT: String(DEV_API_PORT) },
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      proc.on('error', (err) => {
        console.warn(`[dev-api] could not spawn bun (${err.message}). Install bun or set GMATCH_DEV_API=remote.`)
      })
      // Dev DB/blob paths default to apps/api (serve.ts) — no electron
      // userData here, and none needed for debugging.
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
      const started = Date.now()
      const poll = setInterval(async () => {
        // A child that already exited can never come up — never claim ready
        // for a process we did not start.
        if (!proc) {
          clearInterval(poll)
          console.warn('[dev-api] sidecar exited before becoming healthy')
          return
        }
        if (await isSidecarHealthy()) {
          clearInterval(poll)
          console.log(`[dev-api] local sidecar ready at ${DEV_API_BASE}`)
          return
        }
        if (Date.now() - started > 30_000) {
          clearInterval(poll)
          console.warn('[dev-api] sidecar did not report healthy within 30s')
        }
      }, 500)
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
  plugins: [react(), tailwindcss(), devPxPlugin(), devApiPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Dev proxy: /api goes to the LOCAL sidecar (devApiPlugin above) so the
    // browser dev server debugs the same server the packaged app runs.
    // GMATCH_DEV_API=remote keeps the old central-node target.
    // Also proxies Grid feed's booru mirrors for browser dev.
    proxy: {
      '^/api': DEV_API_REMOTE
        ? { target: 'https://gmatch.fly.dev', changeOrigin: true, secure: true, ws: true }
        : { target: DEV_API_BASE, changeOrigin: true, ws: true },
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
