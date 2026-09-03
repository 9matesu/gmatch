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

function isQueryBlocked(query) {
  const q = String(query).toLowerCase()
  return blocklist.some((bad) => q.includes(bad))
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
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

// --- source parsers -------------------------------------------------------

function parseDanbooruJson(body, baseUrl) {
  const data = JSON.parse(body)
  const raw = Array.isArray(data) ? data : (data.posts && (data.posts.post ?? data.posts)) ?? []
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((p) => ({
      id: String(p.id),
      url: p.file_url || `${baseUrl}/images/${p.directory}/${p.image}`,
      tags: typeof p.tags === 'string' ? p.tags.split(' ') : [],
      rating: p.rating,
    }))
    .filter((p) => p.url)
}

function parsePahealXml(body) {
  const posts = []
  const elRe = /<tag\b([^>]*)>/g
  const attr = (attrs, name) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(attrs)
    return m ? m[1] : ''
  }
  let m
  while ((m = elRe.exec(body))) {
    const fileUrl = attr(m[1], 'file_url')
    if (!fileUrl) continue
    posts.push({
      id: attr(m[1], 'id') || fileUrl,
      url: fileUrl,
      tags: attr(m[1], 'tags') ? attr(m[1], 'tags').split(' ') : [],
      rating: 'e',
    })
  }
  return posts
}

function parseE621(body) {
  const data = JSON.parse(body)
  return (data.posts ?? [])
    .filter((p) => p.rating === 'e' && p.file && p.file.url)
    .map((p) => ({
      id: String(p.id),
      url: p.file.url,
      tags: [...(p.tags.general ?? []), ...(p.tags.celebrities ?? [])],
      rating: p.rating,
    }))
}

// Round-robin over sources with simple health tracking (SPEC §6).
const SOURCES = [
  {
    id: 'tbib',
    url: (tags, limit) =>
      `https://tbib.org/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(tags)}&limit=${limit}&json=1`,
    parse: (body) => parseDanbooruJson(body, 'https://tbib.org'),
  },
  {
    id: 'safebooru',
    url: (tags, limit) =>
      `https://safebooru.org/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(tags)}&limit=${limit}&json=1`,
    parse: (body) => parseDanbooruJson(body, 'https://safebooru.org'),
  },
  {
    // paheal combos return 0 results — query a single tag only.
    id: 'paheal',
    url: (tags, limit) =>
      `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(tags.split(/\s+/)[0])}&limit=${limit}`,
    parse: parsePahealXml,
  },
  {
    id: 'e621',
    url: (tags, limit) =>
      `https://e621.net/posts.json?tags=${encodeURIComponent(tags)}+rating:explicit&limit=${limit}`,
    parse: parseE621,
  },
]

let rrIndex = 0

async function fetchBooru({ tags, limit }) {
  const query = String(tags ?? '').trim()
  const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
  if (!query || isQueryBlocked(query)) {
    return { posts: [], source: null, ok: false, error: 'blocked-or-empty query' }
  }
  const ordered = SOURCES.map((_, i) => SOURCES[(rrIndex + i) % SOURCES.length])
  for (const source of ordered) {
    try {
      const body = await httpGet(source.url(query, n))
      const posts = source.parse(body)
      if (posts.length > 0) {
        rrIndex = (SOURCES.indexOf(source) + 1) % SOURCES.length
        return { posts, source: source.id, ok: true }
      }
    } catch {
      // try next source
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
