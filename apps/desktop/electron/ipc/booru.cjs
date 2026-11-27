'use strict'
// Booru fetch bridge (the main process is the authority; the renderer only
// receives already-filtered posts) + pmv:playlist lookups.
module.exports = function registerBooruHandlers({ ipcMain, fetchBooru, setRoundExcludes, httpGet, feedMetrics }) {
  ipcMain.handle('booru:fetch', (_event, payload) => {
    // Player excludes arrive per round and become query negatives.
    setRoundExcludes((payload && payload.excludes) || [])
    return fetchBooru(payload ?? {})
  })

  // Read-only feed search metrics (observability, never rendered in the UI).
  ipcMain.handle('booru:timings', () => (feedMetrics ? feedMetrics.summary() : null))

  ipcMain.handle('pmv:playlist', async (_event, id) => {
    const rawId = String(id || '').trim()
    if (!/^(?:[0-9a-fA-F]{24}|[a-zA-Z0-9_-]{12,32})$/.test(rawId)) return null
    try {
      const text = await httpGet(`https://pmvhaven.com/api/playlists/${rawId}`, { Referer: 'https://pmvhaven.com/' })
      return JSON.parse(text)
    } catch {
      return null
    }
  })
}