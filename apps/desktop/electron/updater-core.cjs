// Pure, testable core of the portable self-update (no electron, no I/O).
// A portable build is ONE file: "reinstall" means download the artifact for
// THIS platform, replace the running file after quit, relaunch. Both launchers
// share the same verification path; only the swap script differs (batch on
// Windows, POSIX sh elsewhere). Wiring (network, spawn, IPC) lives in
// updater.cjs. isNewer mirrors src/utils/version.ts — drift guard in
// src/electron/updater-core.test.ts.

const PORTABLE_RE = /^gMatch-(\d+(?:\.\d+)*)-portable\.(exe|appimage|deb|dmg)$/i

/** Portable artifact extension(s) that can be swapped on each OS. A .deb is a
 *  recognized release artifact (it is published for distro packaging) but is
 *  NOT a portable swap target: it needs a package manager, not a file move. */
const PLATFORM_EXTENSIONS = {
  win32: ['.exe'],
  linux: ['.appimage'],
  darwin: ['.dmg', '.appimage'],
}

/** Extensions allowed for a platform; null means "any" (tests / unknown OS). */
function extensionsFor(platform) {
  return Object.prototype.hasOwnProperty.call(PLATFORM_EXTENSIONS, platform)
    ? PLATFORM_EXTENSIONS[platform]
    : null
}

function extOf(name) {
  const m = /\.([^.]+)$/.exec(String(name || ''))
  return m ? `.${m[1].toLowerCase()}` : ''
}

