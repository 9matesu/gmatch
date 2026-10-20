// gMatch Electron main process.
// All booru HTTP happens HERE (renderer never touches the network directly).
// Endpoints per docs/SPEC.md §6. 10s timeout, browser UA, round-robin health.
const { app, BrowserWindow, ipcMain, protocol, net, dialog, safeStorage, session, shell } = require('electron')
const https = require('https')
const fs = require('node:fs')
const path = require('node:path')
const imageCache = require('./imageCache.cjs')
const { createFetchBooru } = require('./booruSources.cjs')
const vault = require('./vault.cjs')
const vaultServer = require('./vaultServer.cjs')
const customFolders = require('./customFolders.cjs')
const wallpaperWin = require('./wallpaperWin.cjs')
const { sanitizeBounds } = require('./window-bounds-core.cjs')
const { dapiSource, booruOrgSource, gateBooruOrgEntry } = require('./booru-sources-core.cjs')
const { loadRegistry: loadBooruRegistry, refererFor: booruRefererFor } = require('./booru-registry.cjs')
const startupMetrics = require('./startupMetrics.cjs')

// Background video & screen sharing fix: keep video playback running and prevent black screen when alt-tabbed / occluded.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// A portable exe can run twice from one double-click (and did: two sidecars
// fight over :8790 and the second window never appeared). One install, one
// process — the second launch just focuses the first window.
// Log the silent quit: without this, every retry after a zombie leaves no
// trace in main.log and looks like "double-click, nothing happens".
if (!app.requestSingleInstanceLock()) {
  try {
    const { appendWithRotation: appendLock } = require('./mainlog-core.cjs')
    appendLock(path.join(app.getPath('userData'), 'main.log'), 'second instance quit (single-instance lock held)')
  } catch { /* userData unavailable — still quit silently rather than fight */ }
  try {
    const lockTmp = path.join(require('node:os').tmpdir(), 'gmatch-lock.log')
    require('node:fs').appendFileSync(lockTmp, `[${new Date().toISOString()}] second instance quit\n`)
  } catch { /* best effort */ }
  app.quit()
  app.exit(0)
}

// Never die silently: "app doesn't open" was unsolvable without this. Every
// fatal lands in the real userData main.log AND a native dialog. The log
// rotates at ~1MB (keeps one .1 generation) so it can never starve the disk.
// NOTE: with name "@gmatch/desktop" the real path is
// %APPDATA%\@gmatch\desktop\main.log (not %APPDATA%\gMatch\main.log).
const { appendWithRotation } = require('./mainlog-core.cjs')
const LOG_HINT = 'Details were written to:\n%APPDATA%\\@gmatch\\desktop\\main.log'
function mainLogPath() {
  return path.join(app.getPath('userData'), 'main.log')
}
function mainLog(line) {
  try { appendWithRotation(mainLogPath(), line) } catch { /* last resort only */ }
}

// Startup sampler (see startupMetrics.cjs). Module-level so createWindow's
// did-finish-load handler and the renderer's boot:mark IPC can reach it.
let bootMetrics = null
process.on('uncaughtException', (err) => {
  mainLog(`uncaught: ${err?.stack || err}`)
  try { dialog.showErrorBox('gMatch hit an unexpected error', `${String(err?.message || err)}\n\n${LOG_HINT}`) } catch { /* headless edge */ }
})
process.on('unhandledRejection', (reason) => mainLog(`unhandledRejection: ${reason?.stack || reason}`))

// Update handoff: once the swap script is spawned, quitting must not be
// blocked by the renderer's save-your-keys unload gate.
let updateHandoff = false
// Explicit renderer reload (context menu, Ctrl+R): the key-save flush runs
// synchronously in beforeunload itself, so the stay/leave gate is pure noise
// here - let reloads through unasked. Close keeps the dialog.
let reloadWanted = false

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

// Packaged topology: either we HOST the bundled
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
    try { dialog.showErrorBox('gMatch could not start', `${String(err?.message || err)}\n\n${LOG_HINT}`) } catch { /* headless edge */ }
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
    // Opt-in local media vault: gallery keeps + card bytes on disk.
    scheme: vault.SCHEME,
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

let currentBlocklistData = null
let currentBlocklist = []

function userBlocklistPath() {
  try {
    return path.join(app.getPath('userData'), 'blocklist.json')
  } catch {
    return null
  }
}

function getDefaultBlocklistData() {
  try {
    const raw = fs.readFileSync(blocklistPath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    mainLog(`Failed to read default blocklist.json: ${err?.message || err}`)
    return { blocklist: [], suggested: [], noise: [] }
  }
}

function loadBlocklistData() {
  const userPath = userBlocklistPath()
  if (userPath && fs.existsSync(userPath)) {
    try {
      const raw = fs.readFileSync(userPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.blocklist)) {
        currentBlocklistData = parsed
        currentBlocklist = parsed.blocklist
        return currentBlocklistData
      }
    } catch (err) {
      mainLog(`Failed to parse userData blocklist.json: ${err?.message || err}`)
    }
  }
  currentBlocklistData = getDefaultBlocklistData()
  currentBlocklist = Array.isArray(currentBlocklistData.blocklist) ? currentBlocklistData.blocklist : []
  return currentBlocklistData
}

loadBlocklistData()

// Booru origins (shared/sources.json) — the same rows the renderer and the
// vite dev proxy read, so a mirror can no longer exist in one runtime only.
const booruRegistry = loadBooruRegistry(app)
const booruSources = booruRegistry.sources

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const TIMEOUT_MS = 3_500
// Budget for full HTML documents (babesource searches run ~500KB,
// galleries ~300KB). JSON APIs stay on the tight TIMEOUT_MS.
const HTML_TIMEOUT_MS = 8_000

// Build negative query terms directly from the active blocklist (single source
// of truth), PLUS whatever player excludes this round asks for.
//
// Excludes used to be applied only in the renderer's post-filter, so a booru
// happily returned the excluded content and we paid to download it only to
// throw it away. Sending `-term` in the query means the source never offers it.
// The renderer still post-filters, so this is an optimisation, not a gate.
let roundExcludes = []
function setRoundExcludes(list) {
  roundExcludes = Array.isArray(list) ? list.filter((t) => typeof t === 'string') : []
}

function getQueryNegatives() {
  const seen = new Set()
  const terms = []
  const add = (b) => {
    const t = String(b || '').trim().toLowerCase()
    if (!/^[a-z0-9_-]+$/.test(t) || seen.has(t)) return
    seen.add(t)
    terms.push(`-${t}`)
  }
  for (const b of currentBlocklist || []) add(b)
  for (const b of roundExcludes) add(b)
  return terms.join(' ')
}

// Post-level floor (user spec: high quality always; loosened from 700px to
// 400px for localhost content-volume parity — small stills/gifs stay).
const FLOOR_PX = 400

// Blocklist matching. MUST stay byte-for-byte equivalent to
// apps/desktop/src/game/tagFilter.ts (hitsAtTokenStart): the renderer and the
// main process enforce the same hard line and a disagreement between them is
// a safety hole, not a cosmetic bug. See tagFilter.ts for why a raw substring
// test is wrong and why allowing a term to be a token PREFIX keeps every real
// compound blocked.
function normalizeTagText(raw) {
  return String(raw).toLowerCase().replace(/[\s-]+/g, '_')
}

function hitsAtTokenStart(tag, term) {
  if (!tag || !term) return false
  let from = 0
  for (;;) {
    const i = tag.indexOf(term, from)
    if (i === -1) return false
    if (i === 0 || tag.charCodeAt(i - 1) === 95) return true // '_'
    from = i + 1
  }
}

function isQueryBlocked(query) {
  const q = normalizeTagText(query)
  return currentBlocklist.some((bad) => hitsAtTokenStart(q, normalizeTagText(bad)))
}


// Post tag filter: strictly checks the active blocklist JSON — no hard blocks.
function hasBadTag(tags) {
  return tags.some((t) => {
    const s = normalizeTagText(t)
    return currentBlocklist.some((bad) => hitsAtTokenStart(s, normalizeTagText(bad)))
  })
}

async function httpGet(url, headers, timeoutMs) {
  let ref = {}
  if (typeof url === 'string') {
    try {
      const u = new URL(url)
      // Referer comes from shared/sources.json — this used to be a hand-written
      // hostname chain duplicated in three other files, which is how
      // babesource/xbooru/twimg quietly lost their Referer in one copy each.
      ref = { Referer: booruRefererFor(u.hostname, booruSources) }
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
      // The net.fetch branch MUST carry its own timeout. Electron's net.fetch
      // has no implicit one, and `net` is always present in the packaged app,
      // so without this the branch that always runs is the only branch with no
      // timeout: a hung mirror holds its race lane indefinitely, and since
      // firstWithPosts waits for all lanes the whole round stalls past the 8s
      // deadline. The https.get fallback below does set one; these must match.
      const controller = new AbortController()
      const budgetMs = timeoutMs || TIMEOUT_MS
      const timer = setTimeout(() => controller.abort(), budgetMs)
      const unref = timer.unref
      if (typeof unref === 'function') unref.call(timer)
      let res
      try {
        res = await net.fetch(url, {
          headers: allHeaders,
          redirect: 'follow',
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      return await res.text()
    } catch (err) {
      // An aborted fetch is a TIMEOUT, not a network failure — report it as
      // the same quality-gate timeout the https path uses so callers treat
      // both the same. HTTP errors still propagate as before.
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || err)))) {
        throw new Error('quality-gate timeout')
      }
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
          httpGet(next, headers, timeoutMs).then(resolve, reject)
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
    req.setTimeout(timeoutMs || TIMEOUT_MS, () => req.destroy(new Error('quality-gate timeout')))
    req.on('error', reject)
  })
}

