// Dev/unpackaged Electron runtime isolation (W6).
//
// `npm run dev` (vite browser) owns port 5173 + the local Bun sidecar on 8790
// + that sidecar's own DB. `npm run electron` (the UNPACKAGED shell, `electron
// .`) must be able to run AT THE SAME TIME without stomping it: it gets its own
// API port and its own userData dir, so there is no EADDRINUSE, no shared world
// and no shared single-instance lock.
//
// The PACKAGED app is untouched by design: it still hosts its node on 8790 at
// the legacy userData root with the normal single-instance lock. main.cjs only
// applies these when `app.isPackaged` is false.
const path = require('node:path')

/** Port `npm run dev`'s sidecar owns (vite.config.ts DEV_API_PORT default). */
const DEV_API_PORT = 8790

/** Port the unpackaged dev shell's own sidecar owns — distinct from 8790. */
const DEV_ELECTRON_API_PORT = Number(process.env.GMATCH_DEV_API_PORT || 8791)

/**
 * userData dir for the unpackaged dev shell: a sibling of the packaged
 * install's userData (`%APPDATA%/gmatch-dev`), never the packaged root. An
 * absolute path is required by `app.setPath('userData', …)`.
 */
function devUserDataDir(appDataDir) {
  return path.join(appDataDir, 'gmatch-dev')
}

module.exports = { DEV_API_PORT, DEV_ELECTRON_API_PORT, devUserDataDir }