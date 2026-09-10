import { expect, test } from '@playwright/test'
import { seedApp, mockBooruFeed } from './helpers'

// Journey 1: open -> navigate to Idle -> play -> state updates.
test('idle: click the stage, g$ balance grows', async ({ page }) => {
  await seedApp(page, { gc: 0 })
  await mockBooruFeed(page)
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('gc-balance')).toHaveText('0')
  await expect
    .poll(async () => {
      await stage.click()
      return page.getByTestId('gc-balance').textContent()
    }, { timeout: 15_000 })
    .not.toBe('0')
})

// Journey 2: open -> navigate to Games -> duel hub renders.
test('games: hub reachable with sub-tabs', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/games')
  // 1.1 layout: games opens on the default tab and the sidebar exposes the
  // sub-tabs; the old page heading was removed with the games-group nav.
  await expect(page.getByRole('button', { name: 'Idle Clicker' }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Play Cards', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Babecock', exact: true }).first()).toBeVisible()
})

// Journey 3: Games hub -> Idle Clicker tab -> play -> duel tab -> back; state preserved.
// (Idle Clicker moved from the top-level sidebar into Porn Games in 1.0.1.)
test('navigation round-trip preserves idle state', async ({ page }) => {
  await seedApp(page, { gc: 0 })
  await mockBooruFeed(page)
  await page.goto('/#/games')
  await page.getByRole('button', { name: 'Idle Clicker' }).click()
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => {
      await stage.click()
      return page.getByTestId('gc-balance').textContent()
    }, { timeout: 15_000 })
    .not.toBe('0')
  const afterClick = await page.getByTestId('gc-balance').textContent()
  await page.getByRole('button', { name: 'Play Cards', exact: true }).click()
  await page.getByRole('button', { name: 'Idle Clicker' }).click()
  await expect(stage).toBeVisible()
  expect(await page.getByTestId('gc-balance').textContent()).toBe(afterClick)
})

// Journey 4: refresh keeps the route + app functional.
test('refresh preserves the route', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/grid')
  await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
    timeout: 20_000,
  })
  await page.reload()
  await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible()
  expect(page.url()).toContain('#/grid')
})

// The PWA service worker (useNotifications registers /sw.js) caches
// same-origin GETs in this Chromium profile; block SWs for the whole file so
// route-abort mocks and fresh state are deterministic (affects journey 5's
// offline simulation; others never depended on SW).
test.use({ contextOptions: { serviceWorkers: 'block' } })

// Journey 5: sources down -> offline UI with Retry -> recovery.
test('offline card shows and retry recovers', async ({ page }) => {
  await seedApp(page)
  // Block the sidecar AND the dev booru proxies: the idle feed uses the
  // vite /booru routes in browser mode, the shell uses 8790.
  await page.route('**://127.0.0.1:8790/**', (r) => r.abort('connectionrefused'))
  await page.route('**/booru/**', (r) => r.abort('connectionrefused'))
  await page.route('**/rg-auth/**', (r) => r.abort('connectionrefused'))
  await page.goto('/#/grid')
  // Either offline (all sources failed) or empty (feed not yet pulled) is a
  // valid "not playable" stage state; both carry the Retry affordance.
  await expect(page.getByText(/sources offline|no image/i)).toBeVisible({ timeout: 30_000 })
  // Two retry affordances exist (OfflineCard + header button) — scope to the card.
  await page.getByRole('status').getByRole('button', { name: /retry/i }).click()
  await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
    timeout: 30_000,
  })
})

// Navigation: back/forward buttons move between views.
// The Admin sidebar entry was removed in db66606; the #/admin route (PIN gate)
// stays reachable — navigate by hash, which is exactly what this journey tests.
test('browser back/forward navigate views', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await page.goto('/#/admin')
  await expect(page.getByText('Admin Operations')).toBeVisible({ timeout: 15_000 })
  await page.goBack()
  await expect(stage).toBeVisible()
  await page.goForward()
  await expect(page.getByText('Admin Operations')).toBeVisible()
})
