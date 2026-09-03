// GoonGrid Electron main process.
// All booru HTTP happens HERE (renderer never touches the network directly).
// Endpoints per docs/SPEC.md §6. 10s timeout, browser UA, round-robin health.
const { app, BrowserWindow, ipcMain } = require('electron')
const https = require('https')
const path = require('path')

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
].join('')

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

function hasBadTag(tags) {
  return tags.some((t) => {
    const s = String(t).toLowerCase()
    return BAD_TAG_FRAGMENTS.some((b) => s.includes(b))
  })
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'application/json, text/xml, */*' } },
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

function parseDanbooruJson(body, baseUrl) {
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
        !hasBadTag(p.tags),
    )
}

function parsePahealXml(body) {
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
      !hasBadTag(p.tags),
  )
}

// Round-robin over sources with simple health tracking (SPEC §6).
// Explicit-rated human sources only (user spec): tbib + xbooru + paheal.
// e621 (furry) and safebooru (safe-only) were removed on purpose.
const SOURCES = [
  {
    id: 'tbib',
    url: (tags, limit) =>
      `https://tbib.org/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
        tags + ' rating:explicit ' + NEGATIVES,
      )}&limit=${limit}&json=1`,
    parse: (body) => parseDanbooruJson(body, 'https://tbib.org'),
  },
  {
    id: 'xbooru',
    url: (tags, limit) =>
      `https://xbooru.com/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
        tags + ' rating:explicit ' + NEGATIVES,
      )}&limit=${limit}&json=1`,
    parse: (body) => parseDanbooruJson(body, 'https://xbooru.com'),
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
  const variants = queryVariants(query)
  const ordered = SOURCES.map((_, i) => SOURCES[(rrIndex + i) % SOURCES.length])
  for (const source of ordered) {
    for (const variant of variants) {
      try {
        const body = await httpGet(source.url(variant, n))
        const posts = source.parse(body)
        if (posts.length > 0) {
          rrIndex = (SOURCES.indexOf(source) + 1) % SOURCES.length
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
  ipcMain.handle('booru:fetch', (_event, payload) => fetchBooru(payload ?? {}))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
