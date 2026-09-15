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
const MAX_SINGLE_BYTES = 25 * 1024 * 1024

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
    const e = manifest[String(url)]
    if (!e) return null
    try {
      fs.accessSync(fileFor(e.key), fs.constants.R_OK)
    } catch {
      delete manifest[String(url)]
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
    const hit = get(url)
    if (hit) {
      manifest[String(url)].pins += 1
      writeManifest()
      return hit
    }
    const fetch = fetcher || imageCache.fetchBinary
    const { buf, mime } = await fetch(String(url))
    if (!buf || buf.length === 0 || buf.length > MAX_SINGLE_BYTES) return null
    if (!makeRoom(buf.length)) return null
    const key = keyFor(url)
    try {
      fs.writeFileSync(fileFor(key), buf)
    } catch {
      return null
    }
    manifest[String(url)] = { key, mime: String(mime || ''), bytes: buf.length, atime: Date.now(), pins: 1 }
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

function prune() {
  makeRoom(0)
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
    return new Response(buf, {
      headers: {
        'Content-Type': entry.mime || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      },
    })
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
  prune,
  serveVault,
  // Test seam.
  _test: { keyFor, extOf, makeRoom: (need) => makeRoom(need), manifest: () => manifest, setFetcher: (fn) => { fetcher = fn } },
}
