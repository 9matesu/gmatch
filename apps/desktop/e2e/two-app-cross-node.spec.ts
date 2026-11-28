/**
 * BATCH 2.5 / D3 â€” CROSS-NODE two-app proof. NO PINNING.
 *
 * App 1: browser dev (Playwright webServer vite :5273, whose /api proxy rides
 *        its own fresh Bun node on GMATCH_E2E_PORT (default :8791) â€” playwright.config.ts).
 * App 2: the UNPACKAGED Electron shell (Playwright _electron), whose renderer
 *        loads the same vite bundle but has the preload bridge, its own
 *        userData and its OWN sidecar at window.__API_BASE__ =
 *        GMATCH_E2E_ELECTRON_PORT (default :8793)
 *        (electron/dev-runtime.cjs).
 *
 * Neither renderer is pointed at the other's node: any stored `gmatch.api.url`
 * override and the dev-proxy cookie are cleared at seed time so each app falls
 * through to ITS OWN node. Cross-app traffic must therefore travel the real
 * rendezvous/swarm path â€” a shared node is not allowed to make this pass.
 *
 * Every leg fails LOUD with its own name. Screenshots are taken only AFTER the
 * pixels they must show are asserted; a `User` row, an empty list or an offline
 * state is a FAIL, never evidence.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seedApp } from './helpers'

const SHOTS = 'I:/temp/opencode/batch25-cross'
const APP_DIR = fileURLToPath(new URL('../', import.meta.url))
const E2E_PORT = process.env.GMATCH_E2E_PORT || '8791'
const ELECTRON_PORT = process.env.GMATCH_E2E_ELECTRON_PORT || '8793'
const ELECTRON_API = `http://127.0.0.1:${ELECTRON_PORT}`
const BROWSER_NAME = 'CrossNode Browser'
const ELECTRON_NAME = 'CrossNode Electron'
const MSG = 'cross-node sealed hello from the browser'
const CAPTION = 'cross-node-post-seen-by-electron'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// Boot + six legs + a bounded 130s decay wait; one generous ceiling so a slow
// first load cannot turn into a harness timeout that masquerades as a bug.
test.setTimeout(600_000)

/**
 * A row is only the peer if it shows BOTH the real signed name AND liveness.
 * Both filters apply to the FULL list before .first(): an older, now-stale row
 * with the same name must never mask the live one.
 */
function activePeerRow(page: Page, name: string) {
  return page
    .locator('[data-testid="chat-player-row"]')
    .filter({ hasText: name })
    .filter({ hasText: 'Active now' })
    .first()
}

function messageRow(page: Page, text: string) {
  return page.locator('[data-message-row]', { hasText: text }).first()
}

/** The CommandIsland live-peer chip count, never the zero-connection one. */
function peerChip(page: Page) {
  return page.getByRole('button', { name: /^Peers, [1-9]\d* connected$/ })
}

/**
 * Electron keeps the identity in the DPAPI KV (preload bridge), not in
 * localStorage; browser dev uses localStorage. Read whichever is authoritative.
 */
async function identityIn(page: Page): Promise<{ orbitId: string } | null> {
  return evalStable(page, async () => {
    const raw = await page.evaluate(async () => {
      const bridge = (window as unknown as { gmatch?: { secureGet?: (k: string) => Promise<string | null> } }).gmatch
      const value = bridge?.secureGet ? await bridge.secureGet('orbit_identity') : null
      return value ?? localStorage.getItem('orbit_identity')
    })
    return raw ? (JSON.parse(raw) as { orbitId: string }) : null
  })
}

async function evalStable<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      const message = String((err as Error)?.message ?? err)
      const navigated = /Execution context was destroyed|Target closed|navigation|Cannot find context/.test(message)
      if (!navigated || Date.now() > deadline) throw err
      await page.waitForTimeout(500)
    }
  }
}

/**
 * No pinning: drop any stale node override (and the dev-proxy routing cookie)
 * BEFORE boot so each renderer resolves its own node. A healthy loopback
 * override survives the app's own self-heal, so the harness must clear it.
 */
