// GoonGrid image + feed-response cache (main process).
// Pictures live on disk under the OS user folder:
//   <userData>/image-cache/<fnv1a(url)>.<ext>  +  meta.json
// (<userData> on Windows = C:\Users\<user>\AppData\Roaming\goongrid.)
// Feed responses (parsed post lists per normalized query) live in
// <userData>/feed-cache.json with a 10-minute TTL, so repeat tag queries
// never re-hit the booru APIs. Served to the renderer over IPC +
// the privileged gooncache:// scheme. Best-effort: every failure returns
// null so the renderer falls back to the remote URL.
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const SCHEME = 'gooncache'
const MAX_FILES = 400
const MAX_BYTES = 400 * 1024 * 1024
const MAX_SINGLE_BYTES = 25 * 1024 * 1024
const FEED_TTL_MS = 10 * 60 * 1000
const FEED_MAX_QUERIES = 100
const IMG_TIMEOUT_MS = 15_000

let UA = 'Mozilla/5.0'
let cacheDir = null
let metaPath = null
let feedPath = null
/** url -> { file, bytes, addedAt, lastUsed } */
let meta = {}
/** normQuery -> { posts, ts } */
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

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data))
  } catch {
    /* cache is best-effort */
  }
}

function init(userDataPath, userAgent) {
  if (userAgent) UA = userAgent
  cacheDir = path.join(userDataPath, 'image-cache')
  metaPath = path.join(cacheDir, 'meta.json')
  feedPath = path.join(userDataPath, 'feed-cache.json')
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
  } catch {
    /* without a dir every op below degrades to null */
  }
  const m = readJson(metaPath, {})
  meta = m && typeof m === 'object' ? m : {}
  const f = readJson(feedPath, {})
  feed = f && typeof f === 'object' ? f : {}
}

function persistMeta() {
  if (metaPath) writeJson(metaPath, meta)
}

function persistFeed() {
  if (feedPath) writeJson(feedPath, feed)
}

function stats() {
  let files = 0
  let bytes = 0
  for (const e of Object.values(meta)) {
    files += 1
    bytes += Number(e.bytes) || 0
  }
  return { files, bytes }
}

/** Delete oldest-lastUsed entries until both caps fit. */
function evictIfNeeded() {
  const keys = Object.keys(meta).sort((a, b) => (meta[a].lastUsed || 0) - (meta[b].lastUsed || 0))
  let { files, bytes } = stats()
  for (const k of keys) {
    if (files <= MAX_FILES && bytes <= MAX_BYTES) break
    try {
      fs.unlinkSync(path.join(cacheDir, meta[k].file))
    } catch {
      /* already gone */
    }
    bytes -= Number(meta[k].bytes) || 0
    files -= 1
    delete meta[k]
  }
  persistMeta()
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
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      },
    )
    req.setTimeout(IMG_TIMEOUT_MS, () => req.destroy(new Error('image timeout')))
    req.on('error', reject)
  })
}

/**
 * Resolve a remote picture URL to a gooncache:// local URL.
 * Hit → touch + return. Miss → download, store, evict, return.
 * Returns null on any failure (renderer uses the remote URL).
 */
async function cacheImage(url) {
  try {
    if (!url || !cacheDir) return null
    const now = Date.now()
    const hit = meta[url]
    if (hit && hit.file) {
      const abs = path.join(cacheDir, path.basename(hit.file))
      if (fs.existsSync(abs)) {
        hit.lastUsed = now
        persistMeta()
        return `${SCHEME}://f/${path.basename(hit.file)}`
      }
      delete meta[url]
    }
    const buf = await fetchBinary(url)
    const file = cacheFileName(url)
    fs.writeFileSync(path.join(cacheDir, file), buf)
    meta[url] = { file, bytes: buf.length, addedAt: now, lastUsed: now }
    evictIfNeeded()
    return `${SCHEME}://f/${file}`
  } catch {
    return null
  }
}

function clear() {
  try {
    for (const e of Object.values(meta)) {
      try {
        fs.unlinkSync(path.join(cacheDir, path.basename(e.file)))
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  meta = {}
  persistMeta()
  return stats()
}

/** Feed-response cache: parsed posts per query, 10-minute TTL. */
function getFeedCache(query) {
  try {
    const key = normalizeQuery(query)
    const hit = feed[key]
    if (!hit || !Array.isArray(hit.posts)) return null
    if (Date.now() - hit.ts >= FEED_TTL_MS) {
      delete feed[key]
      persistFeed()
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
    persistFeed()
  } catch {
    /* ignore */
  }
}

/**
 * protocol.handle('gooncache') handler. Only serves files inside the cache
 * dir (basename check) — never arbitrary paths.
 */
async function serveImage(request, net) {
  try {
    const u = new URL(request.url)
    const file = path.basename(u.pathname || u.host || '')
    if (!file || file.includes('..')) return new Response('bad file', { status: 400 })
    const abs = path.join(cacheDir, file)
    const real = path.resolve(abs)
    if (!real.startsWith(path.resolve(cacheDir))) return new Response('forbidden', { status: 403 })
    if (!fs.existsSync(real)) return new Response('miss', { status: 404 })
    return net.fetch(`file:///${real.replace(/\\/g, '/')}`)
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
  _test: { fnv1a, cacheFileName, normalizeQuery },
}
