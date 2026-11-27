'use strict'
// Pure decision helpers for the cross-platform desktop-wallpaper IPC.
// Split out from desktop-wallpaper.cjs because that module reaches into fs and
// child_process, which a test cannot fake (vi.mock / require do not mix).
// Same pattern as wallpaper-core.cjs and dom-video-core.cjs.
//
// Every rule here exists to keep a wallpaper change from becoming a broken
// desktop: reject sources the OS cannot address, name the exact backend a
// platform has, and turn child_process errors into reasons instead of throws.

const MAX_WALLPAPER_BYTES = 25 * 1024 * 1024

/** Which OS backend can actually change the *desktop* wallpaper. */
function detectBackend(platform) {
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return 'unsupported'
}

/** True for the buffer forms the IPC accepts (no JSON-only arrays). */
function isBufferLike(value) {
  if (Buffer.isBuffer(value)) return true
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true
  return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)
}

function byteLengthOf(value) {
  if (Buffer.isBuffer(value)) return value.length
  if (typeof ArrayBuffer !== 'undefined') {
    if (value instanceof ArrayBuffer) return value.byteLength
    if (ArrayBuffer.isView(value)) return value.byteLength
  }
  return -1
}

/** Absolute paths only: a relative path would resolve against the main
 * process cwd and point at a completely different (or missing) image. */
function isAbsolutePath(value, platform) {
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
  return value.startsWith('/')
}

/** A file:// URI back into a local path. Remote schemes are refused by the
 * caller before this runs; a malformed URI is an invalid source, never a
 * crash. */
