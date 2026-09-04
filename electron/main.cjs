// GoonGrid Electron main process.
// All booru HTTP happens HERE (renderer never touches the network directly).
// Endpoints per docs/SPEC.md §6. 10s timeout, browser UA, round-robin health.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron')
const https = require('https')
const path = require('path')
const imageCache = require('./imageCache.cjs')

// gooncache:// serves cached picture files from the user folder.
// Privileged (standard+secure, fetchable) so sandboxed <img> tags can use it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: imageCache.SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

// Defense-in-depth: enforce the SPEC §8 blocklist on incoming queries too.
// Single source of truth: shared/blocklist.json (imported by src/game/tagFilter.ts).
const { blocklist } = require('../shared/blocklist.json')

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

function httpGet(url, headers) {
  // imhentai's Cloudflare front challenges bare-Node fetches — a site
  // Referer makes gallery/search pages answer 200 like a real browser tab.
  const ref =
    typeof url === 'string' && url.includes('imhentai.xxx')
      ? { Referer: 'https://imhentai.xxx/' }
      : {}
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'application/json, text/xml, */*', ...ref, ...(headers || {}) } },
      (res) => {
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
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('quality-gate timeout'))
    )
    req.on('error', reject)
  })
}

// --- source parsers -------------------------------------------------------

function parseDanbooruJson(body, baseUrl, captions) {
  const data = JSON.parse(body)
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
        /\.(jpe?g|png)$/i.test(p.url) &&
        // DAPI spells it 'explicit'; e621-style sources use 'e'
        (p.rating === 'explicit' || p.rating === 'e') &&
        p.width >= MIN_WIDTH &&
        p.height >= MIN_HEIGHT &&
        p.width * p.height >= MIN_PIXELS &&
        !hasBadTag(p.tags, captions),
    )
}

function parsePahealXml(body, captions) {
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
    const width = Number(attr(m[1], 'width')) || 0
    const height = Number(attr(m[1], 'height')) || 0
    posts.push({
      id: attr(m[1], 'id') || fileUrl,
      url: fileUrl,
      tags: attr(m[1], 'tags') ? attr(m[1], 'tags').split(/\s+/).filter(Boolean) : [],
      rating: 'e',
      width,
      height,
    })
  }
  return posts.filter(
    (p) =>
      /\.(jpe?g|png)$/i.test(p.url) &&
      p.width >= MIN_WIDTH &&
      p.height >= MIN_HEIGHT &&
      p.width * p.height >= MIN_PIXELS &&
      !hasBadTag(p.tags, captions),
  )
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
  const token = await redgifsAuth()
  const page = 1 + Math.floor(Math.random() * 5)
  const url =
    `${REDGIFS_API}/v2/gifs/search?search_text=${encodeURIComponent(redgifsWords(variant))}` +
    `&order=trending&count=${n}&page=${page}`
  const body = await httpGet(url, { Authorization: `Bearer ${token}` })
  return parseRedgifsJson(body, captions)
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
    url: (tags, limit) =>
      `https://tbib.org/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
        tags + ' rating:explicit ' + NEGATIVES,
      )}&limit=${limit}&json=1`,
    parse: (body, captions) => parseDanbooruJson(body, 'https://tbib.org', captions),
  },
  {
    id: 'xbooru',
    url: (tags, limit) =>
      `https://xbooru.com/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
        tags + ' rating:explicit ' + NEGATIVES,
      )}&limit=${limit}&json=1`,
    parse: (body, captions) => parseDanbooruJson(body, 'https://xbooru.com', captions),
  },
  {
    // Real/hardcore porn: pornstars (skylar vox), BBC, mp4s/gifs.
    id: 'redgifs',
    fetch: (variant, n, captions) => fetchRedgifs(variant, n, captions),
  },
  {
    // paheal combos return 0 results — query a single tag only.
    id: 'paheal',
    url: (tags, limit) =>
      `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(
        tags.split(/\s+/)[0],
      )}&limit=${limit}`,
    parse: parsePahealXml,
  },
  {
    // Slow (multi-fetch scrape) — last resort before giving up.
    id: 'imhentai',
    fetch: (variant, n, captions) => fetchImhentai(variant, n, captions),
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
  // Feed-response cache: repeat tag queries reuse parsed posts for 10 min,
  // no API round-trip at all.
  const hit = imageCache.getFeedCache(query)
  if (hit) {
    return { posts: hit, source: 'cache', ok: true, cached: true }
  }
  const variants = queryVariants(query)
  const captions = isCaptionQuery(query)
  const ordered = SOURCES.map((_, i) => SOURCES[(rrIndex + i) % SOURCES.length])
  for (const source of ordered) {
    for (const variant of variants) {
      const vhit = imageCache.getFeedCache(variant)
      if (vhit) {
        rrIndex = (SOURCES.indexOf(source) + 1) % SOURCES.length
        return { posts: vhit, source: 'cache', ok: true, query: variant, cached: true }
      }
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
    backgroundColor: '#0a0a0f',
    title: 'GoonGrid — Babecock Idle',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.removeMenu()
  // Only use the dev server when explicitly requested — never guess a port,
  // another app may be listening there.
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl && !app.isPackaged) {
    win.loadURL(devUrl).catch(() => win.loadFile(path.join(__dirname, '../dist/index.html')))
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  imageCache.init(app.getPath('userData'), UA)
  protocol.handle(imageCache.SCHEME, (request) => imageCache.serveImage(request, net))
  ipcMain.handle('booru:fetch', (_event, payload) => fetchBooru(payload ?? {}))
  ipcMain.handle('cache:image', (_event, url) => imageCache.cacheImage(url).then((local) => ({ local })))
  ipcMain.handle('cache:stats', () => imageCache.cacheStats())
  ipcMain.handle('cache:clear', () => imageCache.clearCache())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
