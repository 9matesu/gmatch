import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Duplex } from 'node:stream'

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

function devApiProxyPlugin(): Plugin {
  return {
    name: 'gmatch-dev-api-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/api')) {
          if (req.url?.startsWith('/fly-api')) {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Headers', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
            if (req.method === 'OPTIONS') {
              res.statusCode = 204
              res.end()
              return
            }
          }
          return next()
        }

        // Handle preflight OPTIONS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        const target = resolveDevApiTarget(req)
        const targetUrl = new URL(req.url, target)

        // Courier guard: the central node answers 404 at the edge for every
        // route outside its allow-list. Relaying that storm is unreadable, so
        // say what is actually wrong once instead of a hundred times.
        if (isCourierNode(target) && !COURIER_ALLOWED.test(targetUrl.pathname)) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'access-control-allow-origin': '*' })
          res.end(JSON.stringify({
            error: `${target} is a blind courier (mail/turn/directory only) and cannot serve ${targetUrl.pathname}. ` +
              `Connect a full node, or boot the local sidecar (npm run dev, or GMATCH_API_PORT).`,
          }))
          return
        }

        try {
          const isHttps = targetUrl.protocol === 'https:'
          const client = isHttps ? https : http

          const headers: Record<string, string | string[] | undefined> = { ...req.headers }
          delete headers.host
          headers['host'] = targetUrl.host
          headers['origin'] = targetUrl.origin
          headers['referer'] = `${targetUrl.origin}/`

          const proxyReq = client.request(targetUrl, {
            method: req.method,
            headers: headers as http.OutgoingHttpHeaders,
            timeout: 30000,
          }, (proxyRes) => {
            const respHeaders = { ...proxyRes.headers }
            respHeaders['access-control-allow-origin'] = '*'
            respHeaders['access-control-allow-headers'] = '*'
            respHeaders['access-control-allow-methods'] = '*'
            // A client that navigates away mid-request aborts the socket, and an
            // unhandled 'error' on either stream takes the WHOLE dev server
            // down (observed: `throw er; Unhandled 'error' event`,
            // ECONNABORTED) — which then fails every later e2e spec for reasons
            // that have nothing to do with the test.
            proxyRes.on('error', () => { res.destroy() })
            res.on('error', () => { proxyRes.destroy() })
            res.writeHead(proxyRes.statusCode || 500, respHeaders)
            proxyRes.pipe(res)
          })

          proxyReq.on('error', (err: unknown) => {
            const code = (err as { code?: string })?.code
            if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
              return
            }
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json', 'access-control-allow-origin': '*' })
              res.end(JSON.stringify({ error: `Central node waking up or unreachable (${target}): ${(err as Error).message}` }))
            }
          })

          proxyReq.on('timeout', () => {
            proxyReq.destroy()
            if (!res.headersSent) {
              res.writeHead(504, { 'Content-Type': 'application/json', 'access-control-allow-origin': '*' })
              res.end(JSON.stringify({ error: 'Gateway timeout' }))
            }
          })

          req.pipe(proxyReq)
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'access-control-allow-origin': '*' })
            res.end(JSON.stringify({ error: (err as Error).message }))
          }
        }
      })

      // WebSocket upgrades (/api/ws) never reach the http middleware above.
      // Without this the P2P socket dies in browser dev while the same code
      // works in Electron, which talks to the sidecar directly.
      const httpServer = server.httpServer
      if (httpServer) {
        httpServer.on('upgrade', (req, socket, head) => {
          if (!req.url?.startsWith('/api/')) return // vite's own HMR socket
          const target = resolveDevApiTarget(req)
          const targetUrl = new URL(req.url, target)
          if (isCourierNode(target) && !COURIER_ALLOWED.test(targetUrl.pathname)) {
            socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
            socket.end()
            return
          }
          proxyUpgrade(req, socket, head, targetUrl)
        })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Dev data node.
//
// The central Render deployment is a BLIND COURIER (`SITE_SERVICES=mail,turn`):
// every stateful route 404s at the edge (apps/api/src/serve.ts:237 +
// site-services.ts:23). It is the directory/mail/TURN node, NOT a data node.
// Dev used to default /api to it, so every lobby/feed/users poll came back 404.
// The packaged app never had that problem: Electron boots the local Bun
// sidecar and the preload hands us its URL. Browser dev now does the same
// (docs/DEPLOY.md "Dev sidecar"); `GMATCH_DEV_API=remote` opts back out to a
// remote FULL node.
const DEV_API_PORT = Number(process.env.GMATCH_API_PORT || 8790)
const DEV_API_LOCAL = `http://127.0.0.1:${DEV_API_PORT}`
const DEV_API_REMOTE_URL = 'https://gmatch.fly.dev'
const DEV_API_REMOTE = process.env.GMATCH_DEV_API === 'remote'

/** Courier hosts answer only the allow-list below; everything else is 404. */
const COURIER_HOSTS = /(^|\.)onrender\.com$/
const COURIER_ALLOWED =
  /^\/(api\/(health|identity|servers(\/.*)?|mail(\/.*)?|turn(\/.*)?|admin(\/.*)?)|\.well-known\/.*|\/(p|u)\/.*)$/

function isCourierNode(target: string): boolean {
  try {
    return COURIER_HOSTS.test(new URL(target).hostname)
  } catch {
    return false
  }
}

/** Connected server (cookie / header) wins; else the dev default node. */
function resolveDevApiTarget(req: IncomingMessage): string {
  const cookie = req.headers.cookie || ''
  const match = cookie.match(/gmatch_server_url=([^;]+)/)
  if (match) {
    try {
      const decoded = decodeURIComponent(match[1]).trim().replace(/\/+$/, '')
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded
    } catch { /* ignore */ }
  }
  const custom = req.headers['x-gmatch-server']
  if (typeof custom === 'string' && (custom.startsWith('http://') || custom.startsWith('https://'))) {
    return custom.trim().replace(/\/+$/, '')
  }
  if (DEV_API_REMOTE) return DEV_API_REMOTE_URL
  return (process.env.VITE_API_URL || DEV_API_LOCAL).replace(/\/+$/, '')
}

/** True when a full node already answers /api/health on the dev port. */
async function isSidecarHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`${DEV_API_LOCAL}/api/health`, { signal: AbortSignal.timeout(1500) })
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

