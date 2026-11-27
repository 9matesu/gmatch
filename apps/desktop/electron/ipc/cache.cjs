'use strict'
// Encrypted picture cache (disk LRU) + the RAM feed index behind it.
module.exports = function registerCacheHandlers({ ipcMain, imageCache }) {
  ipcMain.handle('cache:image', (_event, url) => imageCache.cacheImage(url).then((local) => ({ local })))
  ipcMain.handle('cache:stats', () => imageCache.cacheStats())
  // What the device holds, newest first: the cache viewer's data source.
  ipcMain.handle('cache:list', () => ({ items: imageCache.list() }))
  ipcMain.handle('cache:clear', () => imageCache.clearCache())
  ipcMain.handle('cache:clear-feed', () => imageCache.clearFeedCache())
  ipcMain.handle('cache:evict', (_event, url) => ({ ok: imageCache.evict(String(url ?? '')) }))
}