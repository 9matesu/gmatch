// One-off capture spec for the landing page screenshots (site/img/).
// Runs through the playwright harness so the vite dev server (+ Bun sidecar)
// auto-boots. All views use the deterministic synthetic-feed mock: the UI
// shell, nav and panels are REAL; placeholder imagery is 1x1 synthetic —
// no external booru traffic, nothing prohibited.
import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seedApp, mockBooruFeed } from './helpers'

const OUT = fileURLToPath(new URL('../../../site/img/', import.meta.url))
mkdirSync(OUT, { recursive: true })

async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: `${OUT}${name}.png` })
  console.log('captured', name)
}

test('capture landing screenshots', async ({ browser }) => {
  test.setTimeout(180_000)
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1366, height: 860 },
  })
  const page = await ctx.newPage()

  // 1. Idle grid (clicker stage).
  await seedApp(page, { gc: 15234 })
  await mockBooruFeed(page)
  await page.goto('/#/grid')
  await page.getByRole('button', { name: /attack the current foe/i }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  await shot(page, 'idle-grid')

  // 2. Games hub with sub-tabs.
  await page.goto('/#/games')
  await page.getByRole('button', { name: 'Idle Clicker' }).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await shot(page, 'games-hub')

  // 3. Card game (Play tab).
  await page.getByRole('button', { name: 'Play Cards', exact: true }).first().click()
  await page.waitForTimeout(2500)
  await shot(page, 'cards')

  // 4. Social feed.
  await mockBooruFeed(page)
  await page.goto('/#/feed')
  await page.waitForTimeout(2500)
  await shot(page, 'feed')

  // 5. Servers view (join/host).
  await page.goto('/#/servers')
  await page.waitForTimeout(2000)
  await shot(page, 'servers')

  await ctx.close()
})
