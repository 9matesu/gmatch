#!/usr/bin/env node
/**
 * LIVE roster check — TWO real Electron instances, two real public trackers.
 *
 * This is the proof for the requirement "players online must see each other":
 * it boots the actual app twice (separate userData dirs → separate
 * identities, separate sidecar ports), lets the tracker mesh run for real,
 * and then reads each renderer's OWN persisted roster
 * (`orbit_p2p_known_peers`) to check that each side listed the other.
 *
 * Nothing is stubbed: the WebRTC connection, the tracker announce and the
 * signed HELLO are the production ones. The ONLY thing read from the page is
 * the roster the app itself persisted.
 *
 * usage: node tools/roster-live-check.mjs        (run from apps/desktop)
 * exit 0 = both instances saw each other.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const repoRoot = join(appDir, '..', '..')

const VITE_PORT = 5274
const DEV_URL = `http://localhost:${VITE_PORT}`
const ROOT = 'I:/temp/opencode'

const instances = [
  { name: 'A', dataDir: join(ROOT, 'gm-roster-a'), apiPort: '8790', cdp: '9222' },
  { name: 'B', dataDir: join(ROOT, 'gm-roster-b'), apiPort: '8791', cdp: '9223' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

function viteBin() {
  const candidates = [
    join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    join(appDir, 'node_modules', 'vite', 'bin', 'vite.js'),
  ]
  const hit = candidates.find((c) => existsSync(c))
  if (!hit) throw new Error('vite binary not found')
  return hit
}

async function waitForHttp(url, budgetMs = 30_000) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1200) })
      if (r.ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(400)
  }
  return false
}

const children = []
function cleanup() {
  for (const c of children) {
    try {
      c.kill()
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

// 1. vite
log('booting vite…')
const vite = spawn(process.execPath, [viteBin(), '--port', String(VITE_PORT), '--strictPort'], {
  cwd: appDir,
  stdio: 'ignore',
})
children.push(vite)
if (!(await waitForHttp(DEV_URL))) {
  console.error('vite did not come up')
  process.exit(2)
}

// 2. two Electron instances
const electronPath = require('electron')

// A sidecar left behind by an earlier run still answers :8790/:8791, and the
// app then ADOPTS it (that is the resilient path) — so the new instance would
// talk to the OLD database. Free the ports first.
function freePort(port) {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${port}`)) continue
      if (!/LISTENING/i.test(line)) continue
      const pid = line.trim().split(/\s+/).pop()
      if (pid && /^\d+$/.test(pid)) pids.add(pid)
    }
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' })
        log(`freed :${port} (pid ${pid})`)
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* netstat unavailable — the app adopts a healthy sidecar anyway */
  }
}

for (const inst of instances) {
  rmSync(inst.dataDir, { recursive: true, force: true })
  mkdirSync(inst.dataDir, { recursive: true })
  freePort(inst.apiPort)
  log(`booting electron ${inst.name} (cdp ${inst.cdp}, api ${inst.apiPort})…`)
  // Child output goes to a FILE, never a pipe: Electron writes a lot to stdout
  // (the sidecar's output is relayed through it) and a pipe nobody drains
  // blocks the writer — which showed up as a native access violation.
  const outFile = join(ROOT, `${inst.name}-electron.out.log`)
  const errFile = join(ROOT, `${inst.name}-electron.err.log`)
  const outFd = openSync(outFile, 'w')
  const errFd = openSync(errFile, 'w')
  const child = spawn(
    electronPath,
    ['.', `--user-data-dir=${inst.dataDir}`, `--remote-debugging-port=${inst.cdp}`],
    {
      cwd: appDir,
      stdio: ['ignore', outFd, errFd],
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: DEV_URL,
        GMATCH_API_PORT: inst.apiPort,
      },
    },
  )
  child.on('exit', (code, signal) => {
    log(`electron ${inst.name} EXITED code=${code} signal=${signal}`)
    const tail = (f) => {
      try {
        return readFileSync(f, 'utf8').trim().slice(0, 1200)
      } catch {
        return ''
      }
    }
    if (tail(errFile)) log(`${inst.name} stderr:\n  ${tail(errFile)}`)
  })
  children.push(child)
}

// 3. attach
const pages = {}
for (const inst of instances) {
  const endpoint = `http://127.0.0.1:${inst.cdp}`
  const started = Date.now()
  let browser = null
  while (Date.now() - started < 40_000) {
    try {
      browser = await chromium.connectOverCDP(endpoint)
      break
    } catch {
      await sleep(500)
    }
  }
  if (!browser) {
    console.error(`could not attach to electron ${inst.name}`)
    process.exit(2)
  }
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] || (await ctx.waitForEvent('page', { timeout: 20_000 }))
  const errors = []
  const logs = []
  // The app can raise a JS dialog (the fatal-error dialog in main.cjs). Playwright
  // auto-dismisses dialogs, and a dialog that closes itself races the handler,
  // which throws an unhandled 'error' — swallow it.
  page.on('dialog', (d) => {
    d.dismiss().catch(() => {})
  })
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error') errors.push(text.slice(0, 200))
    if (/swarm|mesh|tracker|roster|peer/i.test(text)) logs.push(text.slice(0, 180))
  })
  pages[inst.name] = { page, browser, errors, logs, inst }
  log(`attached to electron ${inst.name}`)
}