// --- source parsers -------------------------------------------------------

function parseDanbooruJson(body, baseUrl, prefix = '') {
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
      // Source-scoped id: tbib #102 and xbooru #102 are different pictures, and
      // a shared bare numeric id made the renderer's seen-set swallow one.
      id: prefix + String(p.id ?? ''),
      url: p.file_url || `${baseUrl}/images/${p.directory}/${p.image}`,
      tags: typeof p.tags === 'string' ? p.tags.split(/\s+/).filter(Boolean) : [],
      // Only what the source actually said. This used to default to 'e', which
      // turned the rating check below into a tautology: it was approving posts
      // whose rating had never been reported. DAPI does return a real rating;
      // anything else is genuinely unknown and must stay that way.
      rating: typeof p.rating === 'string' && p.rating ? p.rating : undefined,
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
    }))
    .filter((p) => p.id && p.url)
    .filter(
      (p) =>
        // Localhost parity: same media set as the renderer's allowOnly
        // (stills + gifs + short mp4/webm loops). Floor is 400px, not 700px.
        /\.(jpe?g|png|gif|webp|mp4|webm)(?:[?#]|$)/i.test(p.url) &&
        // DAPI spells it 'explicit'; e621-style sources use 'e'. A MISSING
        // rating now fails here, matching the renderer's fail-closed
        // isRatingAllowed. This path only serves dapi/moebooru, both of which
        // return a real rating, so nothing legitimate is lost.
        (p.rating === 'explicit' || p.rating === 'e' || p.rating === 'adult') &&
        (p.width === 0 || p.width >= 400) &&
        (p.height === 0 || p.height >= 400) &&
        !hasBadTag(p.tags),
    )
}

function parsePahealXml(body) {
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
      // Source-scoped (matches the renderer parser).
      id: `paheal-${attr(m[1], 'id') || fileUrl}`,
      url: fileUrl,
      fileName,
      tags: attr(m[1], 'tags') ? attr(m[1], 'tags').split(/\s+/).filter(Boolean) : [],
        // No rating asserted: this source cannot report one. The renderer gate fails
        // closed without an explicit no-rating-channel declaration.
        rating: undefined,
      width,
      height,
    })
  }
  return posts.filter(
    (p) =>
      (!p.fileName || /\.(jpe?g|png|gif|webp)$/i.test(p.fileName) || /\.(jpe?g|png|gif|webp|mp4|webm)$/i.test(p.url)) &&
      (p.width === 0 || p.width >= 400) &&
      (p.height === 0 || p.height >= 400) &&
      !hasBadTag(p.tags),
  )
}

// --- konachan / yandere (Moebooru JSON: explicit hentai pools, no key) -------
// Verified live: konachan.com answers rating:explicit server-side; yandere
// ignores the rating filter, so rating is enforced client-side below.
// Both paginate with ?page=N — random page per call keeps rounds fresh.
function moebooruUrl(base, variant, n, deterministic) {
  const key = `moe::${base}::${variant}`
  // Sample pages without replacement (shared with the dapi path) so a
  // thin pool does not keep re-answering the same page.
  const page = deterministic ? 1 : 1 + drawFreshPage(key, 50)
  const tags = base.includes('konachan') ? `${variant} rating:explicit` : variant
  return `${base}/post.json?tags=${encodeURIComponent(tags)}&limit=${n}&page=${page}`
}

function parseMoebooruJson(body, prefix) {
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
      // Fail CLOSED like parseDanbooruJson. This defaulted to 'e', asserting an
      // explicit rating the source never reported — and yandere ignores the
      // server-side rating filter, so that fabricated 'e' was the ONLY thing
      // letting its posts through the gate. Missing rating is unknown, and
      // unknown must not pass as explicit.
      rating: typeof p.rating === 'string' && p.rating ? p.rating : undefined,
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
    }))
    .filter((p) => p.id !== `${prefix}-` && p.url)
    .filter(
      (p) =>
        // Localhost parity: gifs/webp kept, floor 400px (not 700px).
        /\.(jpe?g|png|gif|webp)$/i.test(p.url) &&
        (p.rating === 'explicit' || p.rating === 'e' || p.rating === 'adult') &&
        p.width >= 400 &&
        p.height >= 400 &&
        !hasBadTag(p.tags),
    )
}

// --- realbooru (HTML scraper: images/videos with Referer) --------------------
function realbooruPostFromThumb(thumbSrc, rawTitle, postId) {
  const t = /realbooru\.com\/thumbnails\/([^/]+)\/([^/]+)\/thumbnail_([^."]+)\.jpg/i.exec(thumbSrc || '')
  if (!t) return null
  const dir1 = t[1]
  const dir2 = t[2]
  const hash = t[3]
  const tags = String(rawTitle || '')
    .split(/,\s*/)
    .map((x) => x.trim().replace(/\s+/g, '_'))
    .filter(Boolean)
  const isVideo = tags.includes('video') || tags.includes('mp4') || tags.includes('webm')
  const isGif = tags.includes('gif')
  // realbooru stores stills as .jpeg on the full-image path (.jpg 404s).
  const ext = isVideo ? 'mp4' : isGif ? 'gif' : 'jpeg'
  const url = `https://realbooru.com/images/${dir1}/${dir2}/${hash}.${ext}`
  const preview = `https://realbooru.com/thumbnails/${dir1}/${dir2}/thumbnail_${hash}.jpg`
  const altId = postId || ''
  if (!altId) return null
  if (hasBadTag(tags)) return null
  return { id: `rb-${altId}`, url, preview, tags, rating: undefined, kind: isVideo ? 'video' : 'image', width: 1200, height: 1200, postId }
}

function parseRealbooruEntries(html) {
  const out = []
  if (!html || typeof html !== 'string') return out
  const seen = new Set()
  const push = (e) => {
    if (!e || !e.id || e.id === 'rb-' || seen.has(e.id)) return
    seen.add(e.id)
    out.push(e)
  }
  let m
  const anchorRe = /<a\b[^>]*href="[^"]*?page=post&(?:amp;)?s=view&(?:amp;)?id=(\d+)"[^>]*>\s*<img\b([^>]*)>/gi
  while ((m = anchorRe.exec(html)) !== null) {
    const attrs = m[2]
    const src = /src="([^"]+)"/i.exec(attrs)
    const title = /title="([^"]*)"/i.exec(attrs)
    push(realbooruPostFromThumb(src ? src[1] : '', title ? title[1] : '', m[1]))
  }
  const imgRe = /<img\s+[^>]*src="(https:\/\/realbooru\.com\/thumbnails\/([^/]+)\/([^/]+)\/thumbnail_([^."]+)\.jpg)"[^>]*title="([^"]*)"[^>]*alt="Image:\s*(\d+)"/gi
  while ((m = imgRe.exec(html)) !== null) {
    push(realbooruPostFromThumb(m[1], m[5], m[6]))
  }
  return out
}

function kindForFileUrl(url) {
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url) ? 'video' : 'image'
}

