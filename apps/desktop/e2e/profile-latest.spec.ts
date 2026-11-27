import { expect, test } from '@playwright/test'
import { seedApp, expectToast } from './helpers'

test.use({ contextOptions: { serviceWorkers: 'block' } })

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Real composer flow: open Create Post, attach a real image, apply crop,
 *  caption + share. Mirrors social.spec.ts. */
async function publishPost(page: import('@playwright/test').Page, caption: string) {
  await page.getByRole('button', { name: 'Create a post', exact: true }).click()
  // One media picker for every entry point: choose Upload, then drop.
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const drop = page.getByText('Drop a file, click to browse, or paste from the clipboard')
  await expect(drop).toBeVisible({ timeout: 20_000 })
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    drop.click(),
  ])
  await chooser.setFiles({ name: 'profile-post.png', mimeType: 'image/png', buffer: PNG_1x1 })
  const apply = page.getByRole('button', { name: 'Use this media', exact: true })
  await expect(apply).toBeVisible({ timeout: 10_000 })
  await apply.click()
  await page.getByPlaceholder('Write a caption...').fill(caption)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expectToast(page, 'Post shared.')
}

/** A profile grid tile that rendered media successfully: visible image, never
 *  "No preview", backed by a real src. */
async function expectProfileMediaTile(media: import('@playwright/test').Locator) {
  await expect(media).toBeVisible({ timeout: 20_000 })
  const parent = media.locator('..')
  await expect(parent).not.toContainText('No preview', { timeout: 20_000 })
  const src = await media.getAttribute('src')
  expect(src).toBeTruthy()
  expect(String(src)).not.toContain('No preview')
}

test('profile: own published post with real bytes appears on the profile grid', async ({
  page,
}) => {
  await seedApp(page)
  await page.goto('/#/feed')

  // Publish one post with real bytes so the profile has something to show.
  await publishPost(page, `e2e profile post ${Date.now()}`)

  // Navigate to the own profile.
  await page.goto('/#/profile')

  // The profile grid should render the post's media tile (blob URL from
  // signed object fetch). Wait for it to appear.
  const tiles = page.locator('.aspect-square').locator('img, video')
  await expect(tiles.first()).toBeVisible({ timeout: 20_000 })
  await expectProfileMediaTile(tiles.first())
})

test('profile: images survive a reload on the own profile', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/feed')

  await publishPost(page, `e2e profile reload post ${Date.now()}`)

  await page.goto('/#/profile')
  const tilesBefore = page.locator('.aspect-square').locator('img, video')
  await expect(tilesBefore.first()).toBeVisible({ timeout: 20_000 })

  await page.reload()
  await page.goto('/#/profile')

  const tilesAfter = page.locator('.aspect-square').locator('img, video')
  await expect(tilesAfter.first()).toBeVisible({ timeout: 20_000 })
  await expectProfileMediaTile(tilesAfter.first())
})