/** Numeric semver-ish compare — must stay identical to src/utils/version.ts. */
function isNewer(candidate, current) {
  const a = candidate.split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

/** 'gMatch-1.2.3-portable.AppImage' -> '1.2.3' | null */
function parsePortableName(name) {
  const m = PORTABLE_RE.exec(String(name || ''))
  return m ? m[1] : null
}

/**
 * GitHub asset digest field -> lowercase hex | null.
 *
 * GitHub serves `"digest": "sha256:<hex64>"` (COLON). An older npm-era shape
 * used `sha256-<hex64>` (DASH), so both are accepted. The dash-only regex made
 * every real asset hash parse to null, which read as "unverified" and refused
 * every update.
 */
function parseDigest(d) {
  const m = /^sha256[-:]([0-9a-f]{64})$/i.exec(String(d || ''))
  return m ? m[1].toLowerCase() : null
}

/**
 * GitHub Releases API payload (releases/latest) -> the newest portable asset.
 * When `opts.platform` is given, only artifacts that can be swapped on that OS
 * are considered, so a Windows exe never hides (or is hidden by) a Linux
 * AppImage. Ties on version prefer the first extension listed for the OS.
 * Falls back to the tag version with a missingAsset marker when the release
 * exists but carries no (yet) matching asset. `opts.insecure` allows http://
 * asset URLs — ONLY for the local smoke-test override (GMATCH_RELEASE_URL).
 */
function parseRelease(release, opts) {
  const allowHttp = Boolean(opts?.insecure)
  const allowed = extensionsFor(opts?.platform)
  const assets = Array.isArray(release?.assets) ? release.assets : []
  let best = null
  for (const a of assets) {
    const version = parsePortableName(a?.name)
    const url = typeof a?.browser_download_url === 'string' ? a.browser_download_url : ''
    const okUrl = url.startsWith('https://') || (allowHttp && url.startsWith('http://'))
    if (!version || !okUrl) continue
    const ext = extOf(a.name)
    if (allowed && !allowed.includes(ext)) continue
    const rank = allowed ? allowed.indexOf(ext) : 0
    if (!best || isNewer(version, best.version) || (version === best.version && rank < best.rank)) {
      best = { version, name: String(a.name), url, digest: parseDigest(a.digest), sizeBytes: sizeField(a.size), rank }
    }
  }
  if (best) {
    const { rank, ...plan } = best
    void rank
    return plan
  }
  const m = /^v?(\d+(?:\.\d+)*)$/.exec(String(release?.tag_name || ''))
  const ext = (allowed || ['.exe'])[0]
  if (m) return { version: m[1], name: `gMatch-${m[1]}-portable${ext}`, url: '', digest: null, missingAsset: true }
  return null
}

/** site release.json ({ version, sha256 }) trusted only for the same version. */
function shaFromReleaseJson(meta, version) {
  if (!meta || typeof meta !== 'object' || String(meta.version) !== String(version)) return null
  return /^[0-9a-f]{64}$/i.test(String(meta.sha256 || '')) ? String(meta.sha256).toLowerCase() : null
}

/**
 * Normalize a release manifest ({ file, version, sha256, downloadUrl? }) into a
 * download plan source. Both the site's `release.json` and the node's own
 * manifest use this shape. The download URL is usually absolute (the GitHub
 * Release asset); when it is not, it is resolved against the feed that served
 * the manifest (`base`) — a manifest with no absolute URL and no base is not
 * a usable source, so it resolves to null instead of inventing a host.
 */
function parseSiteRelease(meta, base = '', platform = '') {
  if (!meta || typeof meta !== 'object') return null
  const urlHint = String(meta.downloadUrl || '')
  const name = String(meta.file || '') || decodeURIComponent(urlHint.split('/').pop() || '')
  const version = parsePortableName(name) || String(meta.version || '')
  const allowed = extensionsFor(platform)
  const ext = extOf(name)
  // The file may be one of our named artifacts, or a plain asset URL named by
  // the manifest's `version` (the smoke test uses this shape). Either way its
  // extension must be one this app can actually swap.
  const namedPortable = PORTABLE_RE.test(name)
  const plainAsset = /^\d+(\.\d+)*$/.test(String(meta.version || ''))
  if (!/^\d+(\.\d+)*$/.test(version)) return null
  if (!namedPortable && !(plainAsset && ['.exe', '.appimage', '.deb', '.dmg'].includes(ext))) return null
  if (allowed && !allowed.includes(ext)) return null
  const rel = `/releases/${name.replace(/[^\w.-]/g, '')}`
  let url = String(meta.downloadUrl || '')
  if (!/^https?:\/\//i.test(url)) {
    if (!base) return null
    url = base.replace(/\/+$/, '') + rel
  }
  return { version, name, url, digest: shaField(meta.sha256), sizeBytes: sizeField(meta.sizeBytes) }
}

/** Lowercase 64-hex sha256 or null. */
function shaField(v) {
  return /^[0-9a-f]{64}$/i.test(String(v || '')) ? String(v).toLowerCase() : null
}

/** Positive integer byte size or null (used to validate the downloaded file). */
function sizeField(v) {
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** Decision for a fresh release payload against the installed version. Accepts
 *  the GitHub Releases API shape (assets[]) or the site release.json shape
 *  ({ file, version, sha256, downloadUrl }). `opts.platform` narrows assets to
 *  those the current OS can actually swap. */
function planCheck(release, currentVersion, opts) {
  if (!release || typeof release !== 'object') return { action: 'error', error: 'release source has no downloadable gMatch-*-portable artifact' }
  const parsed = Array.isArray(release.assets)
    ? parseRelease(release, opts)
    : ('file' in release || 'version' in release || 'downloadUrl' in release)
      ? parseSiteRelease(release, opts?.base, opts?.platform)
      : null
  if (!parsed) return { action: 'error', error: 'release source has no downloadable gMatch-*-portable artifact' }
  if (parsed.missingAsset || !parsed.url) return { action: 'error', error: `release v${parsed.version} has no downloadable asset` }
  const httpsOk = /^https:\/\//i.test(parsed.url)
  if (!httpsOk && !(opts?.insecure && /^http:\/\//i.test(parsed.url))) {
    return { action: 'error', error: 'release download URL must be https' }
  }
  if (!isNewer(parsed.version, currentVersion)) return { action: 'current', version: parsed.version }
  return { action: 'download', ...parsed }
}

/**
 * True for a feed on the user's OWN network: the loopback node or a private
 * LAN address. Those are hosts the user chose (their machine, their network),
 * so a plain-http feed is acceptable there — and nowhere else.
 */
function isPrivateFeedUrl(url) {
  const raw = String(url || '')
  if (!/^http:\/\//i.test(raw)) return false
  let host = ''
  try {
    host = new URL(raw).hostname
  } catch {
    return false
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  return false
}

/** Keep only characters safe for a quoted cmd.exe path token. */
function sanitizePath(p) {
  return String(p).replace(/["&|<>^%\n\r]/g, '')
}

/** Single-quote a path for POSIX sh, escaping an embedded quote as '\'' . */
function shellQuote(p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`
}

/**
 * Batch script for Windows: runs AFTER the app quits, retry-move the
 * downloaded artifact over the old one (AV scanners release their handle
 * late), relaunch, and self-delete.
 *
 * Window visibility contract: the cmd.exe that runs this script must be
 * spawned with `windowsHide: true` and WITHOUT `detached: true` (see
 * updater.cjs). A detached cmd has NO console at all, so every external
 * console exe the batch calls — `ping.exe` below — allocates its own
 * VISIBLE window on every retry (the "reappearing command prompts" bug).
 * With windowsHide the cmd owns an invisible console its children inherit.
 */
function buildWindowsScript({ source, target, logPath }) {
  const src = sanitizePath(source)
  const dst = sanitizePath(target)
  const log = sanitizePath(logPath)
  return [
    '@echo off',
    'setlocal enableextensions',
    'set TRIES=0',
    ':retry',
    'set /a TRIES+=1',
    `move /y "${src}" "${dst}" >> "${log}" 2>&1`,
    'if not errorlevel 1 goto launch',
    'if %TRIES% GEQ 30 goto giveup',
    // Progressive backoff between move attempts: ~3s for the first ten
    // (the common AV-handle case clears in seconds), ~6s for the next ten,
    // ~10s for the last ten. Bounded: 30 tries, about three minutes total.
    'set /a WAIT=3',
    'if %TRIES% GTR 10 set /a WAIT=6',
    'if %TRIES% GTR 20 set /a WAIT=10',
    'ping -n %WAIT% 127.0.0.1 >nul',
    'goto retry',
    ':giveup',
    `echo [updater] could not replace "${dst}" after 30 attempts >> "${log}"`,
    `echo [updater] downloaded file kept at "${src}" - replace manually >> "${log}"`,
    // Terminal failure must never leave the user without a working app:
    // the move failed, so the OLD exe is still in place — relaunch it. The
    // next update attempt requires the user's consent again, so this
    // cannot loop by itself.
    `start "" "${dst}"`,
    'goto end',
    ':launch',
    `start "" "${dst}"`,
    ':end',
    `echo [updater] finished Tries=%TRIES% >> "${log}"`,
    `del "%~f0" >nul 2>&1`,
    '',
  ].join('\r\n')
}

/**
 * POSIX sh script for Linux/macOS: the same bounded retry loop, using `mv`
 * instead of `move` and `sleep` instead of `ping`. It runs AFTER the app
 * quits, sets the executable bit on the portable file (an AppImage needs it),
 * relaunches on BOTH outcomes (on failure the OLD file is still in place), and
 * self-deletes. The renderer hands it to /bin/sh with no console to hide.
 */
function buildPosixScript({ source, target, logPath }) {
  const src = shellQuote(source)
  const dst = shellQuote(target)
  const log = shellQuote(logPath)
  const logLine = (text) => `echo ${shellQuote(text)} >> ${log}`
  return [
    '#!/bin/sh',
    '# Portable self-update swap: retry after the app quits, relaunch, self-delete.',
    'TRIES=0',
    'MOVED=0',
    'while [ "$TRIES" -lt 30 ]; do',
    '  TRIES=$((TRIES + 1))',
    `  if mv -f ${src} ${dst} >> ${log} 2>&1; then MOVED=1; break; fi`,
    '  WAIT=3',
    '  if [ "$TRIES" -gt 10 ]; then WAIT=6; fi',
    '  if [ "$TRIES" -gt 20 ]; then WAIT=10; fi',
    '  sleep "$WAIT"',
    'done',
    'if [ "$MOVED" -eq 1 ]; then',
    `  chmod +x ${dst} >> ${log} 2>&1 || true`,
    `  ${dst} >/dev/null 2>&1 &`,
    'else',
    logLine(`[updater] could not replace "${target}" after 30 attempts`),
    logLine(`[updater] downloaded file kept at "${source}" - replace manually`),
    `  ${dst} >/dev/null 2>&1 &`,
    'fi',
    `echo "[updater] finished Tries=$TRIES" >> ${log}`,
    'rm -f "$0"',
    '',
  ].join('\n')
}

/** One entry point: the swap script for the OS that will run it. */
function buildUpdaterScript({ source, target, logPath, platform = process.platform }) {
  return platform === 'win32'
    ? buildWindowsScript({ source, target, logPath })
    : buildPosixScript({ source, target, logPath })
}

module.exports = {
  isNewer, parsePortableName, parseDigest, parseRelease, parseSiteRelease, shaField, sizeField,
  shaFromReleaseJson, planCheck, sanitizePath, shellQuote, buildWindowsScript, buildPosixScript,
  buildUpdaterScript, isPrivateFeedUrl, PORTABLE_RE, PLATFORM_EXTENSIONS,
}
