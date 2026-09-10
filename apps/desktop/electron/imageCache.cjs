// gMatch image + feed-response cache (main process) — MEMORY ONLY (F1 fix).
// Security plan B.1: content must never cross a session on disk. Images are
// held in an LRU byte-budget Map (apps/desktop/electron/imageCacheMemory.cjs)
// and served over the same privileged gmcache:// scheme; feed query
// responses are cached in RAM with the same 10-minute TTL.
// init() destroys the legacy on-disk caches left by pre-1.1 installs
// (image-cache/ + meta.json + feed-cache.json) — one-time, force, silent.
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const mem = require('./imageCacheMemory.cjs')

const SCHEME = 'gmcache'
const MAX_SINGLE_BYTES = 25 * 1024 * 1024
const FEED_TTL_MS = 10 * 60 * 1000
const FEED_MAX_QUERIES = 40
const IMG_TIMEOUT_MS = 15_000

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', img: 'application/octet-stream',
}

let UA = 'Mozilla/5.0'
/** url -> { key, mime, bytes } (RAM only) */
let meta = {}
/** normQuery -> { posts, ts } (RAM only) */
let feed = {}

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function cacheFileName(url) {
  const m = /\.(jpe?g|png|gif|webp|mp4|webm)(?:[?#]|$)/i.exec(url)
  const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'img'
  return `${fnv1a(url)}.${ext}`
}

function normalizeQuery(q) {
  return String(q ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Destroy legacy on-disk caches (pre-memory builds). */
function destroyDiskCaches(userDataPath) {
  try { fs.rmSync(path.join(userDataPath, 'image-cache'), { recursive: true, force: true }) } catch { /* already clean */ }
  try { fs.rmSync(path.join(userDataPath, 'feed-cache.json'), { force: true }) } catch { /* already clean */ }
}

function init(userDataPath, userAgent) {
  if (userAgent) UA = userAgent
  destroyDiskCaches(userDataPath)
  meta = {}
  feed = {}
}

function stats() {
  return { files: mem.size(), bytes: mem.totalBytes() }
}

function fetchBinary(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(url)
    } catch {
      reject(new Error('bad url'))
      return
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      reject(new Error('bad protocol'))
      return
    }
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'image/*,video/*,*/*' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          fetchBinary(next, redirects - 1).then(resolve, reject)
          return
        }
        if (res.statusCode >= 400) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const type = String(res.headers['content-type'] || '')
        if (!/^(image|video)\//i.test(type)) {
          res.resume()
          reject(new Error(`not an image: ${type}`))
          return
        }
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          if (size > MAX_SINGLE_BYTES) {
            req.destroy(new Error('file too large'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ buf: Buffer.concat(chunks), mime: type }))
        res.on('error', reject)
      },
    )
    req.setTimeout(IMG_TIMEOUT_MS, () => req.destroy(new Error('image timeout')))
    req.on('error', reject)
  })
}

/**
 * Resolve a remote picture URL to a gmcache:// local URL.
 * Hit → touch (LRU) + return. Miss → download into RAM, return.
 * Returns null on any failure (renderer falls back to the remote URL).
 */
async function cacheImage(url) {
  try {
    if (!url) return null
    const hit = meta[url]
    if (hit && mem.get(hit.key)) return `${SCHEME}://f/${hit.key}`
    const { buf, mime } = await fetchBinary(url)
    const key = cacheFileName(url)
    if (!mem.put(key, buf)) return null // over budget: no local copy, remote URL stands
    meta[url] = { key, mime: mime || EXT_MIME[key.split('.').pop()] || 'application/octet-stream', bytes: buf.length }
    return `${SCHEME}://f/${key}`
  } catch {
    return null
  }
}

function clear() {
  mem.clear()
  meta = {}
  feed = {}
  return stats()
}

/** Feed-response cache: parsed posts per query, 10-minute TTL, RAM only. */
function getFeedCache(query) {
  try {
    const key = normalizeQuery(query)
    const hit = feed[key]
    if (!hit || !Array.isArray(hit.posts)) return null
    if (Date.now() - hit.ts >= FEED_TTL_MS) {
      delete feed[key]
      return null
    }
    return hit.posts
  } catch {
    return null
  }
}

function setFeedCache(query, posts) {
  try {
    if (!Array.isArray(posts) || posts.length === 0) return
    const key = normalizeQuery(query)
    feed[key] = { posts, ts: Date.now() }
    const keys = Object.keys(feed).sort((a, b) => feed[a].ts - feed[b].ts)
    while (keys.length > FEED_MAX_QUERIES) {
      delete feed[keys.shift()]
    }
  } catch {
    /* ignore */
  }
}

/**
 * protocol.handle('gmcache') handler — serves RAM buffers keyed by the
 * sanitized filename. Unknown/evicted key → 404 (renderer falls back remote).
 */
async function serveImage(request) {
  try {
    const u = new URL(request.url)
    const key = path.basename(u.pathname || u.host || '')
    if (!key || key.includes('..')) return new Response('bad file', { status: 400 })
    const buf = mem.get(key)
    if (!buf) return new Response('miss', { status: 404 })
    const mime = Object.values(meta).find((m) => m.key === key)?.mime || EXT_MIME[key.split('.').pop()] || 'application/octet-stream'
    return new Response(buf, { headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' } })
  } catch {
    return new Response('cache error', { status: 500 })
  }
}

module.exports = {
  SCHEME,
  init,
  cacheImage,
  cacheStats: stats,
  clearCache: clear,
  getFeedCache,
  setFeedCache,
  serveImage,
  // Test seam (pure-ish helpers; heavy IO stays in cacheImage/serveImage).
  _test: { fnv1a, cacheFileName, normalizeQuery, destroyDiskCaches },
}
