// Standalone test for the pure wallpaper core (run: node electron/wallpaper-core.test.cjs).
// Pins the decision table for the OS wallpaper swap: the platform/data gate,
// the restore plan (never restore to blank), the temp-file cap, and the two
// mappings that let the renderer tell a missing PowerShell from a failed set.
const assert = require('assert')
const core = require('./wallpaper-core.cjs')

// ---- rejectReason: platform + data gate ----
assert.strictEqual(core.rejectReason('win32', Buffer.from([1, 2, 3])), null, 'win32 + bytes is allowed')
assert.strictEqual(core.rejectReason('darwin', Buffer.from([1])), 'unsupported-platform', 'non-Windows is refused up front')
assert.strictEqual(core.rejectReason('linux', Buffer.from([1])), 'unsupported-platform')
assert.strictEqual(core.rejectReason('win32', 'not a buffer'), 'no-data', 'a non-buffer is no-data, not a crash')

// ---- wallpaperExtension: from mime ----
assert.strictEqual(core.wallpaperExtension('image/png'), '.png')
assert.strictEqual(core.wallpaperExtension('image/webp'), '.webp')
assert.strictEqual(core.wallpaperExtension('image/jpeg'), '.jpg')
assert.strictEqual(core.wallpaperExtension(''), '.jpg', 'default extension is jpg')
assert.strictEqual(core.wallpaperExtension(undefined), '.jpg')

// ---- restorePlan: never blank the desktop, never restore when nothing swapped ----
const unsupported = core.restorePlan('darwin', true, 'C:\\a.jpg')
assert.strictEqual(unsupported.ok, false)
assert.strictEqual(unsupported.reason, 'unsupported-platform')

const nothing = core.restorePlan('win32', false, 'C:\\a.jpg')
assert.strictEqual(nothing.skipSet, true)
assert.strictEqual(nothing.set, undefined)

// A captured-but-empty path must NOT restore (restoring '' would blank the desktop).
const noCaptured = core.restorePlan('win32', true, null)
assert.strictEqual(noCaptured.skipSet, true)
assert.strictEqual(noCaptured.set, undefined)

const ok = core.restorePlan('win32', true, 'C:\\wallpaper.jpg')
assert.strictEqual(ok.set, 'C:\\wallpaper.jpg')

// ---- tempFileCap: small and positive ----
assert.ok(core.tempFileCap() >= 1, 'keeps at least one candidate')
assert.ok(core.tempFileCap() <= 5, 'never accumulates a pile')

// ---- classifySetResult: the whole point — a missing PowerShell is NOT a failed set ----
assert.deepStrictEqual(core.classifySetResult({ ok: true, out: 'ok' }), { ok: true })
assert.deepStrictEqual(core.classifySetResult({ ok: false, reason: 'no-powershell' }),
  { ok: false, reason: 'no-powershell' })
assert.deepStrictEqual(core.classifySetResult({ ok: false, reason: 'error' }),
  { ok: false, reason: 'set-failed' })
assert.deepStrictEqual(core.classifySetResult({ ok: false }),
  { ok: false, reason: 'set-failed' })

// ---- getWallpaperPath: empty buffer means "no image", not a path ----
assert.strictEqual(core.getWallpaperPath({ ok: true, out: 'C:\\Users\\me\\pic.jpg' }), 'C:\\Users\\me\\pic.jpg')
assert.strictEqual(core.getWallpaperPath({ ok: true, out: '   ' }), null, 'empty buffer -> null')
assert.strictEqual(core.getWallpaperPath({ ok: true, out: '' }), null)
assert.strictEqual(core.getWallpaperPath({ ok: false, reason: 'no-powershell' }), null)
assert.strictEqual(core.getWallpaperPath(null), null)

console.log('wallpaper-core.test.cjs: all assertions passed')