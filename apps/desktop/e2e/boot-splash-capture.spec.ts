// One-off capture of the ONE boot screen, exactly as it paints before the
// bundle: JavaScript disabled, so this is the static shell in index.html —
// the gMatch brand lockup and the live status label, in the self-hosted
// Switzer face. Run: npx playwright test boot-splash-capture
import { test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../test-results/', import.meta.url))
mkdirSync(OUT, { recursive: true })

test('capture the boot splash', async ({ browser }) => {
  const ctx = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 800 },
  })
  const page = await ctx.newPage()
  await page.goto('/')
  await page.getByText('gMatch', { exact: true }).waitFor({ timeout: 5_000 })
  await page.screenshot({ path: `${OUT}boot-splash.png` })
  console.log('captured test-results/boot-splash.png')
  await ctx.close()
})