async function clearApiOverride(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('gmatch.api.url')
    localStorage.removeItem('gmatch.onboarding.serverUrl')
    document.cookie = 'gmatch_server_url=; path=/; max-age=0'
  })
}

/** Publish a real name on the app's OWN node (browser -> E2E_PORT, shell -> ELECTRON_PORT). */
async function publishDisplayName(page: Page, name: string) {
  await expect
    .poll(
      async () => {
        await evalStable(page, () =>
          page.evaluate(async (displayName: string) => {
            const mod = await import('/src/utils/api.ts')
            const bridge = (window as unknown as { gmatch?: { secureGet?: (k: string) => Promise<string | null> } }).gmatch
            const secureRaw = bridge?.secureGet ? await bridge.secureGet('orbit_identity') : null
            const identity = JSON.parse(secureRaw ?? localStorage.getItem('orbit_identity') ?? 'null')
            const res = await mod.orbitFetch(
              '/api/users/profile',
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: displayName }),
              },
              identity,
            )
            if (!res.ok) throw new Error(`display name PATCH failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
          }, name),
        )
        return true
      },
      { timeout: 30_000, message: `could not publish display name ${name}` },
    )
    .toBe(true)
    // The presence beacon reads the LOCAL profile, not the node row. A raw
    // PATCH updates the server only, so persist the name locally and reload
    // once; otherwise the peer beacon carries no display name and the roster
    // shows a fallback id.
    await evalStable(page, () =>
      page.evaluate(async (displayName: string) => {
        localStorage.setItem('orbit_display_name', displayName)
      }, name),
    )
}

async function waitForNode(url: string, label: string) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) })
      const body = (await res.json()) as { db_ready?: boolean }
      if (res.ok && body.db_ready) return
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`LEG roster: ${label} node never became db_ready on ${url}`)
}

/** First-run dialogs (Help/Tour/Media suite) can cover the chat; close them. */
async function dismissOverlays(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip for now' })
  if (await skip.isVisible().catch(() => false)) await skip.click()
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
  console.log(`captured ${SHOTS}/${name}.png`)
}

test('browser and Electron on separate nodes see each other, chat, post and stay online', async ({ browser, baseURL }) => {
  mkdirSync(SHOTS, { recursive: true })
  if (!baseURL) throw new Error('LEG roster: Playwright baseURL missing')

  const ctxBrowser: BrowserContext = await browser.newContext({
    viewport: { width: 1366, height: 860 },
    serviceWorkers: 'block',
  })
  const pageBrowser = await ctxBrowser.newPage()

  let shell: ElectronApplication | null = null
  try {
    shell = await electron.launch({
      args: ['.'],
      cwd: APP_DIR,
      timeout: 60_000,
      env: {
        ...process.env,
        // The shell gets its own dev-runtime userData + sidecar. The vite
        // webServer already owns E2E_PORT, so never let the shell claim it.
        GMATCH_DEV_API_PORT: ELECTRON_PORT,
        VITE_DEV_SERVER_URL: baseURL,
        STORAGE_ENCRYPTION_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      },
    })
    const pageShell = await shell.firstWindow()
    await pageShell.setViewportSize({ width: 1366, height: 860 })
    pageShell.on('dialog', (dialog) => { void dialog.accept().catch(() => {}) })
    pageBrowser.on('dialog', (dialog) => { void dialog.accept().catch(() => {}) })

    await waitForNode(`http://127.0.0.1:${E2E_PORT}`, 'browser dev node')
    await waitForNode(ELECTRON_API, 'electron node')

    const idBrowser = await seedApp(pageBrowser, { displayName: BROWSER_NAME })
    await clearApiOverride(pageBrowser)
    await pageBrowser.goto(`${baseURL}/#/feed`)

    await seedApp(pageShell, { displayName: ELECTRON_NAME })
    await clearApiOverride(pageShell)
    // Electron stores its identity in DPAPI, so the seeded localStorage copy is
    // migrated/purged at boot. Read the identity the REAL shell is using, then
    // seed first-run overlays under THAT id (Help/Tour key by id).
    const idShell = await identityIn(pageShell)
    if (!idShell) throw new Error('LEG roster: Electron shell has no identity in its secure store')
    await pageShell.addInitScript(([id, name]: [string, string]) => {
      localStorage.setItem('orbit_display_name', name)
      localStorage.setItem(`gmatch_help_seen_${id}`, '1')
      localStorage.setItem(`orbit_tour_v1:${id}`, JSON.stringify({ version: 1, index: 0, status: 'done' }))
      localStorage.setItem(
        `orbit_onboarding_v2:${id}`,
        JSON.stringify({
          version: 1,
          current: 'ready',
          completed: ['welcome', 'auth', 'profile', 'platform', 'feed', 'tune', 'cards', 'economy', 'games', 'ready'],
        }),
      )
    }, [idShell.orbitId, ELECTRON_NAME])
    await pageShell.reload({ waitUntil: 'domcontentloaded' })
    await pageShell.goto(`${baseURL}/#/feed`, { waitUntil: 'domcontentloaded' })
    await dismissOverlays(pageShell)

    // Prove these are two DIFFERENT app shells on DIFFERENT nodes, not two
    // copies of one surface pinned to one API base.
    const browserShell = await evalStable(pageBrowser, () =>
      pageBrowser.evaluate(() => Boolean((window as { gmatch?: unknown }).gmatch)),
    )
    const electronShell = await evalStable(pageShell, () =>
      pageShell.evaluate(() => Boolean((window as { gmatch?: unknown }).gmatch)),
    )
    const electronApi = await evalStable(pageShell, () =>
      pageShell.evaluate(() => (window as { __API_BASE__?: string }).__API_BASE__),
    )
    const browserApi = await evalStable(pageBrowser, () =>
      pageBrowser.evaluate(() => (window as { __API_BASE__?: string }).__API_BASE__),
    )
    expect(browserShell, 'browser dev must have no Electron bridge').toBe(false)
    expect(electronShell, 'Electron renderer must have the preload bridge').toBe(true)
    expect(electronApi, 'Electron must use its OWN sidecar node').toBe(ELECTRON_API)
    expect(browserApi, 'browser dev must use the dev proxy, not a preload base').toBeFalsy()
    expect(idShell.orbitId).not.toBe(idBrowser.orbitId)
    console.log(`cross-node: browser bridge=${browserShell}, electron bridge=${electronShell}, browser __API_BASE__=${browserApi}, electron __API_BASE__=${electronApi}`)

    await publishDisplayName(pageBrowser, BROWSER_NAME)
    await publishDisplayName(pageShell, ELECTRON_NAME)

    // â”€â”€ LEG roster: each app shows the OTHER identity, real name + Active now â”€â”€
    await pageBrowser.goto(`${baseURL}/#/messages`)
    await pageShell.goto(`${baseURL}/#/messages`, { waitUntil: 'domcontentloaded' })
    await dismissOverlays(pageShell)
    await dismissOverlays(pageBrowser)
    const deadlineRoster = Date.now() + 120_000
    let browserSeesShell = false
    let shellSeesBrowser = false
    while (Date.now() < deadlineRoster && !(browserSeesShell && shellSeesBrowser)) {
      browserSeesShell = await activePeerRow(pageBrowser, ELECTRON_NAME).isVisible().catch(() => false)
      shellSeesBrowser = await activePeerRow(pageShell, BROWSER_NAME).isVisible().catch(() => false)
      await pageBrowser.waitForTimeout(1000)
    }
    if (!browserSeesShell || !shellSeesBrowser) {
      // Honest failure evidence: capture what each list ACTUALLY rendered, and
      // name the shots FAIL so an empty/`User` list is never read as a pass.
      const browserRows = await pageBrowser.locator('[data-testid="chat-player-row"]').allInnerTexts().catch(() => [])
      const shellRows = await pageShell.locator('[data-testid="chat-player-row"]').allInnerTexts().catch(() => [])
      console.log(`LEG roster diagnostic browser rows: ${JSON.stringify(browserRows)}`)
      console.log(`LEG roster diagnostic electron rows: ${JSON.stringify(shellRows)}`)
      await shot(pageBrowser, 'FAIL-roster-browser')
      await shot(pageShell, 'FAIL-roster-electron')
      throw new Error(
        `LEG roster FAIL: browser sees Electron=${browserSeesShell} (real name + Active now), ` +
        `Electron sees browser=${shellSeesBrowser}. Expected cross-node peers in each player list.`,
      )
    }
    expect(await activePeerRow(pageBrowser, ELECTRON_NAME).innerText()).toContain(ELECTRON_NAME)
    expect(await activePeerRow(pageShell, BROWSER_NAME).innerText()).toContain(BROWSER_NAME)
    await shot(pageBrowser, 'roster-browser-sees-electron')
    await shot(pageShell, 'roster-electron-sees-browser')
    console.log('LEG roster PASS: each app shows the other signed name with Active now')

    // â”€â”€ LEG count: the live CommandIsland chip is non-zero in BOTH apps â”€â”€â”€â”€â”€â”€
    await expect(peerChip(pageBrowser), 'LEG count FAIL: browser peer chip shows zero').toBeVisible({ timeout: 30_000 })
    await expect(peerChip(pageShell), 'LEG count FAIL: Electron peer chip shows zero').toBeVisible({ timeout: 30_000 })
    await shot(pageBrowser, 'count-browser-peer-chip')
    await shot(pageShell, 'count-electron-peer-chip')
    console.log('LEG count PASS: both CommandIsland chips reflect the roster peer (not zero)')

    // â”€â”€ LEG dm: sealed browser -> Electron, Delivered then Seen on real read â”€â”€
    await activePeerRow(pageBrowser, ELECTRON_NAME).getByLabel(`Message ${ELECTRON_NAME}`).click()
    await expect(pageBrowser.getByLabel('Write a message')).toBeVisible({ timeout: 20_000 })
    await pageBrowser.getByLabel('Write a message').fill(MSG)
    await pageBrowser.getByLabel('Write a message').press('Enter')
    await expect(pageBrowser.locator('[data-message-id]', { hasText: MSG }).first()).toBeVisible({ timeout: 20_000 })
    await expect(pageShell.getByText(MSG).first(), 'LEG dm FAIL: sealed DM never arrived in Electron').toBeVisible({ timeout: 60_000 })
    await expect(messageRow(pageBrowser, MSG).locator('[title="Delivered"]'), 'LEG dm FAIL: no real delivery ack').toBeVisible({ timeout: 30_000 })
    await expect(messageRow(pageBrowser, MSG).locator('[title="Seen"]')).toHaveCount(0)
    await shot(pageBrowser, 'dm-browser-delivered')
    await dismissOverlays(pageShell)
    await pageShell.getByRole('button').filter({ hasText: MSG }).first().click()
    await expect(pageShell.locator('[data-message-id]', { hasText: MSG }).first()).toBeVisible({ timeout: 20_000 })
    await expect(messageRow(pageBrowser, MSG).locator('[title="Seen"]'), 'LEG dm FAIL: opening the thread earned no read receipt').toBeVisible({ timeout: 30_000 })
    await shot(pageShell, 'dm-electron-thread')
    console.log('LEG dm PASS: cross-node sealed DM arrived, Delivered -> Seen on real read')

    // â”€â”€ LEG post: browser post appears in Electron's feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await pageBrowser.goto(`${baseURL}/#/feed`)
    await pageBrowser.getByRole('button', { name: 'Create a post', exact: true }).click()
    await pageBrowser.getByRole('button', { name: 'Upload', exact: true }).click()
    const drop = pageBrowser.getByText('Drop a file, click to browse, or paste from the clipboard')
    await expect(drop).toBeVisible({ timeout: 20_000 })
    const [chooser] = await Promise.all([
      pageBrowser.waitForEvent('filechooser'),
      drop.click(),
    ])
    await chooser.setFiles({ name: 'cross-node-post.png', mimeType: 'image/png', buffer: PNG_1x1 })
    const apply = pageBrowser.getByRole('button', { name: 'Use this media', exact: true })
    await expect(apply).toBeVisible({ timeout: 10_000 })
    await apply.click()
    await pageBrowser.getByPlaceholder('Write a caption...').fill(CAPTION)
    await pageBrowser.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(pageBrowser.getByText(CAPTION).first()).toBeVisible({ timeout: 30_000 })
    await pageShell.goto(`${baseURL}/#/feed`, { waitUntil: 'domcontentloaded' })
    await expect(pageShell.getByText(CAPTION).first(), 'LEG post FAIL: browser post never reached the Electron feed').toBeVisible({ timeout: 60_000 })
    await shot(pageBrowser, 'post-browser-published')
    await shot(pageShell, 'post-electron-feed')
    console.log('LEG post PASS: post published on the browser node is visible in the Electron feed')

    // â”€â”€ LEG profile: Electron opens the browser peer's real profile â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await pageShell.goto(`${baseURL}/#/messages`, { waitUntil: 'domcontentloaded' })
    await dismissOverlays(pageShell)
    const row = activePeerRow(pageShell, BROWSER_NAME)
    await expect(row).toBeVisible({ timeout: 60_000 })
    await row.getByTitle(`View ${BROWSER_NAME}'s profile`).click()
    const dialog = pageShell.getByRole('dialog', { name: `${BROWSER_NAME} profile` })
    await expect(dialog, 'LEG profile FAIL: opened profile shows no real signed name').toBeVisible({ timeout: 20_000 })
    await expect(dialog.getByText('Online'), 'LEG profile FAIL: peer shown offline').toBeVisible()
    await expect(dialog.getByText(/^Posts \([1-9]\d*\)$/), 'LEG profile FAIL: no posts from the browser peer').toBeVisible({ timeout: 60_000 })
    await shot(pageShell, 'profile-electron-opens-browser')
    console.log('LEG profile PASS: Electron opened the browser peer profile â€” real name, Online, posts >= 1')

    // â”€â”€ LEG decay: ~130s later the peers are STILL online (60/120s bug) â”€â”€â”€â”€â”€
    await pageShell.keyboard.press('Escape')
    await pageBrowser.goto(`${baseURL}/#/messages`, { waitUntil: 'domcontentloaded' })
    await pageShell.goto(`${baseURL}/#/messages`, { waitUntil: 'domcontentloaded' })
    await dismissOverlays(pageBrowser)
    await dismissOverlays(pageShell)
    console.log('LEG decay: waiting 130s to check the 60s/120s roster timeout...')
    await pageBrowser.waitForTimeout(130_000)
    await expect(activePeerRow(pageBrowser, ELECTRON_NAME), 'LEG decay FAIL: browser lost the Electron peer after 130s').toBeVisible({ timeout: 30_000 })
    await expect(activePeerRow(pageShell, BROWSER_NAME), 'LEG decay FAIL: Electron lost the browser peer after 130s').toBeVisible({ timeout: 30_000 })
    await expect(peerChip(pageBrowser), 'LEG decay FAIL: browser peer chip fell back to zero').toBeVisible({ timeout: 30_000 })
    await expect(peerChip(pageShell), 'LEG decay FAIL: Electron peer chip fell back to zero').toBeVisible({ timeout: 30_000 })
    await shot(pageBrowser, 'decay-browser-still-online')
    await shot(pageShell, 'decay-electron-still-online')
    console.log('LEG decay PASS: peers still Active now after 130s')

    console.log(`ALL CROSS-NODE LEGS PASS; screenshots in ${SHOTS}`)
  } finally {
    // A native Electron dialog can keep close() pending forever; bound it,
    // then tree-kill the child so no orphan holds the ELECTRON_PORT sidecar for a
    // later run.
    try {
      await Promise.race([
        shell?.close() ?? Promise.resolve(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('electron close timeout')), 15_000)),
      ])
    } catch { /* force cleanup below */ }
    // A failed launch leaves an ElectronApplication with no backing process;
    // process() then throws and would mask the real test failure.
    const proc = (() => { try { return shell?.process() } catch { return undefined } })()
    if (proc && proc.exitCode === null) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        try { proc.kill('SIGKILL') } catch { /* already gone */ }
      }
    }
    await ctxBrowser.close()
  }
})
