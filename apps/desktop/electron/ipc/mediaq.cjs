'use strict'
// mediaq setup suite IPC: status, one-shot install (streams progress), cancel,
// start, stop, restart. The installer owns the network/uv work; this bridges it
// to the renderer, owns the AbortController, and reports what really happened
// (an installed-but-not-started server is never reported as a clean success).
module.exports = function registerMediaqHandlers({ ipcMain, installer, sidecar, getUserData, mainLog, onReady }) {
  let current = null // AbortController for the in-flight install, if any

  const log = (line) => { if (mainLog) mainLog('[mediaq] ' + line) }
  const errText = (err) => String((err && err.message) || err || '')

  // One owner for "the local server is usable by the clicker". Every start path
  // (install, start, restart) goes through it so a cooldown is never left stale.
  async function startServer(mediaqBin) {
    await sidecar.startMediaq({ mediaqBin, onLog: log })
    if (onReady) onReady()
    return { ok: true, base: sidecar.BASE, running: true }
  }

  ipcMain.handle('mediaq:status', async () => {
    let st = { installed: false, hasUv: false, bin: null }
    let error = null
    try {
      st = await installer.mediaqStatus({ userData: getUserData() })
    } catch (err) {
      error = errText(err)
    }
    let running = false
    try {
      running = await sidecar.isHealthy()
    } catch {
      /* an unreachable local server is simply not running */
    }
    return {
      installed: Boolean(st.installed),
      hasUv: Boolean(st.hasUv),
      running: Boolean(running),
      base: sidecar.BASE,
      ...(error ? { error } : {}),
    }
  })

  ipcMain.handle('mediaq:install', async (event) => {
    const send = (p) => {
      try {
        if (!event.sender.isDestroyed()) event.sender.send('mediaq:progress', p)
      } catch {
        /* window gone */
      }
    }
    // A second install request supersedes the first: abort it.
    if (current) {
      try {
        current.abort()
      } catch {
        /* ignore */
      }
    }
    const controller = new AbortController()
    current = controller
    const signal = controller.signal
    try {
      const { bin } = await installer.installMediaqSuite({ userData: getUserData(), onProgress: send, signal })
      // Start it immediately so the provider (localhost:8765) answers. A server
      // that fails to start is reported as such — install succeeded, launch did not.
      let running = false
      let startError = null
      try {
        await startServer(bin)
        running = true
      } catch (err) {
        startError = errText(err)
        send({ phase: 'warn', message: 'installed, but the server did not start: ' + startError })
      }
      send({
        phase: 'done',
        percent: 100,
        message: running ? 'mediaq is ready' : 'mediaq installed (server not running)',
      })
      return { ok: true, bin, running, ...(startError ? { error: startError } : {}) }
    } catch (err) {
      if (signal.aborted) {
        send({ phase: 'cancelled', message: 'cancelled' })
        return { ok: false, cancelled: true }
      }
      const message = errText(err)
      send({ phase: 'error', message })
      return { ok: false, error: message }
    } finally {
      if (current === controller) current = null
    }
  })

  ipcMain.handle('mediaq:cancel', () => {
    if (current) {
      try {
        current.abort()
      } catch {
        /* ignore */
      }
    }
    return { ok: true }
  })

  ipcMain.handle('mediaq:start', async () => {
    try {
      const st = await installer.mediaqStatus({ userData: getUserData() })
      if (!st.bin) return { ok: false, error: 'not-installed' }
      return await startServer(st.bin)
    } catch (err) {
      return { ok: false, error: errText(err) }
    }
  })

  ipcMain.handle('mediaq:stop', async () => {
    try {
      const stopped = await sidecar.stopMediaq()
      // A server started by another process cannot be killed by us; verify the
      // port instead of claiming a stop that did not happen.
      let running = false
      for (let i = 0; i < 6; i += 1) {
        running = await sidecar.isHealthy()
        if (!running) break
        await new Promise((r) => setTimeout(r, 200))
      }
      if (running) return { ok: false, running: true, error: 'still-running' }
      return { ok: true, running: false, stopped: Boolean(stopped && stopped.stopped) }
    } catch (err) {
      return { ok: false, error: errText(err) }
    }
  })

  ipcMain.handle('mediaq:restart', async () => {
    try {
      const st = await installer.mediaqStatus({ userData: getUserData() })
      if (!st.bin) return { ok: false, error: 'not-installed' }
      // Best-effort stop: a server we do not own stays up and start re-adopts it.
      await sidecar.stopMediaq()
      return await startServer(st.bin)
    } catch (err) {
      return { ok: false, error: errText(err) }
    }
  })
}
