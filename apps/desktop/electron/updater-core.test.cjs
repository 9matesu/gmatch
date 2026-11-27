// Standalone test for the pure updater core (run: node electron/updater-core.test.cjs).
// Covers BOTH swap scripts (Windows batch and POSIX sh), the release-plan
// decision table, platform-scoped asset selection, and the missing-asset and
// 503-cold-start shapes.
const assert = require('assert')
const core = require('./updater-core.cjs')

async function main() {
  // ---- Windows swap script: hidden console, bounded, terminal, relaunches ----
  const source = 'C:\\Downloads\\gMatch-9.9.9-portable.exe'
  const target = 'C:\\Apps\\gMatch-1.0.0-portable.exe'
  const logPath = 'C:\\Users\\u\\AppData\\Roaming\\gmatch\\main.log'
  const script = core.buildWindowsScript({ source, target, logPath })

  assert.ok(script.startsWith('@echo off'), 'echo must stay off (no visible command text)')
  assert.ok(script.includes('if %TRIES% GEQ 30 goto giveup'), 'bounded retry count')
  assert.ok(script.includes('ping -n %WAIT% 127.0.0.1 >nul'), 'variable backoff wait, output suppressed')
  assert.ok(script.includes('set /a WAIT=3'), 'fast first retries')
  assert.ok(script.includes('if %TRIES% GTR 10 set /a WAIT=6'), 'backoff step 2')
  assert.ok(script.includes('if %TRIES% GTR 20 set /a WAIT=10'), 'backoff step 3')
  assert.ok(script.includes(':giveup'), 'explicit terminal state')
  // Terminal failure relaunches the OLD exe so the user keeps a working app;
  // success relaunches the NEW one. Two starts total, both of the target.
  const relaunches = script.split(`start "" "${target}"`).length - 1
  assert.strictEqual(relaunches, 2, 'relaunch on both success and terminal failure')
  assert.ok(script.includes(`echo [updater] downloaded file kept at "${core.sanitizePath(source)}"`),
    'terminal state tells the user where the downloaded file is')
  assert.ok(script.includes('del "%~f0"'), 'self-delete survives')
  // The dispatcher honours the platform, not the host running this test.
  assert.strictEqual(core.buildUpdaterScript({ source, target, logPath, platform: 'win32' }), script)

  // ---- POSIX swap script (Linux/macOS): same guarantees, shell syntax ----
  const linSrc = '/home/u/Downloads/gMatch-9.9.9-portable.AppImage'
  const linDst = '/home/u/Apps/gMatch-1.0.0-portable.AppImage'
  const linLog = '/home/u/.config/gmatch/main.log'
  const sh = core.buildUpdaterScript({ source: linSrc, target: linDst, logPath: linLog, platform: 'linux' })
  assert.ok(sh.startsWith('#!/bin/sh'), 'POSIX script has a shell shebang')
  assert.strictEqual(core.buildUpdaterScript({ source: linSrc, target: linDst, logPath: linLog, platform: 'darwin' }), sh)
  assert.ok(sh.includes(`mv -f '${linSrc}' '${linDst}'`), 'moves the verified artifact over the old one')
  assert.ok(sh.includes('while [ "$TRIES" -lt 30 ]'), 'bounded retry count')
  assert.ok(sh.includes('sleep "$WAIT"'), 'backoff uses sleep, not ping.exe')
  assert.ok(sh.includes(`chmod +x '${linDst}'`), 'relaunched portable file stays executable')
  assert.strictEqual(sh.split(`'${linDst}' >/dev/null 2>&1 &`).length - 1, 2, 'relaunch on success and terminal failure')
  assert.ok(sh.includes('[updater] downloaded file kept at'), 'terminal state reports the kept artifact')
  assert.ok(sh.includes('rm -f "$0"'), 'self-delete survives')
  assert.strictEqual(core.shellQuote("a'b"), "'a'\\''b'", 'embedded quote is escaped for sh')

  // sanitizePath regression: dangerous cmd metacharacters must vanish.
  assert.strictEqual(core.sanitizePath('a"b&c|d<e>f^g%h'), 'abcdefgh')

  // ---- a node feed on the user's own network may be plain http ----
  assert.strictEqual(core.isPrivateFeedUrl('http://127.0.0.1:8790/release.json'), true,
    'the node on this machine may serve the feed over http')
  assert.strictEqual(core.isPrivateFeedUrl('http://192.168.1.10:8790/release.json'), true,
    'a node on the user\'s LAN may serve the feed over http')
  assert.strictEqual(core.isPrivateFeedUrl('http://93.184.216.34/release.json'), false,
    'a public host may NOT serve the feed over http')
  assert.strictEqual(core.isPrivateFeedUrl('https://gmatch.pages.dev/release.json'), false)

  // ---- parseDigest: GitHub's REAL colon form ----
  assert.strictEqual(core.parseDigest(`sha256:${'c'.repeat(64)}`), 'c'.repeat(64),
    'GitHub serves sha256:<hex>; the dash-only regex refused every real asset')
  assert.strictEqual(core.parseDigest(`sha256-${'d'.repeat(64)}`), 'd'.repeat(64))
  assert.strictEqual(core.parseDigest('sha256:abc'), null)
  assert.strictEqual(core.parseDigest('md5:' + 'e'.repeat(64)), null)

  // ---- portable names: every published artifact shape ----
  assert.strictEqual(core.parsePortableName('gMatch-1.2.3-portable.exe'), '1.2.3')
  assert.strictEqual(core.parsePortableName('gMatch-1.2.3-portable.AppImage'), '1.2.3')
  assert.strictEqual(core.parsePortableName('gMatch-1.2.3-portable.deb'), '1.2.3',
    'a deb is a recognized release artifact; the platform filter excludes it from swaps')
  assert.strictEqual(core.parsePortableName('gMatch-Setup-1.2.3.exe'), null)

  // ---- planCheck: site release.json shape ----
  const site = {
    file: 'gMatch-1.6.0-portable.exe',
    version: '1.6.0',
    sha256: 'a'.repeat(64),
    sizeBytes: 1234,
    downloadUrl: 'https://example.com/releases/gMatch-1.6.0-portable.exe',
  }
  const plan = core.planCheck(site, '1.5.2', {})
  assert.strictEqual(plan.action, 'download')
  assert.strictEqual(plan.version, '1.6.0')
  assert.strictEqual(plan.digest, 'a'.repeat(64))
  assert.strictEqual(plan.sizeBytes, 1234, 'published size travels with the plan')

  // sizeBytes missing/garbage -> null, not a guess.
  assert.strictEqual(core.planCheck({ ...site, sizeBytes: 'big' }, '1.5.2', {}).sizeBytes, null)
  assert.strictEqual(core.sizeField(-5), null)
  assert.strictEqual(core.sizeField('1024'), 1024)

  // Missing asset shapes -> terminal error, never a download with a dead URL.
  assert.strictEqual(core.planCheck({ version: '9.9.9' }, '1.5.2', {}).action, 'error')
  assert.ok(core.planCheck({ version: '9.9.9' }, '1.5.2', {}).error.includes('no downloadable'))
  const ghNoAsset = { tag_name: 'v1.6.0', assets: [{ name: 'source.zip', browser_download_url: 'https://x/source.zip' }] }
  assert.strictEqual(core.planCheck(ghNoAsset, '1.5.2', {}).action, 'error')

  // Older or equal version -> current (no pointless re-download).
  assert.strictEqual(core.planCheck({ ...site, version: '1.0.0', file: 'gMatch-1.0.0-portable.exe' }, '1.5.2', {}).action, 'current')

  // Plain http is refused unless the insecure local-override is set.
  const httpFeed = { ...site, downloadUrl: 'http://example.com/releases/gMatch-1.6.0-portable.exe' }
  assert.strictEqual(core.planCheck(httpFeed, '1.5.2', {}).action, 'error')
  assert.strictEqual(core.planCheck(httpFeed, '1.5.2', { insecure: true }).action, 'download')

  // ---- platform-scoped assets: one release, one artifact per OS ----
  const gh = {
    tag_name: 'v2.0.0',
    assets: [
      { name: 'gMatch-2.0.0-portable.exe', browser_download_url: 'https://x/gMatch-2.0.0-portable.exe', digest: `sha256:${'1'.repeat(64)}` },
      { name: 'gMatch-2.0.0-portable.AppImage', browser_download_url: 'https://x/gMatch-2.0.0-portable.AppImage', digest: `sha256:${'2'.repeat(64)}` },
      { name: 'gMatch-2.0.0-portable.deb', browser_download_url: 'https://x/gMatch-2.0.0-portable.deb', digest: `sha256:${'3'.repeat(64)}` },
    ],
  }
  assert.strictEqual(core.planCheck(gh, '1.9.0', { platform: 'win32' }).name, 'gMatch-2.0.0-portable.exe')
  assert.strictEqual(core.planCheck(gh, '1.9.0', { platform: 'linux' }).name, 'gMatch-2.0.0-portable.AppImage',
    'Linux swaps the AppImage, never a Windows exe or a system package')
  assert.strictEqual(core.planCheck(gh, '1.9.0', { platform: 'darwin' }).name, 'gMatch-2.0.0-portable.AppImage')
  // A deb manifest is a recognized artifact but never a portable swap plan.
  assert.strictEqual(core.planCheck({ ...site, file: 'gMatch-1.6.0-portable.deb' }, '1.5.2', {}).action, 'download')
  assert.strictEqual(core.planCheck({ ...site, file: 'gMatch-1.6.0-portable.deb' }, '1.5.2', { platform: 'linux' }).action, 'error')
  // No artifact for this OS: honest error, never a wrong-platform download.
  assert.strictEqual(core.planCheck({ tag_name: 'v2.0.0', assets: [gh.assets[0]] }, '1.9.0', { platform: 'linux' }).action, 'error')

  console.log('updater-core.test.cjs: all assertions passed')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
