'use strict'
// Secure KV bridge (B.3): the renderer proxies designated localStorage keys here.
module.exports = function registerSecureHandlers({ ipcMain, secureKV, secureAvailable }) {
  ipcMain.handle('secure:available', () => secureAvailable)
  ipcMain.handle('secure:get', (_event, key) => secureKV.get(String(key)))
  ipcMain.handle('secure:set', (_event, key, value) => secureKV.set(String(key), String(value)))
  ipcMain.handle('secure:delete', (_event, key) => secureKV.delete(String(key)))
}