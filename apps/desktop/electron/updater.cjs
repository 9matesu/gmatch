// Portable self-update wiring (electron main): check the release feed,
// auto-DOWNLOAD the new gMatch-<ver>-portable.exe next to the user's portable
// file (PORTABLE_EXECUTABLE_FILE; fallback: %TEMP%\gmatch-update), then on the
// renderer's "Install & Restart" hand a detached cmd.exe a retry-move script,
// quit, and let the script swap the file and relaunch. The download is
// verified against the published SHA-256; a source without a hash is reported
// as 'verified: false' honestly.
const https = require('node:https')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const core = require('./updater-core.cjs')

// The repo is PRIVATE, so the canonical public release feed for installed
// apps is the site's release.json (fly mirrors the GitHub Release artifact;
// it carries the exact sha256 we verify). GitHub API shape also supported.
const RELEASE_URL = 'https://gmatch.fly.dev/release.json'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 12 * 1000

function get(url, { insecure = false } = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    if (url.startsWith('http:') && !insecure) { reject(new Error('plain http refused')); return }
    const req = mod.get(url, {
      headers: { 'User-Agent': 'gMatch-updater', Accept: 'application/vnd.github+json' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume()
        resolve(get(new URL(res.headers.location, url).href, { insecure }, redirects - 1))
        return
      }
      resolve(res)
    })
    req.on('error', reject)
    req.setTimeout(20000, () => req.destroy(new Error('timeout')))
  })
}

async function getJson(url, opts) {
  const res = await get(url, opts)
  let body = ''
  for await (const chunk of res) body += chunk
  if (res.statusCode !== 200) throw new Error(`release API ${res.statusCode}`)
  return JSON.parse(body)
}

/** Stream `url` to `dest` reporting (pct, received); resolves { sha256, bytes }. */
function download(url, dest, onProgress, opts) {
  return get(url, opts).then((res) => new Promise((resolve, reject) => {
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`download HTTP ${res.statusCode}`)); return }
    const total = Number(res.headers['content-length'] || 0)
    const hash = createHash('sha256')
    const out = fs.createWriteStream(dest)
    let received = 0
    let lastPct = -2
    res.on('data', (chunk) => {
      hash.update(chunk)
      received += chunk.length
      const pct = total ? Math.floor((received / total) * 100) : -1
      if (pct !== lastPct) { lastPct = pct; onProgress(pct, received) }
    })
    res.pipe(out)
    out.on('finish', () => { out.close(); resolve({ sha256: hash.digest('hex'), bytes: received }) })
    out.on('error', reject)
    res.on('error', reject)
  }))
}

/** The user-facing portable exe (not the temp-extracted copy we're running). */
function portableExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
}

/** Where to drop the new exe: prefer next to the user's file, then TEMP. */
function pickDestDir(userExePath, tempDir) {
  for (const dir of [path.dirname(userExePath), path.join(tempDir, 'gmatch-update')]) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const probe = path.join(dir, '.gmatch-update-write-test')
      fs.writeFileSync(probe, 'x')
      fs.rmSync(probe, { force: true })
      return dir
    } catch { /* next candidate */ }
  }
  return null
}

function createUpdater({ app, webContents, log = () => {} }) {
  let state = { phase: 'idle', current: app.getVersion() }
  const insecureOverride = Boolean(process.env.GMATCH_RELEASE_URL)
  const apiUrl = process.env.GMATCH_RELEASE_URL || RELEASE_URL

  const setStatus = (patch) => {
    state = { ...state, ...patch }
    for (const wc of webContents()) {
      try { wc.send('update:status', state) } catch { /* window gone */ }
    }
    return state
  }

  let downloading = false
  async function startDownload(plan) {
    if (downloading) return
    downloading = true
    const dir = pickDestDir(portableExePath(), app.getPath('temp'))
    if (!dir) {
      downloading = false
      setStatus({ phase: 'error', error: 'no writable folder to place the update — run gMatch from your Downloads folder' })
      return
    }
    const dest = path.join(dir, plan.name)
    const partial = dest + '.part'
    try {
      fs.rmSync(dest, { force: true })
      setStatus({ phase: 'downloading', version: plan.version, percent: 0, bytes: 0 })
      const { sha256, bytes } = await download(plan.url, partial, (percent, received) => {
        setStatus({ phase: 'downloading', percent: Math.max(0, percent), bytes: received })
      }, { insecure: insecureOverride })
      const expected = plan.digest || null
      const verified = expected ? sha256 === expected : null
      if (verified === false) throw new Error('sha256 mismatch — download discarded')
      fs.renameSync(partial, dest)
      log(`[updater] downloaded ${plan.name} sha256=${sha256} verified=${verified}`)
      setStatus({ phase: 'ready', version: plan.version, destPath: dest, bytes, verified: verified === true })
    } catch (err) {
      try { fs.rmSync(partial, { force: true }) } catch { /* ignore */ }
      log(`[updater] download failed: ${String(err?.message || err)}`)
      setStatus({ phase: 'error', error: String(err?.message || err) })
    } finally {
      downloading = false
    }
  }

  async function check(manual) {
    if (state.phase === 'downloading') return state
    setStatus({ phase: 'checking', manual: Boolean(manual) })
    try {
      const release = await getJson(apiUrl, { insecure: insecureOverride })
      const plan = core.planCheck(release, app.getVersion(), { insecure: insecureOverride })
      if (plan.action === 'current') return setStatus({ phase: 'current', latest: plan.version })
      if (plan.action === 'error') return setStatus({ phase: 'error', error: plan.error })
      setStatus({ phase: 'available', version: plan.version })
      void startDownload(plan) // auto-download; the user only confirms the swap
      return state
    } catch (err) {
      return setStatus({ phase: 'error', error: String(err?.message || err) })
    }
  }

  /** Hand off to cmd.exe (replace the user's portable exe + relaunch) and quit. */
  function install() {
    if (state.phase !== 'ready' || !state.destPath) return { ok: false, error: 'nothing downloaded yet' }
    const target = portableExePath()
    const script = core.buildUpdaterScript({
      source: state.destPath,
      target,
      logPath: path.join(app.getPath('userData'), 'main.log'),
    })
    const cmdPath = path.join(app.getPath('temp'), 'gmatch-update.cmd')
    try {
      fs.writeFileSync(cmdPath, script)
      spawn('cmd.exe', ['/c', cmdPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
    log(`[updater] handing swap of ${path.basename(target)} to ${cmdPath}`)
    app.quit()
    return { ok: true }
  }

  function schedule() {
    setTimeout(() => { void check(false) }, FIRST_CHECK_DELAY_MS)
    setInterval(() => { void check(false) }, CHECK_INTERVAL_MS)
  }

  return { check, install, schedule, getState: () => state }
}

module.exports = { createUpdater, RELEASE_URL, pickDestDir, download }
