// gMatch image + feed-response cache (main process) — encrypted disk cache.
// Images stored AES-256-GCM encrypted in userData/imgcache/*.enc using the
// same storage.key as the API sidecar. Served over gmcache:// scheme.
// Feed query responses still cached in RAM with 10-minute TTL.
// init() destroys the legacy on-disk caches left by pre-1.1 installs
// (image-cache/ + meta.json + feed-cache.json) — one-time, force, silent.
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const mem = require('./diskImageCache.cjs')
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

/** Extension for the disk key, from the bytes' declared mime (not the url). */
function extForMime(mime, url) {
  const m = /^(image|video)\/([\w.+-]+)/i.exec(String(mime || ''))
  if (m) {
    const sub = m[2].toLowerCase()
    if (sub === 'jpeg') return 'jpg'
    if (['jpg', 'png', 'gif', 'webp', 'mp4', 'webm'].includes(sub)) return sub
  }
  const ext = cacheFileName(url).split('.').pop()
  return ext || 'img'
}

let UA = 'Mozilla/5.0'
/**
 * url -> { key, mime, bytes, ts }
 *
 * RAM mirror of the PERSISTED index (`<userData>/imgcache/index.json`). The
 * bytes live in the encrypted .enc files; this map says which url is which
 * file. It used to live in RAM only, which made the cache write-only across
 * restarts: every picture was re-downloaded and the 500MB on disk could not
 * be reached (nor listed by the cache viewer).
 */
let meta = {}
/** normQuery -> { posts, ts } (RAM only) */
let feed = {}
/** Where the url index is persisted (null = not initialised). */
let indexPath = null
/** The index is a cache, not an archive: keep the newest entries only. */
const INDEX_MAX_ENTRIES = 2000

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
  // Underscores and spaces name the same tag (skylar_vox == skylar vox):
  // canonicalize so both spellings share one memo slot.
  return String(q ?? '')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Destroy legacy on-disk caches (pre-1.1 builds).
 *
 * One-time per install, not once per boot. A recursive remove of a path that
 * no longer exists is cheap, but a pre-1.1 install can leave hundreds of MB
 * behind, and paying that on every launch is disk work nobody asked for. The
 * marker makes it the migration it was always documented to be.
 */
function destroyDiskCaches(userDataPath) {
  const marker = path.join(userDataPath, '.legacy-cache-purged')
  try { if (fs.existsSync(marker)) return } catch { /* fall through and try */ }
  try { fs.rmSync(path.join(userDataPath, 'image-cache'), { recursive: true, force: true }) } catch { /* already clean */ }
  try { fs.rmSync(path.join(userDataPath, 'feed-cache.json'), { force: true }) } catch { /* already clean */ }
  try { fs.writeFileSync(marker, new Date().toISOString()) } catch { /* retry next boot */ }
}

/**
 * Persist the url -> file map next to the encrypted bytes.
 *
 * The map is what makes the cache reachable after a restart (and what the
 * cache viewer lists). It is written as a flat array of rows; the newest
 * entries win when the cap is hit.
 */
