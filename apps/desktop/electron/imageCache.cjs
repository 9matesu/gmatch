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
let electronNet = null
try {
  electronNet = require('electron').net
} catch {
  /* running outside electron (e.g. node test) */
}

const SCHEME = 'gmcache'
const MAX_SINGLE_BYTES = 25 * 1024 * 1024
// Same rule as vault.cjs: parsed videos (80MB+ mp4s) must not be rejected
// at fetch time or the vault never sees them.
const MAX_SINGLE_VIDEO_BYTES = 200 * 1024 * 1024
// ponytail: 10min list TTL — a deduped query must refresh; the 24h "one call"
// guarantee lives in the image-BYTES cache, not the feed list.
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

function getReferer(url) {
  if (typeof url !== 'string') return undefined
  try {
    const u = new URL(url)
    if (url.includes('imhentai.xxx')) return 'https://imhentai.xxx/'
    if (url.includes('paheal')) return 'https://rule34.paheal.net/'
    if (url.includes('realbooru.com')) return 'https://realbooru.com/'
    if (url.includes('booru.org')) return 'https://booru.org/'
    return u.origin + '/'
  } catch {
    return undefined
  }
}

async function fetchBinary(url, redirects = 3) {
  let u
  try {
    u = new URL(url)
  } catch {
    throw new Error('bad url')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('bad protocol')
  }

  const ref = getReferer(url)
  const reqHeaders = {
    'User-Agent': UA,
    Accept: 'image/*,video/*,*/*',
    ...(ref ? { Referer: ref } : {}),
  }

  if (electronNet && typeof electronNet.fetch === 'function') {
    try {
      const res = await electronNet.fetch(url, {
        headers: reqHeaders,
        redirect: 'follow',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const type = String(res.headers.get('content-type') || '')
      const isOctet = type.includes('octet-stream')
      const hasMediaExt = /\.(jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov)(\?|#|$)/i.test(url)
      if (!/^(image|video)\//i.test(type) && !(isOctet && hasMediaExt)) {
        throw new Error(`not an image: ${type}`)
      }
      const ab = await res.arrayBuffer()
      const buf = Buffer.from(ab)
      // Videos get a bigger ceiling (vault pins parsed mp4s 80MB+); see
      // vault.cjs MAX_SINGLE_VIDEO_BYTES for the same rule at store time.
      const cap = /^video\//i.test(type) ? MAX_SINGLE_VIDEO_BYTES : MAX_SINGLE_BYTES
      if (buf.length > cap) {
        throw new Error('file too large')
      }
      return { buf, mime: type || 'application/octet-stream' }
    } catch (err) {
      if (err && /HTTP \d+/.test(err.message)) throw err
      if (err && /file too large/.test(err.message)) throw err
      /* fallback to node http/https */
    }
  }

  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(
      url,
      { headers: reqHeaders },
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
        const isOctet = type.includes('octet-stream')
        const hasMediaExt = /\.(jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov)(\?|#|$)/i.test(url)
        if (!/^(image|video)\//i.test(type) && !(isOctet && hasMediaExt)) {
          res.resume()
          reject(new Error(`not an image: ${type}`))
          return
        }
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          const cap = /^video\//i.test(String(type)) ? MAX_SINGLE_VIDEO_BYTES : MAX_SINGLE_BYTES
          if (size > cap) {
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

    const urlsToTry = [url]
    if (url.includes('realbooru.com/images/')) {
      const rbMatch = url.match(/https:\/\/realbooru\.com\/images\/([^/]+)\/([^/]+)\/([^.]+)\.(jpg|jpeg|png|gif|mp4|webm)/i)
      if (rbMatch) {
        const [, d1, d2, h, ext] = rbMatch
        const lower = ext.toLowerCase()
        const alts = ['jpeg', 'jpg', 'png', 'gif'].filter((e) => e !== lower)
        for (const a of alts) {
          urlsToTry.push(`https://realbooru.com/images/${d1}/${d2}/${h}.${a}`)
        }
        urlsToTry.push(`https://realbooru.com/thumbnails/${d1}/${d2}/thumbnail_${h}.jpg`)
      }
    }

    let fetched = null
    for (const tryUrl of urlsToTry) {
      try {
        fetched = await fetchBinary(tryUrl)
        if (fetched) break
      } catch {
        /* try next fallback */
      }
    }
    if (!fetched) return null

    const { buf, mime } = fetched
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

/** Evict a single image from cache and free its memory. Also prunes any cached feed lists. */
function evict(url) {
  try {
    if (!url) return false
    for (const q in feed) {
      if (feed[q] && Array.isArray(feed[q].posts)) {
        feed[q].posts = feed[q].posts.filter((p) => p && p.url !== url)
      }
    }
    const hit = meta[url]
    if (hit) {
      mem.del(hit.key)
      delete meta[url]
      return true
    }
    return false
  } catch {
    return false
  }
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
    const buf = mem.get(key)
    if (!buf) return new Response('miss', { status: 404 })
    const mime = Object.values(meta).find((m) => m.key === key)?.mime || EXT_MIME[key.split('.').pop()] || 'application/octet-stream'
    // Range support: <video> seeking re-requests with Range; answering 200
    // every time makes a cached mp4 re-download the whole blob per seek.
    const range = request.headers.get('range')
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range)
    if (m && (m[1] || m[2])) {
      const total = buf.length
      const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]))
      const end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
      if (start <= end && end < total) {
        return new Response(buf.slice(start, end + 1), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(end - start + 1),
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
    }
    return new Response(buf, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
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
  init,
  fetchBinary,
  cacheImage,
  cacheStats: stats,
  clearCache: clear,
  evict,
  getFeedCache,
  setFeedCache,
  serveImage,
  // Test seam (pure-ish helpers; heavy IO stays in cacheImage/serveImage).
  _test: { fnv1a, cacheFileName, normalizeQuery, destroyDiskCaches },
}
