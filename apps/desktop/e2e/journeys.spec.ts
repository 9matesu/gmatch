import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'

// Journey 1: open -> navigate to Idle -> play -> state updates.
test('idle: click the stage, g$ balance grows', async ({ page }) => {
  await seedApp(page, { gc: 0 })
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
  await expect(page.getByRole('heading', { name: /porn games/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Babecock', exact: true })).toBeVisible()
})

// Journey 3: Idle -> Games -> back to Idle; game state preserved.
test('navigation round-trip preserves idle state', async ({ page }) => {
  await seedApp(page, { gc: 0 })
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => {
      await stage.click()
      return page.getByTestId('gc-balance').textContent()
    }, { timeout: 15_000 })
    .not.toBe('0')
  const afterClick = await page.getByTestId('gc-balance').textContent()
  await page.getByRole('button', { name: 'Porn Games' }).click()
  await page.getByRole('button', { name: 'Babecock · Idle' }).click()
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
  await page.getByRole('button', { name: /retry/i }).click()
  await expect(page.getByRole('button', { name: /attack the current foe/i })).toBeVisible({
    timeout: 30_000,
  })
})

// Navigation: back/forward buttons move between views.
test('browser back/forward navigate views', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/grid')
  const stage = page.getByRole('button', { name: /attack the current foe/i })
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Admin' }).click()
  await expect(page.getByText('Admin Operations')).toBeVisible({ timeout: 15_000 })
  await page.goBack()
  await expect(stage).toBeVisible()
  await page.goForward()
  await expect(page.getByText('Admin Operations')).toBeVisible()
})
