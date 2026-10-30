// gMatch local media vault (main process) -- the app's on-disk media store.
//
// CONTENT-ADDRESSED: a file is named by the sha256 of its bytes, so identical
// bytes are stored once, a record's local reference (localRef) IS its content
// hash, and the P2P swarm object id needs no separate mapping. Every media byte
// the app receives (gallery keeps, card media, swarm objects, uploads) is
// written here; the renderer falls back to IndexedDB only when no Electron
// bridge exists (browser dev).
//
// ENCRYPTED: AES-256-GCM with the same storage key as the picture LRU
// (electron/aeadFile.cjs). Adult media never lands on disk in the clear.
//
// Layout: <userData>/media-vault/<sha256> + manifest.json
//   manifest: storeKey -> { file, mime, bytes, atime, pins, hash, enc }
//   `storeKey` is how a caller names the object (source url, object id, or
//   `local://<hash>` for an anonymous put). `hash` is the content identity and
//   the on-disk file name. Legacy entries (older builds) used the url-derived
//   `<sha256(url)>.<ext>` as file name, carried no `hash`, and were plaintext
//   (`enc` absent); they are read as-is and never re-keyed.
// Quota 3GB, LRU over unpinned entries; pinned entries (gallery keeps, cards)
// survive eviction until unpinned/removed. A file is deleted only when no
// manifest entry still references it (content dedupe).
const fs = require('fs')
const path = require('path')
const nodeCrypto = require('crypto')
const aead = require('./aeadFile.cjs')
const imageCache = require('./imageCache.cjs')

const SCHEME = 'vault'
const QUOTA_BYTES = 3 * 1024 * 1024 * 1024
const HASH_RE = /^[0-9a-f]{64}$/i

/** Store key for a by-hash put with no caller-provided name. */
function localKey(hash) {
  return `local://${hash}`
}

let dir = null
let encKey = null
/** storeKey -> entry */
let manifest = {}
/** content hash -> storeKey (dedupe + lookup by content) */
let byHash = new Map()
/** Test seam: stub the byte fetcher (defaults to imageCache.fetchBinary). */
let fetcher = null
/** storeKeys whose bytes could not be read/hashed this session: the lazy
 *  content-hash backfill must not re-read them on every lookup. */
const unhashable = new Set()

function hashOf(buf) {
  return nodeCrypto.createHash('sha256').update(buf).digest('hex')
}

/** On-disk file name of an entry (legacy rows carry `key` instead of `file`). */
function fileOf(entry) {
  return (entry && (entry.file || entry.key)) || null
}

function fileFor(file) {
  return dir && file ? path.join(dir, file) : null
}

function manifestPath() {
  return dir ? path.join(dir, 'manifest.json') : null
}

function loadManifest() {
  manifest = {}
  byHash = new Map()
  unhashable.clear()
  try {
    const raw = fs.readFileSync(manifestPath(), 'utf8')
    const d = JSON.parse(raw)
    if (d && typeof d === 'object') {
      for (const [storeKey, e] of Object.entries(d)) {
        if (!e || typeof e !== 'object') continue
        const file = fileOf(e)
        if (typeof file !== 'string' || typeof e.bytes !== 'number') continue
        const entry = {
          file,
          mime: String(e.mime || ''),
          bytes: e.bytes,
          atime: Number(e.atime) || 0,
          pins: Number(e.pins) || 0,
        }
        if (typeof e.hash === 'string' && HASH_RE.test(e.hash)) entry.hash = e.hash.toLowerCase()
        if (e.enc) entry.enc = 1
        manifest[storeKey] = entry
        if (entry.hash) byHash.set(entry.hash, storeKey)
      }
    }
  } catch {
    /* missing/corrupt -- start empty */
  }
}

function writeManifest() {
  try {
    if (manifestPath()) fs.writeFileSync(manifestPath(), JSON.stringify(manifest))
  } catch {
    /* disk hiccup -- memory still authoritative this session */
  }
}

function totalBytes() {
  let n = 0
  for (const e of Object.values(manifest)) n += e.bytes
  return n
}

/** Other manifest entries pointing at the same file (content dedupe). */
function referencedByOthers(file, exceptStoreKey) {
  return Object.keys(manifest).some(
    (k) => k !== exceptStoreKey && fileOf(manifest[k]) === file,
  )
}

