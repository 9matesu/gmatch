'use strict'
// Encrypted media vault: the renderer's keepsakes, served over loopback when the
// main process holds the bytes.
module.exports = function registerVaultHandlers({ ipcMain, vault, vaultServer }) {
  // probe (not get) so a row whose bytes cannot be read is reported as
  // unreadable rather than a miss, and is never dropped from the manifest.
  ipcMain.handle('vault:get', (_event, url) => vault.probe(String(url ?? '')))
  ipcMain.handle('vault:pin', (_event, url) => vault.pin(String(url ?? '')).then((local) => ({ local })))
  ipcMain.handle('vault:pin-stream', (event, url) => vault.pinStream(String(url ?? ''), {
    onProgress: ({ bytes, total }) => {
      try {
        event.sender.send('vault:pin-stream-progress', { url: String(url ?? ''), bytes, total })
      } catch {}
    },
  }))
  ipcMain.handle('vault:unpin', (_event, url) => ({ ok: vault.unpin(String(url ?? '')) }))
  ipcMain.handle('vault:remove', (_event, url) => ({ ok: vault.remove(String(url ?? '')) }))
  // Disco-first: bytes the renderer already holds (verified swarm assembly,
  // forged upload) are written straight to the encrypted store, re-checked
  // against their content hash in the main process.
  ipcMain.handle('vault:put-bytes', (_event, hash, mime, data, alias) =>
    vault.putBytes(String(hash ?? ''), String(mime ?? ''), data, alias == null ? null : String(alias)))
  ipcMain.handle('vault:list', () => vault.list())
  ipcMain.handle('vault:stats', () => vault.stats())
  ipcMain.handle('vault:clear', () => vault.clear())
  ipcMain.handle('vault:http-url', (_event, url) => ({ local: vaultServer.httpUrl(String(url ?? '')) }))
}