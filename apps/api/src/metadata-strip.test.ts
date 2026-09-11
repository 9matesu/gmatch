import { describe, it, expect } from 'vitest'
import { stripImageMetadata } from './metadata-strip'

// Byte fixtures built in-test — no binary files in git.

function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0))
}
function be16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff]
}
function be32(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function jpegSegment(marker: number, payload: number[]): number[] {
  return [0xff, marker, ...be16(payload.length + 2), ...payload]
}

function jpegWithMetadata(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    ...jpegSegment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]), // APP0 keep
    ...jpegSegment(0xe1, [...ascii('Exif\0\0'), 0x4d, 0x4d, 0x00, 0x2a]), // APP1 Exif drop
    ...jpegSegment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0<xmp/>')]), // APP1 XMP drop
    ...jpegSegment(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 0]), // APP2 ICC drop
    ...jpegSegment(0xfe, ascii('comment')), // COM drop
    ...jpegSegment(0xc0, [0x08, 0x00, 0x10, 0x00, 0x10, 0x03]), // SOF0 keep
    0xff, 0xda, ...be16(6), 1, 0, 0, 0, // SOS header
    0x01, 0x02, 0x03, // entropy data
    0xff, 0xd9, // EOI
  ])
}

function pngChunk(type: string, data: number[]): number[] {
  return [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0] // CRC placeholder
}

function pngWithMetadata(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...pngChunk('tEXt', ascii('Comment\x00secret-note')),
    ...pngChunk('eXIf', [0x4d, 0x4d, 0x00, 0x2a]),
    ...pngChunk('iTXt', ascii('XML:com.adobe.xmp\x00\x00\x00\x00<xmp/>')),
    ...pngChunk('IDAT', [0x78, 0x9c, 1, 2, 3]),
    ...pngChunk('IEND', []),
  ])
}

function gifWithMetadata(): Uint8Array {
  return new Uint8Array([
    ...ascii('GIF89a'), 1, 0, 1, 0, 0, 0, 0, // header + LSD (7 bytes, packed=0, no GCT)
    0x21, 0xff, 0x08, ...ascii('Exif\0\0II'), 0x00, // app extension (Exif) drop
    0x21, 0xfe, 0x05, ...ascii('cmt!!'), 0x00, // comment extension drop
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, // image descriptor
    0x02, 0x02, 0x44, 0x01, 0x00, // LZW min code + one block + terminator
    0x3b, // trailer
  ])
}

function le32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}

function webpChunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])]
}

function webpWithMetadata(): Uint8Array {
  const body = [
    ...webpChunk('VP8X', [0, 0, 0, 9, 0, 0, 9, 0, 0]),
    ...webpChunk('EXIF', [0x45, 0x78, 0x69, 0x66]),
    ...webpChunk('ANIM', [0, 0, 0, 0]),
  ]
  return new Uint8Array([...ascii('RIFF'), ...le32(4 + body.length), ...ascii('WEBP'), ...body])
}

describe('stripImageMetadata', () => {
  it('jpeg: drops all APPn + COM, keeps SOI/APP0/SOF/SOS/EOI', () => {
    const out = stripImageMetadata(jpegWithMetadata(), 'image/jpeg')
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)
    const s = Buffer.from(out).toString('latin1')
    expect(s).not.toContain('Exif')
    expect(s).not.toContain('xap')
    expect(s).not.toContain('ICC_PROFILE')
    expect(s).not.toContain('comment')
    expect(s).toContain('JFIF')
    // SOF0 and SOS markers survive
    let sawSof = false
    let sawSos = false
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xc0) sawSof = true
      if (out[i] === 0xff && out[i + 1] === 0xda) sawSos = true
    }
    expect(sawSof).toBe(true)
    expect(sawSos).toBe(true)
    expect(out[out.length - 2]).toBe(0xff)
    expect(out[out.length - 1]).toBe(0xd9)
  })

  it('png: drops tEXt/eXIf/iTXt, keeps signature/IHDR/IDAT/IEND', () => {
    const out = stripImageMetadata(pngWithMetadata(), 'image/png')
    const s = Buffer.from(out).toString('latin1')
    expect(s).not.toContain('tEXt')
    expect(s).not.toContain('eXIf')
    expect(s).not.toContain('iTXt')
    expect(s).not.toContain('secret-note')
    expect(s).toContain('IHDR')
    expect(s).toContain('IDAT')
    expect(s.slice(-8, -4)).toBe('IEND')
    expect(out[0]).toBe(0x89)
  })

  it('gif: drops application + comment extensions, keeps image block', () => {
    const out = stripImageMetadata(gifWithMetadata(), 'image/gif')
    const s = Buffer.from(out).toString('latin1')
    expect(s).not.toContain('Exif')
    expect(s).not.toContain('cmt!!')
    expect(s.startsWith('GIF89a')).toBe(true)
    expect(s).toContain('\x2c') // image descriptor survives
    expect(out[out.length - 1]).toBe(0x3b) // trailer
  })

  it('webp: drops EXIF chunk, rewrites RIFF size', () => {
    const out = stripImageMetadata(webpWithMetadata(), 'image/webp')
    const s = Buffer.from(out).toString('latin1')
    expect(s).not.toContain('EXIF')
    expect(s).toContain('VP8X')
    expect(s).toContain('ANIM')
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24)
    expect(riffSize + 8).toBe(out.length)
  })

  it('unknown mime passes through untouched', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    expect(stripImageMetadata(bytes, 'video/mp4')).toBe(bytes)
  })
})
