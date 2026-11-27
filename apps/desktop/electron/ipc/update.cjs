'use strict'
// Update check/install IPC (Settings). The updater itself is created in main
// (packaged only); this module owns only the IPC surface.
module.exports = function registerUpdateHandlers({ ipcMain, app, getUpdater, onInstall }) {
  ipcMain.handle('update:check', () =>
    (getUpdater() ? getUpdater().check(true) : { phase: 'unsupported', current: app.getVersion() }))
  ipcMain.handle('update:state', () =>
    (getUpdater() ? getUpdater().getState() : { phase: 'unsupported', current: app.getVersion() }))
  ipcMain.handle('update:install', () => {
    const updater = getUpdater()
    if (!updater) return { ok: false, error: 'updates only work in packaged builds' }
    // The swap script restarts the app: that is a real quit, not a close.
    onInstall()
    return updater.install()
  })
}