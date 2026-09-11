/**
 * Shared image metadata stripper (security wave 2, plan F20).
 *
 * Post tags live in the DB, never in the file — so every image entering or
 * leaving the app ships with pixels only. Pure JS, byte-level, no WASM.
 * JPEG: drop APP1..APP15 + COM (Exif/XMP/ICC/comments). PNG: drop
 * eXIf/tEXt/zTXt/iTXt/tIME/iCCP. GIF: drop Application + Comment extension
 * blocks. WebP: drop EXIF/XMP /ICCP RIFF chunks.
 * Video (mp4/webm) has no cheap pure-JS strip — documented limitation in
 * docs/SECURITY-AUDIT.md (round 4).
 */

export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  if (mime === 'image/jpeg') return stripJpeg(bytes)
  if (mime === 'image/png') return stripPng(bytes)
  if (mime === 'image/gif') return stripGif(bytes)
  if (mime === 'image/webp') return stripWebp(bytes)
  return bytes
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const out: number[] = []
  out.push(bytes[0], bytes[1])
  let i = 2
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { out.push(bytes[i]); i += 1; continue }
    const marker = bytes[i + 1]
    // standalone markers: SOI, EOI, RSTn
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(bytes[i], bytes[i + 1]); i += 2; continue }
    if (i + 3 >= bytes.length) return bytes // corrupt — bail with original
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    if (segLen < 2 || i + 2 + segLen > bytes.length) return bytes
    // APP1..APP15 (0xE1-0xEF) and COM (0xFE) carry metadata — drop.
    // APP0 (JFIF geometry) and everything from SOF/SOS on stay.
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
    if (!drop) {
      for (let k = 0; k < 2 + segLen; k += 1) out.push(bytes[i + k])
    }
    i += 2 + segLen
    // After SOS (0xFFDA) the rest is entropy-coded — copy through and stop.
    if (marker === 0xda) {
      while (i < bytes.length) { out.push(bytes[i]); i += 1 }
      break
    }
  }
  return new Uint8Array(out)
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME', 'iCCP'])

function stripPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return bytes
  const out: number[] = []
  for (let k = 0; k < 8; k += 1) out.push(bytes[k])
  let i = 8
  while (i + 8 <= bytes.length) {
    const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    const end = i + 8 + len + 4
    if (end > bytes.length) return bytes
    if (!PNG_DROP.has(type)) {
      for (let k = i; k < end; k += 1) out.push(bytes[k])
    }
    i = end
    if (type === 'IEND') break
  }
  return new Uint8Array(out)
}

function stripGif(bytes: Uint8Array): Uint8Array {
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5])
  if (!head.startsWith('GIF8') && !head.startsWith('GIF7')) return bytes
  const out: number[] = []
  let i = 0
  // signature (6) + logical screen descriptor (7) + optional global color table
  while (i < 13 && i < bytes.length) { out.push(bytes[i]); i += 1 }
  if (i >= bytes.length) return bytes
  const packed = bytes[10]
  if (packed & 0x80) {
    const gct = 3 * (2 << (packed & 0x07))
    for (let k = 0; k < gct && i < bytes.length; k += 1) { out.push(bytes[i]); i += 1 }
  }
  while (i < bytes.length) {
    const b = bytes[i]
    if (b === 0x21 && (bytes[i + 1] === 0xff || bytes[i + 1] === 0xfe)) {
      // Application/Comment extension: skip label + sub-block chain + terminator
      i += 2
      while (i < bytes.length && bytes[i] !== 0x00) i += bytes[i] + 1
      i += 1 // block terminator
      continue
    }
    out.push(b)
    i += 1
    if (b === 0x2c) {
      // Image descriptor: 9 fixed bytes, LZW min code, then data sub-blocks —
      // copy verbatim so 0x21 0xff inside pixel data is never misread.
      const end = Math.min(i + 9, bytes.length)
      while (i < end) { out.push(bytes[i]); i += 1 }
      if (i < bytes.length) { out.push(bytes[i]); i += 1 } // min code size
      while (i < bytes.length && bytes[i] !== 0x00) {
        const n = Math.min(bytes[i] + 1, bytes.length - i)
        for (let k = 0; k < n; k += 1) { out.push(bytes[i]); i += 1 }
      }
      if (i < bytes.length) { out.push(bytes[i]); i += 1 } // terminator
    }
  }
  return new Uint8Array(out)
}

const WEBP_DROP = new Set(['EXIF', 'XMP ', 'ICCP'])

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes
  const s = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  const f = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  if (s !== 'RIFF' || f !== 'WEBP') return bytes
  const body: number[] = [...ascii4('WEBP')]
  let i = 12
  while (i + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
    const len = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)
    const padded = len + (len % 2)
    if (i + 8 + padded > bytes.length) return bytes
    if (!WEBP_DROP.has(type)) {
      for (let k = i; k < i + 8 + padded; k += 1) body.push(bytes[k])
    }
    i += 8 + padded
  }
  const out = new Uint8Array(8 + body.length)
  out.set(ascii4('RIFF'), 0)
  const size = body.length // RIFF size counts 'WEBP' + chunks; 'WEBP' is already in body
  out[4] = size & 0xff
  out[5] = (size >> 8) & 0xff
  out[6] = (size >> 16) & 0xff
  out[7] = (size >> 24) & 0xff
  out.set(body, 8)
  return out
}

function ascii4(s: string): Uint8Array {
  return new Uint8Array(Array.from(s).map((c) => c.charCodeAt(0)))
}
