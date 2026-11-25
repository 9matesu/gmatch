'use strict'
// App metadata, external links and the Settings blocklist editor. The blocklist
// itself (load/parse/validate) is injected: this module only owns the IPC surface
// and the userData override file, so main.cjs keeps the rule next to its parsers.
const fs = require('node:fs')
const path = require('node:path')
const { shell } = require('electron')

module.exports = function registerAppHandlers({ ipcMain, app, blocklist }) {
  const { userPath, get, load, defaults, apply } = blocklist

  // Update check (Settings): installed version + open the download in the OS browser.
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:open-log', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('shell:open', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.reject(new Error('only http(s) URLs'))
  })

  // Dynamic blocklist control (Settings -> Blocklist): full edit/reset.
  ipcMain.handle('blocklist:get', () => ({
    current: get() || load(),
    defaults: defaults(),
    isCustom: Boolean(userPath() && fs.existsSync(userPath())),
  }))

  // Write the user's blocklist override file. Single source of truth:
  // shared/blocklist.json is the factory default (read-only); the user's copy
  // takes precedence on load.
  const persist = (data) => {
    const target = userPath()
    if (!target) return
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8')
  }

  ipcMain.handle('blocklist:set', (_event, payload) => {
    try {
      let data = payload
      if (typeof data === 'string') data = JSON.parse(data)
      if (!data || typeof data !== 'object') {
        return { ok: false, error: 'Payload must be a JSON object' }
      }
      if (!Array.isArray(data.blocklist)) {
        return { ok: false, error: 'Payload must contain a "blocklist" array' }
      }
      persist(data)
      apply(data)
      return { ok: true, data: get() }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  /**
   * Ban terms FOR GOOD ("never show this again" in the clicker).
   *
   * The read-modify-write happens HERE, on the authoritative list: the
   * renderer sends only the TERMS and adopts the list main returns. The old
   * path sent the renderer's own full list, which silently clobbered anything
   * main had written since (the renderer's copy could be a session old).
   */
  ipcMain.handle('blocklist:ban', (_event, payload) => {
    try {
      const raw = Array.isArray(payload)
        ? payload
        : typeof payload === 'string'
          ? [payload]
          : [payload?.tag]
      const data = load()
      const list = Array.isArray(data.blocklist) ? [...data.blocklist] : []
      const added = []
      for (const r of raw) {
        // Only real strings are terms: a number payload is not a tag.
        if (typeof r !== 'string') continue
        const t = r.toLowerCase().trim()
        if (!t || list.includes(t)) continue
        list.push(t)
        added.push(t)
      }
      if (!added.length) return { ok: true, data, added: [] }
      const next = { ...data, blocklist: list }
      persist(next)
      apply(next)
      return { ok: true, data: next, added }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('blocklist:reset', () => {
    try {
      const target = userPath()
      if (target && fs.existsSync(target)) {
        fs.unlinkSync(target)
      }
      const data = defaults()
      apply(data)
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
}