import { createClient } from '@libsql/client'
import { D1Turso, ensureSchema } from './db'
import { restoreDb, snapshotDb } from './persistence'
import { LocalBlobStore } from './blob'
import { resolveStorageKey } from './storage-key'
import { resolveNodeKey } from './node-key'
import app from './index'
import { join, dirname, extname } from 'node:path'
import { handleIncoming, conns, WsConn, broadcastToRoom } from './ws-bus'
import { mailWatchers, handleMailSocketMessage } from './routes/mail'
import { isApiPath, parseSiteServices, siteAllows } from './site-services'
import { leaveLobby, advanceLobby } from './lobby'
import { advanceBabecock } from './babecock'
import { runPeriodicMaintenance } from './cleanup'

declare const Bun: any

// Single embedded in-memory SQLite engine. Row persistence (to gitignored
// orbit.snapshot.sqlite) is handled by snapshotDb/restoreDb instead of an
// external Turso instance.
const client = createClient({ url: ':memory:' })
const db = new D1Turso(client)

const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH || join(process.cwd(), 'orbit.snapshot.sqlite')
// crypto.ts hard-requires a non-zero 64-hex STORAGE_ENCRYPTION_KEY; the server
// can also be started bare (`bun run serve:api`, packaged api-stage). Resolve
// env → persisted keyfile → fresh generated key so uploads/PMs never 500 on a
// missing key.
process.env.STORAGE_ENCRYPTION_KEY = resolveStorageKey(SNAPSHOT_PATH, process.env)
const BLOB_STORE_DIR = process.env.BLOB_STORE_DIR || (process.env.SNAPSHOT_PATH ? join(dirname(process.env.SNAPSHOT_PATH), 'blobs') : './blobs')
const SNAPSHOT_INTERVAL_MS = Math.max(
  30000,
  parseInt(process.env.SNAPSHOT_INTERVAL_MS || '30000', 10) || 30000,
)
const SNAPSHOT_INITIAL_DELAY_MS = Math.max(
  10000,
  parseInt(process.env.SNAPSHOT_INITIAL_DELAY_MS || '10000', 10) || 10000,
)
let snapshotInFlight = false

async function takeSnapshot() {
  if (snapshotInFlight) return
  snapshotInFlight = true
  try {
    await snapshotDb(client, SNAPSHOT_PATH)
    console.log(`[DB] snapshot written → ${SNAPSHOT_PATH}`)
  } catch (err) {
    console.warn('[DB] Snapshot failed:', (err as Error)?.message || err)
  } finally {
    snapshotInFlight = false
  }
}

let dbReady = false
let dbInitError: string | null = null
const dbReadyPromise = (async () => {
  try {
    await ensureSchema(client)
    // Boot-time durability diagnostics: log whether the snapshot file + blob
    // store vimpy exist on disk before we try to load, so a deploy that lost
    // the mounted volume (the most common root cause of "cards reset on
    // update") is visible in logs immediately rather than discovered when
    // a user later reports missing data.
    const { access } = await import('node:fs/promises')
    let snapshotExists = false
    try {
      await access(SNAPSHOT_PATH)
      snapshotExists = true
    } catch {
      console.warn(`[DB] no snapshot found at ${SNAPSHOT_PATH} — first boot or missing volume mount`)
    }
    const restored = await restoreDb(client, SNAPSHOT_PATH)
    console.log(`[DB] restore summary: file_present=${snapshotExists} rows_restored=${restored}`)
    // Blob store sanity check — count objects recovered on disk.
    let blobCount = -1
    try {
      const { readdir } = await import('node:fs/promises')
      let entries: string[] = []
      try { entries = await readdir(BLOB_STORE_DIR) } catch {}
      blobCount = entries.length
      console.log(`[DB] blob store at ${BLOB_STORE_DIR}: ${blobCount} top-level entries`)
    } catch (err) {
      console.warn(`[DB] blob store check failed: ${(err as Error)?.message}`)
    }
    dbReady = true
  } catch (err) {
    dbInitError = (err as Error)?.message || String(err)
    console.error('[DB] Startup error:', dbInitError)
  }
})()

