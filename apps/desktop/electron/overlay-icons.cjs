// Overlay/taskbar badge icons (1..9 and "9+"), generated once and cached.
//
// Windows' setOverlayIcon needs a real image per count; drawing digits at runtime
// needs a canvas, which the main process does not have. So the digits are drawn
// here, pixel by pixel, into a PNG (zlib + CRC32 are in node:zlib and computed
// below) and written to userData once. A malformed or unreadable file is simply
// skipped by the caller: the overlay is an enhancement, never a crash.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 16
const ACCENT = [255, 45, 120]
const INK = [255, 255, 255]

// 3x5 digits: enough at 16px, and legible when scaled 2x.
const GLYPHS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** One badge: an accent plate with the count (or "9+") in white. */
function badge(label) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const at = (y * SIZE + x) * 4
    rgba[at] = r
    rgba[at + 1] = g
    rgba[at + 2] = b
    rgba[at + 3] = a
  }

  // A filled circle, so the plate reads as a badge on any wallpaper.
  const c = (SIZE - 1) / 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c)
      if (d <= c - 0.5) set(x, y, ACCENT)
    }
  }

  const text = String(label)
  const scale = text.length > 1 ? 1 : 2
  const glyphW = 3 * scale + (text.length - 1) * scale
  const glyphH = 5 * scale
  const ox = Math.round((SIZE - glyphW) / 2)
  const oy = Math.round((SIZE - glyphH) / 2)
  let cursor = ox
  for (const ch of text) {
    const glyph = GLYPHS[ch]
    if (!glyph) {
      cursor += 4 * scale
      continue
    }
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) set(cursor + gx * scale + sx, oy + gy * scale + sy, INK)
        }
      }
    }
    cursor += 4 * scale
  }
  return png(rgba)
}

const cache = new Map()

/** @returns {string[]} paths for counts 1..9 plus the "9+" plate. */
function ensureOverlayIcons(dir) {
  if (cache.has(dir)) return cache.get(dir)
  const paths = []
  try {
    fs.mkdirSync(dir, { recursive: true })
    for (let n = 1; n <= 9; n++) {
      const file = path.join(dir, `badge-${n}.png`)
      if (!fs.existsSync(file)) fs.writeFileSync(file, badge(String(n)))
      paths.push(file)
    }
    const overflow = path.join(dir, 'badge-9plus.png')
    if (!fs.existsSync(overflow)) fs.writeFileSync(overflow, badge('9+'))
    paths.push(overflow)
    cache.set(dir, paths)
    return paths
  } catch {
    cache.set(dir, [])
    return []
  }
}

module.exports = { ensureOverlayIcons };