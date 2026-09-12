// Engagement journey: For You default, cold-start nudge, sidebar logout.
import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'

test('feed defaults to For You pill', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/feed')
  const pill = page.getByRole('button', { name: 'For You', exact: true })
  await expect(pill).toBeVisible()
  await expect(pill).toHaveClass(/bg-glass-w12/)
})

test('empty timeline shows the cold-start nudge', async ({ page }) => {
  await seedApp(page)
  // Force an empty server feed without breaking profile fetches: only the
  // /api/posts collection route answers empty.
  await page.route('**/api/posts?*', (route) =>
    route.fulfill({ json: { posts: [] } }))
  await page.goto('/#/feed')
  await expect(page.getByText(/Empty in here\? Start posting/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Upload your first post/ })).toBeVisible()
})

test('sidebar logout opens the confirm dialog', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/feed')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByText('Sign out?')).toBeVisible()
})
