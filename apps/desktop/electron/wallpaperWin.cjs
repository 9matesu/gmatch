// Windows desktop wallpaper swap for consented domination effects.
// No native deps: SystemParametersInfoW via a PowerShell Add-Type snippet.
// The previous wallpaper path is remembered so it can be restored when the
// effect expires. Non-Windows platforms (and any failure) are harmless
// no-ops — the in-app wallpaper still works everywhere.
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const {
  wallpaperExtension,
  rejectReason,
  restorePlan,
  tempFileCap,
  classifySetResult,
  getWallpaperPath,
} = require('./wallpaper-core.cjs')
// Linux has no SystemParametersInfo; the cross-platform controller owns
// gsettings/KDE there. Keeping the delegation here means the renderer's one
// buffer bridge works on both OSes without a second consent decision.
const desktopWallpaper = require('./desktop-wallpaper.cjs')

const PS = 'powershell.exe'
const SCRIPT = `
Add-Type -Name W -Namespace N -MemberDefinition '
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
'
$cmd = $args[0]
if ($cmd -eq 'get') {
  $buf = New-Object System.Text.StringBuilder 260
  $rc = [N.W]::SystemParametersInfo(0x0014, 260, $buf, 0)
  # SPI_GETDESKWALLPAPER returns 0 on failure and leaves the buffer empty.
  if ($rc -ne 0) { Write-Output $buf.ToString() }
} elseif ($cmd -eq 'set') {
  $p = $args[1]
  if (-not (Test-Path -LiteralPath $p)) { exit 2 }
  # SPI_SETDESKWALLPAPER returns 0 on failure. The old snippet cast it to
  # [void] and wrote 'ok' regardless, so a wallpaper that never changed still
  # reported success and the toast lied.
  $rc = [N.W]::SystemParametersInfo(0x0013, 0, $p, 3)
  if ($rc -eq 0) { exit 3 }
  Write-Output 'ok'
}
`

/**
 * Run the PowerShell snippet. Resolves a structured result instead of a bare
 * string so callers can tell a MISSING PowerShell (ENOENT — PATH/policy) from a
 * command that ran and failed (non-zero exit / timeout).
 */
function runPs(args) {
  return new Promise((resolve) => {
    execFile(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT, ...args],
      { windowsHide: true, timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          const reason = err.code === 'ENOENT' ? 'no-powershell' : 'error'
          return resolve({ ok: false, reason, out: '', err: String(stderr || err.message || '') })
        }
        return resolve({ ok: true, out: String(stdout || '').trim(), err: '' })
      })
  })
}

let previousPath = null // remembered once per session until restore()
let swapped = false // true between a successful set and its restore
const tmpFiles = new Set() // deleted on restore() AFTER the fade-out window

/**
 * Read the current OS wallpaper path. Retries once because the first SPI_GET
 * call can transiently return an empty buffer; a genuinely empty result (a
 * solid-colour desktop with no image) returns null, which restore treats as
 * "nothing to restore" rather than "restore to blank".
 */
async function getWallpaper() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runPs(['get'])
    const p = getWallpaperPath(res)
    if (p) return p
  }
  return null
}

/** True when this process has the OS wallpaper swapped and owes a restore. */
function hasPendingSwap() {
  return swapped
}

/** Write the image to a session temp file and set it as the OS wallpaper. */
async function setWallpaperFromBuffer(buf, mime) {
  if (process.platform === 'linux') return desktopWallpaper.setWallpaper({ data: buf, mime })
  const reject = rejectReason(process.platform, buf)
  if (reject) return { ok: false, reason: reject }
  let tmpFile = null
  try {
    tmpFile = path.join(os.tmpdir(), `gmatch-wallpaper-${Date.now()}${wallpaperExtension(mime)}`)
    fs.writeFileSync(tmpFile, buf)
    tmpFiles.add(tmpFile)
    // best-effort hygiene: never accumulate more than a few candidates
    while (tmpFiles.size > tempFileCap()) {
      const victim = tmpFiles.values().next().value
      tmpFiles.delete(victim)
      try { fs.unlinkSync(victim) } catch { /* gone */ }
    }
    if (previousPath === null) previousPath = await getWallpaper()
    const res = await runPs(['set', tmpFile])
    const outcome = classifySetResult(res)
    if (!outcome.ok) {
      // The file was never installed; drop it now so a failed set cannot leak
      // temp files (restore only runs its cleanup after a successful swap).
      tmpFiles.delete(tmpFile)
      try { fs.unlinkSync(tmpFile) } catch { /* gone */ }
      return outcome
    }
    swapped = true
    return { ok: true, hadPrevious: Boolean(previousPath) }
  } catch {
    if (tmpFile) { tmpFiles.delete(tmpFile); try { fs.unlinkSync(tmpFile) } catch { /* gone */ } }
    return { ok: false, reason: 'error' }
  }
}

/** Delete every temp wallpaper left from effect sessions. */
function cleanupWallpaperFiles() {
  for (const f of tmpFiles) { try { fs.unlinkSync(f) } catch { /* gone */ } }
  tmpFiles.clear()
}

/** Restore the wallpaper captured before the first swap; clears the temp file. */
async function restoreWallpaper() {
  if (process.platform === 'linux') return desktopWallpaper.restoreWallpaper()
  const plan = restorePlan(process.platform, swapped, previousPath)
  if (!plan.ok) return plan
  if (plan.skipSet && !swapped) { cleanupWallpaperFiles(); return plan }
  try {
    // Guard the existence check. The old code ran `set ''` when the captured
    // file was gone, and SystemParametersInfo with an empty string CLEARS the
    // desktop — so a user whose original wallpaper had been deleted got a
    // blank background instead of their own.
    if (plan.set && fs.existsSync(plan.set)) {
      const res = await runPs(['set', plan.set])
      if (!res.ok) return { ok: false, reason: 'restore-failed' }
    }
  } catch {
    return { ok: false, reason: 'restore-failed' }
  } finally {
    // Windows copies the file into its own wallpaper store when SPI runs, so
    // the temp file is disposable once the swap (or its restore) is done.
    cleanupWallpaperFiles()
    previousPath = null
    swapped = false
  }
  return { ok: true }
}

module.exports = {
  setWallpaperFromBuffer,
  restoreWallpaper,
  cleanupWallpaperFiles,
  hasPendingSwap,
}