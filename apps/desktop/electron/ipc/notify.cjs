'use strict'
// OS notification state: the unread badge (taskbar overlay + tray tooltip +
// window flash) and the two native-notification entry points. The unread count
// is the renderer's; this module only decides what the OS shows with it.
const { join } = require('node:path')
const { BrowserWindow, Notification } = require('electron')
const { ensureOverlayIcons } = require('../overlay-icons.cjs')

module.exports = function registerNotifyHandlers({ ipcMain, app, mainLog, getTray, trayStatus }) {
  let unreadCount = 0

  /** Icons are generated once per userData dir and reused. */
  function overlayIconFor(count) {
    const paths = ensureOverlayIcons(join(app.getPath('userData'), 'badges'))
    if (!paths.length) return null
    return paths[Math.min(count, 10) - 1] || null
  }

  /** The one place the window is told what the badge says. */
  function applyUnread(count) {
    const next = Math.max(0, Math.floor(Number(count) || 0))
    const grew = next > unreadCount
    unreadCount = next
    const win = BrowserWindow.getAllWindows()[0]
    const focused = !!win && !win.isMinimized() && win.isFocused()
    if (!win) return grew
    try {
      if (unreadCount === 0 || focused) {
        win.setOverlayIcon(null, '')
        win.flashFrame(false)
      } else {
        const icon = overlayIconFor(unreadCount)
        if (icon) win.setOverlayIcon(icon, `${unreadCount} unread`)
        win.flashFrame(true)
      }
    } catch { /* overlay is an enhancement, never a crash */ }
    getTray()?.setTooltip(
      unreadCount > 0 ? `gMatch \u2014 ${unreadCount} unread` : 'gMatch',
    )
    return grew
  }

  /** Focus changes what the OS shows: a focused window is not an alert. */
  function wireWindowNotifications(target) {
    target.on('focus', () => { applyUnread(unreadCount) })
    target.on('minimize', () => { applyUnread(unreadCount) })
    target.on('restore', () => { applyUnread(unreadCount) })
  }

  // Native toast. The strings are plain text and Chromium escapes them; no
  // shell, no URL, no exec.
  ipcMain.handle('notify:native', (_event, title, body) => {
    try {
      const t = String(title || 'gMatch').slice(0, 120)
      const b = String(body || '').slice(0, 280)
      if (!Notification.isSupported()) return { ok: false, reason: 'unsupported' }
      const n = new Notification({ title: t, body: b, silent: false })
      n.on('failed', (_e, error) => { console.warn('[domination] native notification failed:', error) })
      n.show()
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err?.message || String(err) }
    }
  })

  ipcMain.on('tray:status', (_e, text) => trayStatus(text))
  // The merged unread count is the renderer's (one store feeds the badge, the
  // overlay, the tray and the centre). The main process only decides what the
  // OS shows with it.
  ipcMain.on('notify:read', () => applyUnread(0))
  ipcMain.on('notify:sync', (_e, payload) => {
    try {
      const { count = 0, title = '', body = '', hideContent = false } = payload || {}
      const grew = applyUnread(count)
      const win = BrowserWindow.getAllWindows()[0]
      const focused = !!win && !win.isMinimized() && win.isFocused()
      // Alert only when nobody is looking, and only for a real increase: a
      // burst of 50 becomes ONE flash, never 50.
      if (!grew || focused || !win || !Notification.isSupported()) return
      const n = new Notification({
        title: hideContent || !title ? 'gMatch' : String(title).slice(0, 120),
        body: hideContent
          ? `${count} new notification${count === 1 ? '' : 's'}`
          : String(body || '').slice(0, 240),
        silent: false,
      })
      n.on('click', () => {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        win.webContents.send('notify:opened')
      })
    } catch (err) {
      mainLog(`notify:sync failed: ${err?.message || err}`)
    }
  })

  return { applyUnread, wireWindowNotifications }
}