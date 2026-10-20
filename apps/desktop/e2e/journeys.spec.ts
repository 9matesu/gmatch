import { expect, test, type Page } from '@playwright/test'
import { seedApp, mockBooruFeed } from './helpers'

/**
 * The idle balance as the STORE holds it. The visible HUD number was removed
 * (idle points are local-only, so the save is the state of record), which is
 * why this reads the app's own module rather than scraping a label that no
 * longer exists in the DOM.
 */
async function idlePoints(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const mod = await import('/src/game/store.ts')
    return (mod.useGame.getState() as { points: number }).points
  })
}

/** The packaged feed uses Electron IPC, which browser E2E cannot call. Seed a
 * known foe into the real store so this journey tests the stage click path, not
 * whether a booru mirror happens to be reachable in Chromium. */
async function seedPlayableFoe(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const mod = await import('/src/game/store.ts')
    mod.useGame.setState({
      current: { id: 'e2e-foe', url: '/__e2e__/foe.png', tags: ['gangbang'], rating: 'e', kind: 'image' },
      queue: [],
      foeHp: 100,
      foeMaxHp: 100,
      feedOffline: false,
      imageReady: true,
    } as never)
  })
}

// Journey 1: open -> navigate to Idle -> play -> state updates.
test('idle: click the stage, points balance grows', async ({ page }) => {
  await seedApp(page, { points: 0 })
  await mockBooruFeed(page)
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await seedPlayableFoe(page)

  const before = await idlePoints(page)
  await stage.click()
  await expect(page.getByText(/^\+\d/).first()).toBeVisible()
  await expect.poll(() => idlePoints(page), { timeout: 15_000 }).toBeGreaterThan(before)
})

// Journey 2: open -> navigate to Games -> hub renders its sub-tabs.
// The tablist is "1v1 Arena | Rankings | Babecock"; the idle clicker is no
// longer a games sub-tab (it is its own #/grid route), and "Play Cards" was
// renamed to "1v1 Arena".
test('games: hub reachable with sub-tabs', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/games')
  await expect(page.getByRole('tablist', { name: 'Arena Modes' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: '1v1 Arena', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rankings', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Babecock', exact: true }).first()).toBeVisible()
})

// Journey 3: idle clicker -> play -> away -> back; state preserved.
// The clicker lives on its own #/grid route, so the round trip is now across
// two routes rather than two games sub-tabs.
test('navigation round-trip preserves idle state', async ({ page }) => {
  await seedApp(page, { points: 0 })
  await mockBooruFeed(page)
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await seedPlayableFoe(page)
  await stage.click()
  await expect.poll(() => idlePoints(page), { timeout: 15_000 }).toBeGreaterThan(0)
  const afterClick = await idlePoints(page)
  await page.goto('/#/games')
  await page.goto('/#/grid')
  await expect(stage).toBeVisible()
  // Exact equality is right here: the seeded starter tags earn 0 pts/s, so with
  // no clicks in between nothing may change — a reset would show up as 0.
  expect(await idlePoints(page)).toBe(afterClick)
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
// Both targets are real routes. (The admin panel is a modal reached from the
// HUD, not a route — see social.spec.ts journey 6.)
test('browser back/forward navigate views', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await page.goto('/#/store')
  const storePrice = page.locator('text=/g\\$\\s?[\\d.,]+/').first()
  await expect(storePrice).toBeVisible({ timeout: 20_000 })
  await page.goBack()
  await expect(stage).toBeVisible()
  await page.goForward()
  await expect(storePrice).toBeVisible()
})
