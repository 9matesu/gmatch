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

  // Seed a returning user and drop the help-modal flag so the capture shows
  // the views themselves instead of the guide overlay.
  const identity = await seedApp(page, { points: 15234 })
  await page.addInitScript(
    (id: string) => localStorage.setItem(`gmatch_help_seen_${id}`, '1'),
    identity.orbitId,
  )
  await mockBooruFeed(page)

  // 1. Social feed. First paint also fires first-run toasts (achievements);
  //    wait them out so the capture shows the view, not a notification.
  await page.goto('/#/feed')
  await page.waitForTimeout(6000)
  await shot(page, 'feed')

  // 2. Servers view: the built-in public world plus anything added locally.
  await page.goto('/#/servers')
  await page.getByText('gmatch Node').first().waitFor({ timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await shot(page, 'servers')

  // 3. Watch party gallery.
  await page.goto('/#/watch')
  await page.waitForTimeout(1500)
  await shot(page, 'watch')

  await ctx.close()
})
