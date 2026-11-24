'use strict'
// mediaq setup suite IPC: status, one-shot install (with progress), and start.
// The installer owns the network/uv work; this only bridges it to the renderer.
module.exports = function registerMediaqHandlers({ ipcMain, installer, sidecar, getUserData, mainLog }) {
  const safe = (fn, fallback) => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }

  ipcMain.handle('mediaq:status', async () => {
    const userData = getUserData()
    const st = await safe(() => installer.mediaqStatus({ userData }), { installed: false, hasUv: false, bin: null })
    const running = await safe(() => sidecar.isHealthy(), false)
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
    try {
      const { bin } = await installer.installMediaqSuite({ userData: getUserData(), onProgress: send })
      // Start it immediately so the provider (localhost:8765) answers.
      try {
        await sidecar.startMediaq({ mediaqBin: bin, onLog: (l) => mainLog && mainLog('[mediaq] ' + l) })
      } catch (err) {
        send({ phase: 'warn', message: 'installed, but the server did not start: ' + String((err && err.message) || err) })
      }
      send({ phase: 'done', message: 'mediaq is ready' })
      return { ok: true, bin }
    } catch (err) {
      const message = String((err && err.message) || err)
      send({ phase: 'error', message })
      return { ok: false, error: message }
    }
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