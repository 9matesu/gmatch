// Standalone test for the dev Electron runtime isolation (W6).
// (run: node electron/dev-runtime.test.cjs). Not part of `npm run test` —
// electron/*.test.cjs have no vitest runner (AGENTS.md).
//
// Proves the unpackaged `npm run electron` shell is isolated from `npm run dev`
// so both run at once: a DISTINCT API port (never the dev sidecar's 8790) and a
// DISTINCT userData dir (never the packaged install's root, so no shared world,
// identity or single-instance lock).
const assert = require('assert')
const path = require('node:path')
const os = require('node:os')

const dev = require('./dev-runtime.cjs')

// 1. The dev shell's API port is NOT the port `npm run dev`'s sidecar owns.
assert.strictEqual(dev.DEV_API_PORT, 8790, 'npm run dev sidecar port is 8790')
assert.notStrictEqual(
  dev.DEV_ELECTRON_API_PORT,
  dev.DEV_API_PORT,
  'dev electron API port must differ from the dev sidecar port (EADDRINUSE)',
)

// 2. The dev userData dir is a distinct, absolute sibling of the packaged root.
const appData = path.join(os.tmpdir(), 'gmatch-appdata')
const devDir = dev.devUserDataDir(appData)
assert.ok(path.isAbsolute(devDir), 'dev userData dir is absolute (app.setPath requires it)')
assert.notStrictEqual(devDir, appData, 'dev userData dir must differ from the packaged userData root')
assert.strictEqual(path.dirname(devDir), appData, 'dev userData dir is a sibling of the packaged root')

// 3. A port override is honoured (power users / CI), still isolated by default.
const original = process.env.GMATCH_DEV_API_PORT
process.env.GMATCH_DEV_API_PORT = '9999'
delete require.cache[require.resolve('./dev-runtime.cjs')]
assert.strictEqual(require('./dev-runtime.cjs').DEV_ELECTRON_API_PORT, 9999, 'port override honoured')
if (original === undefined) delete process.env.GMATCH_DEV_API_PORT
else process.env.GMATCH_DEV_API_PORT = original

console.log('dev-runtime.test.cjs: ok (dev electron port', dev.DEV_ELECTRON_API_PORT, '!= dev', dev.DEV_API_PORT, '; userData', devDir + ')')