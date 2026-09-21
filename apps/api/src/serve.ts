import { createClient } from '@libsql/client'
import { D1Turso, ensureSchema } from './db'
import { existsSync } from 'node:fs'
import { LocalBlobStore } from './blob'
import { resolveStorageKey } from './storage-key'
import { resolveNodeKey } from './node-key'
import app from './index'
import { join, dirname, extname } from 'node:path'
import { handleIncoming, conns, broadcastToRoom, watchDisconnect, WsConn } from './ws-bus'
import { mailWatchers, handleMailSocketMessage, unwatchMailSocket } from './routes/mail'
import { isApiPath, parseSiteServices, siteAllows } from './site-services'
import { leaveLobby, advanceLobby } from './lobby'
import { advanceBabecock } from './babecock'
import { runPeriodicMaintenance } from './cleanup'

declare const Bun: any

// Single file-backed SQLite engine: the DB file (the same artifact the old
// snapshot cycle produced via VACUUM INTO) is the live database — rows land
// on disk per transaction instead of living in RAM behind 30 s snapshots.
const DB_PATH = process.env.SNAPSHOT_PATH || join(process.cwd(), 'orbit.sqlite')
const SNAPSHOT_PATH = DB_PATH
const dbFilePresentAtBoot = existsSync(DB_PATH)
const client = createClient({ url: `file:${DB_PATH}` })
const db = new D1Turso(client)
// crypto.ts hard-requires a non-zero 64-hex STORAGE_ENCRYPTION_KEY; the server
// can also be started bare (`bun run serve:api`, packaged api-stage). Resolve
// env → persisted keyfile → fresh generated key so uploads/PMs never 500 on a
// missing key.
process.env.STORAGE_ENCRYPTION_KEY = resolveStorageKey(SNAPSHOT_PATH, process.env)
const BLOB_STORE_DIR = process.env.BLOB_STORE_DIR || (process.env.SNAPSHOT_PATH ? join(dirname(process.env.SNAPSHOT_PATH), 'blobs') : './blobs')
let dbReady = false
let dbInitError: string | null = null
const dbReadyPromise = (async () => {
  try {
    // Boot-time durability diagnostics: a deploy that lost the mounted
    // volume (the most common root cause of "cards reset on update") must
    // be visible in logs immediately rather than discovered when a user
    // later reports missing data.
    if (!dbFilePresentAtBoot) {
      console.warn(`[DB] no DB file found at ${SNAPSHOT_PATH} — first boot or missing volume mount`)
    }
    await ensureSchema(client)
    // Compaction + durability: WAL for crash-safe per-transaction persistence
    // without a snapshot dance; FULL auto_vacuum reclaims space. On a
    // pre-existing DB file auto_vacuum only takes effect after one VACUUM —
    // the guard makes that happen exactly once per DB lifetime.
    await client.execute('PRAGMA journal_mode = WAL')
    const av = await client.execute('PRAGMA auto_vacuum')
    const avValue = Number(Object.values((av.rows[0] ?? {}) as Record<string, unknown>)[0] ?? 0)
    if (!avValue) {
      await client.execute('PRAGMA auto_vacuum = FULL')
      await client.execute('VACUUM')
    }
    console.log(`[DB] file DB ready at ${SNAPSHOT_PATH} (WAL, auto_vacuum=FULL)`)
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

// Watch rooms live in memory; keep them across restarts/deploys on the same
// /data volume as the DB snapshot. 30 s tick + SIGTERM flush; file is tiny
// (<=50 rooms) so unconditional rewrite is fine. Workers mode has no FS and
// skips this entirely (routes only run here).
import { serializeParties, restoreParties, liveMediaObjectIds } from './watchparty'
const PARTIES_PATH = process.env.WATCH_PARTIES_PATH ||
  (process.env.SNAPSHOT_PATH ? join(dirname(process.env.SNAPSHOT_PATH), 'watchparties.json') : './watchparties.json')
async function flushParties(): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(PARTIES_PATH, serializeParties(), { mode: 0o600 })
}
import('node:fs/promises').then(({ readFile }) =>
  readFile(PARTIES_PATH, 'utf8')
    .then((j) => { const n = restoreParties(j); if (n) console.log(`[WATCH] restored ${n} room(s)`) })
    .catch(() => { /* first boot: no file yet */ }),
).catch(() => {})
setInterval(() => {
  flushParties().catch((e) => console.warn('[WATCH] snapshot failed', (e as Error)?.message || e))
  // Live rooms re-extend their media leases (Objects.expires_at, A4); a
  // room that truly dies stops refreshing and expires +1 day after last
  // use. Without this, an all-night room eventually served a purged
  // object ("No preview") while touchRooms kept it alive.
  const ids = liveMediaObjectIds()
  if (ids.length && dbReady) {
    const ph = ids.map(() => '?').join(',')
    db.prepare(`UPDATE Objects SET expires_at = datetime('now', '+1 day') WHERE id IN (${ph})`)
      .bind(...ids).run().catch((e: Error) => console.warn('[WATCH] media lease refresh failed', e?.message || e))
  }
}, 30_000)
// On SIGTERM/SIGINT, flush watch parties and exit. The file-backed DB needs
// no shutdown snapshot — rows are on disk per transaction.
async function persistAndExit(code: number) {
  try { await flushParties() } catch { /* best effort */ }
  process.exit(code)
}
process.once('SIGTERM', () => { void persistAndExit(0) })
process.once('SIGINT', () => { void persistAndExit(0) })

const bucket = new LocalBlobStore(BLOB_STORE_DIR)
// One-shot video MIME backfill (1.4.7): repairs pre-fix mislabeled rows
// (octet-stream/image-jpeg video bytes, loopback content_urls). SystemMeta-
// gated inside repairVideoMime — runs once per DB, best-effort per row,
// never fails boot.
dbReadyPromise.then(() => {
  import('./migrate-video-mime').then(({ repairVideoMime }) =>
    repairVideoMime(db, bucket).then(
      (s) => { if (s.sniffed || s.loopbackRewritten) console.log(`[DB] video MIME repair: ${s.sniffed} re-sniffed, ${s.loopbackRewritten} loopback URLs rewritten`) },
      (err) => console.warn('[DB] video MIME repair skipped:', (err as Error)?.message || err),
    ),
  ).catch((err) => console.warn('[DB] video MIME repair skipped:', (err as Error)?.message || err))
})
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

// Gossip pull (plan G1 — every user a self-hosting db): host nodes
// periodically pull signed public-post envelopes from the upstream relay
// (central by default) into their own db. Offline hosts catch up on next
// pull via the durable SystemMeta cursor. Central itself sets no upstream
// and skips; dev sidecars opt in via GMATCH_GOSSIP_UPSTREAM (apiSidecar).
const GOSSIP_UPSTREAM = (process.env.GOSSIP_UPSTREAM || '').replace(/\/+$/, '')
let gossipPullRunning = false
if (GOSSIP_UPSTREAM) {
  setInterval(() => {
    if (!dbReady || gossipPullRunning) return
    gossipPullRunning = true
    import('./gossip-pull').then(({ pullGossipUpstream }) => pullGossipUpstream(db, GOSSIP_UPSTREAM))
      .then((r) => {
        if (r.applied > 0 || r.rejected > 0) {
          console.log(`[GOSSIP] pull: applied=${r.applied} duplicates=${r.duplicates} rejected=${r.rejected}`)
        }
      })
      .catch((err) => console.warn('[GOSSIP] pull failed:', (err as Error)?.message || err))
      .finally(() => { gossipPullRunning = false })
  }, 60_000)
}

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
        const wasLobbyMember = conn.userId && conn.rooms.has('lobby')
        // WS6: Remove user from lobby queue on disconnect to prevent ghost entries
        if (wasLobbyMember) {
          leaveLobby(db, conn.userId!).catch((err) =>
            console.warn('[WS] lobby leave on disconnect failed:', err?.message || err)
          )
        }
        // Mark the user offline immediately so the roster drops them (and any
        // ghost) on the next poll — for ANY authed socket, not only lobby
        // members (watch/chat-only users used to linger until heartbeat decay).
        // ponytail: linear scan over live conns, fine at this scale.
        if (conn.userId) {
          const stillConnected = [...conns].some((o) => o !== conn && o.userId === conn.userId)
          if (!stillConnected) {
            db.prepare("UPDATE Users SET last_seen = datetime('now','-10 minutes') WHERE id = ?")
              .bind(conn.userId)
              .run()
              .then(() => {
                if (wasLobbyMember) broadcastToRoom('lobby', { type: 'lobby', action: 'refresh' })
              })
              .catch((err) => console.warn('[WS] mark offline on disconnect failed:', err?.message || err))
          }
        }
        conns.delete(conn)
        watchDisconnect(conn)
        wsToConn.delete(ws)
      }
    },
  },
})

console.log(`[ORBIT API] server running on port ${process.env.PORT || 8080}`)
