// gMatch local media vault (main process) — OPT-IN persistent storage for
// gallery keeps + card media. OFF by default (Settings → local vault); the
// renderer only calls pin/get when the player opted in, so without opt-in
// nothing touches disk and the F1 memory-only guarantee stands.
// Layout: <userData>/media-vault/<sha256(url).ext> + manifest.json
// {url: {key, mime, bytes, atime, pins}}. Quota 3GB, LRU; pinned entries
// (gallery keeps, cards) survive eviction until unpinned/removed.
const fs = require('fs')
const path = require('path')
const nodeCrypto = require('crypto')
const imageCache = require('./imageCache.cjs')

const SCHEME = 'vault'
const QUOTA_BYTES = 3 * 1024 * 1024 * 1024

let dir = null
/** url -> { key, mime, bytes, atime, pins } */
let manifest = {}
/** Test seam: stub the byte fetcher (defaults to imageCache.fetchBinary). */
let fetcher = null

function extOf(url) {
  const m = /\.(jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov)(?:[?#]|$)/i.exec(String(url || ''))
  const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'img'
  return ext
}

function keyFor(url) {
  const h = nodeCrypto.createHash('sha256').update(String(url)).digest('hex')
  return `${h}.${extOf(url)}`
}

function manifestPath() {
  return dir ? path.join(dir, 'manifest.json') : null
}

function loadManifest() {
  manifest = {}
  try {
    const raw = fs.readFileSync(manifestPath(), 'utf8')
    const d = JSON.parse(raw)
    if (d && typeof d === 'object') {
      for (const [url, e] of Object.entries(d)) {
        if (e && typeof e.key === 'string' && typeof e.bytes === 'number') {
          manifest[url] = { key: e.key, mime: String(e.mime || ''), bytes: e.bytes, atime: Number(e.atime) || 0, pins: Number(e.pins) || 0 }
        }
      }
    }
  } catch {
    /* missing/corrupt — start empty */
  }
}

function writeManifest() {
  try {
    if (manifestPath()) fs.writeFileSync(manifestPath(), JSON.stringify(manifest))
  } catch {
    /* disk hiccup — memory still authoritative this session */
  }
}

function totalBytes() {
  let n = 0
  for (const e of Object.values(manifest)) n += e.bytes
  return n
}

function fileFor(key) {
  return dir ? path.join(dir, key) : null
}

function dropEntry(url) {
  const e = manifest[url]
  if (!e) return false
  try {
    if (e.key && !e.key.includes('..')) fs.rmSync(fileFor(e.key), { force: true })
  } catch {
    /* already gone */
  }
  delete manifest[url]
  return true
}

/** Evict oldest unpinned entries until `need` bytes fit under quota. */
function makeRoom(need) {
  if (totalBytes() + need <= QUOTA_BYTES) return true
  const cands = Object.entries(manifest)
    .filter(([, e]) => (e.pins || 0) <= 0)
    .sort((a, b) => a[1].atime - b[1].atime)
  for (const [url] of cands) {
    dropEntry(url)
    if (totalBytes() + need <= QUOTA_BYTES) return true
  }
  return totalBytes() + need <= QUOTA_BYTES
}

function init(userDataPath) {
  dir = path.join(String(userDataPath), 'media-vault')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    dir = null
  }
  loadManifest()
}

function stats() {
  return { files: Object.keys(manifest).length, bytes: totalBytes(), quota: QUOTA_BYTES, dir: Boolean(dir) }
}

/**
 * Lookup only: vault:// URL when the bytes are already local, else null.
 * Renderers use this per mount — never downloads, so mere browsing can't
 * fill the disk.
 */
function get(url) {
  try {
    if (!url || !dir) return null
    const str = String(url)
    if (str.startsWith(`${SCHEME}://f/`)) {
      const k = str.split('/').pop()
      if (k) {
        try {
          fs.accessSync(fileFor(k), fs.constants.R_OK)
          return str
        } catch {
          return null
        }
      }
    }
    const e = manifest[str]
    if (!e) return null
    try {
      fs.accessSync(fileFor(e.key), fs.constants.R_OK)
    } catch {
      delete manifest[str]
      return null
    }
    e.atime = Date.now()
    return `${SCHEME}://f/${e.key}`
  } catch {
    return null
  }
}

/**
 * Get-or-fetch + pin. Used for gallery keeps + card media only (opt-in).
 * Returns the vault:// URL or null (caller falls back to remote).
 */
async function pin(url) {
  try {
    if (!url || !dir) return null
    const str = String(url)
    if (str.startsWith(`${SCHEME}://f/`)) {
      const hit = get(str)
      if (hit) return hit
    }
    const hit = get(str)
    if (hit) {
      if (manifest[str]) {
        manifest[str].pins = (manifest[str].pins || 0) + 1
        writeManifest()
      }
      return hit
    }
    // idle-file:// (player-owned idle folders) is not http(s) — the byte
    // fetcher rejects any other scheme, so those keeps never reached disk
    // and only reappeared while the clicker held the folder grant open.
    // Read the granted path directly instead of routing through the fetcher.
    let fetched = null
    if (str.startsWith('idle-file://')) {
      fetched = require('./customFolders.cjs').readIdleFile(str)
      if (!fetched) return null
    } else if (str.startsWith('gmcache://')) {
      const cacheKey = str.replace('gmcache://', '')
      const cached = require('./diskImageCache.cjs').get(cacheKey)
      if (cached) {
        const buf = Buffer.isBuffer(cached) ? cached : cached.buf
        if (buf && buf.length > 0) {
          fetched = { buf, mime: cached.mime || 'image/jpeg' }
        }
      }
      if (!fetched) {
        try {
          const m = imageCache.readCache ? imageCache.readCache(str) : null
          if (m && m.buf) fetched = m
        } catch {}
      }
      if (!fetched) return null
    } else {
      const fetch = fetcher || imageCache.fetchBinary
      try {
        fetched = await fetch(str)
      } catch (err) {
        // Fallback for boorus: try alternate extensions
        if (/\.(jpe?g|png|gif|webp)$/i.test(str)) {
          const exts = ['jpg', 'png', 'gif', 'jpeg']
          for (const ext of exts) {
            const alt = str.replace(/\.(jpe?g|png|gif|webp)$/i, `.${ext}`)
            if (alt === str) continue
            try {
              fetched = await fetch(alt)
              if (fetched && fetched.buf) break
            } catch {}
          }
        }
      }
    }
    if (!fetched || !fetched.buf || fetched.buf.length === 0) return null
    const { buf, mime } = fetched
    const cap = imageCache.capFor(mime, str)
    if (buf.length > cap) return null
    if (!makeRoom(buf.length)) return null
    const key = keyFor(str)
    try {
      fs.writeFileSync(fileFor(key), buf)
    } catch {
      return null
    }
    manifest[str] = { key, mime: String(mime || ''), bytes: buf.length, atime: Date.now(), pins: 1 }
    writeManifest()
    return `${SCHEME}://f/${key}`
  } catch {
    return null
  }
}

function unpin(url) {
  try {
    const e = manifest[String(url)]
    if (!e) return false
    e.pins = Math.max(0, (e.pins || 0) - 1)
    writeManifest()
    return true
  } catch {
    return false
  }
}

/** Delete bytes immediately regardless of pins (user asked it gone). */
function remove(url) {
  try {
    const ok = dropEntry(String(url))
    if (ok) writeManifest()
    return ok
  } catch {
    return false
  }
}

/** Wipe the whole vault (opt-out). */
function clear() {
  try {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already clean */
  }
  manifest = {}
  try {
    if (dir) fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* next init recreates */
  }
  writeManifest()
  return stats()
}

/**
 * protocol.handle('vault') — serves vault files by basename key.
 * Unknown/evicted key → 404 (renderer falls back to remote).
 */
async function serveVault(request) {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      })
    }
    const u = new URL(request.url)
    const key = path.basename(u.pathname || u.host || '')
    if (!key || key.includes('..')) return new Response('bad file', { status: 400 })
    const entry = Object.values(manifest).find((e) => e.key === key)
    if (!entry || !dir) return new Response('miss', { status: 404 })
    let buf
    try {
      buf = await fs.promises.readFile(fileFor(key))
    } catch {
      return new Response('miss', { status: 404 })
    }
    // Range support: a 100MB+ mp4 must seek; answering the whole file with
    // 200 forces the browser to re-download everything on every jump.
    const base = {
      'Content-Type': entry.mime || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '')
    if (range) {
      const total = buf.length
      let start = range[1] ? parseInt(range[1], 10) : 0
      let end = range[2] ? Math.min(parseInt(range[2], 10), total - 1) : total - 1
      if (!Number.isFinite(start) || start >= total || start > end) {
        return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${buf.length}` } })
      }
      const slice = buf.subarray(start, end + 1)
      return new Response(slice, {
        status: 206,
        headers: { ...base, 'Content-Length': String(slice.length), 'Content-Range': `bytes ${start}-${end}/${total}` },
      })
    }
    return new Response(buf, { headers: { ...base, 'Content-Length': String(buf.length) } })
  } catch {
    return new Response('cache error', { status: 500 })
  }
}

module.exports = {
  SCHEME,
  QUOTA_BYTES,
  init,
  stats,
  get,
  pin,
  unpin,
  remove,
  clear,
  serveVault,
  // Test seam.
  _test: { keyFor, extOf, makeRoom: (need) => makeRoom(need), manifest: () => manifest, setFetcher: (fn) => { fetcher = fn } },
}
