'use strict'
// Server-mode bridge for the Settings UI (packaged topology control): read/write
// the host/client pointer, probe a candidate node, relaunch into the new mode.
const fs = require('node:fs')
const path = require('node:path')

function ownerFile(app) {
  return path.join(app.getPath('userData'), 'admin-owner.json')
}

function readOwner(app) {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerFile(app), 'utf8'))
    return typeof parsed?.orbitId === 'string' ? parsed.orbitId : null
  } catch {
    return null
  }
}

module.exports = function registerServerHandlers({ ipcMain, app, serverMode, apiSidecar, secureKV }) {
  ipcMain.handle('server:state', () => ({
    packaged: app.isPackaged,
    // The active world id (default install = "official"). The renderer uses it
    // to namespace per-world client storage and to know which world is live.
    worldId: serverMode.readWorldId(),
    // Public identifier only — never a credential. The console PIN stays in
    // the main process / node as a scrypt hash.
    nodeOwnerId: readOwner(app),
    ...(app.isPackaged
      ? { ...serverMode.readServerMode(), lanUrls: serverMode.lanUrls() }
      : { mode: 'host', url: apiSidecar.API_BASE, lanUrls: serverMode.lanUrls() }),
  }))
  // Bind this install's first identity as the node owner. Sticky: a later
  // account switch cannot claim the console for a different identity.
  ipcMain.handle('server:claim-admin-owner', (_event, orbitId) => {
    const id = String(orbitId || '').trim()
    if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return { ok: false }
    const existing = readOwner(app)
    if (existing) return { ok: true, orbitId: existing }
    try {
      fs.mkdirSync(path.dirname(ownerFile(app)), { recursive: true })
      fs.writeFileSync(ownerFile(app), JSON.stringify({ orbitId: id }))
      return { ok: true, orbitId: id }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  // Persist host/client choice + hand the renderer the fresh state. Switching
  // takes effect on next launch (relaunch button in Settings does that). The
  // client world id is written separately by `server:set-world` (switchClientWorld).
  ipcMain.handle('server:set', (_event, payload) => {
    const mode = payload?.mode === 'client' ? 'client' : 'host'
    try {
      serverMode.writeServerMode(mode, String(payload?.url || ''))
    } catch (err) {
      return { ok: false, error: err.message }
    }
    return { ok: true }
  })
  // Record the active CLIENT world id (written by switchClientWorld right after
  // it commits a node). Hosting is one world, so writeWorldId refuses otherwise.
  ipcMain.handle('server:set-world', (_event, worldId) => {
    try {
      serverMode.writeWorldId(String(worldId || ''))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
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