function dropEntry(storeKey) {
  const e = manifest[storeKey]
  if (!e) return false
  const file = fileOf(e)
  delete manifest[storeKey]
  if (e.hash && byHash.get(e.hash) === storeKey) {
    const alt = Object.keys(manifest).find((k) => fileOf(manifest[k]) === file)
    if (alt) byHash.set(e.hash, alt)
    else byHash.delete(e.hash)
  }
  if (file && !referencedByOthers(file, storeKey)) {
    try {
      fs.rmSync(fileFor(file), { force: true })
    } catch {
      /* already gone */
    }
  }
  return true
}

/** Evict oldest unpinned entries until `need` bytes fit under quota. */
function makeRoom(need) {
  if (totalBytes() + need <= QUOTA_BYTES) return true
  const cands = Object.entries(manifest)
    .filter(([, e]) => (e.pins || 0) <= 0)
    .sort((a, b) => a[1].atime - b[1].atime)
  for (const [storeKey] of cands) {
    dropEntry(storeKey)
    if (totalBytes() + need <= QUOTA_BYTES) return true
  }
  return totalBytes() + need <= QUOTA_BYTES
}

function readFileBytes(entry) {
  const buf = fs.readFileSync(fileFor(fileOf(entry)))
  if (!entry.enc) return buf
  return aead.decrypt(buf, encKey)
}

function writeFileBytes(file, buf) {
  const out = encKey ? aead.encrypt(buf, encKey) : buf
  fs.writeFileSync(fileFor(file), out)
}

/** Index (or re-index) bytes already on disk under a content hash. */
function indexContent(storeKey, file, hash, mime, bytes, pins) {
  const prev = manifest[storeKey]
  manifest[storeKey] = {
    file,
    mime: String(mime || ''),
    bytes,
    atime: Date.now(),
    pins: pins || (prev && prev.pins) || 1,
    hash,
    enc: encKey ? 1 : 0,
  }
  if (prev && prev.hash && prev.hash !== hash && byHash.get(prev.hash) === storeKey) {
    byHash.delete(prev.hash)
  }
  byHash.set(hash, storeKey)
}

/**
 * Legacy rows were named sha256(source url) and carry no `hash`, so
 * `vault://f/<contentHash>` -- the keep's own local identity (sha256 of the
 * bytes) -- could not resolve them even though the bytes sit on disk. On a
 * hash miss, read each hash-less entry once, hash its (decrypted) bytes and
 * bind the hash, then persist. Bounded and one-time: an entry that has given
 * a hash is never re-read, and bytes that cannot be read or decrypted are
 * skipped (reported unreadable by `probe`, never as absence).
 */
function bindContentHashes(want) {
  if (!HASH_RE.test(want)) return
  let changed = false
  for (const storeKey of Object.keys(manifest)) {
    const e = manifest[storeKey]
    if (e.hash || unhashable.has(storeKey)) continue
    let hash
    try {
      // aead.decrypt returns null (not throws) on a bad envelope.
      const buf = readFileBytes(e)
      if (!buf) throw new Error('unreadable')
      hash = hashOf(buf)
    } catch {
      unhashable.add(storeKey)
      continue
    }
    e.hash = hash
    changed = true
    if (!byHash.has(hash)) byHash.set(hash, storeKey)
  }
  if (changed) writeManifest()
}

function entryFor(ref) {
  if (!ref) return null
  let str = String(ref)
  if (str.startsWith(`${SCHEME}://f/`)) str = str.split('/').pop() || ''
  if (!str || str.includes('..')) return null
  const direct = manifest[str]
  if (direct) return { storeKey: str, entry: direct }
  if (HASH_RE.test(str)) {
    const wanted = str.toLowerCase()
    let storeKey = byHash.get(wanted)
    if (!storeKey) {
      bindContentHashes(wanted)
      storeKey = byHash.get(wanted)
    }
    if (storeKey) return { storeKey, entry: manifest[storeKey] }
  }
  const byFile = Object.keys(manifest).find((k) => fileOf(manifest[k]) === str)
  if (byFile) return { storeKey: byFile, entry: manifest[byFile] }
  // Object ids survive world moves: the manifest was written with the node URL
  // that served the bytes (https://gmatch.fly.dev/api/objects/<id>, a LAN
  // origin, …). A post row only knows its id, so match any stored key that ends
  // in /api/objects/<id>. Without this, media that is physically on disk reads
  // as "absent" after switching worlds and the tile waits for a seeder forever.
  if (!str.includes('/')) {
    const suffix = `/api/objects/${str}`
    const byObjectId = Object.keys(manifest).find((k) => k.endsWith(suffix))
    if (byObjectId) return { storeKey: byObjectId, entry: manifest[byObjectId] }
  }
  return null
}