setInterval(() => {
  if (dbReady) takeSnapshot()
}, SNAPSHOT_INTERVAL_MS)
setTimeout(() => {
  if (dbReady) takeSnapshot()
}, SNAPSHOT_INITIAL_DELAY_MS)
// On SIGTERM/SIGINT, persist a final snapshot before letting the process
// exit. Bun's exit() is synchronous so we kick the snapshot synchronously
// and rely on snapshotDb being awaitable. Fly.io's default stop_signal is
// SIGTERM with a kill_timeout; verify fly.toml has kill_timeout >= 60s so
// the VACUUM INTO completes.
async function persistAndExit(code: number) {
  try {
    if (dbReady) await takeSnapshot()
    console.log('[DB] shutdown snapshot complete')
  } catch (err) {
    console.warn('[DB] shutdown snapshot failed:', (err as Error)?.message || err)
  }
  process.exit(code)
}
process.once('SIGTERM', () => { void persistAndExit(0) })
process.once('SIGINT', () => { void persistAndExit(0) })

const bucket = new LocalBlobStore(BLOB_STORE_DIR)
// ADMIN_PIN / ADMIN_PIN_HASH must reach routes via c.env — pre-B.4 neither was
// wired here, so verify-pin silently ran on the hardcoded fallback forever.
const nodeKey = resolveNodeKey(SNAPSHOT_PATH)
const isDev = !process.env.FLY_APP_NAME && process.env.NODE_ENV !== 'production'
const devAdminPin = isDev && !process.env.ADMIN_PIN && !process.env.ADMIN_PIN_HASH ? 'admin' : undefined
const env = {
  DB: db,
  BUCKET: bucket,
  NODE_PRIV_HEX: nodeKey.privHex,
  NODE_PUB_HEX: nodeKey.pubHex,
  ...(process.env.ADMIN_PIN || devAdminPin ? { ADMIN_PIN: process.env.ADMIN_PIN || devAdminPin } : {}),
  ...(process.env.ADMIN_PIN_HASH ? { ADMIN_PIN_HASH: process.env.ADMIN_PIN_HASH } : {}),
  ...(process.env.ADMIN_ORBIT_ID ? { ADMIN_ORBIT_ID: process.env.ADMIN_ORBIT_ID } : {}),
  ...(process.env.API_SEALED_ONLY ? { API_SEALED_ONLY: process.env.API_SEALED_ONLY } : {}),
}
const WEB_DIST = process.env.WEB_DIST_DIR || join((import.meta as any).dir || process.cwd(), '..', '..', 'web', 'out')

// Maintenance cadence: continuous automatic expiration sweep every 60s,
// 3-hour picture wipe window, and daily score reset at 00:00 UTC.
setInterval(() => {
  if (dbReady) runPeriodicMaintenance(db, bucket).catch((err) => console.warn('[MAINT] interval run failed:', err?.message || err))
}, 60 * 1000)
dbReadyPromise.then(() => {
  if (dbReady) runPeriodicMaintenance(db, bucket).catch((err) => console.warn('[MAINT] initial run failed:', err?.message || err))
})

// Match tick: drive lobby->pick->reveal->decide transitions and timeouts for
// AFK players even when nobody is polling the lobby endpoint.
setInterval(() => {
  if (dbReady) advanceLobby(db).catch((err) => console.warn('[LOBBY] match tick failed:', err?.message || err))
}, 1000)

// Babecock tick: close rounds when the 2-minute window lapses and park them in
// the gallery, even when nobody is actively polling the Babecock endpoint.
setInterval(() => {
  if (dbReady) advanceBabecock(db).catch((err) => console.warn('[BABECOCK] advance tick failed:', err?.message || err))
}, 1000)

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.exe': 'application/octet-stream',
}

const wsToConn = new WeakMap<object, WsConn>()

// null => full node (self-host/dev); Set => official site, courier-only.
const siteServices = parseSiteServices()

