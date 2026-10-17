// Encrypted on-disk LRU cache for images (Plan: RAM-to-Disk).
// Replaces in-memory LRU Map with AES-256-GCM encrypted disk files.
// Files stored at userData/imgcache/<key>.enc.
const fs = require('fs')
const path = require('path')
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

function get(key) {
  if (!dbPath || !encKey) return null
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_')
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

function del(key) {
  if (!dbPath) return false
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_')
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

module.exports = { init, put, get, del, clear, setMaxBytes, totalBytes, size, getMaxBytes }