function init(userDataPath, storageKeyHex) {
  dir = path.join(String(userDataPath), 'media-vault')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    dir = null
  }
  encKey = aead.keyFrom(storageKeyHex, userDataPath)
  loadManifest()
}

function stats() {
  return {
    files: Object.keys(manifest).length,
    objects: byHash.size,
    bytes: totalBytes(),
    quota: QUOTA_BYTES,
    dir: Boolean(dir),
    encrypted: Boolean(encKey),
  }
}

/**
 * Lookup only: vault:// URL when the bytes are already local, else null.
 * Accepts a store key (source url / object id), a content hash, or a
 * vault://f/<file> URL. Renderers use this per mount -- never downloads, so
 * mere browsing can't fill the disk.
 */
function get(ref) {
  try {
    if (!ref || !dir) return null
    const hit = entryFor(ref)
    if (!hit) return null
    try {
      fs.accessSync(fileFor(fileOf(hit.entry)), fs.constants.R_OK)
    } catch {
      // NEVER drop here. A locked/transiently unreadable file (AV scan, a
      // concurrent write, a permission blip) used to delete the manifest entry
      // AND the blob, so media that was cached a second earlier vanished for
      // good. `probe` reports the same row as unreadable; this path just misses
      // it for now and `pin` can re-fetch it later.
      return null
    }
    hit.entry.atime = Date.now()
    return `${SCHEME}://f/${fileOf(hit.entry)}`
  } catch {
    return null
  }
}

/**
 * Honest lookup for callers that must tell "no local bytes" apart from "bytes
 * are here but could not be read or decrypted" -- and that must not destroy a
 * record on a transient read failure. Returns
 * { state: 'absent' } | { state: 'local', local, mime } |
 * { state: 'unreadable', reason: 'missing-file' | 'decrypt' | 'read' }.
 */
function probe(ref) {
  try {
    if (!ref || !dir) return { state: 'absent' }
    const hit = entryFor(ref)
    if (!hit) return { state: 'absent' }
    const file = fileFor(fileOf(hit.entry))
    if (!file) return { state: 'absent' }
    try {
      fs.accessSync(file, fs.constants.R_OK)
    } catch {
      return { state: 'unreadable', reason: 'missing-file' }
    }
    // Encrypted rows: prove the envelope actually decrypts, so a corrupt or
    // key-mismatched file is diagnosable instead of a silently broken render
    // (aead.decrypt returns null rather than throwing on a bad envelope).
    if (hit.entry.enc) {
      let plain = null
      try {
        plain = readFileBytes(hit.entry)
      } catch {
        plain = null
      }
      if (!plain) return { state: 'unreadable', reason: 'decrypt' }
    }
    hit.entry.atime = Date.now()
    return { state: 'local', local: `${SCHEME}://f/${fileOf(hit.entry)}`, mime: hit.entry.mime || '' }
  } catch {
    return { state: 'unreadable', reason: 'read' }
  }
}

/**
 * Fetch + pin one URL's bytes. Returns the vault:// URL or null (caller falls
 * back to remote). The bytes are content-addressed, so a re-pin of identical
 * content reuses the file instead of writing a second copy.
 */