// Exact file URL from a realbooru post-view page (verified live):
// <video><source mp4> first, then <img id="image">, then the Original
// link. Mirrors services/booru.ts parseRealbooruPost.
function parseRealbooruPost(html) {
  try {
    if (!html || typeof html !== 'string') return null
    const video = /<video\b[^>]*>([\s\S]*?)<\/video>/i.exec(html)
    if (video) {
      const srcs = [...video[1].matchAll(/<source\b[^>]*\bsrc="([^"]+)"/gi)].map((s) => s[1])
      const mp4 = srcs.find((u) => /\.mp4(?:[?#]|$)/i.test(u))
      const any = mp4 || srcs.find((u) => /\.(mp4|webm|mov)(?:[?#]|$)/i.test(u))
      if (any) return { url: any, kind: 'video' }
    }
    const img = /<img\b(?=[^>]*\bid="image")[^>]*\bsrc="([^"]+)"/i.exec(html)
    if (img) {
      const url = img[1].startsWith('//') ? `https:${img[1]}` : img[1]
      return { url, kind: kindForFileUrl(url) }
    }
    const orig = /<a\b[^>]*\bhref="([^"]+)"[^>]*>\s*Original\s*<\/a>/i.exec(html)
    if (orig) {
      const url = orig[1].startsWith('//') ? `https:${orig[1]}` : orig[1]
      return { url, kind: kindForFileUrl(url) }
    }
    return null
  } catch {
    return null
  }
}

// --- booru.org subdomains (hgoon, blacked, allgirl, rule34) ------------------
function booruOrgPostFromFields(bSub, dir, hash, ext, rawTitle) {
  const ratingMatch = /rating:([a-z]+)/i.exec(rawTitle)
  // A missing rating token is UNKNOWN, not explicit. Defaulting to 'e' here is
  // what made the 18+ check a tautology for every booru.org sub.
  const rating = ratingMatch ? ratingMatch[1].toLowerCase() : null
  const tagsPart = rawTitle
    .replace(/score:\d+/i, '')
    .replace(/rating:[a-z]+/i, '')
    .trim()
  const tags = tagsPart.split(/\s+/).filter(Boolean)
  const url = `https://img.booru.org/${bSub}/images/${dir}/${hash}.${ext}`
  const preview = `https://thumbs.booru.org/${bSub}/thumbnails/${dir}/thumbnail_${hash}.${ext}`
  const id = `${bSub}-${hash.slice(0, 10)}`
  // Pass the stated rating through verbatim. This accepted `questionable` and
  // returned `rating: 'e'`, promoting a questionable post straight past the
  // 18+ gate; a title with no rating token is unclassified, not explicit.
  if (rating === 'explicit' || rating === 'e') {
    if (!hasBadTag(tags)) {
      return { id, url, preview, tags, rating, width: 1200, height: 1200 }
    }
  }
  return null
}

function parseBooruOrgEntries(html, query) {
  const out = []
  if (!html || typeof html !== 'string') return out
  const seen = new Set()
  const push = (e, postId) => {
    if (!e || seen.has(e.id)) return
    seen.add(e.id)
    out.push({ ...e, postId: postId || null })
  }
  // WAF forces tagless browsing, so the query is enforced HERE — in memory,
  // against the tags booru.org publishes in the thumb's `title=` attribute, and
  // BEFORE any post-view expansion (those entries would otherwise cost up to six
  // fetches inside the round budget only to be dropped).
  //
  // The rule itself is gateBooruOrgEntry in ./booru-sources-core.cjs: shared with
  // both test suites, and pinned against the renderer's matchesQuery by a
  // case-table parity test. See BOORU-API.md §9 invariant 0d.
  const gated = (e) => gateBooruOrgEntry(e, query)
  let m
  const anchorRe = /<a\b[^>]*\bid="p(\d+)"[^>]*href="[^"]*?s=view&(?:amp;)?id=(\d+)"[^>]*>\s*<img\b([^>]*)>/gi
  while ((m = anchorRe.exec(html)) !== null) {
    const attrs = m[3]
    const fields =
      /src="https:\/\/thumbs\.booru\.org\/([^/]+)\/thumbnails\/\/([^/]+)\/thumbnail_([^."]+)\.([^"]+)"[^>]*title="([^"]*)"/i.exec(
        attrs,
      )
    if (!fields) continue
    push(gated(booruOrgPostFromFields(fields[1], fields[2], fields[3], fields[4], fields[5])), m[2])
  }
  const imgRe =
    /<img\s+[^>]*src="https:\/\/thumbs\.booru\.org\/([^/]+)\/thumbnails\/\/([^/]+)\/thumbnail_([^."]+)\.([^"]+)"[^>]*title="([^"]*)"/gi
  while ((m = imgRe.exec(html)) !== null) {
    push(gated(booruOrgPostFromFields(m[1], m[2], m[3], m[4], m[5])), null)
  }
  return out
}

function parseBooruOrgHtml(html, query) {
  return parseBooruOrgEntries(html, query).map((e) => {
    const out = { ...e }
    delete out.postId
    return out
  })
}

// Exact file URL from a booru.org post-view page (verified live on blacked:
// `<img … id="image" src="https://img.booru.org/…">`). Falls back to an
// original-file link. Mirrors services/booru.ts parseBooruOrgPost.
function parseBooruOrgPost(html) {
  try {
    if (!html || typeof html !== 'string') return null
    const img = /<img\b(?=[^>]*\bid="image")[^>]*\bsrc="([^"]+)"/i.exec(html)
    if (img) {
      const url = img[1].startsWith('//') ? `https:${img[1]}` : img[1]
      return { url, kind: kindForFileUrl(url) }
    }
    const orig = /<a\b[^>]*\bhref="([^"]*\/\/images\/[^"]+)"[^>]*>/i.exec(html)
    if (orig) {
      const url = orig[1].startsWith('//') ? `https:${orig[1]}` : orig[1]
      return { url, kind: kindForFileUrl(url) }
    }
    return null
  } catch {
    return null
  }
}

// --- redgifs (real/hardcore porn: pornstars, BBC, mp4s/gifs) ------------------
// Public v2 API: temporary token (verified live) → niche-targeted gif fetch
// when the query matches a niche, else the generic trending feed (upstream
// ignores search_text — every query returns the same global feed, so plain
// search is query-blind). Shape: gifs[] with urls.hd (.mp4), urls.poster
// (.jpg), id, tags[], niches[], width, height.
// Registry-driven (shared/sources.json). No literal fallback on purpose: if the
// registry fails to load, booruSources is empty, no redgifs source is ever
// built, and this stays unread. A hardcoded copy here is exactly the drift the
// registry exists to remove.
const REDGIFS_API = (booruSources.find((s) => s.kind === 'redgifs') || {}).apiOrigin || ''
let redgifsToken = null
let redgifsTokenExp = 0
// Niche id per query (null = generic fallback), 1h TTL.
const redgifsNicheCache = new Map()
const REDGIFS_NICHE_CACHE_MS = 3600_000
// Sequential niche-probe cap per uncached query (matches the renderer).
const REDGIFS_NICHE_MAX_CANDIDATES = 3

// Page memory: recently-drawn pages per source+variant, so rounds sample
// WITHOUT replacement instead of re-rolling a seen window. The renderer has
// this (drawFreshPid/drawFreshPage in src/services/booru.ts) but the IPC path
// used plain Math.random(), so a 5-page pool like paheal or redgifs kept
// re-answering the same posts until the seen-set filtered them and the round
// came back empty.
const PAGE_MEMORY_DEPTH = 20
const recentPages = new Map()

function recordPage(key, page) {
  recentPages.set(key, [...(recentPages.get(key) || []), page].slice(-PAGE_MEMORY_DEPTH))
}

/** Draw a 0-based page in [0, maxExclusive) avoiding the last few draws. */
function drawFreshPage(key, maxExclusive) {
  const pool = Math.max(1, maxExclusive)
  if (pool <= 1) return 0
  const seen = recentPages.get(key) || []
  for (let i = 0; i < 6; i++) {
    const p = Math.floor(Math.random() * pool)
    if (!seen.includes(p)) {
      recordPage(key, p)
      return p
    }
  }
  return Math.floor(Math.random() * pool)
}

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
  const body = await httpGet(`${REDGIFS_API}/v2/auth/temporary`, undefined, TIMEOUT_MS)
  const token = JSON.parse(body).token
  if (typeof token !== 'string' || !token) throw new Error('redgifs auth failed')
  redgifsToken = token
  redgifsTokenExp = Date.now() + 20 * 3600 * 1000
  return token
}

function parseRedgifsJson(body) {
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
        // No rating asserted: this source cannot report one. The renderer gate fails
        // closed without an explicit no-rating-channel declaration.
        rating: undefined,
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
        // Localhost parity: short loops are often small — floor 400px.
        (p.width === 0 || p.width >= 400) &&
        (p.height === 0 || p.height >= 400) &&
        !hasBadTag(p.tags),
    )
}

async function fetchRedgifs(variant, n) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await redgifsAuth()
      // 1. Niche-targeted attempt (query-aware), tagged with query tokens.
      //
      // There is deliberately NO generic-trending fallback. Upstream ignores
      // `search_text` on /v2/gifs/search, so that endpoint returns the same
      // GLOBAL trending feed for every query: it cannot answer "images related
      // to <tag>" at all. Serving it made the shipped app show whatever was
      // trending worldwide for a tag the player had never heard of. When no
      // niche matches, this source returns [] — "I don't have that tag" — and
      // the round moves to a source that does. The renderer path already
      // refused this; main is now aligned with it.
      try {
        const niche = await redgifsNicheForQuery(variant, token)
        if (niche) {
          const page = drawFreshPage(`rg::${variant}`, 5)
          const body = await httpGet(
            `${REDGIFS_API}/v2/niches/${encodeURIComponent(niche.id)}/gifs?count=${n}&page=${page}`,
            { Authorization: `Bearer ${token}` },
            TIMEOUT_MS,
          )
          const posts = tagNichePosts(parseRedgifsJson(body), variant, niche)
          if (posts.length > 0) return posts
        }
      } catch (e) {
        if (/401/.test(String((e && e.message) || e))) {
          mainLog('redgifs niche fetch 401 — refreshing token and retrying once')
          redgifsToken = null
          redgifsTokenExp = 0
          continue
        }
        /* niche lookup is best-effort — no match means no posts here */
      }
      // No niche for this query: an HONEST empty, not a trending substitute.
      return []
    } catch (e) {
      if (!/401/.test(String((e && e.message) || e))) throw e
      // Stale cached temp token; drop it and retry once fresh.
      mainLog('redgifs search 401 — refreshing token and retrying once')
      redgifsToken = null
      redgifsTokenExp = 0
    }
  }
  // Both attempts 401'd — surface empty so the caller moves to the next source.
  return []
}

