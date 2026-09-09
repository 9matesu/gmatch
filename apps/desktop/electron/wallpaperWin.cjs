// Windows desktop wallpaper swap for consented domination effects.
// No native deps: SystemParametersInfoW via a PowerShell Add-Type snippet.
// The previous wallpaper path is remembered so it can be restored when the
// effect expires. Non-Windows platforms (and any failure) are harmless
// no-ops — the in-app wallpaper still works everywhere.
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

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
const tmpFiles = new Set() // deleted on restore() AFTER the fade-out window

async function getWallpaper() {
  return runPs(['get'])
}

/** Write the image to a session temp file and set it as the OS wallpaper. */
async function setWallpaperFromBuffer(buf, mime) {
  if (process.platform !== 'win32' || !Buffer.isBuffer(buf)) return { ok: false }
  try {
    const ext = /png/i.test(String(mime)) ? '.png' : /webp/i.test(String(mime)) ? '.webp' : '.jpg'
    const tmpFile = path.join(os.tmpdir(), `gmatch-wallpaper-${Date.now()}${ext}`)
    fs.writeFileSync(tmpFile, buf)
    tmpFiles.add(tmpFile)
    // best-effort hygiene: never accumulate more than 3 candidates
    while (tmpFiles.size > 3) {
      const victim = tmpFiles.values().next().value
      tmpFiles.delete(victim)
      try { fs.unlinkSync(victim) } catch { /* gone */ }
    }
    if (previousPath === null) previousPath = (await getWallpaper()) || null
    const out = await runPs(['set', tmpFile])
    if (out !== 'ok') return { ok: false }
    return { ok: true, hadPrevious: Boolean(previousPath) }
  } catch {
    return { ok: false }
  }
}

/** Delete every temp wallpaper left from effect sessions. */
function cleanupWallpaperFiles() {
  for (const f of tmpFiles) { try { fs.unlinkSync(f) } catch { /* gone */ } }
  tmpFiles.clear()
}

/** Restore the wallpaper captured before the first swap; clears the temp file. */
async function restoreWallpaper() {
  if (process.platform !== 'win32') return { ok: false }
  try {
    if (previousPath) {
      const exists = fs.existsSync(previousPath)
      await runPs(['set', exists ? previousPath : ''])
    }
  } catch { /* best-effort */ } finally {
    // Windows copies the file into its own wallpaper store when SPI runs, so
    // the temp file is disposable once the swap (or its restore) is done.
    cleanupWallpaperFiles()
    previousPath = null
  }
  return { ok: true }
}

module.exports = { setWallpaperFromBuffer, restoreWallpaper, cleanupWallpaperFiles }