async function pin(url) {
  try {
    if (!url || !dir) return null
    const str = String(url)
    if (str.startsWith(`${SCHEME}://f/`)) {
      const hit = get(str)
      if (hit) return hit
    }
    const existing = get(str)
    if (existing) {
      const e = manifest[str]
      if (e) {
        e.pins = (e.pins || 0) + 1
        writeManifest()
      }
      return existing
    }
    // idle-file:// (player-owned idle folders) is not http(s) -- the byte
    // fetcher rejects any other scheme, so those keeps never reached disk
    // and only reappeared while the clicker held the folder grant open.
    // Read the granted path directly instead of routing through the fetcher.
    let fetched = null
    if (str.startsWith('idle-file://')) {
      fetched = require('./customFolders.cjs').readIdleFile(str)
      if (!fetched) return null
    } else if (str.startsWith('gmcache://')) {
      const cacheKey = str.replace('gmcache://', '')
      const cached = require('./diskImageCache.cjs').get(cacheKey)
      if (cached) {
        const buf = Buffer.isBuffer(cached) ? cached : cached.buf
        if (buf && buf.length > 0) {
          fetched = { buf, mime: cached.mime || 'image/jpeg' }
        }
      }
      if (!fetched) {
        try {
          const m = imageCache.readCache ? imageCache.readCache(str) : null
          if (m && m.buf) fetched = m
        } catch {}
      }
      if (!fetched) return null
    } else {
      const fetch = fetcher || imageCache.fetchBinary
      try {
        fetched = await fetch(str)
      } catch {
        // The booru hosts sometimes 404 a URL whose extension is wrong or
        // rotated: retry the same path with each common image extension.
        if (/\.(jpe?g|png|gif|webp)$/i.test(str)) {
          const exts = ['jpg', 'png', 'gif', 'jpeg']
          for (const ext of exts) {
            const alt = str.replace(/\.(jpe?g|png|gif|webp)$/i, `.${ext}`)
            if (alt === str) continue
            try {
              fetched = await fetch(alt)
              if (fetched && fetched.buf) break
            } catch {}
          }
        }
      }
    }
    if (!fetched || !fetched.buf || fetched.buf.length === 0) return null
    const { buf, mime } = fetched
    const cap = imageCache.capFor(mime, str)
    if (buf.length > cap) return null
    if (!makeRoom(buf.length)) return null
    const hash = hashOf(buf)
    try {
      if (!fs.existsSync(fileFor(hash))) writeFileBytes(hash, buf)
    } catch {
      return null
    }
    indexContent(str, hash, hash, mime, buf.length, 1)
    writeManifest()
    return `${SCHEME}://f/${hash}`
  } catch {
    return null
  }
}

/**
 * Streaming pin for large media (keepsake MP4s of any size). Downloads the
 * response body in chunks straight to a temp file -- the whole file is NEVER
 * buffered in memory -- while hashing and encrypting incrementally (single
 * pass). There is NO per-file byte cap: the vault quota is the only limit.
 * Incomplete/failed writes are deleted, never renamed into place. Returns
 * { ok, key, mime, bytes, hash } or { ok:false, reason }.
 */
