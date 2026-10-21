// Disk + CPU measurement for the local-first media path (run: node scripts/measure-disk.cjs).
//
// The renderer harness measures the protocol; this measures the REAL disk:
// the encrypted image cache the app actually writes (AES-256-GCM files under
// <userData>/imgcache), its write/read throughput, its LRU ceiling, and how
// much disk a cache of N images actually occupies.
//
// Output is a table meant to be pasted into docs/LOCAL-FIRST-ROADMAP.md.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const cache = require('../electron/diskImageCache.cjs')

const MIB = 1024 * 1024

function human(bytes) {
  return `${(bytes / MIB).toFixed(1)} MiB`
}

function dirSize(dir) {
  let total = 0
  let count = 0
  for (const file of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, file))
    total += stat.size
    count += 1
  }
  return { total, count }
}

function measure() {
  const before = process.cpuUsage()
  const started = Date.now()
  return {
    ms: () => Date.now() - started,
    cpuMs: () => {
      const now = process.cpuUsage(before)
      return (now.user + now.system) / 1000
    },
  }
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gmatch-disk-measure-'))
  const storageKeyHex = crypto.randomBytes(32).toString('hex')
  cache.init(tmp, storageKeyHex)

  const rows = []

  // --- write throughput -----------------------------------------------------
  const blobSize = 2 * MIB
  const blob = Buffer.alloc(blobSize)
  for (let i = 0; i < blob.length; i += 1) blob[i] = (i * 31) & 0xff
  const count = 20
  const write = measure()
  for (let i = 0; i < count; i += 1) {
    const key = `image${i}_${crypto.randomBytes(4).toString('hex')}`
    if (!cache.put(key, blob)) throw new Error('cache put failed')
  }
  const writeMs = write.ms()
  const writeCpu = write.cpuMs()
  rows.push(['write (encrypted)', `${count} x ${human(blobSize)}`, `${writeMs} ms`, `${(count * blobSize / MIB / (writeMs / 1000)).toFixed(1)} MiB/s`, `${writeCpu.toFixed(0)} ms cpu`])

  // --- read throughput + integrity -----------------------------------------
  const read = measure()
  let readBytes = 0
  for (const key of cache.indexKeys ? cache.indexKeys() : []) { /* not exposed; read by name below */ }
  const names = fs.readdirSync(path.join(tmp, 'imgcache')).filter((f) => f.endsWith('.enc')).map((f) => f.slice(0, -4))
  let verified = 0
  for (const key of names) {
    const back = cache.get(key)
    if (!back) throw new Error(`cache get failed for ${key}`)
    if (!back.equals(blob)) throw new Error(`cache read-back mismatch for ${key}`)
    readBytes += back.length
    verified += 1
  }
  const readMs = read.ms()
  const readCpu = read.cpuMs()
  rows.push(['read + decrypt', `${verified} files (${human(readBytes)})`, `${readMs} ms`, `${(readBytes / MIB / (readMs / 1000)).toFixed(1)} MiB/s`, `${readCpu.toFixed(0)} ms cpu`])

  // --- disk footprint -------------------------------------------------------
  const disk = dirSize(path.join(tmp, 'imgcache'))
  rows.push(['disk footprint', `${disk.count} encrypted files`, human(disk.total), `${(disk.total / (count * blobSize)).toFixed(2)}x payload`, `index ${cache.size()} entries`])

  // --- LRU ceiling ----------------------------------------------------------
  cache.setMaxBytes(8 * MIB)
  for (let i = 0; i < 8; i += 1) {
    cache.put(`flood${i}_${crypto.randomBytes(4).toString('hex')}`, blob)
  }
  const afterFlood = dirSize(path.join(tmp, 'imgcache'))
  rows.push(['LRU ceiling', `cap ${human(cache.getMaxBytes())}`, `kept ${human(cache.totalBytes())}`, `${afterFlood.count} files on disk`, `within cap: ${cache.totalBytes() <= cache.getMaxBytes() ? 'yes' : 'NO'}`])

  console.log('--- encrypted image cache (real disk) ---')
  console.log(['metric', 'work', 'time', 'rate', 'notes'].join(' | '))
  for (const row of rows) console.log(row.join(' | '))

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
}

main()