// 4. past the age gate and onto the app, the way a PLAYER does it: click the
// 18+ button, set a handle, press Enter. The app then creates its OWN
// identity (createIdentity) and the mesh starts on it.
//
// The identity lives in SECURE storage (the bridge), so an injected identity
// would have to survive a reload — and a CDP reload is what crashed Electron
// natively in an earlier run of this tool (0xC0000005). Driving the real
// first-run path avoids the reload AND tests what a player actually does.
for (const inst of instances) {
  const { page } = pages[inst.name]
  try {
    await page.getByRole('button', { name: /I am 18 or Older/ }).click({ timeout: 45_000, force: true })
    await page.waitForSelector('#onboarding-display-name', { timeout: 30_000 })
    await page.fill('#onboarding-display-name', 'Live' + inst.name)
    // `force` skips Playwright's actionability wait: the onboarding card runs
    // an entry animation, and an element that keeps animating never becomes
    // "stable" — the click then times out even though the button is there.
    await page.getByRole('button', { name: 'Enter', exact: true }).click({ timeout: 20_000, force: true })
    // The app is up when the shell is: the feed header is the first thing
    // that only renders with an identity.
    await page
      .getByText(/Latest|For You/)
      .first()
      .waitFor({ timeout: 45_000 })
      .catch(() => {})
    const identity = await page.evaluate(async () => {
      try {
        const raw = await window.gmatch?.secureGet?.('orbit_identity')
        return raw ? JSON.parse(String(raw)) : null
      } catch {
        return null
      }
    })
    if (!identity?.orbitId) {
      log(`${inst.name}: the app did NOT create an identity`)
      continue
    }
    inst.identity = identity
    log(`${inst.name} signed in: ${identity.orbitId.slice(0, 12)}…`)
  } catch (e) {
    log(`could not sign in ${inst.name}: ${String(e).slice(0, 200)}`)
  }
}
log('signed in; letting the mesh run…')

// 5. wait for the roster to show the OTHER side
const readRoster = async (name) => {
  const { page } = pages[name]
  try {
    return await page.evaluate(() => {
      const raw = localStorage.getItem('orbit_p2p_known_peers')
      let peers = []
      try {
        peers = raw ? JSON.parse(raw) : []
      } catch {
        peers = []
      }
      return { peers: peers.map((p) => ({ id: p.id, online: p.online, name: p.display_name })) }
    })
  } catch (e) {
    return { peers: [], error: String(e).slice(0, 120) }
  }
}

const idA = instances[0].identity?.orbitId
const idB = instances[1].identity?.orbitId
if (!idA || !idB) {
  log('RESULT: an instance never signed in — nothing to compare')
  cleanup()
  process.exit(2)
}
const deadline = Date.now() + 90_000
let a = null
let b = null
let sawEachOther = false
while (Date.now() < deadline) {
  a = await readRoster('A')
  b = await readRoster('B')
  const aSeesB = a.peers.some((p) => p.id === idB && p.online)
  const bSeesA = b.peers.some((p) => p.id === idA && p.online)
  if (aSeesB && bSeesA) {
    sawEachOther = true
    break
  }
  await sleep(3000)
}

log('--- live roster evidence ---')
log(`A identity: ${idA}`)
log(`B identity: ${idB}`)
log(`A roster:   ${JSON.stringify(a?.peers ?? [])}`)
log(`B roster:   ${JSON.stringify(b?.peers ?? [])}`)
for (const name of Object.keys(pages)) {
  const errs = pages[name].errors
  log(`${name} page errors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`)
  const meshLogs = pages[name].logs.slice(0, 8)
  if (meshLogs.length) log(`${name} mesh logs:\n  ${meshLogs.join('\n  ')}`)
  // Did the app even reach the shell? A landing screen means the identity was
  // rejected and the mesh never started — a DIFFERENT failure from "the mesh
  // started but found nobody".
  try {
    const state = await pages[name].page.evaluate(() => ({
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
      keys: Object.keys(localStorage),
    }))
    log(`${name} screen: ${state.text}`)
    log(`${name} has peers key: ${state.keys.includes('orbit_p2p_known_peers')}`)
  } catch (e) {
    log(`${name} screen: <unreadable: ${String(e).slice(0, 100)}>`)
  }
}

if (sawEachOther) {
  log('RESULT: both instances see each other in the roster')
  cleanup()
  process.exit(0)
}
log('RESULT: the two instances did NOT find each other within the budget')
cleanup()
process.exit(1)