/** Hand a WS upgrade to the upstream node (no http middleware involved). */
function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, targetUrl: URL): void {
  const client = targetUrl.protocol === 'https:' ? https : http
  const headers: Record<string, string | string[] | undefined> = { ...req.headers }
  delete headers.host
  headers.host = targetUrl.host

  const proxyReq = client.request({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    method: req.method,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    headers: headers as http.OutgoingHttpHeaders,
  })

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const lines = Object.entries(proxyRes.headers).map(
      ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`,
    )
    socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n${lines.join('\r\n')}\r\n\r\n`)
    if (proxyHead?.length) socket.write(proxyHead)
    proxySocket.pipe(socket).pipe(proxySocket)
  })
  // Upstream refused the upgrade (e.g. courier 404s /api/ws): answer, don't hang.
  proxyReq.on('response', (res) => {
    socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\nConnection: close\r\n\r\n`)
    socket.end()
  })
  proxyReq.on('error', () => socket.destroy())
  if (head?.length) proxyReq.write(head)
  proxyReq.end()
}

/**
 * Boots the same local Bun sidecar the packaged app runs, so `npm run dev` in a
 * browser debugs the node the app really talks to (docs/DEPLOY.md).
 */
function devSidecarPlugin(): Plugin {
  let proc: ReturnType<typeof spawn> | null = null
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      proc?.kill()
    } catch {
      /* already dead */
    }
    proc = null
  }
  return {
    name: 'gmatch-dev-sidecar',
    async configureServer(server) {
      // Dev-server crash guard. When a browser navigates away mid-request it
      // resets the keep-alive socket, and Node re-emits that as an unhandled
      // 'error' event on the server socket:
      //     throw er; // Unhandled 'error' event
      //     Error: write ECONNABORTED
      // That kills the entire dev process, and every later e2e spec then fails
      // for reasons that have nothing to do with the test (observed: 30
      // "failures" that were one aborted request). Per-socket errors are the
      // client's business, not the server's.
      server.httpServer?.on('connection', (socket) => {
        socket.on('error', () => { /* client went away mid-request */ })
      })
      server.httpServer?.on('clientError', (_err, socket) => {
        try {
          socket.destroy()
        } catch {
          /* already torn down */
        }
      })
      if (DEV_API_REMOTE) return
      // Adopt before spawning: a second window, a leftover process or
      // `npm run dev:electron` may already own the port, and the doomed
      // duplicate would crash with EADDRINUSE while our health poll happily
      // reported "ready" against the OTHER process (observed live).
      if (await isSidecarHealthy()) {
        console.log(`[dev-api] adopting existing sidecar at ${DEV_API_LOCAL}`)
        return
      }
      const apiDir = fileURLToPath(new URL('../api', import.meta.url))
      // libsql does NOT create the SQLite file's parent directory (error 14),
      // and e2e points SNAPSHOT_PATH at a fresh throwaway dir on every machine.
      const dataDirs = [process.env.SNAPSHOT_PATH && dirname(process.env.SNAPSHOT_PATH), process.env.BLOB_STORE_DIR]
        .filter((d): d is string => Boolean(d))
      for (const dir of dataDirs) {
        try {
          mkdirSync(dir, { recursive: true })
        } catch (err) {
          console.warn(`[dev-api] could not create ${dir}: ${(err as Error).message}`)
        }
      }
      // GMATCH_API_FRESH=1: start the node EMPTY. A shared dev DB accumulates
      // users/posts/notifications across runs, which makes order-dependent
      // specs (empty feed, cold-start nudge) pass or fail depending on what ran
      // before. Wiped only when we are about to spawn, so an adopted sidecar
      // never has its live database unlinked underneath it.
      if (process.env.GMATCH_API_FRESH === '1') {
        const wipe: string[] = []
        if (process.env.SNAPSHOT_PATH) {
          wipe.push(process.env.SNAPSHOT_PATH, `${process.env.SNAPSHOT_PATH}-wal`, `${process.env.SNAPSHOT_PATH}-shm`)
        }
        if (process.env.WATCH_PARTIES_PATH) wipe.push(process.env.WATCH_PARTIES_PATH)
        for (const file of wipe) {
          try {
            rmSync(file, { force: true })
          } catch (err) {
            console.warn(`[dev-api] could not reset ${file}: ${(err as Error).message}`)
          }
        }
        const blobDir = process.env.BLOB_STORE_DIR
        if (blobDir) {
          try {
            rmSync(blobDir, { recursive: true, force: true })
            mkdirSync(blobDir, { recursive: true })
          } catch (err) {
            console.warn(`[dev-api] could not reset ${blobDir}: ${(err as Error).message}`)
          }
        }
        console.log('[dev-api] starting from an empty database (GMATCH_API_FRESH=1)')
      }
      proc = spawn(devBunBin(), ['run', 'src/serve.ts'], {
        cwd: apiDir,
        env: { ...process.env, PORT: String(DEV_API_PORT) },
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      proc.on('error', (err: Error) => {
        console.warn(`[dev-api] could not spawn bun (${err.message}). Install bun or set GMATCH_DEV_API=remote.`)
      })
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
      const started = Date.now()
      const poll = setInterval(async () => {
        // A child that already exited can never come up.
        if (!proc) {
          clearInterval(poll)
          console.warn('[dev-api] sidecar exited before becoming healthy')
          return
        }
        if (await isSidecarHealthy()) {
          clearInterval(poll)
          console.log(`[dev-api] local sidecar ready at ${DEV_API_LOCAL}`)
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
  plugins: [react(), tailwindcss(), devPxPlugin(), devSidecarPlugin(), devApiProxyPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Dev-only proxy: routes booru mirrors and legacy fly endpoints for browser dev.
    proxy: {
      '^/fly-api': {
        target: 'https://gmatch.fly.dev',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/fly-api/, ''),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['access-control-allow-origin'] = '*'
            proxyRes.headers['access-control-allow-headers'] = '*'
            proxyRes.headers['access-control-allow-methods'] = '*'
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
