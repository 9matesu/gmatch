// Preload: expose a minimal, typed bridge. Renderer never fetches boorus directly.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('goongrid', {
  booruFetch: (request) => ipcRenderer.invoke('booru:fetch', request),
  cacheImage: (url) => ipcRenderer.invoke('cache:image', url),
  cacheStats: () => ipcRenderer.invoke('cache:stats'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
})
