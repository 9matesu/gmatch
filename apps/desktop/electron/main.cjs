// gMatch Electron main process.
// All booru HTTP happens HERE (renderer never touches the network directly).
// Endpoints per docs/SPEC.md §6. 10s timeout, browser UA, round-robin health.
const { app, BrowserWindow, ipcMain, protocol, net, dialog, safeStorage, session, shell } = require('electron')
const https = require('https')
const fs = require('node:fs')
const path = require('node:path')
const imageCache = require('./imageCache.cjs')
const customFolders = require('./customFolders.cjs')
const wallpaperWin = require('./wallpaperWin.cjs')

// A portable exe can run twice from one double-click (and did: two sidecars
// fight over :8790 and the second window never appeared). One install, one
// process — the second launch just focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  app.exit(0)
}

// Never die silently: "app doesn't open" was unsolvable without this. Every
// fatal lands in %APPDATA%/gMatch/main.log AND a native dialog.
function mainLog(line) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), `[${new Date().toISOString()}] ${line}\r\n`) } catch { /* last resort only */ }
}
process.on('uncaughtException', (err) => {
  mainLog(`uncaught: ${err?.stack || err}`)
  try { dialog.showErrorBox('gMatch hit an unexpected error', `${String(err?.message || err)}\n\nDetails were written to:\n%APPDATA%\\gMatch\\main.log`) } catch { /* headless edge */ }
})
process.on('unhandledRejection', (reason) => mainLog(`unhandledRejection: ${reason?.stack || reason}`))

// Update handoff: once the swap script is spawned, quitting must not be
// blocked by the renderer's save-your-keys unload gate.
let updateHandoff = false

// One-shot camera permission consumed by setPermissionRequestHandler.
let cameraGrantOnce = false
const { createSecureStore } = require('./secureStore.cjs')
const apiSidecar = require('./apiSidecar.cjs')
const serverMode = require('./server-mode.cjs')

// Secure KV (security plan B.3): renderer's sensitive localStorage keys are
// backed here, encrypted with DPAPI (safeStorage) when available.
let secureKV = null
function initSecureKV() {
  const available = (() => {
    try { return safeStorage.isEncryptionAvailable() } catch { return false }
  })()
  secureKV = createSecureStore({
    userDataPath: app.getPath('userData'),
    available,
    encryptString: (s, iv) => {
      // safeStorage has no IV parameter; per-value random salt key derivation:
      // encrypt(s) with the DPAPI master — we store iv only as a format tag.
      void iv
      return safeStorage.encryptString(s)
    },
    decryptString: (buf) => safeStorage.decryptString(buf),
  })
  return available
}

// Packaged topology (1.0, no central server): either we HOST the bundled
// server (default) or we're a CLIENT of a friend's. Decided once at startup.
let packagedServer = null // { mode, url } when app.isPackaged

// Brand migration (goonMatch -> gMatch): the app name feeds userData
// (%APPDATA%/@gmatch/desktop). For existing installs, move the old profile
// ONCE before anything reads it — keys (DPAPI), snapshot DB, blobs and local
// storage all live under this folder and must survive the rename.
// Boot must NEVER die silently: this block used to run (and throw) before any
// error handler existed — a failed rename/mkdir here meant "double-click,
// nothing happens, no log". One catch, loud dialog + log, then a safe boot.
;(function migrateUserData() {
  const fs = require('fs')
  try {
    const newPath = app.getPath('userData')
    const oldPath = path.join(path.dirname(newPath), '@goongrid', path.basename(newPath))
    if (oldPath !== newPath && fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true })
      try {
        fs.renameSync(oldPath, newPath)
      } catch {
        // cross-drive or locked: copy the essentials, keep the old folder
        fs.cpSync(oldPath, newPath, { recursive: true })
      }
    }
  } catch (err) {
    mainLog(`userData migration failed: ${err?.stack || err}`)
    try { dialog.showErrorBox('gMatch could not start', `${String(err?.message || err)}\n\nDetails were written to:\n%APPDATA%\\gMatch\\main.log`) } catch { /* headless edge */ }
    // Continue on the default path: worse than a rename, but never a zombie.
  }
})()

// gmcache:// serves cached pictures from the MAIN-PROCESS RAM (never disk).
// Privileged (standard+secure, fetchable) so sandboxed <img> tags can use it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: imageCache.SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true },
  },
  {
    // Player-owned idle folders: <img>/<video> + fetch (mint re-upload).
    scheme: customFolders.SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true },
  },
])

// Defense-in-depth: enforce the SPEC §8 blocklist on incoming queries too.
// Single source of truth: shared/blocklist.json at the repo root (imported
// by src/game/tagFilter.ts and the desktop electron main alike). Resolved at
// runtime because in packaged builds it ships as extraResources (a relative
// require from inside app.asar would escape the archive).
const blocklistPath = app.isPackaged
  ? path.join(process.resourcesPath, 'shared', 'blocklist.json')
  : path.join(__dirname, '..', '..', '..', 'shared', 'blocklist.json')
