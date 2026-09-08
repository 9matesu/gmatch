// The ONE official server the PACKAGED app talks to (1.0 topology: hosted-only,
// plan .hermes/plans/2026-09-08_135149-1.0-desktop-release.md §2.1).
// Dev mode keeps the local Bun sidecar; this file is only consulted when
// app.isPackaged. Override for testing with GOONGRID_SERVER_URL.
const DEFAULT = 'https://goongrid-api.fly.dev'
const serverUrl = (process.env.GOONGRID_SERVER_URL || DEFAULT).replace(/\/+$/, '')
module.exports = { serverUrl }
