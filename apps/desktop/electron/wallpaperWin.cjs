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
  isSupportedPlatform,
  wallpaperExtension,
  rejectReason,
  restorePlan,
  tempFileCap,
} = require('./wallpaper-core.cjs')

const PS = 'powershell.exe'
const SCRIPT = `
Add-Type -Name W -Namespace N -MemberDefinition '
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
'
$cmd = $args[0]
if ($cmd -eq 'get') {
  $buf = New-Object System.Text.StringBuilder 260
  [void][N.W]::SystemParametersInfo(0x0014, 260, $buf, 0)
  Write-Output $buf.ToString()
} elseif ($cmd -eq 'set') {
  $p = $args[1]
  if (-not (Test-Path -LiteralPath $p)) { Write-Error 'missing file'; exit 1 }
  [void][N.W]::SystemParametersInfo(0x0013, 0, $p, 3)
  Write-Output 'ok'
}
`

function runPs(args) {
  return new Promise((resolve) => {
    execFile(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT, ...args],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => resolve(err ? null : String(stdout).trim()))
  })
}

let previousPath = null // remembered once per session until restore()
let swapped = false // true between a successful set and its restore
const tmpFiles = new Set() // deleted on restore() AFTER the fade-out window

async function getWallpaper() {
  return runPs(['get'])
}

/** True when this process has the OS wallpaper swapped and owes a restore. */
function hasPendingSwap() {
  return swapped
}

/** Write the image to a session temp file and set it as the OS wallpaper. */
async function setWallpaperFromBuffer(buf, mime) {
  const reject = rejectReason(process.platform, buf)
  if (reject) return { ok: false, reason: reject }
  try {
    const tmpFile = path.join(os.tmpdir(), `gmatch-wallpaper-${Date.now()}${wallpaperExtension(mime)}`)
    fs.writeFileSync(tmpFile, buf)
    tmpFiles.add(tmpFile)
    // best-effort hygiene: never accumulate more than a few candidates
    while (tmpFiles.size > tempFileCap()) {
      const victim = tmpFiles.values().next().value
      tmpFiles.delete(victim)
      try { fs.unlinkSync(victim) } catch { /* gone */ }
    }
    if (previousPath === null) previousPath = (await getWallpaper()) || null
    const out = await runPs(['set', tmpFile])
    if (out !== 'ok') return { ok: false, reason: 'set-failed' }
    swapped = true
    return { ok: true, hadPrevious: Boolean(previousPath) }
  } catch {
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
  const plan = restorePlan(process.platform, swapped, previousPath)
  if (!plan.ok) return plan
  if (plan.skipSet && !swapped) return plan
  try {
    // Guard the existence check. The old code ran `set ''` when the captured
    // file was gone, and SystemParametersInfo with an empty string CLEARS the
    // desktop — so a user whose original wallpaper had been deleted got a
    // blank background instead of their own.
    if (plan.set && fs.existsSync(plan.set)) await runPs(['set', plan.set])
  } catch { /* best-effort */ } finally {
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
