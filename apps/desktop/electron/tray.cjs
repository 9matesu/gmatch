// The tray is the app's real exit, and the reason closing the window is not
// quitting: gMatch keeps its node, its mesh and its timers running with no
// window on screen, and the only way out is this menu (or a session end).
//
// No icon file is required: the packaged build ships `build/icon.ico`, and a
// browser checkout that lacks it falls back to a generated silhouette so the
// tray is never empty on a dev machine.
const path = require('node:path')
const { Tray, Menu, nativeImage } = require('electron')

const FALLBACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAX0lEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBQA7JiBBH1Xy5oAAAAASUVORK5CYII=',
  'base64',
)

function trayImage() {
  const packaged = path.join(process.resourcesPath || '', 'build', 'icon.ico')
  const local = path.join(__dirname, '..', 'build', 'icon.ico')
  for (const candidate of [packaged, local]) {
    try {
      const img = nativeImage.createFromPath(candidate)
      if (!img.isEmpty()) return img
    } catch { /* try the next one */ }
  }
  return nativeImage.createFromBuffer(FALLBACK_PNG)
}

/**
 * @param {{ onOpen: () => void, onQuit: () => void }} handlers
 * @returns {{ setTooltip: (text: string) => void, destroy: () => void, focusWindow: () => void }}
 */
function createTray({ onOpen, onQuit }) {
  const tray = new Tray(trayImage())
  tray.setToolTip('gMatch')
  // Windows/Linux: a single click is the expected "show me" gesture; macOS uses
  // the menu for that, so the click opens the window there too (harmless).
  tray.on('click', () => onOpen())
  tray.on('double-click', () => onOpen())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir gMatch', click: () => onOpen() },
      { type: 'separator' },
      { label: 'Sair do gMatch', click: () => onQuit() },
    ]),
  )
  return {
    setTooltip(text) {
      try { tray.setToolTip(String(text || 'gMatch')) } catch { /* best effort */ }
    },
    destroy() {
      try { tray.destroy() } catch { /* already gone */ }
    },
  }
}

module.exports = { createTray };