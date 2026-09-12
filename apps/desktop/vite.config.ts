import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path, { join } from 'node:path'

// Hosts the dev /px byte-proxy may fetch (allowlist — no open proxy).
const PX_ALLOW = /(^|\.)(imhentai\.xxx|paheal\.net|tbib\.org|xbooru\.com|redgifs\.com|konachan\.com|yande\.re|files\.yande\.re|realbooru\.com|booru\.org)$/

const DEV_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

/** Resolve the real bun exe (npm .cmd shims can't be spawned directly). */
function bunBin(): string {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return 'bun'
}

/**
 * Dev-mode API sidecar: `npm run dev` gets the same 8790 server Electron
 * spawns, so the shell's fetches never hit ERR_CONNECTION_REFUSED. Adopts an
 * already-running sidecar; uses apps/api default persistence (gitignored).
 */
function devApiPlugin(): Plugin {
  let proc: ReturnType<typeof spawn> | null = null
  return {
    name: 'gmatch-dev-api',
    configureServer(server) {
      void (async () => {
        try {
          const r = await fetch('http://127.0.0.1:8790/api/health')
          if (r.ok && (await r.json()).db_ready) {
            console.log('[api] adopting existing sidecar on 8790')
            return
          }
        } catch {
          /* spawn below */
        }
        const apiDir = fileURLToPath(new URL('../api', import.meta.url))
        // At-rest encryption key (apps/api/src/crypto.ts hard-requires it or
        // every upload/PM 500s). Generate once, persist in the gitignored
        // apps/api dir — mirrors electron/apiSidecar.cjs for packaged mode.
        let storageKey = process.env.STORAGE_ENCRYPTION_KEY || ''
        const keyPath = join(apiDir, '.dev-storage.key')
        if (!/^[0-9a-f]{64}$/i.test(storageKey)) {
          try {
            storageKey = readFileSync(keyPath, 'utf8').trim()
          } catch {
            /* generate below */
          }
        }
        if (!/^[0-9a-f]{64}$/i.test(storageKey)) {
          storageKey = randomBytes(32).toString('hex')
          try { writeFileSync(keyPath, storageKey) } catch { /* ephemeral is fine in dev */ }
        }
        proc = spawn(bunBin(), ['run', 'src/serve.ts'], {
          cwd: apiDir,
          env: { ...process.env, PORT: '8790', STORAGE_ENCRYPTION_KEY: storageKey },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        proc.stdout?.on('data', (d) => console.log('[api]', d.toString().trim()))
        proc.stderr?.on('data', (d) => console.error('[api!]', d.toString().trim()))
        proc.on('error', (err) => console.error('[api] dev sidecar spawn failed:', err.message))
        server.httpServer?.on('close', () => proc?.kill())
      })()
    },
  }
}

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
          const r = await fetch(target.toString(), {
            headers,
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
  plugins: [react(), tailwindcss(), devApiPlugin(), devPxPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Dev-only CORS bypass for the Grid feed's booru mirrors (kept from the
    // pre-merge gmatch config). Never used in packaged builds — Electron
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
      '^/booru/hgoon': {
        target: 'https://hgoon.booru.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/hgoon/, ''),
      },
      '^/booru/qoh': {
        target: 'https://qoh.booru.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/qoh/, ''),
      },
      '^/booru/celeb': {
        target: 'https://celeb.booru.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/celeb/, ''),
      },
      '^/booru/foot': {
        target: 'https://footfetishbooru.booru.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/foot/, ''),
      },
      '^/booru/blacked': {
        target: 'https://blacked.booru.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/booru\/blacked/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
