import { test, expect } from '@playwright/test'

// The boot shell is inline CSS in the HTML document: it must paint with NO
// JavaScript at all, because the bundle is exactly what is still loading when
// the user is looking at a blank window. That is the whole point of it.
test('the boot shell paints without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByText('gMatch', { exact: true })).toBeVisible({ timeout: 5_000 })
  await page.screenshot({ path: 'test-results/boot-shell.png' })
  // The shell is the first thing on screen: a mark, the word, and a bar.
  const box = await page.locator('#boot').boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(200)
  await context.close()
})

// And the app removes it once it has mounted (otherwise it would cover the UI).
test('the app removes the boot shell after mounting', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 30_000 })
})