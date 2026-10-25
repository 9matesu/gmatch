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

// The canonical public release feed is the project's own Pages site
// (release.json is generated from the shipped exe, so the sha256 describes the
// bytes users download). It is the ONLY hosted feed: there is no second
// deployment to keep alive, and the node this install talks to can still
// serve release.json to its peers (resolved at check time, below).
const RELEASE_FEEDS = [
  { url: 'https://gmatch.pages.dev/release.json', base: 'https://gmatch.pages.dev' },
]
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 12 * 1000
/** A release host that does not answer within this window is abandoned for
 *  this check (a stuck host must not hold the update check open). */
const FEED_TIMEOUT_MS = 8 * 1000

/** Reject with `message` if `promise` does not settle in `ms`. */
function withTimeout(promise, ms, message) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}

/** The origin of a feed URL (where its /releases/<file> lives). */
function baseOf(url) {
  try { return new URL(url).origin } catch { return url }
}

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

function createUpdater({ app, webContents, log = () => {}, spawnFn = spawn, feeds: injectedFeeds, getServerUrl = null }) {
  let state = { phase: 'idle', current: app.getVersion() }
  // The node this install talks to can host the release feed.
  const nodeFeedUrl = () => {
    const url = typeof getServerUrl === 'function' ? getServerUrl() : ''
    if (!url) return ''
    return `${url.replace(/\/+$/, '')}/release.json`
  }
  // The release feed, resolved AT CHECK TIME: the node this install talks
  // to can serve the artifact to its peers, and the user can switch worlds
  // between two checks. Then the public Pages manifest (skipped when down).
  const resolveFeeds = () => {
    if (injectedFeeds) return injectedFeeds
    if (process.env.GMATCH_RELEASE_URL) {
      return [{ url: process.env.GMATCH_RELEASE_URL, base: baseOf(process.env.GMATCH_RELEASE_URL) }]
    }
    const node = nodeFeedUrl()
    return [
      ...(node ? [{ url: node, base: baseOf(node) }] : []),
      ...RELEASE_FEEDS,
    ]
  }
  // Plain http is only allowed for an explicit local override (env or an
  // injected test feed); the shipped feeds are https. A NODE feed is the
  // exception: it is a host the user chose (their own machine, their own
  // network), and it is checked per feed — never as a blanket for the others.
  const insecureOverride = Boolean(process.env.GMATCH_RELEASE_URL)

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
      setStatus({ phase: 'error', error: 'no writable folder to place the update. Run gMatch from your Downloads folder and retry' })
      return
    }
    const dest = path.join(dir, plan.name)
    const partial = dest + '.part'
    try {
      fs.rmSync(dest, { force: true })
      setStatus({ phase: 'downloading', version: plan.version, percent: 0, bytes: 0 })
      const { sha256, bytes } = await download(plan.url, partial, (percent, received) => {
        setStatus({ phase: 'downloading', percent: Math.max(0, percent), bytes: received })
      }, { insecure: insecureOverride || core.isPrivateFeedUrl(plan.url) })
      const expected = plan.digest || null
      // Size first (cheap truncation catch), then the published digest.
      if (plan.sizeBytes !== null && bytes !== plan.sizeBytes) {
        throw new Error('downloaded size does not match the published size; the download was discarded')
      }
      const verified = expected ? sha256 === expected : null
      if (verified === false) throw new Error('sha256 mismatch. The download was discarded.')
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
    // Capture the pre-check state: setStatus(clobbering to 'checking') below
    // must not erase what the already-downloaded guard needs to compare.
    const prev = { phase: state.phase, version: state.version, destPath: state.destPath }
    setStatus({ phase: 'checking', manual: Boolean(manual) })
    // Ask EVERY feed, in parallel: a host that is asleep, stuck or down must
    // not block the others, and a stuck host must not hold the check open.
    // The winner is the highest version among the feeds that answered, and
    // its download URL comes from that same host.
    let best = null
    let lastError = ''
    const feeds = resolveFeeds()
    const answers = await Promise.all(feeds.map(async (feed) => {
      // A feed on the user's own network (the node) may be plain http; the
      // public feeds must stay https.
      const insecure = insecureOverride || core.isPrivateFeedUrl(feed.url)
      try {
        const release = await withTimeout(
          getJson(feed.url, { insecure }),
          FEED_TIMEOUT_MS,
          'release host did not answer',
        )
        const plan = core.planCheck(release, app.getVersion(), { insecure, base: feed.base })
        return plan.action === 'error' ? { error: plan.error } : { plan }
      } catch (err) {
        return { error: String(err?.message || err) }
      }
    }))
    for (const answer of answers) {
      if (answer.error) { lastError = answer.error; continue }
      if (!best) { best = answer.plan; continue }
      if (core.isNewer(answer.plan.version, best.version)) best = answer.plan
    }
    if (!best) {
      // A 503 from the release host is a cold-start (free-tier dyno waking),
      // not a missing release: say so instead of reading like a dead link.
      const friendly = lastError.includes('503')
        ? `${lastError} (the release hosts may be waking up - retry in a minute)`
        : (lastError || 'no release host answered')
      return setStatus({ phase: 'error', error: friendly })
    }
    if (best.action === 'current') return setStatus({ phase: 'current', latest: best.version })
    // Already downloaded these exact bytes and the file is still there:
    // repeated checks (daily timer, manual) must not re-download the same
    // version over and over.
    if (prev.phase === 'ready' && prev.version === best.version && prev.destPath && fs.existsSync(prev.destPath)) {
      return setStatus({ phase: 'ready', version: best.version, destPath: prev.destPath })
    }
    setStatus({ phase: 'available', version: best.version })
    void startDownload(best) // auto-download; the user only confirms the swap
    return state
  }

  /** Hand off to cmd.exe (replace the user's portable exe + relaunch) and quit. */
  let installing = false
  function install() {
    if (state.phase !== 'ready' || !state.destPath) return { ok: false, error: 'nothing downloaded yet' }
    if (installing) return { ok: false, error: 'update is already installing' }
    // Never execute an unverified update artifact: refuse when the published
    // hash was absent or mismatched (mismatch already aborts the download).
    if (state.verified !== true) return { ok: false, error: 'refusing to install: download integrity was not verified' }
    installing = true
    const target = portableExePath()
    const script = core.buildUpdaterScript({
      source: state.destPath,
      target,
      logPath: path.join(app.getPath('userData'), 'main.log'),
    })
    const cmdPath = path.join(app.getPath('temp'), 'gmatch-update.cmd')
    try {
      fs.writeFileSync(cmdPath, script)
      // windowsHide gives cmd.exe an INVISIBLE console that the batch's
      // children (ping.exe, etc.) inherit. `detached: true` was removed on
      // purpose: DETACHED_PROCESS leaves cmd with NO console, and every
      // external console exe the batch calls then allocates its own VISIBLE
      // window — the "reappearing ping prompts" update-loop report. Windows
      // children survive the parent quitting (no job object), and .unref()
      // detaches the child from this process's event loop.
      spawnFn('cmd.exe', ['/c', cmdPath], { stdio: 'ignore', windowsHide: true }).unref()
    } catch (err) {
      installing = false
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

module.exports = { createUpdater, RELEASE_FEEDS, pickDestDir, download }
