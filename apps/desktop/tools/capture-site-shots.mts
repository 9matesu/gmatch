// Standalone screenshot capture for the gMatch landing page.
// Reuses the E2E deterministic mocks (synthetic 1x1 feed images — no external
// booru traffic) so the screenshots show the REAL UI shell, real navigation,
// real panels, and never prohibited content.
// Run from apps/desktop/: I:/goongrid/node_modules/... playwright is imported here.
import { chromium } from '@playwright/test'
import { seedApp, mockBooruFeed } from '../e2e/helpers'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SHOT_BASE || 'http://localhost:5273'
const OUT = new URL('../../site/img/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

async function shot(name, fn, opts = {}) {
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1366, height: 820 },
    deviceScaleFactor: 1,
    ...opts,
  })
  const page = await ctx.newPage()
  try {
    await fn(page)
    await page.screenshot({ path: `${OUT}${name}.png` })
    console.log('captured', name)
  } catch (e) {
    console.error('FAILED', name, e.message)
  } finally {
    await ctx.close()
  }
}

// 1. Idle grid view (the clicker stage) with deterministic feed mock.
await shot('idle-grid', async (page) => {
  await seedApp(page, { gc: 15234 })
  await mockBooruFeed(page)
  await page.goto(`${BASE}/#/grid`)
  await page.getByRole('button', { name: /attack the current foe/i }).waitFor({ timeout: 30000 })
  await page.waitForTimeout(1200)
})

// 2. Games hub (sub-tabs: Play / Babecock / Idle Clicker).
await shot('games-hub', async (page) => {
  await seedApp(page)
  await page.goto(`${BASE}/#/games`)
  await page.getByRole('button', { name: 'Idle Clicker' }).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(600)
})

// 3. Card game detail / collection view.
await shot('cards', async (page) => {
  await seedApp(page)
  await page.goto(`${BASE}/#/games`)
  await page.getByRole('button', { name: 'Play', exact: true }).first().click()
  await page.waitForTimeout(2500)
})

// 4. Social feed view.
await shot('feed', async (page) => {
  await seedApp(page)
  await mockBooruFeed(page)
  await page.goto(`${BASE}/#/feed`)
  await page.waitForTimeout(2500)
})

// 5. Servers view (join/host nodes UI).
await shot('servers', async (page) => {
  await seedApp(page)
  await page.goto(`${BASE}/#/servers`)
  await page.waitForTimeout(2000)
})

await browser.close()
console.log('done')