Bun.serve({
  hostname: '0.0.0.0',
  port: parseInt(process.env.PORT || '8080', 10),
  // Uploads can briefly contend with the remote database. The default 10s Bun
  // idle timeout was cutting off otherwise recoverable inbox refreshes.
  idleTimeout: 60,
  async fetch(req: Request, server: any) {
    const url = new URL(req.url)

        // SITE_SERVICES gate (plan P2.3): the official site = blind courier only.
        // Everything not in the allow-list 404s at the edge, including the legacy
        // identity-bound swarm WS (presence/rooms) — the courier never learns who
        // enters or leaves.
        if (siteServices && isApiPath(url.pathname) && !siteAllows(siteServices, url.pathname)) {
          return new Response('Not Found', { status: 404 })
        }

        // WebSocket upgrade
        if (url.pathname === '/api/ws') {
          if (siteServices) return new Response('Not Found', { status: 404 })
          const upgradeHeader = req.headers.get('Upgrade') || req.headers.get('upgrade')
          if (upgradeHeader?.toLowerCase() === 'websocket' && server.upgrade(req)) return
        }

    // Blind-courier push channel: ANONYMOUS upgrade (no ticket, no identity).
    // The socket may only watch opaque delivery tokens; the courier never
    // learns who it is.
    if (url.pathname === '/api/mail/ws') {
      const upgradeHeader = req.headers.get('Upgrade') || req.headers.get('upgrade')
      if (upgradeHeader?.toLowerCase() === 'websocket' && server.upgrade(req, { data: { mail: true } })) return
    }

    // API & system routes (+ public share pages /p/:id, /u/:id)
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/.well-known/') ||
      url.pathname.startsWith('/p/') ||
      url.pathname.startsWith('/u/')
    ) {
      if (url.pathname === '/api/health') {
        const status = dbReady ? 200 : dbInitError ? 500 : 503
        return Response.json({
          status: dbReady ? 'ok' : dbInitError ? 'error' : 'starting',
          db_ready: dbReady,
          error: dbInitError,
          timestamp: new Date().toISOString(),
          mode: siteServices ? 'courier' : 'legacy',
          services: siteServices ? Array.from(siteServices) : ['all'],
        }, { status })
      }
      if (!dbReady) {
        return Response.json({ error: 'API is starting. Try again shortly.' }, { status: 503 })
      }
      return app.fetch(req, env)
    }

    // Static frontend
    let filePath = join(WEB_DIST, url.pathname === '/' ? 'index.html' : url.pathname)

    let file = Bun.file(filePath)
    if (!(await file.exists()) && !extname(filePath)) {
      const htmlFile = Bun.file(filePath + '.html')
      if (await htmlFile.exists()) {
        file = htmlFile
        filePath = filePath + '.html'
      } else {
        const dirIndex = Bun.file(join(filePath, 'index.html'))
        if (await dirIndex.exists()) {
          file = dirIndex
          filePath = join(filePath, 'index.html')
        }
      }
    }

    if (await file.exists()) {
      const ext = extname(filePath)
      return new Response(file, {
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
      })
    }

    // SPA fallback: serve index.html for unmatched routes
    const indexFile = Bun.file(join(WEB_DIST, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
  websocket: {
    open(ws: any) {
      // Blind-courier sockets: anonymous, token-watch only, never join the
      // legacy swarm rooms (no presence, no identity).
      if (ws.data?.mail) {
        mailWatchers.set(ws, new Set())
        return
      }
      const conn: WsConn = {
        send: (data) => {
          if (ws.readyState === 1 || ws.readyState === WebSocket.OPEN) {
            ws.send(data)
            return true
          }
          return false
        },
        rooms: new Set(['global']),
      }
      conns.add(conn)
      wsToConn.set(ws, conn)
    },
    message(ws: any, message: any) {
      if (ws.data?.mail) {
        handleMailSocketMessage(ws, typeof message === 'string' ? message : message.toString())
        return
      }
      const conn = wsToConn.get(ws)
      if (!conn) return
      handleIncoming(conn, typeof message === 'string' ? message : message.toString())
    },
    close(ws: any) {
      if (ws.data?.mail) {
        unwatchMailSocket(ws)
        return
      }
      const conn = wsToConn.get(ws)
      if (conn) {
        // WS6: Remove user from lobby queue on disconnect to prevent ghost entries
        if (conn.userId && conn.rooms.has('lobby')) {
          leaveLobby(db, conn.userId).catch((err) =>
            console.warn('[WS] lobby leave on disconnect failed:', err?.message || err)
          )
          // Mark the user offline immediately so the roster drops them on the
          // next poll, and nudge connected clients to refresh right away.
          db.prepare("UPDATE Users SET last_seen = datetime('now','-10 minutes') WHERE id = ?")
            .bind(conn.userId)
            .run()
            .then(() => broadcastToRoom('lobby', { type: 'lobby', action: 'refresh' }))
            .catch((err) => console.warn('[WS] mark offline on disconnect failed:', err?.message || err))
        }
        conns.delete(conn)
        wsToConn.delete(ws)
      }
    },
  },
})

console.log(`[ORBIT API] server running on port ${process.env.PORT || 8080}`)
