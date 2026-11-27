// @vitest-environment node
/** Vitest mirror of electron/desktop-wallpaper-core.test.cjs so the cross-
 * platform wallpaper decisions also run in the normal desktop test gate.
 * The runtime module (fs + child_process) is covered by the standalone node
 * test via its injected executor; these are the pure rules it depends on. */
import { describe, it, expect } from 'vitest'
import {
  detectBackend,
  validateSource,
  plan,
  fileUri,
  parseGsettingsValue,
  classifyToolError,
  classifyLinuxResult,
} from '../../electron/desktop-wallpaper-core.cjs'

describe('desktop wallpaper backend detection', () => {
  it('supports Windows and Linux only', () => {
    expect(detectBackend('win32')).toBe('windows')
    expect(detectBackend('linux')).toBe('linux')
    expect(detectBackend('darwin')).toBe('unsupported')
  })
})

describe('desktop wallpaper source validation', () => {
  const bytes = Buffer.from([1, 2, 3])

  it('accepts image bytes and local absolute paths', () => {
    expect(validateSource({ data: bytes, mime: 'image/png' }, 'linux')).toMatchObject({ ok: true, kind: 'data' })
    expect(validateSource('/home/me/pic.jpg', 'linux')).toMatchObject({ ok: true, kind: 'path' })
  })

  it('refuses remote URLs without downloading', () => {
    expect(validateSource('https://example.com/a.jpg', 'linux')).toEqual({ ok: false, reason: 'remote-source' })
  })

  it('refuses non-image, empty and oversized data', () => {
    expect(validateSource({ data: bytes, mime: 'text/html' }, 'win32')).toEqual({ ok: false, reason: 'invalid-mime' })
    expect(validateSource({ data: Buffer.alloc(0), mime: 'image/png' }, 'win32')).toEqual({ ok: false, reason: 'invalid-size' })
  })
})

describe('desktop wallpaper plan + error classification', () => {
  it('reports an unsupported desktop before touching any tool', () => {
    expect(plan('darwin', Buffer.from([1]))).toEqual({ ok: false, reason: 'unsupported-desktop' })
  })

  it('builds file URIs and parses gsettings values', () => {
    expect(fileUri('/home/me/a b.jpg')).toBe('file:///home/me/a%20b.jpg')
    expect(parseGsettingsValue("'file:///a.jpg'")).toBe('file:///a.jpg')
  })

  it('turns process failures into reasons, never exceptions', () => {
    expect(classifyToolError({ code: 'ENOENT' }, 'gsettings')).toEqual({ ok: false, reason: 'no-tool', tool: 'gsettings' })
    expect(classifyToolError({ killed: true }, 'qdbus').reason).toBe('timeout')
    expect(classifyLinuxResult({ reason: 'no-tool' }, { reason: 'no-tool' }).reason).toBe('unsupported-desktop')
  })
})