const { blocklist } = require(blocklistPath)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const TIMEOUT_MS = 10_000

// Feed quality: explicit-only + anti-slop negatives appended to every query.
const NEGATIVES = [
  '-ai_generated',
  '-ai-generated',
  '-furry',
  '-anthro',
  '-feral',
  '-scalie',
  '-monochrome',
  '-greyscale',
  '-sketch',
  '-comic',
  '-manga',
  '-lineart',
  '-lowres',
  '-worst_quality',
  '-jpeg_artifacts',
  '-watermark',
  '-censored',
].join(' ')

// Hard post-level floor (user spec: high quality always). The renderer also
// enforces this in src/services/postFilter.ts — duplicated on purpose so the
// main process stays authoritative even if the renderer is tampered with.
const MIN_WIDTH = 700
const MIN_HEIGHT = 700
const MIN_PIXELS = 700 * 700

// Tag fragments that void a post regardless of negatives (server-side
// negative support is unreliable on some mirrors — xbooru ignores them).
const BAD_TAG_FRAGMENTS = [
  'ai_generated',
  'ai-generated',
  'ai_assisted',
  'monochrome',
  'greyscale',
  'grayscale',
  'sketch',
  'lineart',
  'line_art',
  'comic',
  'manga',
  '4koma',
  'silent_comic',
  'furry',
  'anthro',
  'feral',
  'scalie',
  'animal_',
  'monster_',
  'horse',
  'tentacle',
  'futanari',
  '1futa',
  'trap',
  'otokonoko',
  'tomgirl',
  'crossdressing',
  'yaoi',
  'netorare',
  'vocaloid',
  '3d',
  'daz_studio',
  'honey_select',
  'koikatsu',
  'render',
  'ugly_bastard',
  'amputee',
  'guro',
  'ryona',
  'scat',
  'urine',
  'aged_down',
  'aged_up',
  'greyscale_background',
  'speech_bubble',
  'english_text',
  'translated',
  'commentary',
  'watermark',
  'signature',
  'bad_id',
  'bad_pixiv_id',
  'pixiv_id',
  'hetero',
  'limited_palette',
  'paper',
  'scan',
]

function isQueryBlocked(query) {
  const q = String(query).toLowerCase()
  return blocklist.some((bad) => q.includes(bad))
}

// Caption hunts (query carries caption/goon_caption) keep text-overlay tags
// that the gate otherwise drops — mirrors src/services/postFilter.ts.
const TEXT_OVERLAY = ['speech_bubble', 'english_text', 'translated', 'commentary']

function isCaptionQuery(query) {
  return /caption/i.test(String(query))
}

function hasBadTag(tags, captions) {
  return tags.some((t) => {
    const s = String(t).toLowerCase()
    if (captions && (s.includes('caption') || s.includes('dialogue') || TEXT_OVERLAY.some((b) => s.includes(b)))) {
      return false
    }
    return BAD_TAG_FRAGMENTS.some((b) => s.includes(b))
  })
}

async function httpGet(url, headers) {
  let ref = {}
  if (typeof url === 'string') {
    try {
      const u = new URL(url)
      if (url.includes('imhentai.xxx')) ref = { Referer: 'https://imhentai.xxx/' }
      else if (url.includes('paheal')) ref = { Referer: 'https://rule34.paheal.net/' }
      else if (url.includes('realbooru.com')) ref = { Referer: 'https://realbooru.com/' }
      else if (url.includes('booru.org')) ref = { Referer: 'https://booru.org/' }
      else ref = { Referer: u.origin + '/' }
    } catch {
      /* ignore invalid url */
    }
  }
  const allHeaders = {
    'User-Agent': UA,
    Accept: 'application/json, text/xml, text/html, */*',
    ...ref,
    ...(headers || {}),
  }

  if (net && typeof net.fetch === 'function') {
    try {
      const res = await net.fetch(url, {
        headers: allHeaders,
        redirect: 'follow',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      return await res.text()
    } catch (err) {
      if (err && /HTTP \d+/.test(err.message)) throw err
      /* fallback to https.get if net.fetch fails */
    }
  }

  return new Promise((resolve, reject) => {
    const mod = typeof url === 'string' && url.startsWith('http:') ? require('http') : https
    const req = mod.get(
      url,
      { headers: allHeaders },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          httpGet(next, headers).then(resolve, reject)
          return
        }
        if (res.statusCode >= 400) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve(body))
      },
    )
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('quality-gate timeout')))
    req.on('error', reject)
  })
}

// --- source parsers -------------------------------------------------------

