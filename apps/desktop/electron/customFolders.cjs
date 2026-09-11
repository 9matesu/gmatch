// Player-owned idle-clicker folders (custom image sources).
// The renderer can never touch the filesystem: the player picks a directory
// via dialog, main persists the GRANT (id + path only, never file content —
// security plan B.1 stays intact) in userData/custom-folders.json, lists
// directory entries over IPC, and serves files over the privileged
// idle-file://<grantId>/<filename> scheme. Path traversal is rejected:
// the resolved absolute path must stay inside the granted directory, and
// only media extensions are served (25MB single-file cap, like the cache).
const fs = require('fs')
const path = require('path')
// NOTE: 'electron' is required lazily inside init()/pickFolder() so the pure
// helpers (path guards) stay loadable under plain node for unit tests.

const SCHEME = 'idle-file'
const MEDIA_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'mp4', 'webm', 'mov'])
const LIST_CAP = 500
const MAX_SINGLE_BYTES = 25 * 1024 * 1024

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}

let userDataPath = ''
let grants = [] // { id, path }

function grantsFile() {
  return path.join(userDataPath, 'custom-folders.json')
}

function loadGrants() {
  grants = []
  try {
    const raw = fs.readFileSync(grantsFile(), 'utf8')
    const d = JSON.parse(raw)
    if (Array.isArray(d)) {
      for (const g of d) {
        if (g && typeof g.id === 'string' && typeof g.path === 'string') grants.push({ id: g.id, path: g.path })
      }
    }
  } catch {
    /* first run or corrupt — start empty */
  }
}

function persistGrants() {
  try {
    fs.writeFileSync(grantsFile(), JSON.stringify(grants))
  } catch {
    /* best effort */
  }
}

function findGrant(id) {
  return grants.find((g) => g.id === String(id)) || null
}

async function pickFolder(parentWindow, dialog) {
  let res
  try {
    res = await dialog.showOpenDialog(parentWindow || null, {
      properties: ['openDirectory'],
      title: 'Pick an image folder for the idle feed',
    })
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'dialog failed' }
  }
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, error: 'cancelled' }
  const dir = res.filePaths[0]
  const existing = grants.find((g) => g.path === dir)
  if (existing) return { ok: true, id: existing.id, path: existing.path }
  const id = 'f' + Date.now().toString(36)
  grants.push({ id, path: dir })
  persistGrants()
  return { ok: true, id, path: dir }
}

function listFolder(id) {
  const grant = findGrant(id)
  if (!grant) return { ok: false, error: 'unknown folder' }
  let entries
  try {
    entries = fs.readdirSync(grant.path, { withFileTypes: true })
  } catch {
    return { ok: false, error: 'folder unreadable (moved or deleted?)' }
  }
  const files = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const ext = path.extname(e.name).slice(1).toLowerCase()
    if (!MEDIA_EXTS.has(ext)) continue
    files.push({ name: e.name, url: `${SCHEME}://${grant.id}/${encodeURIComponent(e.name)}` })
    if (files.length >= LIST_CAP) break
  }
  return { ok: true, files }
}

function removeFolder(id) {
  const before = grants.length
  grants = grants.filter((g) => g.id !== String(id))
  if (grants.length !== before) persistGrants()
  return { ok: true }
}

function insideGrant(abs, root) {
  const normRoot = path.normalize(root)
  const normAbs = path.normalize(abs)
  return normAbs === normRoot || normAbs.startsWith(normRoot + path.sep)
}

function serveIdleFile(request) {
  try {
    const u = new URL(request.url)
    const grant = findGrant(u.host)
    if (!grant) return new Response('unknown folder', { status: 404 })
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
      return new Response('bad path', { status: 400 })
    }
    const abs = path.join(grant.path, rel)
    if (!insideGrant(abs, grant.path)) return new Response('forbidden', { status: 403 })
    const ext = path.extname(abs).slice(1).toLowerCase()
    if (!MEDIA_EXTS.has(ext)) return new Response('unsupported media', { status: 415 })
    let stat
    try {
      stat = fs.statSync(abs)
    } catch {
      return new Response('not found', { status: 404 })
    }
    if (!stat.isFile() || stat.size > MAX_SINGLE_BYTES) {
      return new Response('unavailable', { status: stat.isFile() ? 413 : 404 })
    }
    const data = fs.readFileSync(abs)
    return new Response(data, {
      headers: { 'Content-Type': EXT_MIME[ext] || 'application/octet-stream' },
    })
  } catch {
    return new Response('error', { status: 500 })
  }
}

function init(dataPath, { ipcMain, BrowserWindow }) {
   
  const { dialog, protocol } = require('electron')
  userDataPath = dataPath
  loadGrants()
  protocol.handle(SCHEME, (request) => serveIdleFile(request))
  ipcMain.handle('custom:pick-folder', (event) => {
    let win = null
    try {
      win = BrowserWindow.fromWebContents(event.sender) || null
    } catch {
      win = null
    }
    return pickFolder(win, dialog)
  })
  ipcMain.handle('custom:list-folder', (_event, id) => listFolder(id))
  ipcMain.handle('custom:remove-folder', (_event, id) => removeFolder(id))
}

module.exports = { SCHEME, init, __test: { findGrant: (id) => findGrant(id), insideGrant } }
