// Standalone test for the pure desktop-wallpaper decisions.
// Run: cd apps/desktop && node electron/desktop-wallpaper-core.test.cjs
// These rules decide whether a wallpaper change can leave a desktop broken, so
// they are pinned without touching fs or child_process.
const assert = require('assert')
const core = require('./desktop-wallpaper-core.cjs')

// ---- backend detection: only Windows and Linux have a path ----
assert.strictEqual(core.detectBackend('win32'), 'windows')
assert.strictEqual(core.detectBackend('linux'), 'linux')
assert.strictEqual(core.detectBackend('darwin'), 'unsupported')
assert.strictEqual(core.detectBackend('freebsd'), 'unsupported')

// ---- source validation: local bytes / local absolute paths only ----
assert.deepStrictEqual(core.validateSource({ data: Buffer.from([1]), mime: 'image/png' }, 'linux'),
  { ok: true, kind: 'data', data: Buffer.from([1]), mime: 'image/png' })
// Buffer.from([1]) creates a distinct object, so compare shape not identity.
const bytes = Buffer.from([1, 2, 3]); const valid = core.validateSource({ data: bytes, mime: 'image/jpeg' }, 'win32')
assert.strictEqual(valid.ok, true)
assert.strictEqual(valid.kind, 'data')
assert.strictEqual(valid.data, bytes)
assert.strictEqual(core.validateSource({ data: 'nope', mime: 'image/png' }, 'win32').reason, 'no-data')
assert.strictEqual(core.validateSource({ data: Buffer.alloc(0), mime: 'image/png' }, 'win32').reason, 'invalid-size')
assert.strictEqual(core.validateSource({ data: Buffer.alloc(core.MAX_WALLPAPER_BYTES + 1), mime: 'image/png' }, 'win32').reason, 'invalid-size')
assert.strictEqual(core.validateSource({ data: bytes, mime: 'text/html' }, 'win32').reason, 'invalid-mime')
assert.strictEqual(core.validateSource(undefined, 'win32').reason, 'invalid-source')
assert.strictEqual(core.validateSource('', 'win32').reason, 'invalid-source')

// Remote URLs are explicitly refused — no silent main-process download.
assert.strictEqual(core.validateSource('https://example.com/a.jpg', 'linux').reason, 'remote-source')
assert.strictEqual(core.validateSource('relative/a.jpg', 'linux').reason, 'invalid-source')
assert.strictEqual(core.validateSource('/home/me/a.jpg', 'linux').path, '/home/me/a.jpg')
assert.strictEqual(core.validateSource('C:\\Users\\me\\a.jpg', 'win32').path, 'C:\\Users\\me\\a.jpg')
assert.strictEqual(core.validateSource('C:\\Users\\me\\a.jpg', 'linux').reason, 'invalid-source')

// file:// URIs resolve to a local path (with encoded spaces and a drive form).
assert.strictEqual(core.validateSource('file:///home/me/a%20b.jpg', 'linux').path, '/home/me/a b.jpg')
assert.strictEqual(core.validateSource('file:///C:/Users/me/a.jpg', 'win32').path, 'C:\\Users\\me\\a.jpg')
assert.strictEqual(core.validateSource('file://remote/share/a.jpg', 'linux').reason, 'invalid-source')

// ---- plan: unsupported desktop is an error before any tool runs ----
assert.deepStrictEqual(core.plan('darwin', { data: bytes, mime: 'image/png' }), { ok: false, reason: 'unsupported-desktop' })
assert.deepStrictEqual(core.plan('win32', 'https://example.com/a.jpg'), { ok: false, reason: 'remote-source' })
assert.strictEqual(core.plan('linux', '/home/me/a.jpg').backend, 'linux')

// ---- file URI construction for the Linux backends ----
assert.strictEqual(core.fileUri('/home/me/a b.jpg'), 'file:///home/me/a%20b.jpg')
assert.strictEqual(core.fileUri('C:\\Users\\me\\a.jpg'), 'file:///C:/Users/me/a.jpg')
assert.strictEqual(core.fileUri('/home/me/a#b?.jpg'), 'file:///home/me/a%23b%3F.jpg')
assert.strictEqual(core.wallpaperExtension('image/png'), '.png')
assert.strictEqual(core.wallpaperExtension('image/webp'), '.webp')
assert.strictEqual(core.wallpaperExtension('image/jpeg'), '.jpg')

// ---- Windows: registry + TranscodedWallpaper + SPI, no shell interpolation ----
assert.strictEqual(core.windowsRegistryPath(), 'HKCU:\\Control Panel\\Desktop')
const winSet = core.windowsSetScript()
assert.ok(winSet.includes('SystemParametersInfo(0x0013'))
assert.ok(winSet.includes('WallPaper'))
assert.ok(winSet.includes('HKCU:\\Control Panel\\Desktop'))
assert.deepStrictEqual(core.windowsArgsFor(core.windowsGetScript()).slice(0, 5),
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'])
assert.strictEqual(core.windowsArgsFor(winSet, 'C:\\a.jpg').pop(), 'C:\\a.jpg')
assert.strictEqual(core.parseWindowsWallpaper({ ok: true, out: 'C:\\old.jpg' }), 'C:\\old.jpg')
assert.strictEqual(core.parseWindowsWallpaper({ ok: true, out: '   ' }), null)
assert.strictEqual(core.parseWindowsWallpaper({ ok: false }), null)

// ---- Linux: gsettings first, KDE fallback ----
assert.deepStrictEqual(core.gnomeSetArgs('file:///a.jpg'),
  ['set', 'org.gnome.desktop.background', 'picture-uri', 'file:///a.jpg'])
assert.deepStrictEqual(core.gnomeGetArgs(), ['get', 'org.gnome.desktop.background', 'picture-uri'])
assert.strictEqual(core.parseGsettingsValue("'file:///a.jpg'"), 'file:///a.jpg')
assert.strictEqual(core.parseGsettingsValue('file:///a.jpg'), 'file:///a.jpg')
assert.strictEqual(core.parseGsettingsValue(''), null)
const kde = core.kdeSetScript('file:///a b.jpg')
assert.ok(kde.includes('org.kde.image'))
assert.ok(kde.includes('"file:///a b.jpg"'), 'URI is JSON-quoted, never shell-interpolated')
assert.deepStrictEqual(core.kdeDbusArgs('x'), ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', 'x'])
assert.ok(core.kdeDbusTools().includes('qdbus'))
assert.ok(core.kdeDbusTools().some((t) => t.includes('qdbus6')))
assert.ok(core.kdeGetScript().includes('readConfig'))

// ---- errors are reasons, never throws; missing tools on Linux = unsupported ----
assert.deepStrictEqual(core.classifyToolError({ code: 'ENOENT' }, 'gsettings'), { ok: false, reason: 'no-tool', tool: 'gsettings' })
assert.deepStrictEqual(core.classifyToolError({ killed: true }, 'qdbus'), { ok: false, reason: 'timeout', tool: 'qdbus' })
assert.strictEqual(core.classifyToolError(new Error('boom'), 'powershell.exe').reason, 'command-failed')
assert.strictEqual(core.classifyLinuxResult({ reason: 'no-tool' }, { reason: 'no-tool' }).reason, 'unsupported-desktop')
assert.strictEqual(core.classifyLinuxResult({ reason: 'no-tool' }, { ok: true }).reason, 'set-failed')
assert.strictEqual(core.classifyLinuxResult({ reason: 'command-failed' }, null).reason, 'set-failed')

console.log('desktop-wallpaper-core.test.cjs: all assertions passed')