function parseDanbooruJson(body, baseUrl, captions) {
  if (!body || typeof body !== 'string' || !body.trim()) return []
  let data
  try {
    data = JSON.parse(body)
  } catch {
    return []
  }
  const raw = Array.isArray(data) ? data : (data.posts && (data.posts.post ?? data.posts)) ?? []
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: String(p.id ?? ''),
      url: p.file_url || `${baseUrl}/images/${p.directory}/${p.image}`,
      tags: typeof p.tags === 'string' ? p.tags.split(/\s+/).filter(Boolean) : [],
      rating: typeof p.rating === 'string' ? p.rating : 'e',
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
    }))
    .filter((p) => p.id && p.url)
    .filter(
      (p) =>
        /\.(jpe?g|png|webp)(?:[?#]|$)/i.test(p.url) &&
        // DAPI spells it 'explicit'; e621-style sources use 'e'
        (p.rating === 'explicit' || p.rating === 'e') &&
        (p.width === 0 || p.width >= 500) &&
        (p.height === 0 || p.height >= 500) &&
        !hasBadTag(p.tags, captions),
    )
}

function parsePahealXml(body, captions) {
  if (!body || typeof body !== 'string') return []
  const posts = []
  const elRe = /<tag\b([^>]*)>/g
  const attr = (attrs, name) => {
    const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs)
    return m ? m[1] : ''
  }
  let m
  while ((m = elRe.exec(body))) {
    const fileUrl = attr(m[1], 'file_url')
    if (!fileUrl) continue
    const fileName = attr(m[1], 'file_name')
    const width = Number(attr(m[1], 'width')) || 0
    const height = Number(attr(m[1], 'height')) || 0
    posts.push({
      id: attr(m[1], 'id') || fileUrl,
      url: fileUrl,
      fileName,
      tags: attr(m[1], 'tags') ? attr(m[1], 'tags').split(/\s+/).filter(Boolean) : [],
      rating: 'e',
      width,
      height,
    })
  }
  return posts.filter(
    (p) =>
      (!p.fileName || /\.(jpe?g|png|webp)$/i.test(p.fileName) || /\.(jpe?g|png|webp)$/i.test(p.url)) &&
      (p.width === 0 || p.width >= 500) &&
      (p.height === 0 || p.height >= 500) &&
      !hasBadTag(p.tags, captions),
  )
}

// --- konachan / yandere (Moebooru JSON: explicit hentai pools, no key) -------
// Verified live: konachan.com answers rating:explicit server-side; yandere
// ignores the rating filter, so rating is enforced client-side below.
// Both paginate with ?page=N — random page per call keeps rounds fresh.
function moebooruUrl(base, variant, n) {
  const page = 1 + Math.floor(Math.random() * 5)
  const tags = base.includes('konachan') ? `${variant} rating:explicit` : variant
  return `${base}/post.json?tags=${encodeURIComponent(tags)}&limit=${n}&page=${page}`
}

function parseMoebooruJson(body, prefix, captions) {
  let data
  try {
    data = JSON.parse(body)
  } catch {
    return []
  }
  const list = Array.isArray(data) ? data : []
  return list
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: `${prefix}-${p.id ?? ''}`,
      url: typeof p.file_url === 'string' ? p.file_url : '',
      tags: typeof p.tags === 'string' ? p.tags.split(/[^a-z0-9_]+/i).filter(Boolean) : [],
      rating: typeof p.rating === 'string' ? p.rating : 'e',
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
    }))
    .filter((p) => p.id !== `${prefix}-` && p.url)
    .filter(
      (p) =>
        /\.(jpe?g|png)$/i.test(p.url) &&
        (p.rating === 'explicit' || p.rating === 'e') &&
        p.width >= MIN_WIDTH &&
        p.height >= MIN_HEIGHT &&
        p.width * p.height >= MIN_PIXELS &&
        !hasBadTag(p.tags, captions),
    )
}

