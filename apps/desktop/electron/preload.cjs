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
  evictImage: (url) => ipcRenderer.invoke('cache:evict', url),
  // Player-owned idle folders (dialog-picked, served over idle-file://).
  customPickFolder: () => ipcRenderer.invoke('custom:pick-folder'),
  customListFolder: (id) => ipcRenderer.invoke('custom:list-folder', id),
  customRemoveFolder: (id) => ipcRenderer.invoke('custom:remove-folder', id),
  // Secure KV (B.3): DPAPI-backed storage for identity keys/threads/pfps.
  secureAvailable: () => ipcRenderer.invoke('secure:available'),
  secureGet: (key) => ipcRenderer.invoke('secure:get', key),
  secureSet: (key, value) => ipcRenderer.invoke('secure:set', key, value),
  secureDelete: (key) => ipcRenderer.invoke('secure:delete', key),
  serverState: () => ipcRenderer.invoke('server:state'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  serverSet: (payload) => ipcRenderer.invoke('server:set', payload),
  serverRelaunch: () => ipcRenderer.invoke('server:relaunch'),
  // OS integration for consented domination effects (Windows only, best-effort).
  wallpaperSetData: (buf, mime) => ipcRenderer.invoke('wallpaper:set-data', buf, mime),
  wallpaperRestore: () => ipcRenderer.invoke('wallpaper:restore'),
  wallpaperCleanupFiles: () => ipcRenderer.invoke('wallpaper:cleanup-files'),
  grantCameraOnce: () => ipcRenderer.invoke('camera:grant-once'),
})
