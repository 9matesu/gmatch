// Pure decision helpers for the OS wallpaper swap. Split out from
// wallpaperWin.cjs because that module reaches straight into fs and
// child_process, which cannot be exercised from a test (vi.mock does not
// intercept `require()` inside a .cjs file). Same pattern as
// window-bounds-core.cjs.
//
// Every one of these encodes a way to leave a victim's desktop in a worse
// state than we found it, so they are worth pinning.

/** Windows is the only platform with a working SystemParametersInfo path. */
function isSupportedPlatform(platform) {
  return platform === 'win32'
}

/** File extension for a wallpaper buffer, from its mime type. */
function wallpaperExtension(mime) {
  const m = String(mime || '')
  if (/png/i.test(m)) return '.png'
  if (/webp/i.test(m)) return '.webp'
  return '.jpg'
}

/**
 * What `setWallpaperFromBuffer` should report without touching anything.
 * The renderer needs 'unsupported-platform' specifically, so it can tell
 * "this needs the desktop app" apart from "this needs Windows" — a macOS user
 * was told the former while sitting in the desktop app.
 */
function rejectReason(platform, buf) {
  if (!isSupportedPlatform(platform)) return 'unsupported-platform'
  if (!Buffer.isBuffer(buf)) return 'no-data'
  return null
}

/**
 * What a restore should do.
 *
 * `previousPath` of '' would blank the desktop (SystemParametersInfo with an
 * empty string clears it), and restoring when nothing was ever swapped means
 * there is no previous path to be missing in the first place. Both were
 * reachable, so both are refused up front.
 */
function restorePlan(platform, swapped, previousPath) {
  if (!isSupportedPlatform(platform)) return { ok: false, reason: 'unsupported-platform' }
  if (!swapped) return { ok: true, reason: 'nothing-to-restore', skipSet: true, set: undefined }
  if (!previousPath) return { ok: true, reason: 'no-captured-wallpaper', skipSet: true, set: undefined }
  return { ok: true, set: previousPath }
}

/**
 * How many temp files to keep on disk. Windows copies the file into its own
 * store when SPI runs, so these are disposable — but not before the swap
 * completes, hence a small cap rather than zero.
 */
function tempFileCap() {
  return 3
}

module.exports = {
  isSupportedPlatform,
  wallpaperExtension,
  rejectReason,
  restorePlan,
  tempFileCap,
}
