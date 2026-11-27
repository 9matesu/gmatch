'use strict'
// Frameless window controls. NativeHeaderBar draws min/max/close and gates them
// on the bridge; close() quits the app, reload is a plain reload.
const { BrowserWindow, app } = require('electron')

module.exports = function registerWindowHandlers({ ipcMain }) {
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('window:close', () => app.quit())
  ipcMain.on('window:reload', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.webContents.reload()
  })
}