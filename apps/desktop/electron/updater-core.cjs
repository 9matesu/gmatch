// Pure, testable core of the portable self-update (no electron, no I/O).
// A portable build is ONE file: "reinstall" means download
// gMatch-<ver>-portable.exe, replace the running exe after quit, relaunch.
// Wiring (network, spawn, IPC) lives in updater.cjs. isNewer mirrors
// src/utils/version.ts — drift guard in src/electron/updater-core.test.ts.

const PORTABLE_RE = /^gMatch-(\d+(?:\.\d+)*)-portable\.exe$/i

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

/** 'gMatch-1.2.3-portable.exe' -> '1.2.3' | null */
function parsePortableName(name) {
  const m = PORTABLE_RE.exec(String(name || ''))
  return m ? m[1] : null
}

/** GitHub asset digest field: 'sha256-<hex64>' -> lowercase hex | null */
function parseDigest(d) {
  const m = /^sha256-([0-9a-f]{64})$/i.exec(String(d || ''))
  return m ? m[1].toLowerCase() : null
}

/**
 * GitHub Releases API payload (releases/latest) -> the newest portable asset.
 * Falls back to the tag version with a missingAsset marker when the release
 * exists but carries no (yet) matching asset. `opts.insecure` allows http://
 * asset URLs — ONLY for the local smoke-test override (GMATCH_RELEASE_URL).
 */
function parseRelease(release, opts) {
  const allowHttp = Boolean(opts?.insecure)
  const assets = Array.isArray(release?.assets) ? release.assets : []
  let best = null
  for (const a of assets) {
    const version = parsePortableName(a?.name)
    const url = typeof a?.browser_download_url === 'string' ? a.browser_download_url : ''
    const okUrl = url.startsWith('https://') || (allowHttp && url.startsWith('http://'))
    if (!version || !okUrl) continue
    if (!best || isNewer(version, best.version)) {
      best = { version, name: String(a.name), url, digest: parseDigest(a.digest) }
    }
  }
  if (best) return best
  const m = /^v?(\d+(?:\.\d+)*)$/.exec(String(release?.tag_name || ''))
  if (m) return { version: m[1], name: `gMatch-${m[1]}-portable.exe`, url: '', digest: null, missingAsset: true }
  return null
}

/** site release.json ({ version, sha256 }) trusted only for the same version. */
function shaFromReleaseJson(meta, version) {
  if (!meta || typeof meta !== 'object' || String(meta.version) !== String(version)) return null
  return /^[0-9a-f]{64}$/i.test(String(meta.sha256 || '')) ? String(meta.sha256).toLowerCase() : null
}

/**
 * Normalize the site release.json ({ file, version, sha256, downloadUrl? })
 * into a download plan source. The repo is PRIVATE, so the public fly-dev
 * site (which mirrors the GitHub Release artifact) is the canonical release
 * feed for installed apps.
 */
function parseSiteRelease(meta, base = 'https://gmatch.fly.dev') {
  if (!meta || typeof meta !== 'object') return null
  const urlHint = String(meta.downloadUrl || '')
  const name = String(meta.file || '') || decodeURIComponent(urlHint.split('/').pop() || '')
  const version = parsePortableName(name) || String(meta.version || '')
  if (!/^\d+(\.\d+)*$/.test(version) || !/\.exe$/i.test(name)) return null
  const rel = `/releases/${name.replace(/[^\w.-]/g, '')}`
  let url = String(meta.downloadUrl || '')
  if (!/^https?:\/\//i.test(url)) url = base + rel
  return { version, name, url, digest: shaField(meta.sha256) }
}

/** Lowercase 64-hex sha256 or null. */
function shaField(v) {
  return /^[0-9a-f]{64}$/i.test(String(v || '')) ? String(v).toLowerCase() : null
}

/** Decision for a fresh release payload against the installed version. Accepts
 *  the GitHub Releases API shape (assets[]) or the site release.json shape
 *  ({ file, version, sha256, downloadUrl }). */
function planCheck(release, currentVersion, opts) {
  if (!release || typeof release !== 'object') return { action: 'error', error: 'release source has no downloadable gMatch-*-portable.exe' }
  const parsed = Array.isArray(release.assets)
    ? parseRelease(release, opts)
    : ('file' in release || 'version' in release || 'downloadUrl' in release)
      ? parseSiteRelease(release, opts?.base)
      : null
  if (!parsed) return { action: 'error', error: 'release source has no downloadable gMatch-*-portable.exe' }
  if (parsed.missingAsset || !parsed.url) return { action: 'error', error: `release v${parsed.version} has no downloadable asset` }
  const httpsOk = /^https:\/\//i.test(parsed.url)
  if (!httpsOk && !(opts?.insecure && /^http:\/\//i.test(parsed.url))) {
    return { action: 'error', error: 'release download URL must be https' }
  }
  if (!isNewer(parsed.version, currentVersion)) return { action: 'current', version: parsed.version }
  return { action: 'download', ...parsed }
}

/** Keep only characters safe for a quoted cmd.exe path token. */
function sanitizePath(p) {
  return String(p).replace(/["&|<>^%\n\r]/g, '')
}

/**
 * Batch script that runs AFTER the app quits: retry-move the downloaded exe
 * over the old one (AV scanners release their handle late), relaunch, and
 * self-delete. Pure string builder — tested directly.
 */
function buildUpdaterScript({ source, target, logPath }) {
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
    'if %TRIES% GEQ 30 (',
    `  echo [updater] could not replace "${dst}" after 30 attempts >> "${log}"`,
    `  echo [updater] keep the downloaded file and replace manually >> "${log}"`,
    '  goto end',
    ')',
    'ping -n 4 127.0.0.1 >nul',
    'goto retry',
    ':launch',
    `start "" "${dst}"`,
    ':end',
    `echo [updater] finished Tries=%TRIES% >> "${log}"`,
    `del "%~f0" >nul 2>&1`,
    '',
  ].join('\r\n')
}

module.exports = { isNewer, parsePortableName, parseDigest, parseRelease, parseSiteRelease, shaField, shaFromReleaseJson, planCheck, sanitizePath, buildUpdaterScript, PORTABLE_RE }
