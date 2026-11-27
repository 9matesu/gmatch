'use strict'
// mediaq setup suite IPC: status, one-shot install (streams progress), cancel,
// start. The installer owns the network/uv work; this only bridges it to the
// renderer and owns the AbortController that `mediaq:cancel` triggers.
module.exports = function registerMediaqHandlers({ ipcMain, installer, sidecar, getUserData, mainLog }) {
  let current = null // AbortController for the in-flight install, if any

  ipcMain.handle('mediaq:status', async () => {
    const userData = getUserData()
    let st = { installed: false, hasUv: false, bin: null }
    try {
      st = await installer.mediaqStatus({ userData })
    } catch {
      /* fall through with the empty status */
    }
    let running = false
    try {
      running = await sidecar.isHealthy()
    } catch {
      /* ignore */
    }
    return { installed: Boolean(st.installed), running: Boolean(running), base: sidecar.BASE }
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
      // Start it immediately so the provider (localhost:8765) answers.
      try {
        await sidecar.startMediaq({ mediaqBin: bin, onLog: (l) => mainLog && mainLog('[mediaq] ' + l) })
      } catch (err) {
        send({ phase: 'warn', message: 'installed, but the server did not start: ' + String((err && err.message) || err) })
      }
      send({ phase: 'done', percent: 100, message: 'mediaq is ready' })
      return { ok: true, bin }
    } catch (err) {
      if (signal.aborted) {
        send({ phase: 'cancelled', message: 'cancelled' })
        return { ok: false, cancelled: true }
      }
      const message = String((err && err.message) || err)
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
      await sidecar.startMediaq({ mediaqBin: st.bin, onLog: (l) => mainLog && mainLog('[mediaq] ' + l) })
      return { ok: true, base: sidecar.BASE }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })
}