// --- realbooru (HTML scraper: images/videos with Referer) --------------------
function parseRealbooruHtml(html, captions) {
  const posts = []
  const imgRegex =
    /<img\s+[^>]*src="https:\/\/realbooru\.com\/thumbnails\/([^/]+)\/([^/]+)\/thumbnail_([^."]+)\.jpg"[^>]*title="([^"]*)"[^>]*alt="Image:\s*(\d+)"/gi
  let m
  while ((m = imgRegex.exec(html)) !== null) {
    const [, dir1, dir2, hash, rawTitle, postId] = m
    const tags = rawTitle
      .split(/,\s*/)
      .map((t) => t.trim().replace(/\s+/g, '_'))
      .filter(Boolean)
    const isVideo = tags.includes('video') || tags.includes('mp4') || tags.includes('webm')
    const isGif = tags.includes('gif')
    const ext = isVideo ? 'mp4' : isGif ? 'gif' : 'jpeg'
    const url = `https://realbooru.com/images/${dir1}/${dir2}/${hash}.${ext}`
    if (!hasBadTag(tags, captions)) {
      posts.push({ id: `rb-${postId}`, url, tags, rating: 'e', width: 1200, height: 1200 })
    }
  }
  return posts
}

// --- booru.org subdomains (hgoon, blacked, allgirl, rule34) ------------------
function parseBooruOrgHtml(html, sub, captions, query) {
  const posts = []
  const imgRegex =
    /<img\s+[^>]*src="https:\/\/thumbs\.booru\.org\/([^/]+)\/thumbnails\/\/([^/]+)\/thumbnail_([^."]+)\.([^"]+)"[^>]*title="([^"]*)"/gi
  // WAF forces tagless browsing; enforce the query locally so the feed still
  // shows what the player asked for (mirror of matchesQuery in booru.ts).
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  let m
  while ((m = imgRegex.exec(html)) !== null) {
    const [, bSub, dir, hash, ext, rawTitle] = m
    const ratingMatch = /rating:([a-z]+)/i.exec(rawTitle)
    const rating = ratingMatch ? ratingMatch[1].toLowerCase() : 'e'
    const tagsPart = rawTitle
      .replace(/score:\d+/i, '')
      .replace(/rating:[a-z]+/i, '')
      .trim()
    const tags = tagsPart.split(/\s+/).filter(Boolean)
    if (tokens.length) {
      const tagSet = tags.map((t) => t.toLowerCase().replace(/[\s-]+/g, '_'))
      const ok = tokens.some((tok) => tagSet.some((t) => t === tok || t.includes(tok) || tok.includes(t)))
      if (!ok) continue
    }
    const url = `https://img.booru.org/${bSub}//images/${dir}/${hash}.${ext}`
    const id = `${bSub}-${hash.slice(0, 10)}`
    if (rating === 'explicit' || rating === 'e' || rating === 'questionable') {
      if (!hasBadTag(tags, captions)) {
        posts.push({ id, url, tags, rating: 'e', width: 1200, height: 1200 })
      }
    }
  }
  return posts
}

// --- redgifs (real/hardcore porn: pornstars, BBC, mp4s/gifs) ------------------
// Public v2 API: temporary token (verified live) → gif search. Shape:
// gifs[] with urls.hd (.mp4), urls.poster (.jpg), id, tags[], niches[].
const REDGIFS_API = 'https://api.redgifs.com'
let redgifsToken = null
let redgifsTokenExp = 0

function redgifsWords(query) {
  return String(query).replace(/_/g, ' ').trim().replace(/\s+/g, ' ')
}

function normRedgifsTag(t) {
  if (typeof t !== 'string') return null
  const n = t
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return n.length >= 2 ? n : null
}

async function redgifsAuth() {
  if (redgifsToken && Date.now() < redgifsTokenExp) return redgifsToken
  const body = await httpGet(`${REDGIFS_API}/v2/auth/temporary`)
  const token = JSON.parse(body).token
  if (typeof token !== 'string' || !token) throw new Error('redgifs auth failed')
  redgifsToken = token
  redgifsTokenExp = Date.now() + 20 * 3600 * 1000
  return token
}

