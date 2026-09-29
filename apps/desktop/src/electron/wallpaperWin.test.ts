// @vitest-environment node
/**
 * wallpaperWin.cjs reaches into fs and child_process, which cannot be faked
 * from a vitest test — vi.mock does not intercept `require()` inside a .cjs
 * file. So the decisions that can leave a victim's desktop in a worse state
 * than we found it live in wallpaper-core.cjs, and that is what this covers.
 *
 * Each case below is a way to change someone's desktop and fail to put it
 * back, or to wipe it outright.
 */
import { describe, it, expect } from 'vitest'
import {
  isSupportedPlatform,
  wallpaperExtension,
  rejectReason,
  restorePlan,
  tempFileCap,
} from '../../electron/wallpaper-core.cjs'

describe('isSupportedPlatform', () => {
  it('only Windows has a working SystemParametersInfo path', () => {
    expect(isSupportedPlatform('win32')).toBe(true)
    expect(isSupportedPlatform('darwin')).toBe(false)
    expect(isSupportedPlatform('linux')).toBe(false)
  })
})

describe('wallpaperExtension', () => {
  it('maps mimes to extensions Windows will accept', () => {
    expect(wallpaperExtension('image/png')).toBe('.png')
    expect(wallpaperExtension('image/webp')).toBe('.webp')
    expect(wallpaperExtension('image/jpeg')).toBe('.jpg')
    // Unknown mimes fall back to a format SPI definitely handles.
    expect(wallpaperExtension('application/octet-stream')).toBe('.jpg')
    expect(wallpaperExtension(undefined)).toBe('.jpg')
  })
})

describe('rejectReason', () => {
  it('distinguishes a non-Windows host from bad data', () => {
    // The renderer needs this distinction: it used to tell macOS/Linux users
    // "only available in the desktop app" while they were IN the desktop app.
    expect(rejectReason('darwin', Buffer.from('x'))).toBe('unsupported-platform')
    expect(rejectReason('win32', 'not-a-buffer' as unknown as Buffer)).toBe('no-data')
    expect(rejectReason('win32', Buffer.from('x'))).toBeNull()
  })
})

describe('restorePlan', () => {
  it('refuses to do anything off Windows', () => {
    expect(restorePlan('linux', true, 'C:\\a.jpg')).toEqual({ ok: false, reason: 'unsupported-platform' })
  })

  // Restoring when nothing was swapped has no previous path to restore, and the
  // old code then ran `set ''` — which CLEARS the desktop.
  it('never calls the OS when no swap is pending', () => {
    const plan = restorePlan('win32', false, null)
    expect(plan.ok).toBe(true)
    expect(plan.skipSet).toBe(true)
    // The property must be present and falsy: the caller reads `plan.set`, and
    // a missing key read as `undefined` is exactly what used to reach SPI.
    expect(plan.set).toBeUndefined()
  })

  it('refuses to pass an empty path to the OS', () => {
    // Empty string to SystemParametersInfo = blank desktop, not "no change".
    for (const previous of [null, undefined, '']) {
      const plan = restorePlan('win32', true, previous as string | null)
      expect(plan.set, `previous=${String(previous)}`).toBeUndefined()
      expect(plan.skipSet).toBe(true)
    }
  })

  it('restores the captured wallpaper when there is one', () => {
    const plan = restorePlan('win32', true, 'C:\\Users\\x\\original.jpg')
    expect(plan).toEqual({ ok: true, set: 'C:\\Users\\x\\original.jpg' })
  })
})

describe('tempFileCap', () => {
  it('keeps a small number of candidates rather than growing without bound', () => {
    expect(tempFileCap()).toBeGreaterThan(0)
    expect(tempFileCap()).toBeLessThanOrEqual(5)
  })
})
