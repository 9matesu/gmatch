import { expect, test } from '@playwright/test'
import { seedApp, mockBooruFeed, watchApiNetwork, allowExpected } from './helpers'

// The dev 404 storm. Every app poll (/api/lobby, /api/users, /api/groups, ...)
// came back 404 because browser dev proxied /api to a BLIND COURIER
// (`SITE_SERVICES=mail`) that 404s every stateful route at the edge
// (apps/api/src/serve.ts + site-services.ts). A courier is the directory/mail
// node, never a data node.
//
// These tests pin the contract: the node dev/e2e serve data from is a FULL
// node, and no app request may come back 404.

// Endpoints taken verbatim from the 404 report, with the method the app uses.
const DATA_ROUTES: { method: 'GET' | 'POST'; path: string }[] = [
  { method: 'GET', path: '/api/lobby' },
  { method: 'GET', path: '/api/lobby/chat' },
  { method: 'GET', path: '/api/lobby/special' },
  { method: 'GET', path: '/api/lobby/images' },
  { method: 'GET', path: '/api/users' },
  { method: 'GET', path: '/api/groups' },
  { method: 'GET', path: '/api/announcements' },
  { method: 'GET', path: '/api/inbox' },
  { method: 'GET', path: '/api/objects/stories' },
  { method: 'GET', path: '/api/posts?limit=2&sort=latest' },
  { method: 'GET', path: '/api/users/hacks/active' },
  { method: 'GET', path: `/api/users/${'a'.repeat(64)}/following` },
  { method: 'POST', path: '/api/users/heartbeat' },
]

/** Sidecar boot: schema + VACUUM on a cold DB answers 503 until it is up. */
async function waitForFullNode(request: import('@playwright/test').APIRequestContext) {
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/health')
        if (!res.ok()) return `status ${res.status()}`
        const body = (await res.json()) as { db_ready?: boolean; mode?: string }
        if (!body.db_ready) return 'db not ready'
        if (body.mode === 'courier') return 'served by the blind courier'
        return 'ok'
      },
      { timeout: 60_000, message: 'dev /api never reached a full node' },
    )
    .toBe('ok')
}

test.describe('dev API node', () => {
  test('proxy serves a full node, not the blind courier', async ({ request }) => {
    await waitForFullNode(request)

    for (const { method, path } of DATA_ROUTES) {
      const res = await request.fetch(path, { method, failOnStatusCode: false })
      // 401/403 = the route exists and wants auth. 404 = the node does not
      // serve it, which is the regression this file exists to catch.
      expect(res.status(), `${method} ${path} must not 404`).not.toBe(404)
    }
  })

  test('feed and lobby boot with zero failing /api calls', async ({ page }) => {
    await seedApp(page)
    await mockBooruFeed(page)
    // Auth-gated routes answer 401/403 for requests the app cannot sign (e.g.
    // before identity hydration); /api/pm's 404 is the documented mail-mode
    // probe. Neither is a broken node.
    const guard = watchApiNetwork(page, { allow: allowExpected })

    await page.goto('/#/grid')
    await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
      timeout: 20_000,
    })
    await page.goto('/#/lobby')
    await page.waitForLoadState('networkidle')

    guard.assertClean('feed + lobby boot')
    // Non-vacuity: a guard that never saw a request proves nothing. The app
    // polls lobby/feed/users on boot, so this must be well above zero.
    expect(guard.apiCalls(), 'the app made no /api calls — guard proves nothing').toBeGreaterThan(5)
  })

  test('a stale courier data base self-heals on boot', async ({ page }) => {
    // Older builds auto-joined the central courier on first run, writing it to
    // gmatch.api.url + a 1-year gmatch_server_url cookie. The dev proxy honours
    // that cookie and answered 503 for every data route, wedging the session.
    // Seeded with evaluate() (NOT addInitScript) on purpose: an init script
    // re-seeds on every navigation, so the purge+reload would loop forever.
    const COURIER = 'https://gmatch.pages.dev'
    await seedApp(page)
    await mockBooruFeed(page)
    await page.goto('/#/grid')
    await page.evaluate((courier: string) => {
      localStorage.setItem('gmatch.api.url', courier)
      localStorage.setItem('gmatch.onboarding.serverUrl', courier)
    }, COURIER)
    await page.context().addCookies([{
      name: 'gmatch_server_url',
      value: encodeURIComponent(COURIER),
      url: 'http://localhost:5273',
    }])

    // The boot migration purges the state and reloads once (API_BASE is
    // computed at import), so this load must be served by the dev node.
    await page.reload()
    await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForLoadState('networkidle')

    // Polled, not read once: the heal itself is a navigation, and a single
    // evaluate issued while the app is replacing the document dies with
    // "Execution context was destroyed". What the test asserts is that the
    // stale state is gone once the app has settled — not that it was gone at
    // one arbitrary instant.
    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(() => ({
              api: localStorage.getItem('gmatch.api.url'),
              marker: localStorage.getItem('gmatch.onboarding.serverUrl'),
              cookie: document.cookie.includes('gmatch_server_url='),
            }))
          } catch (err) {
            // The heal IS a navigation. A read that lands while the document
            // is being replaced dies with "Execution context was destroyed" —
            // that is the fix working, not a failure, so retry the read.
            return { navigating: String(err).slice(0, 80) }
          }
        },
        { timeout: 30_000, message: 'stale courier state survived the boot migration' },
      )
      .toEqual({
        api: null,
        marker: null,
        cookie: false,
      })
  })

  test('no module fails to transform (vite 500 / HMR abort class)', async ({ page, request }) => {
    // The reported symptom was `GET /@fs/.../UpdateSection.tsx 500` followed by
    // "Failed to reload ... syntax errors or importing non-existent modules".
    // Serving that module proves the settings surface still compiles; the
    // console/pageerror asserts prove the app booted through it.
    const mod = await request.get('/src/components/settings/UpdateSection.tsx', {
      failOnStatusCode: false,
    })
    expect(mod.status(), 'UpdateSection must transform').toBe(200)
    expect(await mod.text()).not.toContain('Internal Server Error')

    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))

    await seedApp(page)
    await mockBooruFeed(page)
    await page.goto('/#/grid')
    await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
      timeout: 20_000,
    })
    await page.reload()
    await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
      timeout: 20_000,
    })

    const broken = errors.filter((e) =>
      /Failed to reload|ERR_ABORTED|Internal Server Error|Unexpected token/i.test(e),
    )
    expect(broken, `module/transform failures:\n${broken.join('\n')}`).toEqual([])
    expect(errors.filter((e) => /^pageerror/.test(e))).toEqual([])
  })
})
