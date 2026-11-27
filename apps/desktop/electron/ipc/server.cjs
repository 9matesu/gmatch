'use strict'
// Server-mode bridge for the Settings UI (packaged topology control): read/write
// the host/client pointer, probe a candidate node, relaunch into the new mode.
module.exports = function registerServerHandlers({ ipcMain, app, serverMode, apiSidecar, secureKV }) {
  ipcMain.handle('server:state', () => ({
    packaged: app.isPackaged,
    // Hosts own their node: the PIN is shown in Settings so the developer
    // (and any self-hoster) can unlock the bundled admin console. See
    // electron/admin-pin.cjs header for the trust argument.
    adminPin: require('../admin-pin.cjs').adminPin(app.getPath('userData')),
    ...(app.isPackaged
      ? { ...serverMode.readServerMode(), lanUrls: serverMode.lanUrls() }
      : { mode: 'host', url: apiSidecar.API_BASE, lanUrls: serverMode.lanUrls() }),
  }))
  // Persist host/client choice + hand the renderer the fresh state. Switching
  // takes effect on next launch (relaunch button in Settings does that).
  ipcMain.handle('server:set', (_event, payload) => {
    const mode = payload?.mode === 'client' ? 'client' : 'host'
    try {
      serverMode.writeServerMode(mode, String(payload?.url || ''))
    } catch (err) {
      return { ok: false, error: err.message }
    }
    return { ok: true }
  })
  ipcMain.handle('server:probe', async (_event, url) => {
    try {
      // Health, not TCP: a live host that 404s is not a node. The same rule
      // the launch check uses, so Reconnect and boot agree.
      return await serverMode.probeServer(url)
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
  // Manual restart for Settings > Diagnostics. Unlike server:relaunch this
  // keeps the window alive: stop the old child, wait for :8790 to close, spawn
  // a replacement and let a real health probe prove it came back. A failure
  // at ANY step is returned to the renderer, never reported as success.
  ipcMain.handle('server:restart-sidecar', async () => {
    try {
      if (app.isPackaged && serverMode.readServerMode().mode !== 'host') {
        return { ok: false, error: 'This install is a client; it has no local sidecar to restart.' }
      }
      if (apiSidecar.isRunning && apiSidecar.isRunning()) apiSidecar.stopApi()
      if (apiSidecar.waitForPortFree) {
        const free = await apiSidecar.waitForPortFree()
        if (!free) return { ok: false, error: 'Port 8790 is still bound after stopping the old server.' }
      }
      await apiSidecar.startApi()
      const healthy = await apiSidecar.ping(3000)
      if (!healthy) return { ok: false, error: 'Server spawned but did not answer /api/health.' }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
  // Apply the new mode NOW: relaunch the app (used by the Settings button).
  ipcMain.handle('server:relaunch', () => {
    apiSidecar.stopApi()
    try { if (secureKV) secureKV.flush() } catch { /* best effort */ }
    const execPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
    app.relaunch({ execPath })
    app.exit(0)
  })
}