async function pinStream(url, { onProgress } = {}) {
  const fail = (reason) => ({ ok: false, reason })
  try {
    if (!url || !dir) return fail('no-vault')
    const str = String(url)
    let u
    try {
      u = new URL(str)
    } catch {
      return fail('bad-url')
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('bad-scheme')
    // Temp name is opaque: the real file is named by its content hash, which
    // is only known once the stream ends.
    const tmp = fileFor(`${nodeCrypto.randomBytes(8).toString('hex')}.part-${Date.now()}`)
    let res
    try {
      res = await fetch(str, { redirect: 'follow' })
    } catch {
      return fail('fetch')
    }
    if (!res || !res.ok || !res.body) {
      try { if (res && res.body && res.body.cancel) await res.body.cancel() } catch {}
      return fail(`http-${res ? res.status : 'none'}`)
    }
    const headerMime = String(res.headers.get('content-type') || '').split(';')[0].trim()
    const isVideo =
      /^video\//i.test(headerMime) ||
      /\.(mp4|webm|mov|mkv)(?:[?#]|$)/i.test(str)
    const mime = headerMime || (isVideo ? 'video/mp4' : 'application/octet-stream')
    if (!/^(image|video)\//i.test(mime)) {
      try { await res.body.cancel() } catch {}
      return fail('not-media')
    }
    const total = Number(res.headers.get('content-length')) || 0
    // Same policy as pin(): evict oldest UNPINNED entries to make room, never
    // the pinned keepsakes. A file bigger than the whole quota can never fit.
    if (total > 0 && (total > QUOTA_BYTES || !makeRoom(total))) {
      try { await res.body.cancel() } catch {}
      return fail('quota')
    }
    // Free disk space (best-effort; platform-dependent).
    try {
      const st = fs.statfsSync(dir)
      const free = Number(st.bavail) * Number(st.bsize)
      const need = total > 0 ? total : 64 * 1024 * 1024
      if (Number.isFinite(free) && free < need) {
        try { await res.body.cancel() } catch {}
        return fail('disk-full')
      }
    } catch {
      /* statfs unavailable -- quota still enforced below */
    }
    const hash = nodeCrypto.createHash('sha256')
    const iv = nodeCrypto.randomBytes(aead.IV_BYTES)
    const cipher = encKey ? nodeCrypto.createCipheriv(aead.ALGO, encKey, iv) : null
    let bytes = 0
    let lastEmit = 0
    const out = fs.createWriteStream(tmp)
    try {
      if (cipher) {
        out.write(iv)
        out.write(Buffer.alloc(aead.TAG_BYTES)) // tag placeholder, patched below
      }
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.length === 0) continue
        // The .part file is not in the manifest, so it must fit on top of the
        // quota: evict unpinned entries before giving up (parity with pin()).
        if (totalBytes() + bytes + value.length > QUOTA_BYTES && !makeRoom(bytes + value.length)) {
          try { await reader.cancel() } catch {}
          throw new Error('quota')
        }
        hash.update(value)
        bytes += value.length
        const chunk = cipher ? cipher.update(value) : value
        if (chunk.length > 0) {
          const okWrite = out.write(chunk)
          if (!okWrite) await new Promise((resolve) => out.once('drain', resolve))
        }
        const now = Date.now()
        if (onProgress && now - lastEmit > 250) {
          lastEmit = now
          try { onProgress({ bytes, total }) } catch {}
        }
      }
      if (cipher) {
        const tail = cipher.final()
        if (tail.length > 0) {
          const okWrite = out.write(tail)
          if (!okWrite) await new Promise((resolve) => out.once('drain', resolve))
        }
      }
      await new Promise((resolve, reject) => {
        out.on('finish', resolve)
        out.on('error', reject)
        out.end()
      })
    } catch (err) {
      try { out.destroy() } catch {}
      try { fs.rmSync(tmp, { force: true }) } catch {}
      return fail(err && err.message === 'quota' ? 'quota' : 'write')
    }
    if (bytes === 0) {
      try { fs.rmSync(tmp, { force: true }) } catch {}
      return fail('empty')
    }
    if (cipher) {
      // Patch the GCM tag into its reserved slot (offset 12).
      try {
        const fd = fs.openSync(tmp, 'r+')
        fs.writeSync(fd, cipher.getAuthTag(), 0, aead.TAG_BYTES, aead.IV_BYTES)
        fs.closeSync(fd)
      } catch {
        try { fs.rmSync(tmp, { force: true }) } catch {}
        return fail('write')
      }
    }
    const contentHash = hash.digest('hex')
    try {
      if (fs.existsSync(fileFor(contentHash))) {
        fs.rmSync(tmp, { force: true }) // identical bytes already stored
      } else {
        fs.renameSync(tmp, fileFor(contentHash))
      }
    } catch {
      try { fs.rmSync(tmp, { force: true }) } catch {}
      return fail('write')
    }
    if (onProgress) {
      try { onProgress({ bytes, total: total || bytes }) } catch {}
    }
    indexContent(str, contentHash, contentHash, mime, bytes, (manifest[str] && manifest[str].pins) || 1)
    writeManifest()
    return { ok: true, key: contentHash, mime: String(mime || ''), bytes, hash: contentHash }
  } catch {
    return fail('error')
  }
}

/**
 * Write bytes the caller already holds (a verified swarm chunk assembly, a
 * forged upload) straight to the encrypted content-addressed store. The hash
 * is re-verified against the bytes: a caller cannot file content under a
 * different identity. `alias` is an optional store key (source url / object
 * id) so the object stays addressable by that name too.
 */
function putBytes(hash, mime, data, alias) {
  try {
    if (!dir || !data) return { ok: false, reason: 'no-vault' }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (!buf.length) return { ok: false, reason: 'empty' }
    const want = String(hash || '').toLowerCase()
    if (!HASH_RE.test(want)) return { ok: false, reason: 'bad-hash' }
    if (hashOf(buf) !== want) return { ok: false, reason: 'hash-mismatch' }
    if (!fs.existsSync(fileFor(want))) {
      if (!makeRoom(buf.length)) return { ok: false, reason: 'quota' }
      try {
        writeFileBytes(want, buf)
      } catch {
        return { ok: false, reason: 'write' }
      }
    }
    const storeKey = alias ? String(alias) : localKey(want)
    indexContent(storeKey, want, want, mime, buf.length, (manifest[storeKey] && manifest[storeKey].pins) || 1)
    writeManifest()
    return { ok: true, ref: want, file: want, bytes: buf.length }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/** Distinct stored objects ({ ref, mime, bytes }) for swarm rehydration. */
function list() {
  try {
    const out = []
    for (const storeKey of Object.keys(manifest)) {
      const e = manifest[storeKey]
      if (!e.hash || byHash.get(e.hash) !== storeKey) continue
      out.push({ ref: e.hash, mime: e.mime, bytes: e.bytes })
    }
    return out
  } catch {
    return []
  }
}

function unpin(ref) {
  try {
    const hit = entryFor(ref)
    if (!hit) return false
    hit.entry.pins = Math.max(0, (hit.entry.pins || 0) - 1)
    writeManifest()
    return true
  } catch {
    return false
  }
}

/** Delete bytes immediately regardless of pins (user asked it gone). */
function remove(ref) {
  try {
    const hit = entryFor(ref)
    if (!hit) return false
    const ok = dropEntry(hit.storeKey)
    if (ok) writeManifest()
    return ok
  } catch {
    return false
  }
}

/** Wipe the whole vault. */
function clear() {
  try {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already clean */
  }
  manifest = {}
  byHash = new Map()
  try {
    if (dir) fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* next init recreates */
  }
  writeManifest()
  return stats()
}

/**
 * protocol.handle('vault') -- serves vault files by basename (the content
 * hash). Unknown/evicted key -> 404 (renderer falls back to remote). Bytes are
 * decrypted before the Range slice so seeking works on plaintext offsets.
 */
async function serveVault(request) {
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
    const storeKey = Object.keys(manifest).find((k) => fileOf(manifest[k]) === key)
    if (!storeKey || !dir) return new Response('miss', { status: 404 })
    const entry = manifest[storeKey]
    let buf
    try {
      buf = readFileBytes(entry)
    } catch {
      return new Response('miss', { status: 404 })
    }
    if (!buf) return new Response('miss', { status: 404 })
    // Range support: a 100MB+ mp4 must seek; answering the whole file with
    // 200 forces the browser to re-download everything on every jump.
    const base = {
      'Content-Type': entry.mime || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '')
    if (range) {
      const total = buf.length
      let start = range[1] ? parseInt(range[1], 10) : 0
      let end = range[2] ? Math.min(parseInt(range[2], 10), total - 1) : total - 1
      if (!Number.isFinite(start) || start >= total || start > end) {
        return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${buf.length}` } })
      }
      const slice = buf.subarray(start, end + 1)
      return new Response(slice, {
        status: 206,
        headers: { ...base, 'Content-Length': String(slice.length), 'Content-Range': `bytes ${start}-${end}/${total}` },
      })
    }
    return new Response(buf, { headers: { ...base, 'Content-Length': String(buf.length) } })
  } catch {
    return new Response('cache error', { status: 500 })
  }
}

module.exports = {
  SCHEME,
  QUOTA_BYTES,
  init,
  stats,
  get,
  probe,
  pin,
  pinStream,
  putBytes,
  list,
  unpin,
  remove,
  clear,
  serveVault,
  // Test seam.
  _test: {
    hashOf,
    fileOf,
    makeRoom: (need) => makeRoom(need),
    manifest: () => manifest,
    localKey,
    setDir: (d) => { dir = d },
    setFetcher: (fn) => {
      fetcher = fn
    },
  },
}
