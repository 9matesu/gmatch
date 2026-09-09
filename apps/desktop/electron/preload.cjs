// Preload: expose a minimal, typed bridge. Renderer never fetches boorus directly.
const { contextBridge, ipcRenderer } = require('electron')

// API sidecar base passed by main via additionalArguments (sandbox-safe).
const apiArg = process.argv.find((a) => a.startsWith('--api-base='))
if (apiArg) contextBridge.exposeInMainWorld('__API_BASE__', apiArg.slice('--api-base='.length))

contextBridge.exposeInMainWorld('gmatch', {
  booruFetch: (request) => ipcRenderer.invoke('booru:fetch', request),
  cacheImage: (url) => ipcRenderer.invoke('cache:image', url),
  cacheStats: () => ipcRenderer.invoke('cache:stats'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  // Secure KV (B.3): DPAPI-backed storage for identity keys/threads/pfps.
  secureAvailable: () => ipcRenderer.invoke('secure:available'),
  secureGet: (key) => ipcRenderer.invoke('secure:get', key),
  secureSet: (key, value) => ipcRenderer.invoke('secure:set', key, value),
  secureDelete: (key) => ipcRenderer.invoke('secure:delete', key),
  serverState: () => ipcRenderer.invoke('server:state'),
  serverSet: (payload) => ipcRenderer.invoke('server:set', payload),
  serverRelaunch: () => ipcRenderer.invoke('server:relaunch'),
})
