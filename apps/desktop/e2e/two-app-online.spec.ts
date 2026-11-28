/**
 * BATCH 2.5 / C5 — one machine, TWO REAL APPS, both online and interacting.
 *
 * App 1: the browser dev surface (the Playwright webServer's vite on :5273,
 *        whose /api proxy rides its own fresh Bun node on :8791 — see
 *        playwright.config.ts).
 * App 2: the actual UNPACKAGED Electron shell, launched by Playwright's
 *        _electron driver. Its renderer loads the same vite bundle but has the
 *        preload bridge, its OWN userData (%APPDATA%/gmatch-dev) and its OWN
 *        sidecar on GMATCH_DEV_API_PORT (:8793, via electron/dev-runtime.cjs).
 *        As a client joined to the browser app's loopback node it shares the
 *        world for social traffic, exactly like a friend joining a host.
 *
 * Every leg fails LOUD with its own name. No skip, no fabricated state:
 * screenshots are taken only AFTER the pixels they must show are asserted.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seedApp } from './helpers'

const SHOTS = 'I:/temp/opencode/batch25'
const APP_DIR = fileURLToPath(new URL('../', import.meta.url))
// playwright.config.ts webServer: vite :5273 + its hermetic Bun node :8791.
const HOST_NODE = 'http://127.0.0.1:8791'
const ELECTRON_API = 'http://127.0.0.1:8793'
const BROWSER_NAME = 'TwoApp Browser'
const ELECTRON_NAME = 'TwoApp Electron'
const MSG = 'two-app sealed hello from the browser'
const CAPTION = 'two-app-post-seen-by-electron'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.setTimeout(360_000)

function playerRow(page: Page, name: string) {
  return page.locator('[data-testid="chat-player-row"]').filter({ hasText: name })
}

function messageRow(page: Page, text: string) {
  return page.locator('[data-message-row]', { hasText: text }).first()
}

/**
 * The app self-reloads once on boot (stored-base self-heal / world switch).
 * Retry only that harness race, never an evaluation error from the app.
 */
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

/** Give the identity a real name on the SHARED node, not just in localStorage. */
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
}

