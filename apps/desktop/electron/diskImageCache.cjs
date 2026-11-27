// Encrypted on-disk LRU cache for images (Plan: RAM-to-Disk).
// Replaces in-memory LRU Map with AES-256-GCM encrypted disk files.
// Files stored at userData/imgcache/<key>.enc.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const aead = require('./aeadFile.cjs')

const MAX_DEFAULT = 500 * 1024 * 1024 // 500 MB disk ceiling

let maxBytes = MAX_DEFAULT
let dbPath = null
let encKey = null // 32-byte Buffer
const index = new Map() // key -> { size, ts }
let total = 0

function init(userDataPath, storageKeyHex) {
  dbPath = path.join(userDataPath, 'imgcache')
  try { fs.mkdirSync(dbPath, { recursive: true }) } catch {}
  encKey = aead.keyFrom(storageKeyHex, userDataPath)
  index.clear()
  total = 0
  try {
    const files = fs.readdirSync(dbPath)
    for (const f of files) {
      if (!f.endsWith('.enc')) continue
      const filePath = path.join(dbPath, f)
      const stat = fs.statSync(filePath)
      const key = f.slice(0, -4)
      index.set(key, { size: stat.size, ts: stat.mtimeMs })
      total += stat.size
    }
  } catch {}
}

function encrypt(buf) {
  return aead.encrypt(buf, encKey)
}

function decrypt(raw) {
  return aead.decrypt(raw, encKey)
}

function evict() {
  while (total > maxBytes && index.size > 0) {
    let oldestKey = null
    let oldestTs = Infinity
    for (const [k, v] of index) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts
        oldestKey = k
      }
    }
    if (!oldestKey) break
    del(oldestKey)
  }
}

function put(key, buf) {
  if (!dbPath || !encKey || !buf) return false
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  const prev = index.get(safeKey)
  if (prev) {
    total -= prev.size
    try { fs.unlinkSync(path.join(dbPath, `${safeKey}.enc`)) } catch {}
    index.delete(safeKey)
  }
  try {
    const encrypted = encrypt(buf)
    fs.writeFileSync(path.join(dbPath, `${safeKey}.enc`), encrypted)
    index.set(safeKey, { size: encrypted.length, ts: Date.now() })
    total += encrypted.length
    evict()
    return true
  } catch {
    return false
  }
}

/** sha256 of the plaintext bytes — one identity for a picture under any url. */
function contentHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * Store bytes under their CONTENT hash ALONE. The MIME/extension lives in the
 * url index (`imageCache.cjs` meta), not in the file name: two mirrors serving
 * the same bytes as jpeg and png must share one encrypted .enc, or the LRU
 * counts the picture twice. A repeat only touches recency — no rewrite.
 */
function putContent(buf) {
  if (!dbPath || !encKey || !buf) return null
  const hash = contentHash(buf)
  const key = hash
  const safeKey = safe(key)
  const hit = index.get(safeKey)
  if (hit) {
    hit.ts = Date.now()
    return { key, hash, reused: true }
  }
  return put(key, buf) ? { key, hash, reused: false } : null
}

function safe(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function get(key) {
  if (!dbPath || !encKey) return null
  const safeKey = safe(key)
  const meta = index.get(safeKey)
  if (!meta) return null
  try {
    const raw = fs.readFileSync(path.join(dbPath, `${safeKey}.enc`))
    meta.ts = Date.now()
    return decrypt(raw)
  } catch {
    index.delete(safeKey)
    total -= meta.size
    return null
  }
}

/** True when the bytes are on disk (no read). Used to prune the url index
 *  against files the LRU already dropped. */
function has(key) {
  if (!dbPath) return false
  return index.has(safe(key))
}

function del(key) {
  if (!dbPath) return false
  const safeKey = safe(key)
  const meta = index.get(safeKey)
  if (!meta) return false
  try { fs.unlinkSync(path.join(dbPath, `${safeKey}.enc`)) } catch {}
  index.delete(safeKey)
  total -= meta.size
  return true
}

function clear() {
  if (!dbPath) return
  try { fs.rmSync(dbPath, { recursive: true, force: true }) } catch {}
  try { fs.mkdirSync(dbPath, { recursive: true }) } catch {}
  index.clear()
  total = 0
}

function setMaxBytes(n) {
  maxBytes = n
  evict()
}

function totalBytes() { return total }
function size() { return index.size }
function getMaxBytes() { return maxBytes }

module.exports = { init, put, get, has, del, clear, setMaxBytes, totalBytes, size, getMaxBytes, contentHash, putContent }