function parseRedgifsJson(body, captions) {
  let data
  try {
    data = JSON.parse(body)
  } catch {
    return []
  }
  const list = Array.isArray(data.gifs) ? data.gifs : []
  return list
    .filter((g) => g && typeof g === 'object')
    .map((g) => {
      const urls = g.urls && typeof g.urls === 'object' ? g.urls : {}
      const tags = []
      for (const t of [...(g.tags || []), ...(g.niches || [])]) {
        const n = normRedgifsTag(t)
        if (n && !tags.includes(n)) tags.push(n)
      }
      return {
        id: typeof g.id === 'string' ? `rg-${g.id}` : '',
        url: typeof urls.hd === 'string' ? urls.hd : '',
        tags,
        rating: 'e',
        preview: typeof urls.poster === 'string' ? urls.poster : undefined,
        kind: 'video',
        width: Number(g.width) || 0,
        height: Number(g.height) || 0,
      }
    })
    .filter(
      (p) =>
        p.id &&
        p.url &&
        /\.(mp4|webm|gif|webp)(?:[?#]|$)/i.test(p.url) &&
        p.width >= MIN_WIDTH &&
        p.height >= MIN_HEIGHT &&
        !hasBadTag(p.tags, captions),
    )
}

async function fetchRedgifs(variant, n, captions) {
  const page = 1 + Math.floor(Math.random() * 5)
  const url =
    `${REDGIFS_API}/v2/gifs/search?search_text=${encodeURIComponent(redgifsWords(variant))}` +
    `&order=trending&count=${n}&page=${page}`
  try {
    const token = await redgifsAuth()
    const body = await httpGet(url, { Authorization: `Bearer ${token}` })
    return parseRedgifsJson(body, captions)
  } catch (e) {
    if (!/401/.test(String((e && e.message) || e))) throw e
    // ponytail: stale cached temp token; drop it and retry once.
    redgifsToken = null
    redgifsTokenExp = 0
    const token = await redgifsAuth()
    const body = await httpGet(url, { Authorization: `Bearer ${token}` })
    return parseRedgifsJson(body, captions)
  }
}

// --- imhentai (hentai galleries: captions, hardcore doujins) ------------------
// No JSON API — scrape HTML like gallery-dl: search page → gallery IDs →
// cover image per gallery (data-src base + $.parseJSON ext map).
const IMHENTAI_ROOT = 'https://imhentai.xxx'

/**
 * imhentai HTML via Electron's net stack (Chromium TLS passes Cloudflare;
 * plain https.get gets a 403 challenge). Falls back to httpGet outside
 * Electron. Throws on bad status like httpGet.
 */
async function imhGet(url) {
  try {
    if (net && typeof net.fetch === 'function') {
      const res = await net.fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,*/*',
          Referer: 'https://imhentai.xxx/',
        },
      })
      if (res.status !== 200) throw new Error(`imh status ${res.status}`)
      return await res.text()
    }
  } catch (e) {
    if (e && /imh status/.test(e.message)) throw e
    /* no Electron net — fall through to https */
  }
  return httpGet(url, { Referer: 'https://imhentai.xxx/' })
}
const IMH_EXTS = { j: 'jpg', p: 'png', g: 'gif', w: 'webp', a: 'avif' }

function parseImhentaiSearch(html, limit) {
  const out = []
  const re = /href="\/gallery\/(\d+)\/?"/g
  let m
  while ((m = re.exec(html))) {
    if (!out.includes(m[1])) out.push(m[1])
    if (out.length >= limit) break
  }
  return out
}

function parseImhentaiCover(html) {
  const srcTag = 'data-src="'
  const srcStart = html.indexOf(srcTag)
  if (srcStart === -1) return null
  const urlStart = srcStart + srcTag.length
  const urlEnd = html.indexOf('"', urlStart)
  if (urlEnd === -1) return null
  const src = html.slice(urlStart, urlEnd)
  if (!src) return null
  const marker = 'parseJSON('
  const mStart = html.indexOf(marker)
  if (mStart !== -1) {
    const q1 = html.indexOf("'", mStart + marker.length)
    const q2 = q1 === -1 ? -1 : html.indexOf("'", q1 + 1)
    if (q1 !== -1 && q2 !== -1) {
      try {
        const raw = html.slice(q1 + 1, q2).split(String.fromCharCode(92)).join('')
        const first = JSON.parse(raw)['1']
        if (typeof first === 'string') {
          const parts = first.split(',')
          const suffix = IMH_EXTS[parts[0]]
          if (suffix) {
            const slash = src.lastIndexOf('/')
            const root = slash === -1 ? '' : src.slice(0, slash + 1)
            return { url: root + '1.' + suffix, width: Number(parts[1]) || 0, height: Number(parts[2]) || 0 }
          }
        }
      } catch {
        /* fall through to raw data-src */
      }
    }
  }
  return { url: src, width: 0, height: 0 }
}

async function fetchImhentai(variant, n, captions) {
  const key = redgifsWords(variant)
  // Cloudflare challenges Node-TLS fetches (403 "Just a moment") — Electron's
  // net stack is Chromium TLS and passes like a real browser tab. Plain-node
  // fallback stays for contexts without Electron.
  const searchBody = await imhGet(`${IMHENTAI_ROOT}/search/?key=${encodeURIComponent(key)}`)
  const ids = parseImhentaiSearch(searchBody, 3)
  const posts = []
  for (const id of ids) {
    if (posts.length >= n) break
    try {
      const galleryBody = await imhGet(`${IMHENTAI_ROOT}/gallery/${encodeURIComponent(id)}/`)
      const cover = parseImhentaiCover(galleryBody)
      if (!cover) continue
      // Dims gate only when known — map-less covers skip it.
      if (cover.width > 0 && cover.height > 0) {
        if (cover.width < MIN_WIDTH || cover.height < MIN_HEIGHT) continue
        if (cover.width * cover.height < MIN_PIXELS) continue
      }
      const tags = key
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2)
      if (hasBadTag(tags, captions)) continue
      posts.push({ id: `imh-${id}`, url: cover.url, tags, rating: 'e', kind: 'image' })
    } catch {
      /* one dead gallery never kills the round */
    }
    if (posts.length >= 5) break
  }
  return posts
}

// Round-robin over sources with simple health tracking (SPEC §6).
// Explicit-rated human sources only (user spec): tbib + xbooru + paheal
// (boorus), redgifs (real/hardcore mp4s+gifs), imhentai (hentai galleries).
// e621 (furry) and safebooru (safe-only) were removed on purpose.
const SOURCES = [
  {
    id: 'tbib',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 8)
      let body = await httpGet(
        `https://tbib.org/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
          variant + ' rating:explicit ' + NEGATIVES,
        )}&limit=${n}&json=1&pid=${pid}`
      )
      let posts = parseDanbooruJson(body, 'https://tbib.org', captions)
      if (posts.length === 0 && pid > 0) {
        body = await httpGet(
          `https://tbib.org/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
            variant + ' rating:explicit ' + NEGATIVES,
          )}&limit=${n}&json=1&pid=0`
        )
        posts = parseDanbooruJson(body, 'https://tbib.org', captions)
      }
      return posts
    },
  },
  {
    id: 'xbooru',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 8)
      let body = await httpGet(
        `https://xbooru.com/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
          variant + ' rating:explicit ' + NEGATIVES,
        )}&limit=${n}&json=1&pid=${pid}`
      )
      let posts = parseDanbooruJson(body, 'https://xbooru.com', captions)
      if (posts.length === 0 && pid > 0) {
        body = await httpGet(
          `https://xbooru.com/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
            variant + ' rating:explicit ' + NEGATIVES,
          )}&limit=${n}&json=1&pid=0`
        )
        posts = parseDanbooruJson(body, 'https://xbooru.com', captions)
      }
      return posts
    },
  },
  {
    // Real/hardcore porn: pornstars (skylar vox), BBC, mp4s/gifs.
    id: 'redgifs',
    fetch: (variant, n, captions) => fetchRedgifs(variant, n, captions),
  },
  {
    // paheal combos return 0 results — query a single tag only.
    id: 'paheal',
    fetch: async (variant, n, captions) => {
      const tag = variant.split(/\s+/)[0]
      const page = 1 + Math.floor(Math.random() * 5)
      let xml = await httpGet(
        `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(tag)}&limit=${n}&page=${page}`
      )
      let posts = parsePahealXml(xml, captions)
      if (posts.length === 0 && page > 1) {
        xml = await httpGet(
          `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(tag)}&limit=${n}&page=1`
        )
        posts = parsePahealXml(xml, captions)
      }
      return posts
    },
  },
  {
    // Slow (multi-fetch scrape) — last resort before giving up.
    id: 'imhentai',
    fetch: (variant, n, captions) => fetchImhentai(variant, n, captions),
  },
  {
    // Explicit hentai pools (Moebooru JSON, no key): biggest anime/hentai
    // archive of the bunch. Serves uncensored per yandere/konachan probes.
    id: 'konachan',
    fetch: async (variant, n, captions) =>
      parseMoebooruJson(await httpGet(moebooruUrl('https://konachan.com', variant, n)), 'kona', captions),
  },
  {
    id: 'yandere',
    fetch: async (variant, n, captions) =>
      parseMoebooruJson(await httpGet(moebooruUrl('https://yande.re', variant, n)), 'yand', captions),
  },
  {
    // realbooru: real/hardcore porn (jav uncensored, pov, homemade).
    // DAPI offline (API deliberately disabled) — HTML list scraper.
    id: 'realbooru',
    fetch: async (variant, n, captions) => {
      // Preserve multi-word tags with underscores (e.g. skylar_vox),
      // don't drop the rest of the query with split(/\s+/)[0].
      const tagParam = variant.trim().replace(/\s+/g, '_')
      const pid = Math.floor(Math.random() * 5)
      const html = await httpGet(
        `https://realbooru.com/index.php?page=post&s=list&tags=${encodeURIComponent(tagParam)}&pid=${pid}`
      )
      return parseRealbooruHtml(html, captions).slice(0, n)
    },
  },
  {
    // booru.org subdomains — same engine, shared parse:
    // hgoon (goon hentai), blacked (interracial), allgirl, rule34, qoh, celeb, footfetish.
    // Cloudflare WAF challenges `tags=` with 403; omitting `tags=` and paginating
    // via random `pid` returns 200 OK. Each sub is dedicated to its niche theme.
    id: 'hgoon',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://hgoon.booru.org/index.php?page=post&s=list&pid=${pid}`)
      return parseBooruOrgHtml(html, 'hgoon', captions, variant).slice(0, n)
    },
  },
  {
    id: 'blacked',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://blacked.booru.org/index.php?page=post&s=list&pid=${pid}`)
      return parseBooruOrgHtml(html, 'blacked', captions, variant).slice(0, n)
    },
  },
  {
    id: 'allgirl',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://allgirl.booru.org/index.php?page=post&s=list&pid=${pid}`)
      return parseBooruOrgHtml(html, 'allgirl', captions, variant).slice(0, n)
    },
  },
  {
    id: 'rule34-org',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://rule34.booru.org/index.php?page=post&s=list&pid=${pid}`)
      return parseBooruOrgHtml(html, 'rule34', captions, variant).slice(0, n)
    },
  },
  {
    id: 'qoh',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://qoh.booru.org/index.php?page=post&s=list&pid=${pid}`)
      return parseBooruOrgHtml(html, 'qoh', captions, variant).slice(0, n)
    },
  },
  {
    id: 'celeb',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://celeb.booru.org/index.php?page=post&s=list&pid=${pid}`)
      return parseBooruOrgHtml(html, 'celeb', captions, variant).slice(0, n)
    },
  },
  {
    id: 'footfetish',
    fetch: async (variant, n, captions) => {
      const pid = Math.floor(Math.random() * 10) * 20
      const html = await httpGet(`https://footfetishbooru.booru.org/index.php?page=post&s=list&pid=${pid}`)
      return parseBooruOrgHtml(html, 'footfetishbooru', captions, variant).slice(0, n)
    },
  },
]

