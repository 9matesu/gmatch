'use strict'
// Consented domination media: OS wallpaper swap (Windows; no-op elsewhere) and
// the dedicated popup_video player window. Both must never outlive the app.
const { BrowserWindow, screen } = require('electron')

module.exports = function registerDominationMediaHandlers({ ipcMain, app, wallpaperWin, domVideo, mainLog }) {
  // OS wallpaper swap.
  ipcMain.handle('wallpaper:set-data', (_event, buf, mime) =>
    wallpaperWin.setWallpaperFromBuffer(Buffer.from(buf), String(mime || '')))
  ipcMain.handle('wallpaper:restore', () => wallpaperWin.restoreWallpaper())
  ipcMain.handle('wallpaper:cleanup-files', () => { wallpaperWin.cleanupWallpaperFiles(); return { ok: true } })

  // A domination wallpaper that outlives the app is the worst failure mode of
  // this feature: the victim closes gMatch and their desktop is still
  // somebody else's picture, with the only copy of the original living in this
  // process. Nothing called restore on the way out (cleanup-files only deletes
  // temp files, it does not put the wallpaper back), so close it here.
  for (const evt of ['before-quit', 'will-quit']) {
    app.on(evt, () => { if (wallpaperWin.hasPendingSwap()) void wallpaperWin.restoreWallpaper() })
  }

  // Dedicated player window for consented popup_video effects: a real OS window
  // (works while gMatch is minimized), sandboxed, muted, auto-closing at the
  // effect duration. The window lifecycle IS the execution outcome the renderer
  // reports back. URL is https-validated here on the privileged side.
  let domVideoWin = null
  app.on('before-quit', () => {
    if (!domVideoWin) return
    try { domVideoWin.destroy() } catch { /* gone */ }
    domVideoWin = null
  })

  ipcMain.handle('dom-video:open', (_event, url, durationMs) => {
    return new Promise((resolve) => {
      const valid = domVideo.validVideoUrl(url)
      if (!valid) return resolve({ ok: false, reason: 'invalid-url' })
      let settled = false
      const finish = (ok, reason) => { if (!settled) { settled = true; resolve({ ok, reason }) } }
      try {
        if (domVideoWin) { try { domVideoWin.destroy() } catch { /* already gone */ } domVideoWin = null }
        const geo = domVideo.windowGeometry(screen.getPrimaryDisplay()?.workArea)
        domVideoWin = new BrowserWindow({
          ...geo,
          title: 'gMatch',
          backgroundColor: '#000000',
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        })
        let timer = null
        domVideoWin.on('closed', () => {
          domVideoWin = null
          if (timer) clearTimeout(timer)
          finish(true)
        })
        domVideoWin.webContents.on('did-fail-load', () => { try { domVideoWin?.close() } catch { /* gone */ } })
        timer = setTimeout(() => { try { domVideoWin?.close() } catch { /* gone */ } }, domVideo.clampDurationMs(durationMs))
        domVideoWin.loadURL(domVideo.playerPageUrl(valid)).catch(() => { try { domVideoWin?.close() } catch { /* gone */ } })
      } catch (err) {
        mainLog(`dom-video:open failed: ${err?.message || err}`)
        finish(false, err?.message || 'error')
      }
    })
  })
}