function saveIndex() {
  if (!indexPath) return
  try {
    const rows = Object.entries(meta)
      .map(([url, m]) => ({ url, key: m.key, hash: m.hash || '', mime: m.mime, bytes: m.bytes, ts: m.ts || 0 }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, INDEX_MAX_ENTRIES)
    fs.writeFileSync(indexPath, JSON.stringify(rows), 'utf8')
  } catch {
    /* the index is a cache: a failed write is not fatal */
  }
}

/**
 * Load the persisted url -> file map.
 *
 * An entry whose .enc file is gone (the LRU evicted it while the app was
 * closed, or the user cleared the cache) is DROPPED: keeping it would make
 * `cacheImage` answer a gmcache:// URL that 404s forever.
 */
function loadIndex() {
  meta = {}
  if (!indexPath) return
  try {
    if (!fs.existsSync(indexPath)) return
    const rows = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    if (!Array.isArray(rows)) return
    for (const r of rows) {
      const url = typeof r?.url === 'string' ? r.url : ''
      const key = typeof r?.key === 'string' ? r.key : ''
      if (!url || !key || !mem.has(key)) continue
      meta[url] = {
        key,
        // Old indexes predate content keys; the hash is recoverable from a
        // sha256-prefixed key, and stays empty for a legacy url-hash file.
        hash: typeof r.hash === 'string' && r.hash
          ? r.hash
          : (/^[0-9a-f]{64}/i.test(key) ? key.slice(0, 64) : ''),
        mime: typeof r.mime === 'string' ? r.mime : 'application/octet-stream',
        bytes: Number(r.bytes) || 0,
        ts: Number(r.ts) || 0,
      }
    }
  } catch {
    /* a corrupt index is not fatal: the cache simply starts empty */
  }
}

function init(userDataPath, userAgent, storageKeyHex) {
  if (userAgent) UA = userAgent
  destroyDiskCaches(userDataPath)
  mem.init(userDataPath, storageKeyHex)
  indexPath = path.join(userDataPath, 'imgcache', 'index.json')
  loadIndex()
  feed = {}
}

function stats() {
  return { files: mem.size(), bytes: mem.totalBytes() }
}

/**
 * What the device holds, newest first.
 *
 * The cache viewer's data source: every cached picture with its local
 * (gmcache://) url, so the picture renders from disk and can be saved to the
 * gallery without touching the network.
 *
 * An entry whose bytes the LRU dropped mid-session is PRUNED here: the
 * viewer must never show a tile whose local url 404s.
 */
function list() {
  let pruned = false
  const byContent = new Map()
  for (const [url, m] of Object.entries(meta)) {
    if (!mem.has(m.key)) {
      delete meta[url]
      pruned = true
      continue
    }
    const row = {
      url,
      local: `${SCHEME}://f/${m.key}`,
      hash: m.hash || (/^[0-9a-f]{64}/i.test(m.key) ? m.key.slice(0, 64) : ''),
      mime: m.mime,
      bytes: m.bytes,
      ts: m.ts || 0,
    }
    // One picture, one tile: mirrors serving identical bytes share a content
    // hash AND a single .enc file. Keep the newest sighting so a viewer that
    // clicks a row still lands on a url that resolves from disk.
    const id = row.hash || row.local
    const prev = byContent.get(id)
    if (!prev || row.ts > prev.ts) byContent.set(id, row)
  }
  if (pruned) saveIndex()
  return [...byContent.values()].sort((a, b) => b.ts - a.ts)
}

function getReferer(url) {
  if (typeof url !== 'string') return undefined
  try {
    const u = new URL(url)
    if (url.includes('imhentai.xxx')) return 'https://imhentai.xxx/'
    if (url.includes('paheal')) return 'https://rule34.paheal.net/'
    if (url.includes('realbooru.com')) return 'https://realbooru.com/'
    if (url.includes('booru.org')) return 'https://booru.org/'
    if (url.includes('xbooru.com')) return 'https://xbooru.com/'
    if (url.includes('redgifs.com')) return 'https://www.redgifs.com/'
    if (url.includes('twimg.com')) return 'https://twitter.com/'
    return u.origin + '/'
  } catch {
    return undefined
  }
}

/**
 * Byte ceiling for a fetched buffer. Videos get the big cap; everything else
 * the small one. The response MIME is the primary signal, but hosts routinely
 * serve mp4s as application/octet-stream — trusting only the MIME gave a 40MB
 * clip the 25MB image cap, and it was dropped instead of stored.
 */
function capFor(mime, url) {
  const isVideo =
    /^video\//i.test(String(mime || '')) ||
    /\.(mp4|webm|mov|mkv|gifv)(?:[?#]|$)/i.test(String(url || ''))
  return isVideo ? MAX_SINGLE_VIDEO_BYTES : MAX_SINGLE_BYTES
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
      const cap = capFor(type, url)
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
          const cap = capFor(type, url)
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
    // Content-addressed: two urls serving the same bytes share ONE encrypted
    // file. A repeat only refreshes recency, so a re-view costs no rewrite.
    // Files are keyed by content hash only; the MIME is metadata on the row.
    const stored = mem.putContent(buf)
    if (!stored) return null // over budget: no local copy, remote URL stands
    meta[url] = {
      key: stored.key,
      hash: stored.hash,
      mime: mime || 'application/octet-stream',
      bytes: buf.length,
      ts: Date.now(),
    }
    saveIndex()
    return `${SCHEME}://f/${stored.key}`
  } catch {
    return null
  }
}

function clear() {
  mem.clear()
  meta = {}
  feed = {}
  // The index lives INSIDE the cache dir, so mem.clear() already removed it;
  // write an empty one so the next boot does not read a stale file.
  saveIndex()
  return stats()
}

/** Drop all memoized feed lists (bytes untouched): tag intent changed
 * (solo/remove/deselect) so old-tag query slots must not serve again. */
function clearFeedCache() {
  const n = Object.keys(feed).length
  feed = {}
  return { cleared: n }
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
      saveIndex()
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
 *
 * `gmcache://thumb/<key>` serves a DOWNSCALED copy instead of the full-size
 * picture. A gallery of 70 full-res boorus is ~1.2 GB of decoded bitmaps; a
 * 360px thumbnail is ~0.2 MB and decodes in a fraction of the time, which is
 * what the cache viewer, the tag browser and the gallery grids actually show.
 * Thumbs are generated on demand in the main process (Electron's built-in
 * `nativeImage`, no new dependency), kept in a small LRU, and never written to
 * disk — the encrypted originals remain the only durable copy.
 */
const THUMB_MAX_EDGE = 360
const THUMB_LRU_MAX = 400
const THUMB_MIME = 'image/jpeg'
const thumbs = new Map()

function thumbCacheGet(key) {
  const hit = thumbs.get(key)
  if (!hit) return null
  // Refresh recency (Map keeps insertion order; a read moves it to the end).
  thumbs.delete(key)
  thumbs.set(key, hit)
  return hit
}

function thumbCacheSet(key, buf) {
  thumbs.set(key, buf)
  while (thumbs.size > THUMB_LRU_MAX) {
    const oldest = thumbs.keys().next().value
    if (oldest === undefined) break
    thumbs.delete(oldest)
  }
}

/** Downscale picture bytes to a small JPEG. Returns null when not possible. */
function makeThumb(buf, mime) {
  // Content keys carry no extension now: the MIME from the url index is the
  // signal. Videos and unknown blobs have no thumbnail and fall through to the
  // original bytes, so a <video> poster still works.
  if (!/^image\//i.test(String(mime || ''))) return null
  let image = null
  try {
    const { nativeImage } = require('electron')
    image = nativeImage.createFromBuffer(buf)
  } catch {
    return null
  }
  if (!image || image.isEmpty()) return null
  const size = image.getSize()
  const longest = Math.max(size.width, size.height)
  if (!longest || longest <= THUMB_MAX_EDGE) {
    // Already small enough: re-encoding would only cost CPU.
    return buf
  }
  const ratio = THUMB_MAX_EDGE / longest
  try {
    return image.resize({
      width: Math.max(1, Math.round(size.width * ratio)),
      height: Math.max(1, Math.round(size.height * ratio)),
      quality: 'good',
    }).toJPEG(72)
  } catch {
    return null
  }
}

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
    const wantsThumb = u.host === 'thumb'
    const key = path.basename(u.pathname || u.host || '')
    if (!key || key.includes('..')) return new Response('bad file', { status: 400 })
    const buf = mem.get(key)
    if (!buf) return new Response('miss', { status: 404 })
    const mime = Object.values(meta).find((m) => m.key === key)?.mime || EXT_MIME[key.split('.').pop()] || 'application/octet-stream'
    if (wantsThumb) {
      let thumb = thumbCacheGet(key)
      if (!thumb) {
        thumb = makeThumb(buf, mime)
        if (thumb) thumbCacheSet(key, thumb)
      }
      if (thumb) {
        return new Response(thumb, {
          headers: {
            'Content-Type': thumb === buf ? mime : THUMB_MIME,
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
      // No thumbnail possible (a video): fall through and serve the original,
      // so a poster/first frame still renders.
    }
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

/** Test seam: plant a url -> file entry (no network, no bytes). */
function setMeta(url, entry) {
  if (!url || !entry?.key) return false
  meta[url] = { key: entry.key, hash: entry.hash || '', mime: entry.mime || 'application/octet-stream', bytes: Number(entry.bytes) || 0, ts: Number(entry.ts) || Date.now() }
  return true
}

/** Test seam: plant bytes in the encrypted store under a key. */
function putBytes(key, buf) {
  if (!key || !buf) return false
  if (!mem.put(key, buf)) return false
  return true
}

/** Test seam (pure-ish helpers; heavy IO stays in cacheImage/serveImage). */
module.exports = {
  SCHEME,
  init,
  fetchBinary,
  cacheImage,
  cacheStats: stats,
  list,
  clearCache: clear,
  clearFeedCache,
  evict,
  getFeedCache,
  setFeedCache,
  serveImage,
  capFor,
  // Test seam (pure-ish helpers; heavy IO stays in cacheImage/serveImage).
  _test: { fnv1a, cacheFileName, normalizeQuery, destroyDiskCaches, capFor, setMeta, putBytes, saveIndex, extForMime },
}
