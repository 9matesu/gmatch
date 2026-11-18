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
      // Single source of truth: shared/blocklist.json is the factory
      // default (read-only); Settings edits land ONLY in the userData copy,
      // which takes precedence on load.
      const target = userPath()
      if (target) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8')
      }
      apply(data)
      return { ok: true, data: get() }
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