/** Node roster, read with the app's own signed client. */
async function roster(page: Page): Promise<string[]> {
  return evalStable(page, () =>
    page.evaluate(async () => {
      const { orbitFetch } = await import('/src/utils/api.ts')
      const bridge = (window as unknown as { gmatch?: { secureGet?: (k: string) => Promise<string | null> } }).gmatch
      const secureRaw = bridge?.secureGet ? await bridge.secureGet('orbit_identity') : null
      const identity = JSON.parse(secureRaw ?? localStorage.getItem('orbit_identity') ?? 'null')
      const res = await orbitFetch('/api/users/online', {}, identity)
      if (!res.ok) return []
      const data = await res.json().catch(() => null)
      return Array.isArray(data?.users) ? data.users.map((u: { id: string }) => u.id) : []
    }),
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

test('electron shell and browser dev are both online and interact', async ({ browser, baseURL }) => {
  mkdirSync(SHOTS, { recursive: true })
  if (!baseURL) throw new Error('LEG roster: Playwright baseURL missing')

  // ── Two isolated instances ────────────────────────────────────────────────
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
        // webServer already owns :8791, so never let the shell claim it.
        GMATCH_DEV_API_PORT: '8793',
        VITE_DEV_SERVER_URL: baseURL,
        STORAGE_ENCRYPTION_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      },
    })
    const pageShell = await shell.firstWindow()
    await pageShell.setViewportSize({ width: 1366, height: 860 })
    pageShell.on('dialog', (dialog) => { void dialog.accept().catch(() => {}) })
    pageBrowser.on('dialog', (dialog) => { void dialog.accept().catch(() => {}) })

    await waitForNode(HOST_NODE, 'browser')
    await waitForNode(ELECTRON_API, 'electron')

    const idBrowser = await seedApp(pageBrowser, { displayName: BROWSER_NAME })
    // Pin BOTH renderers to the same loopback node; the app's default central
    // rendezvous must not silently become the data API mid-run.
    await pageBrowser.addInitScript((url: string) => localStorage.setItem('gmatch.api.url', url), HOST_NODE)
    await pageBrowser.goto(`${baseURL}/#/feed`)

    // The shell window has already loaded; init scripts apply on the reload.
    await pageShell.addInitScript((url: string) => localStorage.setItem('gmatch.api.url', url), HOST_NODE)
    await seedApp(pageShell, { displayName: ELECTRON_NAME })
    // Electron stores its identity in DPAPI, so the seeded localStorage copy
    // is migrated/purged at boot. Read the identity the REAL shell is using,
    // then seed the first-run overlays under THAT id (Help/Tour key by id).
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

    // Prove these are two DIFFERENT app shells, not two copies of one surface.
    const browserShell = await evalStable(pageBrowser, () =>
      pageBrowser.evaluate(() => Boolean((window as { gmatch?: unknown }).gmatch)),
    )
    const electronShell = await evalStable(pageShell, () =>
      pageShell.evaluate(() => Boolean((window as { gmatch?: unknown }).gmatch)),
    )
    const electronApi = await evalStable(pageShell, () =>
      pageShell.evaluate(() => (window as { __API_BASE__?: string }).__API_BASE__),
    )
    expect(browserShell, 'browser dev must have no Electron bridge').toBe(false)
    expect(electronShell, 'Electron renderer must have the preload bridge').toBe(true)
    expect(electronApi).toBe(ELECTRON_API)
    expect(idShell.orbitId).not.toBe(idBrowser.orbitId)
    console.log(`two apps: browser bridge=${browserShell}, electron bridge=${electronShell}, electron node=${electronApi}`)

    await publishDisplayName(pageBrowser, BROWSER_NAME)
    await publishDisplayName(pageShell, ELECTRON_NAME)

    // ── LEG 1: both peers online in the roster ──────────────────────────────
    await pageBrowser.goto(`${baseURL}/#/messages`)
    await pageShell.goto(`${baseURL}/#/messages`, { waitUntil: 'domcontentloaded' })
    await dismissOverlays(pageShell)
    await dismissOverlays(pageBrowser)
    const deadlineRoster = Date.now() + 90_000
    let browserSeesShell = false
    let shellSeesBrowser = false
    while (Date.now() < deadlineRoster && !(browserSeesShell && shellSeesBrowser)) {
      browserSeesShell = (await roster(pageBrowser)).includes(idShell.orbitId)
      shellSeesBrowser = (await roster(pageShell)).includes(idBrowser.orbitId)
      await pageBrowser.waitForTimeout(1000)
    }
    if (!browserSeesShell || !shellSeesBrowser) {
      throw new Error(
        `LEG roster: browser sees shell=${browserSeesShell}, shell sees browser=${shellSeesBrowser}`,
      )
    }
    const shellRowOnBrowser = playerRow(pageBrowser, ELECTRON_NAME)
    const browserRowOnShell = playerRow(pageShell, BROWSER_NAME)
    await expect(shellRowOnBrowser.getByText('Active now')).toBeVisible({ timeout: 60_000 })
    await expect(browserRowOnShell.getByText('Active now')).toBeVisible({ timeout: 60_000 })
    await shot(pageBrowser, 'browser-messages-two-online')
    await shot(pageShell, 'electron-messages-two-online')
    console.log('LEG roster PASS: both peers online in the shared node roster')

    // ── LEG 2: sealed DM round-trip (Delivered then Seen) ────────────────────
    await shellRowOnBrowser.filter({ hasText: 'Active now' }).getByLabel(`Message ${ELECTRON_NAME}`).click()
    await expect(pageBrowser.getByLabel('Write a message')).toBeVisible({ timeout: 20_000 })
    await pageBrowser.getByLabel('Write a message').fill(MSG)
    await pageBrowser.getByLabel('Write a message').press('Enter')
    await expect(pageBrowser.locator('[data-message-id]', { hasText: MSG }).first()).toBeVisible({ timeout: 20_000 })
    await expect(pageShell.getByText(MSG).first()).toBeVisible({ timeout: 60_000 })
    await expect(messageRow(pageBrowser, MSG).locator('[title="Delivered"]')).toBeVisible({ timeout: 30_000 })
    await expect(messageRow(pageBrowser, MSG).locator('[title="Seen"]')).toHaveCount(0)
    await shot(pageBrowser, 'browser-chat-delivered')
    // Opening the thread is the only act that earns a read receipt.
    await dismissOverlays(pageShell)
    await pageShell.getByRole('button').filter({ hasText: MSG }).first().click()
    await expect(pageShell.locator('[data-message-id]', { hasText: MSG }).first()).toBeVisible({ timeout: 20_000 })
    await expect(messageRow(pageBrowser, MSG).locator('[title="Seen"]')).toBeVisible({ timeout: 30_000 })
    await shot(pageShell, 'electron-chat-thread')
    console.log('LEG dm PASS: sealed message arrived, Delivered -> Seen on real read')

    // ── LEG 3: a post by the browser app appears in the Electron feed ───────
    await pageBrowser.goto(`${baseURL}/#/feed`)
    await pageBrowser.getByRole('button', { name: 'Create a post', exact: true }).click()
    await pageBrowser.getByRole('button', { name: 'Upload', exact: true }).click()
    const drop = pageBrowser.getByText('Drop a file, click to browse, or paste from the clipboard')
    await expect(drop).toBeVisible({ timeout: 20_000 })
    const [chooser] = await Promise.all([
      pageBrowser.waitForEvent('filechooser'),
      drop.click(),
    ])
    await chooser.setFiles({ name: 'two-app-post.png', mimeType: 'image/png', buffer: PNG_1x1 })
    const apply = pageBrowser.getByRole('button', { name: 'Use this media', exact: true })
    await expect(apply).toBeVisible({ timeout: 10_000 })
    await apply.click()
    await pageBrowser.getByPlaceholder('Write a caption...').fill(CAPTION)
    await pageBrowser.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(pageBrowser.getByText(CAPTION).first()).toBeVisible({ timeout: 30_000 })
    await pageShell.goto(`${baseURL}/#/feed`, { waitUntil: 'domcontentloaded' })
    await expect(pageShell.getByText(CAPTION).first()).toBeVisible({ timeout: 60_000 })
    await shot(pageBrowser, 'browser-feed-two-peers-online')
    await shot(pageShell, 'electron-feed-with-browser-post')
    console.log('LEG post PASS: post published in the browser is visible in the Electron feed')

    // ── LEG 4: Electron opens the browser app's profile ─────────────────────
    await pageShell.goto(`${baseURL}/#/messages`, { waitUntil: 'domcontentloaded' })
    const row = playerRow(pageShell, BROWSER_NAME)
    const onlineRow = row.filter({ hasText: 'Active now' })
    await expect(onlineRow.getByText('Active now')).toBeVisible({ timeout: 60_000 })
    await onlineRow.getByTitle(`View ${BROWSER_NAME}'s profile`).click()
    await expect(pageShell.getByText(BROWSER_NAME).first()).toBeVisible({ timeout: 20_000 })
    await shot(pageShell, 'electron-opens-browser-profile')
    console.log('LEG profile PASS: Electron opened the browser peer profile')

    console.log(`ALL LEGS PASS; screenshots in ${SHOTS}`)
  } finally {
    // A native Electron dialog can keep close() pending forever; bound it,
    // then tree-kill the child so no orphan holds the dev single-instance lock
    // or the :8793 sidecar for the next run.
    try {
      await Promise.race([
        shell?.close() ?? Promise.resolve(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('electron close timeout')), 15_000)),
      ])
    } catch { /* force cleanup below */ }
    const proc = shell?.process()
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
