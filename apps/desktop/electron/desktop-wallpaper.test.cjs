// Runtime tests for the cross-platform wallpaper IPC with a fake tool runner
// and fake fs. Run: cd apps/desktop && node electron/desktop-wallpaper.test.cjs
// No real desktop is touched. The point is to prove the Windows and Linux
// command sequences, the restore, and the "never throw / never block" contract.
const assert = require('assert')
const core = require('./desktop-wallpaper-core.cjs')
const { createDesktopWallpaper } = require('./desktop-wallpaper.cjs')

function fakeFs(files = {}) {
  const store = new Map(Object.entries(files))
  return {
    store,
    async stat(p) {
      if (!store.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return { isFile: () => true }
    },
    async writeFile(p, data) { store.set(p, data) },
    async copyFile(from, to) {
      if (!store.has(from)) throw new Error('source gone')
      store.set(to, store.get(from))
    },
    async mkdir() {},
    async unlink(p) { store.delete(p) },
  }
}

/** Runner that records every call and answers by tool + script heuristics. */
function fakeRunner(handlers) {
  const calls = []
  const run = async (tool, args) => {
    calls.push({ tool, args })
    if (handlers[tool]) return handlers[tool](args)
    return { ok: false, reason: 'no-tool', tool }
  }
  return { calls, run }
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

async function main() {
  // ── Windows: registry + TranscodedWallpaper + SPI, with restore ──
  {
    const fs = fakeFs()
    const script = core.windowsSetScript()
    const getScript = core.windowsGetScript()
    const runner = fakeRunner({
      'powershell.exe': (args) => {
        const cmd = args[args.indexOf('-Command') + 1]
        return cmd === getScript
          ? { ok: true, out: 'C:\\Users\\me\\old.jpg' }
          : cmd === script ? { ok: true, out: 'ok' } : { ok: false }
      },
    })
    const wp = createDesktopWallpaper({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      fs,
      run: runner.run,
      tmpdir: () => '/tmp',
    })
    const out = await wp.setWallpaper({ data: PNG, mime: 'image/png' })
    assert.strictEqual(out.ok, true, 'win32 set succeeds')
    assert.strictEqual(out.backend, 'windows')
    const transcoded = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Themes\\TranscodedWallpaper'
    assert.ok(fs.store.has(transcoded), 'bytes copied to TranscodedWallpaper')
    const setCalls = runner.calls.filter((c) => c.args[c.args.indexOf('-Command') + 1] === script)
    assert.strictEqual(setCalls.length, 1)
    assert.strictEqual(setCalls[0].args[setCalls[0].args.length - 1], transcoded, 'SPI gets the transcoded file')
    assert.ok(wp.hasPendingSwap())
    const restored = await wp.restoreWallpaper()
    assert.strictEqual(restored.ok, true)
    const setAfter = runner.calls.filter((c) => c.args[c.args.indexOf('-Command') + 1] === script)
    assert.strictEqual(setAfter.length, 2)
    assert.strictEqual(setAfter[1].args[setAfter[1].args.length - 1], 'C:\\Users\\me\\old.jpg', 'restore puts the old wallpaper back')
    assert.strictEqual(wp.hasPendingSwap(), false)
  }

  // ── Linux GNOME: gsettings picture-uri, restore to the captured URI ──
  {
    const fs = fakeFs()
    const runner = fakeRunner({
      gsettings: (args) => {
        if (args[0] === 'get') return { ok: true, out: "'file:///home/me/old.jpg'" }
        return { ok: true, out: '' }
      },
    })
    const wp = createDesktopWallpaper({ platform: 'linux', fs, run: runner.run, tmpdir: () => '/tmp' })
    const out = await wp.setWallpaper({ data: PNG, mime: 'image/png' })
    assert.strictEqual(out.ok, true)
    assert.strictEqual(out.backend, 'gnome')
    const sets = runner.calls.filter((c) => c.tool === 'gsettings' && c.args[0] === 'set')
    const primary = sets.find((c) => c.args[2] === 'picture-uri')
    assert.ok(primary.args[3].startsWith('file:///tmp/'), 'gsettings gets a file:// URI')
    assert.strictEqual((await wp.restoreWallpaper()).ok, true)
    const after = runner.calls.filter((c) => c.tool === 'gsettings' && c.args[0] === 'set' && c.args[2] === 'picture-uri')
    assert.strictEqual(after[after.length - 1].args[3], 'file:///home/me/old.jpg', 'GNOME restore uses the captured URI')
  }

  // ── Linux KDE fallback: gsettings missing -> qdbus evaluateScript ──
  {
    const fs = fakeFs()
    const runner = fakeRunner({
      qdbus: (args) => (String(args[3]).includes('readConfig')
        ? { ok: true, out: 'file:///home/me/kde-old.jpg' }
        : { ok: true, out: '' }),
    })
    const wp = createDesktopWallpaper({ platform: 'linux', fs, run: runner.run, tmpdir: () => '/tmp' })
    const out = await wp.setWallpaper({ data: PNG, mime: 'image/png' })
    assert.strictEqual(out.ok, true, 'KDE fallback succeeds when gsettings is absent')
    assert.strictEqual(out.backend, 'kde')
    const kdeSet = runner.calls.find((c) => c.tool === 'qdbus' && c.args[3].includes('writeConfig'))
    assert.ok(kdeSet.args[3].includes('org.kde.image'))
    assert.strictEqual((await wp.restoreWallpaper()).ok, true)
  }

  // ── No usable Linux backend: clear error, no throw ──
  {
    const wp = createDesktopWallpaper({ platform: 'linux', fs: fakeFs(), run: fakeRunner({}).run })
    const out = await wp.setWallpaper({ data: PNG, mime: 'image/png' })
    assert.deepStrictEqual(out, { ok: false, reason: 'unsupported-desktop' })
  }

  // ── Unsupported OS: refused up front, zero tool calls ──
  {
    const runner = fakeRunner({})
    const wp = createDesktopWallpaper({ platform: 'darwin', fs: fakeFs(), run: runner.run })
    assert.deepStrictEqual(await wp.setWallpaper({ data: PNG, mime: 'image/png' }), { ok: false, reason: 'unsupported-desktop' })
    assert.strictEqual(runner.calls.length, 0)
    assert.deepStrictEqual(await wp.setWallpaper('https://example.com/a.jpg'), { ok: false, reason: 'unsupported-desktop' })
  }

  // ── Remote URL refused without a download; runner throwing is contained ──
  {
    const runner = fakeRunner({})
    const wp = createDesktopWallpaper({ platform: 'linux', fs: fakeFs(), run: runner.run })
    assert.deepStrictEqual(await wp.setWallpaper('https://example.com/a.jpg'), { ok: false, reason: 'remote-source' })
    assert.strictEqual(runner.calls.length, 0)
    const boom = createDesktopWallpaper({
      platform: 'linux', fs: fakeFs(), tmpdir: () => '/tmp',
      run: () => { throw new Error('kaboom') },
    })
    const out = await boom.setWallpaper({ data: PNG, mime: 'image/png' })
    assert.strictEqual(out.ok, false, 'a throwing runner becomes a result')
    assert.ok(out.reason)
  }

  console.log('desktop-wallpaper.test.cjs: all assertions passed')
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
