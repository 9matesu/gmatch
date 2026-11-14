import { expect, test } from '@playwright/test'
import { seedApp } from './helpers'

test.use({ contextOptions: { serviceWorkers: 'block' } })

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Real composer flow: open Create Post, attach a real image, apply crop,
 *  caption + share. Mirrors social.spec.ts so this journey exercises the same
 *  path a real user takes. */
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
  await chooser.setFiles({ name: 'e2e-post.png', mimeType: 'image/png', buffer: PNG_1x1 })
  // The picker confirms the choice; the cropper only appears for an edit.
  const use = page.getByRole('button', { name: 'Use this media', exact: true })
  await expect(use).toBeVisible({ timeout: 10_000 })
  await use.click()
  await page.getByPlaceholder('Write a caption...').fill(caption)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText('Post shared.')).toBeVisible({ timeout: 20_000 })
}

/** A feed tile that rendered media successfully: visible, never "No preview",
 *  and backed by an  or  with a real src. */
async function expectMediaTile(card: import('@playwright/test').Locator) {
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card).not.toContainText('No preview', { timeout: 20_000 })
  const media = card.locator('img, video').first()
  await expect(media).toBeVisible({ timeout: 20_000 })
  const src = await media.getAttribute('src')
  expect(src).toBeTruthy()
  expect(String(src)).not.toContain('No preview')
}

test('feed: user enters, pulls latest posts, and sees them with images', async ({
  page,
}) => {
  await seedApp(page)
  await page.goto('/#/feed')

  // The feed opens on the timeline. If nothing exists yet, publish one post
  // with real bytes so there is something to pull.
  const postCount = await page.locator('article').count()
  if (postCount === 0) {
    await publishPost(page, `e2e feed post ${Date.now()}`)
    await page.waitForTimeout(3500) // outlast the 3s orbitFetch GET cache
    await page.reload()
  }

  // Pull the latest posts (the timeline renders server rows immediately).
  const cards = page.locator('article')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  expect(await cards.count()).toBeGreaterThan(0)

  // Every visible tile must show media, never fall back to "No preview".
  const count = await cards.count()
  for (let i = 0; i < count; i++) {
    await expectMediaTile(cards.nth(i))
  }
})

test('feed: images survive a reload (pulled posts stay visible)', async ({
  page,
}) => {
  await seedApp(page)
  await page.goto('/#/feed')

  // Publish one post with real bytes first.
  await publishPost(page, `e2e reload post ${Date.now()}`)
  await page.waitForTimeout(3500) // outlast the 3s orbitFetch GET cache

  // Reload: nothing survives in React state; images can only come back from
  // the signed object fetch / local vault.
  await page.reload()
  await page.waitForTimeout(2000)

  const cards = page.locator('article')
  await expect(cards.first()).toBeVisible({ timeout: 20_000 })
  await expectMediaTile(cards.first())
})