function fileUriToPath(uri, platform) {
  try {
    let rest = String(uri).replace(/^file:\/\//i, '')
    // file:///C:/... -> /C:/... ; drop the leading slash for the drive form.
    if (/^\/[A-Za-z]:[\\/]/.test(rest)) rest = rest.slice(1)
    const decoded = decodeURIComponent(rest)
    const local = platform === 'win32' ? decoded.replace(/\//g, '\\') : decoded
    return isAbsolutePath(local, platform) ? local : null
  } catch {
    return null
  }
}

/** Turn a local path into the file URI the Linux backends require. */
function fileUri(filePath) {
  const slashed = String(filePath).replace(/\\/g, '/')
  const rooted = slashed.startsWith('/') ? slashed : `/${slashed}`
  // encodeURI leaves ? and # intact; both would truncate the OS-side URI.
  return `file://${encodeURI(rooted).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

/**
 * Normalise a renderer-supplied source without touching the filesystem.
 * Accepted: { data, mime } (bytes the main process writes to a temp file) or
 * an absolute local path / file:// URI. An http(s) URL is a REMOTE source —
 * the desktop wallpaper must be an image this machine can address, and a
 * silent fetch in the main process would be an unbounded, unaudited download.
 */
function validateSource(source, platform) {
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const data = source.data
    if (!isBufferLike(data)) return { ok: false, reason: 'no-data' }
    const size = byteLengthOf(data)
    if (size <= 0 || size > MAX_WALLPAPER_BYTES) return { ok: false, reason: 'invalid-size' }
    const mime = String(source.mime || '')
    if (mime && !/^image\//i.test(mime)) return { ok: false, reason: 'invalid-mime' }
    return { ok: true, kind: 'data', data, mime }
  }
  if (typeof source === 'string') {
    const value = source.trim()
    if (!value) return { ok: false, reason: 'invalid-source' }
    if (/^file:\/\//i.test(value)) {
      const local = fileUriToPath(value, platform)
      return local ? { ok: true, kind: 'path', path: local } : { ok: false, reason: 'invalid-source' }
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//i.test(value)) return { ok: false, reason: 'remote-source' }
    return isAbsolutePath(value, platform)
      ? { ok: true, kind: 'path', path: value }
      : { ok: false, reason: 'invalid-source' }
  }
  return { ok: false, reason: 'invalid-source' }
}

/** Decide the whole call up front: an unsupported desktop or bad source is a
 * structured error, so the IPC never throws and never spawns a tool. */
function plan(platform, source) {
  const backend = detectBackend(platform)
  if (backend === 'unsupported') return { ok: false, reason: 'unsupported-desktop' }
  const valid = validateSource(source, platform)
  if (!valid.ok) return valid
  return { ok: true, backend, source: valid }
}

/** Extension for a temp file the OS will read as an image. */
function wallpaperExtension(mime) {
  const value = String(mime || '')
  if (/png/i.test(value)) return '.png'
  if (/webp/i.test(value)) return '.webp'
  return '.jpg'
}

// ── Windows: registry (HKCU\Control Panel\Desktop\WallPaper) + the
// TranscodedWallpaper file + SystemParametersInfo so the change is live.
// Arguments travel through execFile's argv array, never a shell string.

function windowsRegistryPath() {
  return 'HKCU:\\Control Panel\\Desktop'
}

function windowsArgsFor(script, filePath) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
  if (filePath) args.push(filePath)
  return args
}

function windowsSetScript() {
  return [
    'param([string]$p)',
    "Add-Type -Name GMatchWallpaper -Namespace GMatch -MemberDefinition '[DllImport(\"user32.dll\", CharSet=CharSet.Auto)] public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);'",
    `Set-ItemProperty -LiteralPath '${windowsRegistryPath()}' -Name WallPaper -Value $p -ErrorAction Stop`,
    `Set-ItemProperty -LiteralPath '${windowsRegistryPath()}' -Name WallpaperStyle -Value '10' -ErrorAction SilentlyContinue`,
    `Set-ItemProperty -LiteralPath '${windowsRegistryPath()}' -Name TileWallpaper -Value '0' -ErrorAction SilentlyContinue`,
    '$rc = [GMatch.GMatchWallpaper]::SystemParametersInfo(0x0013, 0, $p, 0x03)',
    'if ($rc -eq 0) { exit 3 }',
    "Write-Output 'ok'",
  ].join('\n')
}

function windowsGetScript() {
  return [
    `(Get-ItemProperty -LiteralPath '${windowsRegistryPath()}' -Name WallPaper -ErrorAction SilentlyContinue).WallPaper`,
  ].join('\n')
}

/** The previous wallpaper path from a `get` run, or null when there is none. */
function parseWindowsWallpaper(result) {
  if (!result || !result.ok) return null
  const value = String(result.out || '').trim()
  return value || null
}

// ── Linux: GNOME/gsettings first, KDE (qdbus) as the fallback. Both receive
// a file:// URI; JSON.stringify keeps the JS script argument injection-safe.

function gnomeSetArgs(uri) {
  return ['set', 'org.gnome.desktop.background', 'picture-uri', uri]
}

function gnomeGetArgs() {
  return ['get', 'org.gnome.desktop.background', 'picture-uri']
}

/** gsettings prints a quoted GVariant string; take its content, not the quotes. */
function parseGsettingsValue(out) {
  const value = String(out || '').trim()
  if (!value) return null
  const match = value.match(/^'([\s\S]*)'$/)
  const parsed = match ? match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : value
  return parsed || null
}

function kdeSetScript(uri) {
  const jsUri = JSON.stringify(uri)
  return [
    'var d = desktops(); for (var i = 0; i < d.length; i++) {',
    `d[i].wallpaperPlugin = 'org.kde.image'; d[i].currentConfigGroup = Array('Wallpaper', 'org.kde.image', 'General'); d[i].writeConfig('Image', ${jsUri});`,
    '}',
  ].join(' ')
}

function kdeGetScript() {
  return [
    'var d = desktops(); var r = ""; for (var i = 0; i < d.length; i++) {',
    "d[i].currentConfigGroup = Array('Wallpaper', 'org.kde.image', 'General'); var v = d[i].readConfig('Image', ''); if (v && String(v).length) { r = String(v); break; } }",
    'r',
  ].join(' ')
}

function kdeDbusArgs(script) {
  return ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', script]
}

/** The qdbus binary is named differently across Plasma generations. Try all
 * of them so a KDE fallback is not lost to a package rename. */
function kdeDbusTools() {
  return ['qdbus6', 'qdbus-qt5', 'qdbus']
}

/** Turn a child_process error into a reason the renderer can explain. A
 * missing tool on Linux with no fallback left is reported as an unsupported
 * desktop by the caller, never as an uncaught exception. */
function classifyToolError(err, tool) {
  if (!err) return { ok: false, reason: 'command-failed', tool }
  if (err.code === 'ENOENT') return { ok: false, reason: 'no-tool', tool }
  if (err.killed || err.code === 'ETIMEDOUT' || err.signal) return { ok: false, reason: 'timeout', tool }
  return { ok: false, reason: 'command-failed', tool }
}

/** Both Linux backends unavailable (no gsettings, no qdbus) is an unsupported
 * desktop, not a generic failure. A tool that exists but failed is set-failed. */
function classifyLinuxResult(gnome, kde) {
  const missingGnome = !gnome || gnome.reason === 'no-tool'
  const missingKde = !kde || kde.reason === 'no-tool'
  if (missingGnome && missingKde) return { ok: false, reason: 'unsupported-desktop' }
  return { ok: false, reason: 'set-failed' }
}

module.exports = {
  MAX_WALLPAPER_BYTES,
  detectBackend,
  isBufferLike,
  byteLengthOf,
  isAbsolutePath,
  fileUriToPath,
  fileUri,
  validateSource,
  plan,
  wallpaperExtension,
  windowsRegistryPath,
  windowsArgsFor,
  windowsSetScript,
  windowsGetScript,
  parseWindowsWallpaper,
  gnomeSetArgs,
  gnomeGetArgs,
  parseGsettingsValue,
  kdeSetScript,
  kdeGetScript,
  kdeDbusArgs,
  kdeDbusTools,
  classifyToolError,
  classifyLinuxResult,
}