function redgifsQueryTokens(query) {
  const out = []
  for (const part of redgifsWords(query).toLowerCase().split(/[^a-z0-9]+/)) {
    const n = normRedgifsTag(part)
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

function pickRedgifsNiche(query, niches) {
  const tokens = redgifsQueryTokens(query).filter((t) => t.replace(/_/g, '').length >= 3)
  if (tokens.length === 0 || !Array.isArray(niches) || niches.length === 0) return null
  const hayFor = (n) => {
    const hay = new Set()
    const add = (s) => {
      for (const part of String(s || '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 3) hay.add(part)
      }
    }
    add(n.id)
    add(n.name)
    for (const t of n.tags || []) for (const part of String(t).split('_')) {
      if (part.length >= 3) hay.add(part)
    }
    return hay
  }
  let best = null
  let bestScore = 0
  for (const n of niches) {
    if (!n || typeof n.id !== 'string' || !n.id) continue
    const hay = hayFor(n)
    let score = 0
    for (const tok of tokens) {
      const flat = tok.replace(/_/g, '')
      // Full-token equality only: a shared fragment (e.g. `sky` inside
      // `skylar_vox`) must never elect a foreign niche whose posts get
      // stamped with the query tags (wrong-tag rounds).
      if (hay.has(flat)) {
        score += 1
      }
    }
    const subs = typeof n.subscribers === 'number' ? n.subscribers : 0
    if (score > bestScore || (score === bestScore && score > 0 && subs > ((best && best.subscribers) || 0))) {
      best = { id: n.id, name: typeof n.name === 'string' ? n.name : n.id, subscribers: subs }
      bestScore = score
    }
  }
  return bestScore > 0 ? best : null
}

async function redgifsNicheForQuery(variant, token) {
  const key = String(variant || '').trim().toLowerCase()
  if (!key) return null
  const cached = redgifsNicheCache.get(key)
  if (cached && Date.now() < cached.exp) return cached.niche
  const candidates = [redgifsWords(variant), ...redgifsQueryTokens(variant).map((t) => t.replace(/_/g, ' '))]
  // Cap the sequential lookups. An uncached multi-word query previously spent
  // one HTTP round-trip PER candidate (full query + every token) inside a race
  // lane, burning the 8s round budget on niche probing alone. The renderer
  // already caps this at 3; keep the two ends identical.
  for (const q of [...new Set(candidates)].slice(0, REDGIFS_NICHE_MAX_CANDIDATES)) {
    if (!q) continue
    try {
      const body = await httpGet(
        `${REDGIFS_API}/v2/niches/search?query=${encodeURIComponent(q)}`,
        { Authorization: `Bearer ${token}` },
        TIMEOUT_MS,
      )
      let niches = []
      try {
        const data = JSON.parse(body)
        niches = Array.isArray(data.niches) ? data.niches : []
      } catch {
        continue
      }
      const niche = pickRedgifsNiche(variant, niches)
      if (niche) {
        redgifsNicheCache.set(key, { niche, exp: Date.now() + REDGIFS_NICHE_CACHE_MS })
        return niche
      }
    } catch {
      /* next candidate, then generic fallback */
    }
  }
  redgifsNicheCache.set(key, { niche: null, exp: Date.now() + REDGIFS_NICHE_CACHE_MS })
  return null
}

function tagNichePosts(posts, query, niche) {
  // Stamp query tags ONLY on full-token niche↔query agreement (a
  // stale-cached fragment-elected niche must not launder foreign posts
  // through the query match) — otherwise native tags face the filter alone.
  if (!redgifsNicheAgrees(niche, query)) return posts
  const tags = redgifsQueryTokens(query)
  if (tags.length === 0) return posts
  return posts.map((p) => ({
    ...p,
    tags: [...new Set([...(p.tags || []), ...tags])],
  }))
}

/** Full-token niche↔query agreement (mirrors the renderer guard). */
function redgifsNicheAgrees(niche, query) {
  if (!niche || typeof niche.id !== 'string') return false
  const tokens = redgifsQueryTokens(query)
    .map((t) => t.replace(/_/g, ''))
    .filter((t) => t.length >= 3)
  if (tokens.length === 0) return false
  const parts = new Set()
  for (const s of [niche.id, niche.name || '']) {
    for (const part of String(s || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 3) parts.add(part)
    }
  }
  return tokens.some((t) => parts.has(t))
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

function parseImhentaiSearchResults(html, limit) {
  const out = []
  const seen = new Set()
  const thumbRe = /<div class="thumb"[\s\S]*?href="\/gallery\/(\d+)\/?"[\s\S]*?<img[^>]+data-src="([^"]+)"/g
  let m
  while ((m = thumbRe.exec(html))) {
    const [, id, coverUrl] = m
    if (!seen.has(id)) {
      seen.add(id)
      out.push({ id, coverUrl })
      if (out.length >= limit) break
    }
  }
  if (out.length === 0) {
    const linkRe = /href="\/gallery\/(\d+)\/?"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/g
    while ((m = linkRe.exec(html))) {
      const [, id, coverUrl] = m
      if (!seen.has(id)) {
        seen.add(id)
        out.push({ id, coverUrl })
        if (out.length >= limit) break
      }
    }
  }
  return out
}

// EVERY page image from a gallery page (the $.parseJSON ext map carries the
// whole book) — one fetch yields all pages, zero extra requests.
/**
 * Real tags for an imhentai gallery, from its own tag links/title.
 *
 * imhentai has no JSON API, so relevance used to be FAKED: the search key was
 * split into sub-words and stamped onto every page of every gallery the search
 * returned. That made `matchesQuery` pass by construction, so whatever the
 * site's fuzzy search handed back was presented as if it carried the tag. It
 * also broke compounds — `shrooms_q` was stamped as `shrooms`, which the
 * renderer's whole-token gate then rejected, so the whole multi-fetch scrape
 * was spent producing results that got thrown away.
 *
 * Now the gallery's own tags decide. If the page publishes none (markup drift,
 * a book with no tags), we fall back to the search key as ONE whole tag —
 * search-attested rather than invented, and at least consistent with what the
 * renderer can match.
 */
function parseImhentaiGalleryTags(html) {
  const out = []
  if (!html || typeof html !== 'string') return out
  const push = (t) => {
    const n = normRedgifsTag(String(t || '').replace(/\s+/g, '_'))
    if (n && !out.includes(n)) out.push(n)
  }
  // `<div class="tags">` block: each tag is a link to /tag/<name>/
  const tagsBlock = /class="tags"[\s\S]{0,4000}?<\/div>/i.exec(html)
  const scope = tagsBlock ? tagsBlock[0] : html
  const linkRe = /href="\/(?:tag|tags)\/([^"/?#]+)\/?"/gi
  let m
  while ((m = linkRe.exec(scope)) !== null) {
    try {
      push(decodeURIComponent(m[1]))
    } catch {
      push(m[1])
    }
  }
  return out
}

function parseImhentaiGalleryPages(html, limit) {
  const max = Math.max(1, limit || 20)
  if (!html || typeof html !== 'string') return []
  const srcTag = 'data-src="'
  const srcStart = html.indexOf(srcTag)
  if (srcStart === -1) return []
  const urlStart = srcStart + srcTag.length
  const urlEnd = html.indexOf('"', urlStart)
  if (urlEnd === -1) return []
  const src = html.slice(urlStart, urlEnd)
  if (!src) return []
  const slash = src.lastIndexOf('/')
  const root = slash === -1 ? '' : src.slice(0, slash + 1)
  const marker = 'parseJSON('
  const mStart = html.indexOf(marker)
  if (mStart !== -1) {
    const q1 = html.indexOf("'", mStart + marker.length)
    const q2 = q1 === -1 ? -1 : html.indexOf("'", q1 + 1)
    if (q1 !== -1 && q2 !== -1) {
      try {
        const raw = html.slice(q1 + 1, q2).split(String.fromCharCode(92)).join('')
        const data = JSON.parse(raw)
        const pages = Object.keys(data)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1)
          .sort((a, b) => a - b)
        const covers = []
        for (const n of pages) {
          if (covers.length >= max) break
          const entry = data[String(n)]
          if (typeof entry !== 'string') continue
          const parts = entry.split(',')
          const suffix = IMH_EXTS[parts[0]]
          if (!suffix) continue
          covers.push({ url: root + n + '.' + suffix, width: Number(parts[1]) || 0, height: Number(parts[2]) || 0 })
        }
        if (covers.length > 0) return covers
      } catch {
        /* fall through to raw data-src */
      }
    }
  }
  return [{ url: src, width: 0, height: 0 }]
}

// Galleries expanded per gallery-source round; lanes expanded in parallel.
const GALLERY_CAP = 6
const GALLERY_LANES = 3
// Post-view (exact file URL) expansion bounds, mirroring services/booru.ts.
const VIEW_POST_CAP = 6

// Bounded-concurrency map: at most `n` lanes in flight; failures settle to
// undefined and are dropped. Mirrors services/booru.ts (main.cjs can't
// import TS).
async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  const lanes = Math.min(Math.max(1, n), Math.max(items.length, 1))
  const lane = async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch {
        out[i] = undefined
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane))
  return out.filter((v) => v !== undefined)
}

// Round-robin merge across galleries: one post per gallery per turn so
// every gallery contributes instead of the first filling the batch.
function roundRobinPosts(lists, limit) {
  const out = []
  const queues = lists.map((l) => [...l])
  while (out.length < limit && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      if (out.length >= limit) break
      const p = q.shift()
      if (p) out.push(p)
    }
  }
  return out
}

// Post-view expansion: swap guessed file URLs for exact ones from the
// post-view page. Bounded lanes; per-post failures fall back to the guessed
// entry so expansion never kills a round. List order preserved.
function stripViewPostId(e) {
  const out = { ...e }
  delete out.postId
  return out
}

