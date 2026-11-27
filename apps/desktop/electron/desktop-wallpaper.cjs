'use strict'
// Cross-platform desktop wallpaper change for the `wallpaper:set` IPC and the
// consented domination effect. Windows writes the registry + TranscodedWallpaper
// and applies it with SystemParametersInfo; Linux uses gsettings (GNOME) with a
// qdbus/KDE fallback. Everything is async and time-bounded: a wallpaper command
// can never stall the app, and every failure resolves to a structured reason
// rather than throwing across the IPC boundary.
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const core = require('./desktop-wallpaper-core.cjs')

const EXEC_TIMEOUT_MS = 12_000

/** The real tool runner. execFile takes an argv array, so a wallpaper path is
 * never interpreted by a shell; windowsHide keeps an update from flashing a
 * console, and the timeout bounds a hung desktop call. */
function defaultRun(tool, args) {
  return new Promise((resolve) => {
    execFile(tool, args, {
      windowsHide: true,
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => {
      if (!err) return resolve({ ok: true, out: String(stdout || '').trim() })
      resolve(core.classifyToolError(err, tool))
    })
  })
}

/**
 * Build a wallpaper controller. Dependencies are injectable so the OS paths
 * can be exercised in a node test without touching a real desktop.
 */
function createDesktopWallpaper(deps = {}) {
  const platform = deps.platform || process.platform
  const env = deps.env || process.env
  const run = deps.run || defaultRun
  const fsPromises = deps.fs || fs.promises
  const paths = deps.path || path
  const tmpdir = deps.tmpdir || (() => os.tmpdir())

  let previous = null // captured once per pending swap, so restore is possible
  let currentTemp = null // temp file we created; a caller-supplied path is never deleted

  async function safeRun(tool, args) {
    try {
      return await run(tool, args)
    } catch (err) {
      // A synchronous throw from an injected runner (or an unexpected exec
      // failure) is still a result, never an IPC rejection.
      return core.classifyToolError(err, tool)
    }
  }

  async function removeTemp(file) {
    if (!file) return
    try { await fsPromises.unlink(file) } catch { /* already gone */ }
  }

  /** Plasma's qdbus binary was renamed across Qt generations; try each name
   * and keep the last reason so a missing one is still an honest error. */
  async function runKde(script) {
    let last = null
    for (const tool of core.kdeDbusTools()) {
      const res = await safeRun(tool, core.kdeDbusArgs(script))
      if (res.ok) return res
      last = res
    }
    return last || { ok: false, reason: 'no-tool', tool: 'qdbus' }
  }

  function windowsThemesDir() {
    const roaming = env.APPDATA || paths.join(os.homedir(), 'AppData', 'Roaming')
    return paths.join(roaming, 'Microsoft', 'Windows', 'Themes')
  }

  async function capture(backend) {
    if (backend === 'windows') {
      const res = await safeRun('powershell.exe', core.windowsArgsFor(core.windowsGetScript()))
      const value = core.parseWindowsWallpaper(res)
      return value ? { backend, value } : null
    }
    // GNOME is the primary Linux backend; a missing gsettings means we may be
    // on KDE, so probe that before giving up on capture (restore stays honest).
    const gnome = await safeRun('gsettings', core.gnomeGetArgs())
    if (gnome.ok) return { backend: 'gnome', value: core.parseGsettingsValue(gnome.out) }
    const kde = await runKde(core.kdeGetScript())
    if (kde.ok) {
      const match = String(kde.out || '').match(/file:\/\/[^\s"']+/)
      if (match) return { backend: 'kde', value: match[0] }
    }
    return null
  }

  async function apply(backend, filePath) {
    if (backend === 'windows') {
      try {
        const dir = windowsThemesDir()
        await fsPromises.mkdir(dir, { recursive: true })
        // Windows reads the TranscodedWallpaper file; the registry value names
        // it, and SPI makes the change live without a logout.
        const transcoded = paths.join(dir, 'TranscodedWallpaper')
        await fsPromises.copyFile(filePath, transcoded)
        const res = await safeRun('powershell.exe', core.windowsArgsFor(core.windowsSetScript(), transcoded))
        if (!res.ok) {
          return { ok: false, reason: res.reason === 'no-tool' ? 'no-powershell' : 'set-failed' }
        }
        return { ok: true, backend, path: transcoded }
      } catch {
        return { ok: false, reason: 'set-failed' }
      }
    }

    const uri = core.fileUri(filePath)
    const gnome = await safeRun('gsettings', core.gnomeSetArgs(uri))
    if (gnome.ok) {
      // Dark mode uses a separate key; fire-and-forget so a slow second call
      // never delays the IPC answer. The primary key already succeeded.
      void safeRun('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri])
      return { ok: true, backend: 'gnome', uri }
    }
    const kde = await runKde(core.kdeSetScript(uri))
    if (kde.ok) return { ok: true, backend: 'kde', uri }
    return core.classifyLinuxResult(gnome, kde)
  }

  async function setWallpaper(source) {
    try {
      const planned = core.plan(platform, source)
      if (!planned.ok) return { ok: false, reason: planned.reason }

      let filePath = null
      let tempFile = null
      if (planned.source.kind === 'path') {
        filePath = planned.source.path
        try {
          const stat = await fsPromises.stat(filePath)
          if (!stat || !stat.isFile()) return { ok: false, reason: 'invalid-source' }
        } catch {
          return { ok: false, reason: 'invalid-source' }
        }
      } else {
        tempFile = paths.join(
          tmpdir(),
          `gmatch-desktop-wallpaper-${process.pid}-${Date.now()}${core.wallpaperExtension(planned.source.mime)}`,
        )
        try {
          const buf = Buffer.isBuffer(planned.source.data)
            ? planned.source.data
            : Buffer.from(planned.source.data)
          await fsPromises.writeFile(tempFile, buf)
        } catch {
          return { ok: false, reason: 'write-failed' }
        }
        filePath = tempFile
      }

      if (!previous) {
        const captured = await capture(planned.backend)
        // A solid-colour desktop has no captured path: keep trying on the next
        // set instead of pinning an unrestorable placeholder.
        if (captured && captured.value) previous = captured
      }
      const outcome = await apply(planned.backend, filePath)
      if (!outcome.ok) {
        await removeTemp(tempFile)
        return outcome
      }

      const oldTemp = currentTemp
      currentTemp = tempFile
      if (oldTemp && oldTemp !== tempFile) await removeTemp(oldTemp)
      return outcome
    } catch (err) {
      return { ok: false, reason: 'error', detail: String(err && err.message || err) }
    }
  }

  /** Put back the wallpaper captured before the last successful set. Refuses
   * to run when nothing was swapped (an empty path would blank the desktop). */
  async function restoreWallpaper() {
    if (!previous || !previous.value) {
      await removeTemp(currentTemp)
      currentTemp = null
      previous = null
      return { ok: true, reason: 'nothing-to-restore', skip: true }
    }
    try {
      const backend = previous.backend
      let res
      if (backend === 'windows') {
        res = await safeRun('powershell.exe', core.windowsArgsFor(core.windowsSetScript(), previous.value))
      } else if (backend === 'gnome') {
        res = await safeRun('gsettings', core.gnomeSetArgs(previous.value))
        void safeRun('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', previous.value])
      } else {
        res = await runKde(core.kdeSetScript(previous.value))
      }
      if (!res.ok) return { ok: false, reason: 'restore-failed' }
      await removeTemp(currentTemp)
      currentTemp = null
      previous = null
      return { ok: true, backend }
    } catch {
      return { ok: false, reason: 'restore-failed' }
    }
  }

  function hasPendingSwap() {
    return Boolean(previous && previous.value)
  }

  function cleanup() {
    if (currentTemp) { try { fs.unlinkSync(currentTemp) } catch { /* gone */ } currentTemp = null }
  }

  return { setWallpaper, restoreWallpaper, hasPendingSwap, cleanup }
}

module.exports = Object.assign(createDesktopWallpaper(), { createDesktopWallpaper })
