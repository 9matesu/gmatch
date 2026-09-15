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
  // Opt-in local media vault (gallery keeps + card bytes on disk).
  vaultGet: (url) => ipcRenderer.invoke('vault:get', url),
  vaultPin: (url) => ipcRenderer.invoke('vault:pin', url),
  vaultUnpin: (url) => ipcRenderer.invoke('vault:unpin', url),
  vaultRemove: (url) => ipcRenderer.invoke('vault:remove', url),
  vaultStats: () => ipcRenderer.invoke('vault:stats'),
  vaultClear: () => ipcRenderer.invoke('vault:clear'),
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
  // Frameless window controls (renderer draws its own titlebar; absence of
  // these = plain browser/dev, chrome hides the buttons).
  winMinimize: () => ipcRenderer.send('window:minimize'),
  winToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  winClose: () => ipcRenderer.send('window:close'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  serverSet: (payload) => ipcRenderer.invoke('server:set', payload),
  serverRelaunch: () => ipcRenderer.invoke('server:relaunch'),
  // Portable self-update (GitHub Releases).
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => {
    const listener = (_event, status) => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  // OS integration for consented domination effects (Windows only, best-effort).
  wallpaperSetData: (buf, mime) => ipcRenderer.invoke('wallpaper:set-data', buf, mime),
  wallpaperRestore: () => ipcRenderer.invoke('wallpaper:restore'),
  wallpaperCleanupFiles: () => ipcRenderer.invoke('wallpaper:cleanup-files'),
  grantCameraOnce: () => ipcRenderer.invoke('camera:grant-once'),
  blocklistGet: () => ipcRenderer.invoke('blocklist:get'),
  blocklistSet: (data) => ipcRenderer.invoke('blocklist:set', data),
  blocklistReset: () => ipcRenderer.invoke('blocklist:reset'),
  logError: (scope, msg) => { try { ipcRenderer.send('log:renderer', { scope: String(scope || ''), msg: String(msg || '') }) } catch { /* never log-loop */ } },
  openLogFolder: () => ipcRenderer.invoke('app:open-log'),
})