async function expandPostViews(entries, viewBase, parseView) {
  const withId = entries.filter((e) => e.postId).slice(0, VIEW_POST_CAP)
  if (withId.length === 0) return entries.map(stripViewPostId)
  const expanded = await mapLimit(withId, GALLERY_LANES, async (entry) => {
    try {
      const view = await httpGet(`${viewBase}/index.php?page=post&s=view&id=${entry.postId}`, undefined, HTML_TIMEOUT_MS)
      const hit = parseView(view)
      if (!hit || !hit.url) return undefined
      const post = stripViewPostId(entry)
      post.url = hit.url
      post.kind = hit.kind || post.kind
      return post
    } catch {
      return undefined // guessed-url entry below keeps the round alive
    }
  })
  const byId = new Map(expanded.map((p) => [p.id, p]))
  return entries.map((e) => byId.get(e.id) || stripViewPostId(e))
}

async function fetchImhentai(variant, n) {
  const key = redgifsWords(variant)
  // Cloudflare challenges Node-TLS fetches (403 "Just a moment") — Electron's
  // net stack is Chromium TLS and passes like a real browser tab. Plain-node
  // fallback stays for contexts without Electron.
  const searchBody = await imhGet(`${IMHENTAI_ROOT}/search/?key=${encodeURIComponent(key)}`, undefined, HTML_TIMEOUT_MS)
  // The FULL query as ONE token. Splitting it into sub-words (`shrooms_q` ->
  // `shrooms`) produced tags the renderer's whole-token gate rejects, so the
  // scrape was paid for and discarded.
  const queryTag = normRedgifsTag(key.replace(/\s+/g, '_'))
  const tags = queryTag ? [queryTag] : []
  if (hasBadTag(tags)) return []

  // Direct results from search HTML give gallery ids + cover thumbs. Enter EVERY gallery from the search page: covers are only thumbs and
  // the blind thumb->1.jpg rewrite 404s on books that ship .webp/.png —
  // the ext map in the gallery page carries the real extensions. Cover
  // posts remain the fallback when all entries fail. parseImhentaiSearch
  // covers galleries whose markup hides the thumbnail from the direct parse.
  const results = parseImhentaiSearchResults(searchBody, GALLERY_CAP)
  const entries = results.length > 0
    ? results
    : parseImhentaiSearch(searchBody, GALLERY_CAP).map((id) => ({ id, coverUrl: '' }))
  if (entries.length === 0) return []
  const perGallery = Math.max(1, Math.ceil(n / Math.min(entries.length, GALLERY_LANES)))
  const sets = await mapLimit(entries, GALLERY_LANES, async ({ id, coverUrl }) => {
    try {
      const galleryBody = await imhGet(`${IMHENTAI_ROOT}/gallery/${encodeURIComponent(id)}/`, undefined, HTML_TIMEOUT_MS)
      const pages = parseImhentaiGalleryPages(galleryBody, perGallery)
      const thumb = pages.length > 0 ? pages[0].url : coverUrl
      // Prefer the gallery's OWN tags: then the renderer gate can actually
      // verify relevance instead of trusting a stamp. Fall back to the search
      // key when the page publishes none — search-attested, not invented.
      const own = parseImhentaiGalleryTags(galleryBody)
      const postTags = own.length > 0 ? own : tags
      if (hasBadTag(postTags)) return undefined
      const set = []
      pages.forEach((cover, i) => {
        // Dims gate only when known — map-less covers skip it. Floor 400px
        // (localhost parity), not the old 700px starver.
        if (cover.width > 0 && cover.height > 0) {
          if (cover.width < FLOOR_PX || cover.height < FLOOR_PX) return
        }
        set.push({ id: `imh-${id}-p${i + 1}`, url: cover.url, preview: thumb, tags: postTags, rating: undefined, kind: 'image' })
      })
      return set.length > 0 ? set : undefined
    } catch {
      return undefined /* one dead gallery never kills the round */
    }
  })
  const expanded = roundRobinPosts(sets, n)
  if (expanded.length > 0) return expanded
  const directPosts = []
  for (const { id, coverUrl } of results) {
    const full = coverUrl.replace(/\/(?:thumb|t)\.([a-z0-9]+)(?:[?#]|$)/i, '/1.$1')
    if (!full || /\/(?:thumb|thumbs)(?:[?#/.]|$)/i.test(full)) continue
    directPosts.push({ id: `imh-${id}`, url: full, preview: coverUrl, tags, rating: undefined, kind: 'image' })
    if (directPosts.length >= n) break
  }
  return directPosts
}

// --- babesource (real porn photo galleries: full-res stills, never thumbs) --
// Search: /search/<slug>/page<N>.html -> /galleries/<slug>-<id>.html (skip /video/)
// Gallery: <a class="slideshowGalleryImage" href=FULL(babesource.com/media/...)>
//          with thumb <img src>(media.babesource.com/.../thumbs/...).
const BABESOURCE_ROOT = 'https://babesource.com'

function babesourceSlug(query) {
  return String(query || '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function babesourceThumbToFull(thumb) {
  const m = /^https:\/\/media\.babesource\.com\/galleries\/([0-9a-f]+)\/thumbs\/(?:300x406\/)?(.+\.(?:jpe?g|png|webp|gif))$/i.exec(
    String(thumb || '').trim(),
  )
  if (!m) return null
  return `https://babesource.com/media/galleries/${m[1]}/${m[2]}`
}

function parseBabesourceSearch(html, limit) {
  const out = []
  if (!html || typeof html !== 'string') return out
  const re = /href="(https:\/\/babesource\.com\/galleries\/[^"]+?-(\d+)\.html)"/gi
  let m
  while ((m = re.exec(html))) {
    if (m[1].includes('/video/')) continue
    if (!out.includes(m[1])) out.push(m[1])
    if (out.length >= limit) break
  }
  return out
}

function parseBabesourceMaxPage(html) {
  if (!html || typeof html !== 'string') return 1
  let max = 1
  const re = /href=["']page(\d+)\.html["']/gi
  let m
  while ((m = re.exec(html))) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > max) max = Math.min(n, 50)
  }
  return Math.max(1, max)
}

function parseBabesourceGallery(html, limit) {
  const out = []
  const seen = new Set()
  if (!html || typeof html !== 'string') return out
  const isFull = (u) => /^https:\/\/babesource\.com\/media\/galleries\/[0-9a-f]+\/.+\.(?:jpe?g|png|webp|gif)$/i.test(u)
  const push = (url, preview) => {
    if (!isFull(url) || seen.has(url)) return
    seen.add(url)
    out.push({ url, preview: /^https:\/\/media\.babesource\.com\/galleries\//i.test(preview) ? preview : url })
  }
  let m
  const anchorRe = /<a[^>]*class="[^"]*slideshowGalleryImage"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/gi
  while ((m = anchorRe.exec(html))) {
    push(m[1], m[2])
    if (out.length >= limit) return out
  }
  if (out.length === 0) {
    const thumbRe = /https:\/\/media\.babesource\.com\/galleries\/[0-9a-f]+\/thumbs\/(?:300x406\/)?[^"'\s]+\.(?:jpe?g|png|webp|gif)/gi
    while ((m = thumbRe.exec(html))) {
      const full = babesourceThumbToFull(m[0])
      if (full) push(full, m[0])
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * Real tags for a babesource gallery: its own meta keywords / search links.
 *
 * The query used to be split into sub-words and unioned in, which meant every
 * gallery the search returned was stamped as if it carried the tag — so
 * `matchesQuery` passed by construction and a loosely-related gallery was
 * indistinguishable from an exact one. Now the gallery's own keywords decide,
 * and the query is only a fallback (as ONE whole token) for a page that
 * publishes none.
 */
function parseBabesourceTags(html, query) {
  const tags = new Set()
  if (html && typeof html === 'string') {
    const meta = /<meta\s+name="keywords"\s+content="([^"]*)"/i.exec(html)
    if (meta) {
      for (const part of meta[1].split(',')) {
        const n = part.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
        if (n.length >= 2) tags.add(n)
      }
    }
    // Gallery pages link to their own performers/search facets.
    const linkRe = /href="https:\/\/babesource\.com\/(?:pornstars?|search)\/([^"/?#]+)\/?"/gi
    let m
    while ((m = linkRe.exec(html)) !== null) {
      const n = normRedgifsTag(decodeURIComponent(m[1]))
      if (n) tags.add(n)
    }
  }
  if (tags.size === 0) {
    // No tags published: attest the search itself, as ONE whole token.
    const q = normRedgifsTag(String(query || '').replace(/[\s-]+/g, '_'))
    if (q) tags.add(q)
  }
  return [...tags]
}

async function fetchBabesource(variant, n) {
  const slug = babesourceSlug(variant)
  if (!slug) return []
  // Page-1 first; higher pages only when pagination advertises them.
  // Single-page queries 404 on page2+ — normal, not a failure.
  let searchBody
  try {
    searchBody = await httpGet(`${BABESOURCE_ROOT}/search/${encodeURIComponent(slug)}/page1.html`, undefined, HTML_TIMEOUT_MS)
  } catch (e) {
    if (/HTTP 404/.test(String((e && e.message) || e))) return []
    throw e
  }
  const seen = new Set()
  const galleries = []
  const collect = (html) => {
    for (const u of parseBabesourceSearch(html, GALLERY_CAP)) {
      if (!seen.has(u)) {
        seen.add(u)
        galleries.push(u)
      }
    }
  }
  collect(searchBody)
  const searchBodies = [searchBody]
  const maxPage = Math.min(parseBabesourceMaxPage(searchBody), 5)
  if (maxPage > 1 && galleries.length < GALLERY_CAP) {
    // Up to two extra distinct random pages — page 1 alone re-serves the
    // same galleries every round. Mirrors services/booru.ts.
    const extra = new Set()
    for (let i = 0; i < 6 && extra.size < 2; i++) {
      extra.add(Math.max(2, 1 + Math.floor(Math.random() * maxPage)))
    }
    for (const page of [...extra].sort((a, b) => a - b)) {
      try {
        const body = await httpGet(`${BABESOURCE_ROOT}/search/${encodeURIComponent(slug)}/page${page}.html`, undefined, HTML_TIMEOUT_MS)
        searchBodies.push(body)
        collect(body)
      } catch {
        /* stale pagination link — page-1 results still stand */
      }
    }
  }
  if (galleries.length === 0) return []
  // Every gallery contributes: bounded lanes expand in parallel, then images
  // round-robin across galleries so one gallery can't fill the batch alone.
  const perGallery = Math.max(1, Math.ceil(n / galleries.length))
  const sets = await mapLimit(galleries, GALLERY_LANES, async (gUrl) => {
    try {
      const gHtml = await httpGet(gUrl, undefined, HTML_TIMEOUT_MS)
      const tags = parseBabesourceTags(gHtml, variant)
      if (hasBadTag(tags)) return undefined
      const idMatch = /-(\d+)\.html?(?:[?#]|$)/.exec(gUrl)
      const gid = idMatch ? idMatch[1] : 'x'
      const images = parseBabesourceGallery(gHtml, perGallery)
      if (images.length === 0) return undefined
      return images.map((img, i) => ({ id: `bs-${gid}-${i}`, url: img.url, preview: img.preview, tags, rating: undefined, kind: 'image' }))
    } catch {
      return undefined /* one dead gallery never kills the round */
    }
  })
  const expanded = roundRobinPosts(sets, n)
  if (expanded.length > 0) return expanded
  // Gallery expansion died but search HTML arrived: fall back to
  // search-page covers rewritten to exact fulls (never thumbs-as-url).
  // Mirrors services/booru.ts.
  const seenCover = new Set()
  const covers = []
  const coverRe = /https:\/\/media\.babesource\.com\/galleries\/[0-9a-f]+\/thumbs\/(?:300x406\/)?[^"']+?\.(?:jpe?g|png|webp|gif)/gi
  for (const body of searchBodies) {
    let m
    while ((m = coverRe.exec(body))) {
      const full = babesourceThumbToFull(m[0])
      if (!full || seenCover.has(full)) continue
      seenCover.add(full)
      const h = /\/galleries\/([0-9a-f]+)\//i.exec(m[0])
      covers.push({
        id: `bs-c-${h ? h[1] : 'x'}-${covers.length}`,
        url: full,
        preview: m[0],
        tags: parseBabesourceTags(null, variant),
        // No rating asserted: this source cannot report one. The renderer gate fails
        // closed without an explicit no-rating-channel declaration.
        rating: undefined,
        kind: 'image',
      })
      if (covers.length >= n) break
    }
    if (covers.length >= n) break
  }
  return covers
}

// Per-kind fetch strategy. Everything about WHICH mirrors exist and where they
// live comes from shared/sources.json; this map only says how each protocol
// shape is spoken. A source row with no entry here is skipped (and logged) so a
// typo in the registry degrades loudly rather than silently.
const SOURCE_FETCHERS = {
  dapi: (s) =>
    dapiSource(s.id, s.origin, { httpGet, parse: parseDanbooruJson, negatives: getQueryNegatives }, s.category),

  // Explicit hentai pools (Moebooru JSON, no key). Serves uncensored per
  // yandere/konachan probes.
  moebooru: (s) => ({
    id: s.id,
    category: s.category,
    fetch: async (variant, n, opts) =>
      parseMoebooruJson(
        await httpGet(moebooruUrl(s.origin, variant, n, opts && opts.deterministic), undefined, TIMEOUT_MS),
        s.parsePrefix || s.id,
      ),
  }),

  // realbooru: real/hardcore porn (jav uncensored, pov, homemade).
  // DAPI offline (API deliberately disabled) — HTML list scraper.
  realhtml: (s) => ({
    id: s.id,
    category: s.category,
    fetch: async (variant, n) => {
      // Preserve multi-word tags with underscores (e.g. skylar_vox),
      // don't drop the rest of the query with split(/\s+/)[0].
      // No `pid`: it is a result offset and any nonzero value over-pages
      // small pools (live: skylar_vox pid=500 returns a blank page while
      // the base list carries 42 thumbs). Variety comes from shuffling
      // expanded view results + seen-memory.
      const tagParam = variant.trim().replace(/\s+/g, '_')
      const html = await httpGet(
        `${s.origin}/index.php?page=post&s=list&tags=${encodeURIComponent(tagParam)}`,
        undefined,
        HTML_TIMEOUT_MS,
      )
      // Exact file URLs via post-view expansion (guessed-url fallback).
      const expanded = await expandPostViews(parseRealbooruEntries(html), s.origin, parseRealbooruPost)
      return expanded.slice(0, n)
    },
  }),

  booruorg: (s) =>
    booruOrgSource(
      s.origin.replace(/^https?:\/\//, ''),
      { httpGet, parse: parseBooruOrgHtml, parseEntries: parseBooruOrgEntries, parsePost: parseBooruOrgPost },
      s.id,
      s.category,
    ),

  // Real/hardcore porn: pornstars (skylar vox), BBC, mp4s/gifs.
  redgifs: (s) => ({ id: s.id, category: s.category, fetch: (variant, n) => fetchRedgifs(variant, n) }),

  // babesource: real porn photo galleries (full-res stills, eporner replacement).
  // Stills-only — no long videos by construction.
  babesource: (s) => ({ id: s.id, category: s.category, fetch: (variant, n) => fetchBabesource(variant, n) }),

  // Slow (multi-fetch scrape) — last resort before giving up.
  imhentai: (s) => ({ id: s.id, category: s.category, fetch: (variant, n) => fetchImhentai(variant, n) }),

  // paheal combos return 0 results — query a single tag only.
  paheal: (s) => ({
    id: s.id,
    category: s.category,
    fetch: async (variant, n, opts) => {
      // A multi-word query cannot be answered by paheal (combos return 0, and
      // a leading-word answer is exactly the "I asked for two things and got
      // one" report). Return nothing BEFORE spending a request: another source
      // may genuinely have the whole query.
      if (variant.split(/\s+/).filter(Boolean).length > 1) return []
      const tag = variant.split(/\s+/)[0]
      const page = opts && opts.deterministic ? 1 : 1 + drawFreshPage(`paheal::${tag}`, 5)
      const url = (p) =>
        `${s.origin}/api/danbooru/find_posts?tags=${encodeURIComponent(tag)}&limit=${n}&page=${p}`
      let posts = parsePahealXml(await httpGet(url(page), undefined, TIMEOUT_MS))
      if (posts.length === 0 && page > 1) {
        posts = parsePahealXml(await httpGet(url(1), undefined, TIMEOUT_MS))
      }
      return posts
    },
  }),
}

// Round-robin over sources with mirror health tracking (BOORU-API.md §7).
// Explicit-rated human sources categorized as 'real' or 'hentai'. Built from
// shared/sources.json — before this, main and the renderer kept independent
// lists and allgirl.booru.org / rule34.booru.org shipped main-only.
const SOURCES = booruSources.flatMap((s) => {
  const make = SOURCE_FETCHERS[s.kind]
  if (!make) {
    mainLog(`[booru] no fetcher for kind "${s.kind}" (source ${s.id}) — skipped`)
    return []
  }
  // Carry `kind` through: createFetchBooru splits cheap single-request sources
  // from the multi-fetch HTML scrapers so a slow gallery crawl cannot occupy a
  // lane while a mirror that answers in 300ms is never tried (FAST_PHASE).
  return [{ ...make(s), kind: s.kind }]
})
mainLog(`[booru] ${SOURCES.length} sources from registry: ${SOURCES.map((s) => s.id).join(', ')}`)

const fetchBooru = createFetchBooru({
  sources: SOURCES,
  httpGet,
  cache: imageCache,
  blocked: isQueryBlocked,
})

function createWindow() {
  // Restore the last size/position when it is still usable; a 1440x900
  // default on a 1366x768 laptop pushed the title bar off-screen.
  let bounds = { width: 1440, height: 900 }
  try {
    const { screen } = require('electron')
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'window-bounds.json'), 'utf8')
    const saved = JSON.parse(raw)
    bounds = sanitizeBounds(saved, screen.getPrimaryDisplay().workArea) || bounds
    mainLog(`boot: window bounds ok ${JSON.stringify(bounds)}`)
  } catch (err) {
    mainLog(`boot: default window bounds (${err?.message || 'first run'})`)
  }
  let win = null
  try {
    win = new BrowserWindow({
    ...bounds,
    minWidth: 1000,
    // Frameless: NativeHeaderBar is the titlebar (drag strip + win controls).
    frame: false,
    backgroundColor: '#080A0D',
    title: 'gMatch',
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--api-base=${app.isPackaged ? (packagedServer || serverMode.readServerMode()).url : apiSidecar.API_BASE}`],
    },
  })
  let boundsTimer = null
  const persistBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      try { fs.writeFileSync(path.join(app.getPath('userData'), 'window-bounds.json'), JSON.stringify(win.getBounds())) } catch { /* best effort */ }
    }, 500)
  }
  win.on('moved', persistBounds)
  win.on('resized', persistBounds)
  win.removeMenu()
  // Boot timeline anchors. The renderer's own marks (first paint, hydration)
  // arrive over IPC and land on the same clock.
  win.webContents.on('did-finish-load', () => {
    mainLog('boot: did-finish-load')
    bootMetrics?.mark('did-finish-load')
  })
  win.once('ready-to-show', () => bootMetrics?.mark('ready-to-show'))
  // The renderer's beforeunload key-save gate must NEVER silently block the
  // close button (1.0.1 bug: "cant close app" — in Electron, a prevented
  // unload just cancels the window close). Surface the page's message as a
  // real native dialog instead: Stay saves nothing, Leave closes.
  win.webContents.on('will-prevent-unload', (event) => {
    if (updateHandoff || reloadWanted) { reloadWanted = false; event.preventDefault(); return }
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
  // Ctrl/Cmd+R = plain refresh (frameless window, no menu accelerators).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'r' && (input.control || input.meta)) {
      event.preventDefault()
      reloadWanted = true
      win.webContents.reload()
      setTimeout(() => { reloadWanted = false }, 3000)
    }
  })
  // Only use the dev server when explicitly requested — never guess a port,
  // another app may be listening there.
  const devUrl = process.env.VITE_DEV_SERVER_URL
  mainLog(`boot: loading ${devUrl && !app.isPackaged ? devUrl : 'packaged dist/index.html'}`)
  const loaded = (devUrl && !app.isPackaged)
    ? win.loadURL(devUrl).catch(() => win.loadFile(path.join(__dirname, '../dist/index.html')))
    : win.loadFile(path.join(__dirname, '../dist/index.html'))
  loaded.catch((err) => {
    mainLog(`window load failed: ${err?.stack || err}`)
    try { dialog.showErrorBox('gMatch could not load its interface', `${String(err?.message || err)}\n\n${LOG_HINT}`) } catch { /* headless edge */ }
  })
  } catch (err) {
    // createWindow must never throw into the boot chain (that was the 1.2.5
    // "Task Mgr spin, no window" zombie: the outer .catch() never created one).
    mainLog(`createWindow failed: ${err?.stack || err}`)
    try { dialog.showErrorBox('gMatch could not open a window', `${String(err?.message || err)}\n\n${LOG_HINT}`) } catch { /* headless edge */ }
    return
  }
  return win
}

app.whenReady().then(async () => {
  // Start measuring FIRST: everything below is a boot cost the user feels, and
  // a Task Manager lifetime average hides it. Bounded (20 s), unref'd, and it
  // writes nothing until the window closes.
  bootMetrics = startupMetrics.createStartupMetrics({
    sample: () => app.getAppMetrics(),
    log: mainLog,
    persist: startupMetrics.filePersister(app.getPath('userData')),
  })
  bootMetrics.begin()
  void startupMetrics.logEnvironment(app, mainLog)
  mainLog(`boot: whenReady (v${app.getVersion()}, packaged=${app.isPackaged})`)
  bootMetrics.mark('whenReady')
  const secureAvailable = initSecureKV()
  bootMetrics.mark('secureKV')
  mainLog(`boot: secureKV ready (available=${secureAvailable})`)
  ipcMain.on('log:renderer', (_event, { scope, msg }) => mainLog(`[renderer:${scope}] ${msg}`))
  // Renderer milestones (first paint, hydration end) land in the same timeline
  // as the main-process phases, so a spike can be attributed to a phase.
  ipcMain.on('boot:mark', (_event, label) => bootMetrics?.mark(label))
  // Frameless window controls: NativeHeaderBar draws min/max/close and gates
  // them on the bridge exposing winMinimize/winToggleMaximize/winClose (browser
  // dev has no preload -> no buttons). close() routes through the same
  // will-prevent-unload key-save gate as the native titlebar.
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize(); else w.maximize()
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  // Reload = refresh, never the stay/leave dialog: the beforeunload handlers
  // (key save + idle save) run synchronously before the reload lands.
  ipcMain.on('window:reload', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    reloadWanted = true
    w.webContents.reload()
    // Safety: if no unload attempt materializes, don't leak the bypass.
    setTimeout(() => { reloadWanted = false }, 3000)
  })
  const storageKeyPath = path.join(app.getPath('userData'), 'storage.key')
  let diskKey = null
  try { diskKey = fs.readFileSync(storageKeyPath, 'utf8').trim() } catch {}
  imageCache.init(app.getPath('userData'), UA, diskKey)
  bootMetrics.mark('imageCache.init')
  // Same storage key as the picture LRU: the vault holds adult media and must
  // never write it to disk in the clear.
  vault.init(app.getPath('userData'), diskKey)
  bootMetrics.mark('vault.init')
  // How much local media the boot scan had to look at. A spike in a fresh
  // profile and a spike after months of keepsakes are not the same bug.
  try {
    const vs = vault.stats()
    const cs = imageCache.cacheStats()
    mainLog(
      `boot: data vault=${vs.files} files/${Math.round(vs.bytes / 1048576)}MB ` +
        `imgcache=${cs.files} files/${Math.round(cs.bytes / 1048576)}MB`,
    )
  } catch { /* census is diagnostic only */ }
  bootMetrics.mark('census')
  vaultServer.start(app.getPath('userData')).catch(() => {
    /* best effort */
  })
  protocol.handle(imageCache.SCHEME, (request) => imageCache.serveImage(request))
  protocol.handle(vault.SCHEME, (request) => vault.serveVault(request))
  customFolders.init(app.getPath('userData'), { ipcMain, BrowserWindow })
  ipcMain.handle('booru:fetch', (_event, payload) => {
    // Player excludes arrive per round and become query negatives.
    setRoundExcludes((payload && payload.excludes) || [])
    return fetchBooru(payload ?? {})
  })
  ipcMain.handle('pmv:playlist', async (_event, id) => {
    const rawId = String(id || '').trim()
    if (!/^(?:[0-9a-fA-F]{24}|[a-zA-Z0-9_-]{12,32})$/.test(rawId)) return null
    try {
      const text = await httpGet(`https://pmvhaven.com/api/playlists/${rawId}`, { Referer: 'https://pmvhaven.com/' })
      return JSON.parse(text)
    } catch {
      return null
    }
  })
  // Secure KV bridge (B.3): renderer proxies designated localStorage keys here.
  ipcMain.handle('secure:available', () => secureAvailable)
  ipcMain.handle('secure:get', (_event, key) => secureKV.get(String(key)))
  ipcMain.handle('secure:set', (_event, key, value) => secureKV.set(String(key), String(value)))
  ipcMain.handle('secure:delete', (_event, key) => secureKV.delete(String(key)))
  ipcMain.handle('cache:image', (_event, url) => imageCache.cacheImage(url).then((local) => ({ local })))
  ipcMain.handle('cache:stats', () => imageCache.cacheStats())
  ipcMain.handle('cache:clear', () => imageCache.clearCache())
  ipcMain.handle('cache:clear-feed', () => imageCache.clearFeedCache())
  ipcMain.handle('cache:evict', (_event, url) => ({ ok: imageCache.evict(String(url ?? '')) }))
  // probe (not get) so a row whose bytes cannot be read is reported as
  // unreadable rather than a miss, and is never dropped from the manifest.
  ipcMain.handle('vault:get', (_event, url) => vault.probe(String(url ?? '')))
  ipcMain.handle('vault:pin', (_event, url) => vault.pin(String(url ?? '')).then((local) => ({ local })))
  ipcMain.handle('vault:pin-stream', (event, url) => vault.pinStream(String(url ?? ''), {
    onProgress: ({ bytes, total }) => {
      try { event.sender.send('vault:pin-stream-progress', { url: String(url ?? ''), bytes, total }) } catch {}
    },
  }))
  ipcMain.handle('vault:unpin', (_event, url) => ({ ok: vault.unpin(String(url ?? '')) }))
  ipcMain.handle('vault:remove', (_event, url) => ({ ok: vault.remove(String(url ?? '')) }))
  // Disco-first: bytes the renderer already holds (verified swarm assembly,
  // forged upload) are written straight to the encrypted store, re-checked
  // against their content hash in the main process.
  ipcMain.handle('vault:put-bytes', (_event, hash, mime, data, alias) =>
    vault.putBytes(String(hash ?? ''), String(mime ?? ''), data, alias == null ? null : String(alias)))
  ipcMain.handle('vault:list', () => vault.list())
  ipcMain.handle('vault:stats', () => vault.stats())
  ipcMain.handle('vault:clear', () => vault.clear())
  ipcMain.handle('vault:http-url', (_event, url) => ({ local: vaultServer.httpUrl(String(url ?? '')) }))
  // Update check (Settings): installed version + open the download in the OS browser.
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:open-log', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('shell:open', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.reject(new Error('only http(s) URLs'))
  })
  // Dynamic blocklist control (Settings -> Blocklist): full edit/reset.
  ipcMain.handle('blocklist:get', () => {
    const userPath = userBlocklistPath()
    return {
      current: currentBlocklistData || loadBlocklistData(),
      defaults: getDefaultBlocklistData(),
      isCustom: Boolean(userPath && fs.existsSync(userPath)),
    }
  })
  ipcMain.handle('blocklist:set', (_event, payload) => {
    try {
      let data = payload
      if (typeof data === 'string') data = JSON.parse(data)
      if (!data || typeof data !== 'object') {
        return { ok: false, error: 'Payload must be a JSON object' }
      }
      if (!Array.isArray(data.blocklist)) {
        return { ok: false, error: 'Payload must contain a "blocklist" array' }
      }
      // Single source of truth: shared/blocklist.json is the factory
      // default (read-only); Settings edits land ONLY in the userData copy,
      // which takes precedence on load.
      const userPath = userBlocklistPath()
      if (userPath) {
        fs.mkdirSync(path.dirname(userPath), { recursive: true })
        fs.writeFileSync(userPath, JSON.stringify(data, null, 2), 'utf8')
      }
      currentBlocklistData = data
      currentBlocklist = data.blocklist
      return { ok: true, data: currentBlocklistData }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
  ipcMain.handle('blocklist:reset', () => {
    try {
      const userPath = userBlocklistPath()
      if (userPath && fs.existsSync(userPath)) {
        fs.unlinkSync(userPath)
      }
      currentBlocklistData = getDefaultBlocklistData()
      currentBlocklist = Array.isArray(currentBlocklistData.blocklist) ? currentBlocklistData.blocklist : []
      return { ok: true, data: currentBlocklistData }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
  // OS wallpaper swap for consented domination effects (Windows; no-op else).
  ipcMain.handle('wallpaper:set-data', (_event, buf, mime) => wallpaperWin.setWallpaperFromBuffer(Buffer.from(buf), String(mime || '')))
  ipcMain.handle('wallpaper:restore', () => wallpaperWin.restoreWallpaper())
  ipcMain.handle('wallpaper:cleanup-files', () => { wallpaperWin.cleanupWallpaperFiles(); return { ok: true } })
  // A domination wallpaper that outlives the app is the worst failure mode of
  // this feature: the victim closes gMatch and their desktop is still
  // somebody else's picture, with the only copy of the original living in this
  // process. Nothing called restore on the way out (cleanup-files only deletes
  // temp files, it does not put the wallpaper back), so close it here.
  for (const evt of ['before-quit', 'will-quit']) {
    app.on(evt, () => { if (wallpaperWin.hasPendingSwap()) void wallpaperWin.restoreWallpaper() })
  }
  // Camera stays denied by default; the renderer consumes a one-shot grant
  // only AFTER the victim clicks "Allow once" on the in-app prompt.
  ipcMain.handle('camera:grant-once', () => { cameraGrantOnce = true; return { ok: true } })
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' && cameraGrantOnce) {
      cameraGrantOnce = false
      callback(true)
      return
    }
    // Clipboard read/write: the in-app context menu (Copy Image / Paste rows)
    // dies silently without these — Electron asks BEFORE clipboard.readText()
    // resolves. The renderer is our own trusted bundle; same-origin only.
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write' || permission === 'clipboard-write') {
      callback(true)
      return
    }
    callback(false)
  })
  // Server-mode bridge for the Settings UI (packaged topology control).
  ipcMain.handle('server:state', () => ({
    packaged: app.isPackaged,
    // Hosts own their node: the PIN is shown in Settings so the developer
    // (and any self-hoster) can unlock the bundled admin console. See
    // electron/admin-pin.cjs header for the trust argument.
    adminPin: require('./admin-pin.cjs').adminPin(app.getPath('userData')),
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
  ipcMain.handle('server:probe', async (_event, url) => {
    try {
      const res = await net.fetch(String(url || ''))
      return { ok: res.ok, status: res.status }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
  // Apply the new mode NOW: relaunch the app (used by the Settings button).
  ipcMain.handle('server:relaunch', () => {
    apiSidecar.stopApi()
    try { if (secureKV) secureKV.flush() } catch { /* best effort */ }
    const execPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
    app.relaunch({ execPath })
    app.exit(0)
  })
  // P2P mesh (Slice 3): lazy libp2p node in main (ESM, dynamic import — main
  // stays CJS). The node boots on first p2p:* call, never at app launch, so
  // Offline starts pay nothing. Renderer speaks sealed Envelope-v2 only.
  let p2pHostPromise = null
  async function p2pHostEnsure() {
    if (!p2pHostPromise) {
      p2pHostPromise = import('./p2p-host.mjs').then(({ createP2PHost }) =>
        createP2PHost({
          secureKV,
          webContents: () => BrowserWindow.getAllWindows().map((w) => w.webContents),
          log: mainLog,
        }),
      ).catch((err) => { p2pHostPromise = null; throw err })
    }
    return p2pHostPromise
  }
  ipcMain.handle('p2p:status', async () => {
    try { return await (await p2pHostEnsure()).status() } catch (err) { return { started: false, error: err?.message || String(err) } }
  })
  ipcMain.handle('p2p:peers', async () => {
    try { return await (await p2pHostEnsure()).peers() } catch { return [] }
  })
  ipcMain.handle('p2p:send', async (_event, payload) => {
    try { return await (await p2pHostEnsure()).send(payload ?? {}) } catch (err) { return { ok: false, error: err?.message || String(err) } }
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
  // Topology: packaged builds default to CLIENT mode on the central node
  // (gmatch-wcz1.onrender.com); host mode (the bundled server) is the opt-in in
  // Settings. Dev keeps the repo-local sidecar path unchanged.
  // The window MUST exist before any sidecar wait: 1.2.5 blocked up to 30s
  // on startApi() before createWindow(), so a slow/migrating bundled server
  // looked like "Task Mgr spin, never opens" (and invited double-clicks
  // that EADDRINUSE-crashed the sidecar).
  let sidecarRestartTried = false
  const onSidecarCrash = async (code) => {
    mainLog(`sidecar crashed code=${code}`)
    if (!sidecarRestartTried) {
      sidecarRestartTried = true
      try {
        await apiSidecar.startApi()
        mainLog('sidecar restarted ok')
        return
      } catch (e) {
        mainLog(`sidecar restart failed: ${e?.message || e}`)
      }
    }
    try {
      dialog.showErrorBox(
        'The local server stopped',
        `gMatch could not keep its bundled server running.\n\nRestart the app, or switch to a friend's server in Settings > Server.\n\n${LOG_HINT}`,
      )
    } catch { /* headless edge */ }
  }
  let sidecarLogCount = 0
  apiSidecar.sidecarEvents.on('stderr', (line) => {
    // Crash forensics without letting a chatty server fill main.log.
    if (sidecarLogCount++ < 40) mainLog(`[sidecar] ${line}`)
  })
  apiSidecar.sidecarEvents.on('crashed', (code) => void onSidecarCrash(code))
  // Read topology early (sync, cheap) so the window gets the right --api-base.
  try {
    if (app.isPackaged) {
      packagedServer = serverMode.readServerMode()
      mainLog(`boot: server mode=${packagedServer.mode} url=${packagedServer.url}`)
    }
  } catch (err) {
    mainLog(`boot: readServerMode failed, defaulting to client (${err?.message || err})`)
    packagedServer = { mode: 'client', url: 'https://gmatch-wcz1.onrender.com' }
  }
  // Window first — never gate first paint on the bundled server.
  mainLog(`boot: creating window (v${app.getVersion()}, packaged=${app.isPackaged})`)
  createWindow()
  bootMetrics.mark('window.created')
  updater?.schedule()
  // Start the bundled server in the background (host mode only). Failures
  // surface as dialogs + log lines; they can never take the window with them.
  const startSidecarBg = async () => {
    if (app.isPackaged) {
      if (packagedServer.mode !== 'host') return
      process.env.GMATCH_HOST_MODE = '1'
      mainLog('boot: starting bundled server (host mode, background)')
      try {
        await apiSidecar.startApi()
        mainLog('boot: bundled server ready')
      } catch (err) {
        mainLog(`bundled server start failed: ${err?.message || err}`)
        try {
          dialog.showErrorBox(
            'gMatch could not start its server',
            `${String(err?.message || err)}\n\nOpen Settings > Server to switch to a friend's server, then restart.\n\n${LOG_HINT}`,
          )
        } catch { /* headless edge */ }
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
  }
  void startSidecarBg()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
  .catch((err) => {
    // A fatal during boot used to leave a windowless zombie: no window, no
    // error. Log it, show it, open a fallback window so the process is never
    // a Task-Mgr-only ghost, then let the user decide.
    mainLog(`boot failed: ${err?.stack || err}`)
    try { dialog.showErrorBox('gMatch could not start', `${String(err?.message || err)}\n\n${LOG_HINT}`) } catch { /* headless edge */ }
    try {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    } catch { /* last resort: process exits via window-all-closed */ }
  })

// Portable double-launch (or a stale lock): focus the running window instead
// of starting a second sidecar fight. If the first instance somehow has no
// window (crashed boot), open one so a retry never looks like a silent quit.
app.on('second-instance', () => {
  mainLog('second-instance: focusing existing window')
  const w = BrowserWindow.getAllWindows()[0]
  if (w) {
    if (w.isMinimized()) w.restore()
    w.focus()
  } else {
    try { createWindow() } catch { /* best effort */ }
  }
})

app.on('before-quit', () => {
  // Close the startup window early on quit so the summary is still written
  // (otherwise a fast close loses the measurement entirely).
  try { bootMetrics?.finish('quit') } catch { /* diagnostics only */ }
  apiSidecar.stopApi(); try { if (secureKV) secureKV.flush() } catch { /* best effort */ }
})
app.on('will-quit', () => { apiSidecar.stopApi() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