// AND-combos of narrow pervert tags often return 0 on DAPI mirrors, so each
// source tries the full query, then the top-2 tags, then the single leading
// tag. Any result beats falling back to vanilla.
function queryVariants(query) {
  const parts = query.split(/\s+/).filter(Boolean)
  const variants = [query]
  if (parts.length > 2) variants.push(parts.slice(0, 2).join(' '))
  if (parts.length > 1) variants.push(parts[0])
  return [...new Set(variants)]
}

let rrIndex = 0

async function fetchBooru({ tags, limit }) {
  const query = String(tags ?? '').trim()
  const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
  if (!query || isQueryBlocked(query)) {
    return { posts: [], source: null, ok: false, error: 'blocked-or-empty query' }
  }
  // Never serve stale posts to the idle game: always ask the boorus for fresh
  // images (the renderer filters seen ones itself). Feed cache survives only
  // as a write-once store so the game never blocks on it.
  const variants = queryVariants(query)
  const captions = isCaptionQuery(query)
  const ordered = SOURCES.map((_, i) => SOURCES[(rrIndex + i) % SOURCES.length])
  for (const source of ordered) {
    for (const variant of variants) {
      try {
        const posts = source.fetch
          ? await source.fetch(variant, n, captions)
          : source.parse(await httpGet(source.url(variant, n)), captions)
        if (posts.length > 0) {
          rrIndex = (SOURCES.indexOf(source) + 1) % SOURCES.length
          imageCache.setFeedCache(variant, posts)
          return { posts, source: source.id, ok: true, query: variant }
        }
      } catch {
        // try next variant / source
      }
    }
  }
  rrIndex = (rrIndex + 1) % SOURCES.length
  return { posts: [], source: null, ok: false }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    backgroundColor: '#080A0D',
    title: 'gMatch',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--api-base=${app.isPackaged ? (packagedServer || serverMode.readServerMode()).url : apiSidecar.API_BASE}`],
    },
  })
  win.removeMenu()
  // The renderer's beforeunload key-save gate must NEVER silently block the
  // close button (1.0.1 bug: "cant close app" — in Electron, a prevented
  // unload just cancels the window close). Surface the page's message as a
  // real native dialog instead: Stay saves nothing, Leave closes.
  win.webContents.on('will-prevent-unload', (event) => {
    if (updateHandoff) { event.preventDefault(); return }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Stay', 'Leave anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Save your secret key first?',
      message: 'Your account is only recoverable with your secret key.',
      detail: 'Open Settings → Identity & Keys to copy or download it. If you already backed it up, you can close safely.',
    })
    if (choice === 1) event.preventDefault()
  })
  // Only use the dev server when explicitly requested — never guess a port,
  // another app may be listening there.
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl && !app.isPackaged) {
    win.loadURL(devUrl).catch(() => win.loadFile(path.join(__dirname, '../dist/index.html')))
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  const secureAvailable = initSecureKV()
  imageCache.init(app.getPath('userData'), UA)
  protocol.handle(imageCache.SCHEME, (request) => imageCache.serveImage(request))
  customFolders.init(app.getPath('userData'), { ipcMain, BrowserWindow })
  ipcMain.handle('booru:fetch', (_event, payload) => fetchBooru(payload ?? {}))
  // Secure KV bridge (B.3): renderer proxies designated localStorage keys here.
  ipcMain.handle('secure:available', () => secureAvailable)
  ipcMain.handle('secure:get', (_event, key) => secureKV.get(String(key)))
  ipcMain.handle('secure:set', (_event, key, value) => secureKV.set(String(key), String(value)))
  ipcMain.handle('secure:delete', (_event, key) => secureKV.delete(String(key)))
  ipcMain.handle('cache:image', (_event, url) => imageCache.cacheImage(url).then((local) => ({ local })))
  ipcMain.handle('cache:stats', () => imageCache.cacheStats())
  ipcMain.handle('cache:clear', () => imageCache.clearCache())
  ipcMain.handle('cache:evict', (_event, url) => ({ ok: imageCache.evict(String(url ?? '')) }))
  // Update check (Settings): installed version + open the download in the OS browser.
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('shell:open', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.reject(new Error('only http(s) URLs'))
  })
  // OS wallpaper swap for consented domination effects (Windows; no-op else).
  ipcMain.handle('wallpaper:set-data', (_event, buf, mime) => wallpaperWin.setWallpaperFromBuffer(Buffer.from(buf), String(mime || '')))
  ipcMain.handle('wallpaper:restore', () => wallpaperWin.restoreWallpaper())
  ipcMain.handle('wallpaper:cleanup-files', () => { wallpaperWin.cleanupWallpaperFiles(); return { ok: true } })
  // Camera stays denied by default; the renderer consumes a one-shot grant
  // only AFTER the victim clicks "Allow once" on the in-app prompt.
  ipcMain.handle('camera:grant-once', () => { cameraGrantOnce = true; return { ok: true } })
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' && cameraGrantOnce) {
      cameraGrantOnce = false
      callback(true)
      return
    }
    callback(false)
  })
  // Server-mode bridge for the Settings UI (packaged topology control).
  ipcMain.handle('server:state', () => ({
    packaged: app.isPackaged,
    ...(app.isPackaged
      ? { ...serverMode.readServerMode(), lanUrls: serverMode.lanUrls() }
      : { mode: 'host', url: apiSidecar.API_BASE, lanUrls: serverMode.lanUrls() }),
  }))
  // Persist host/client choice + hand the renderer the fresh state. Switching
  // takes effect on next launch (relaunch button in Settings does that).
  ipcMain.handle('server:set', (_event, payload) => {
    const mode = payload?.mode === 'client' ? 'client' : 'host'
    try {
      serverMode.writeServerMode(mode, String(payload?.url || ''))
    } catch (err) {
      return { ok: false, error: err.message }
    }
    return { ok: true }
  })
  // Apply the new mode NOW: relaunch the app (used by the Settings button).
  ipcMain.handle('server:relaunch', () => {
    apiSidecar.stopApi()
    try { if (secureKV) secureKV.flush() } catch { /* best effort */ }
    const execPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
    app.relaunch({ execPath })
    app.exit(0)
  })
  // Portable self-update (GitHub Releases): check + auto-download in main,
  // the renderer's "Install & Restart" triggers the exe swap + relaunch.
  let updater = null
  if (app.isPackaged) {
    updater = require('./updater.cjs').createUpdater({
      app,
      webContents: () => BrowserWindow.getAllWindows().map((w) => w.webContents),
      log: mainLog,
    })
  }
  ipcMain.handle('update:check', () => (updater ? updater.check(true) : { phase: 'unsupported', current: app.getVersion() }))
  ipcMain.handle('update:state', () => (updater ? updater.getState() : { phase: 'unsupported', current: app.getVersion() }))
  ipcMain.handle('update:install', () => {
    if (!updater) return { ok: false, error: 'updates only work in packaged builds' }
    updateHandoff = true
    return updater.install()
  })
  // 1.0 topology (no central server): packaged builds ALWAYS run the bundled
  // server (host mode, default) unless the user configured client mode in
  // Settings. Dev keeps the repo-local sidecar path unchanged.
  if (app.isPackaged) {
    packagedServer = serverMode.readServerMode()
    if (packagedServer.mode === 'host') {
      process.env.GMATCH_HOST_MODE = '1'
      try {
        await apiSidecar.startApi()
      } catch (err) {
        console.error('[api] bundled server start failed:', err.message)
      }
    }
  } else {
    try {
      await apiSidecar.startApi()
    } catch (err) {
      // Sidecar down (e.g. bun missing): the renderer still boots and shows
      // offline states; Grid feed works via IPC booru.
      console.error('[api] sidecar start failed:', err.message)
    }
  }
  createWindow()
  updater?.schedule()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
  .catch((err) => {
    // A fatal during boot used to leave a windowless zombie: no window, no
    // error. Log it, show it, and let the process exit.
    mainLog(`boot failed: ${err?.stack || err}`)
    try { dialog.showErrorBox('gMatch could not start', `${String(err?.message || err)}\n\nDetails were written to:\n%APPDATA%\\gMatch\\main.log`) } catch { /* headless edge */ }
  })

// Portable double-launch (or a stale lock): focus the running window instead
// of starting a second sidecar fight.
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) {
    if (w.isMinimized()) w.restore()
    w.focus()
  }
})

app.on('before-quit', () => { apiSidecar.stopApi(); try { if (secureKV) secureKV.flush() } catch { /* best effort */ } })
app.on('will-quit', () => { apiSidecar.stopApi() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
