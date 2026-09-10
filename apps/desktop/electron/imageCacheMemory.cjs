// In-memory LRU byte-budget cache for images (security plan B.1 / F1).
// Deliberately disk-free: content lives only for the session; a restart (or
// OS sleep-to-disk excluded by design) leaves nothing. Map preserves
// insertion order = LRU order; get() re-inserts to mark "recently used".
const MAX_DEFAULT = 96 * 1024 * 1024 // ~96MB: one feed page is ~20 imgs × ~300KB; keeps the working set, trims the museum (perf checkup: docs/PERF.md)

let maxBytes = MAX_DEFAULT
const map = new Map() // key -> { buf, bytes }
let total = 0

function setMaxBytes(n) {
  maxBytes = n
  evict()
}

function evict() {
  while (total > maxBytes && map.size > 0) {
    const oldestKey = map.keys().next().value
    const entry = map.get(oldestKey)
    map.delete(oldestKey)
    total -= entry.bytes
  }
}

function put(key, buf) {
  const bytes = buf.length
  if (bytes > maxBytes) return false // never store a monster that would self-evict everything
  const prev = map.get(key)
  if (prev) {
    total -= prev.bytes
    map.delete(key)
  }
  map.set(key, { buf, bytes })
  total += bytes
  evict()
  return true
}

function get(key) {
  const hit = map.get(key)
  if (!hit) return null
  // touch: re-insert so it becomes most-recently-used
  map.delete(key)
  map.set(key, hit)
  return hit.buf
}

function clear() {
  map.clear()
  total = 0
}

function totalBytes() { return total }
function size() { return map.size }
function getMaxBytes() { return maxBytes }

module.exports = { put, get, clear, setMaxBytes, totalBytes, size, getMaxBytes }
