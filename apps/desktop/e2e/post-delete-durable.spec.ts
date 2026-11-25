import { expect, test, type Page } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * A deleted post must stay deleted — for good.
 *
 * The load-bearing bug this pins: the tombstone lived in localStorage but the
 * app kept its own React copy of the set, and that copy started EMPTY on every
 * launch. The feed projection filters by that copy, so a post deleted in one
 * session reappeared on the profile in the next one — "I deleted it and it is
 * on my profile again". The server had really removed the row (the API test
 * proves that), so nothing brought it back except the client's own tombstone
 * bookkeeping.
 *
 * The proof is the RELOAD: a tombstone that only lives in React dies with the
 * page, and a delete that only hides a row is not a delete.
 *
 * The post is published through the app's OWN signed API (`orbitFetch` →
 * `POST /api/objects`), not through the composer: the composer's media picker
 * is a hover/click bubble that every e2e spec in this repo already fails on
 * (the "Post shared." toast lives inside the collapsed notification panel, so
 * it is never visible). What is under test here is the DELETE, so the publish
 * step must not be the flaky part. The delete itself goes through the real
 * profile UI.
 */

test.use({ contextOptions: { serviceWorkers: 'block' } })
test.setTimeout(120_000)

const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * Publish one public post with real bytes through the app's own signed path.
 * Returns the node's object id (the id every read path uses).
 *
 * Every await carries its own budget: a hung evaluate would otherwise burn
 * the whole test timeout with no clue about which step was stuck.
 */
async function publishViaApi(page: Page, caption: string): Promise<string> {
  return page.evaluate(
    async ({ cap, b64 }) => {
      const withBudget = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
        ])
      const mod = await withBudget(import('/src/utils/api.ts'), 20_000, 'import api.ts')
      const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
      if (!ident?.orbitId) throw new Error('no identity in localStorage')
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append('image', new File([bytes], 'e2e.png', { type: 'image/png' }))
      form.append('is_public', '1')
      form.append('post_caption', cap)
      form.append('post_group', crypto.randomUUID())
      const res = await withBudget(
        mod.orbitFetch('/api/objects', { method: 'POST', body: form }, ident),
        30_000,
        'POST /api/objects',
      )
      const text = await res.text()
      if (!res.ok) throw new Error(`publish failed: ${res.status} ${text.slice(0, 200)}`)
      const data = JSON.parse(text)
      if (!data?.id) throw new Error(`publish returned no id: ${text.slice(0, 200)}`)
      return String(data.id)
    },
    { cap: caption, b64: PNG_1x1_B64 },
  )
}

/** The profile grid tile that renders this post. */
function profileTile(page: Page, id: string) {
  return page.locator(`div.grid.grid-cols-3 [data-post-id="${id}"]`)
}

/** What the NODE serves for this post, read through the app's signed API. */
async function nodeView(page: Page, id: string) {
  return page.evaluate(async (postId: string) => {
    const mod = await import('/src/utils/api.ts')
    const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const feed = await (await mod.orbitFetch('/api/posts?limit=50&sort=latest', {}, ident)).json()
    const profile = await (
      await mod.orbitFetch(`/api/posts?author_id=${ident.orbitId}&limit=200&sort=latest`, {}, ident)
    ).json()
    const detail = await mod.orbitFetch(`/api/posts/${postId}`, {}, ident)
    return {
      inFeed: (feed.posts || []).some((p: { id: string }) => p.id === postId),
      inProfile: (profile.posts || []).some((p: { id: string }) => p.id === postId),
      detailStatus: detail.status,
    }
  }, id)
}

/** Delete the post with the given id through the real profile UI. */
async function deleteThroughProfileUi(page: Page, id: string): Promise<void> {
  await page.goto('/#/profile')
  const tile = profileTile(page, id)
  await expect(tile).toBeVisible({ timeout: 30_000 })
  await tile.click()
  const options = page.getByRole('button', { name: 'Post options' })
  await expect(options).toBeVisible({ timeout: 20_000 })
  await options.click()
  const del = page.getByRole('button', { name: 'Delete Post' })
  await expect(del).toBeVisible({ timeout: 20_000 })
  await del.click()
}

test('a deleted post is gone for good: it does not come back on the profile after a reload', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/feed')
  const id = await test.step('publish through the signed API', () =>
    publishViaApi(page, `e2e delete ${Date.now()}`),
  )

  // It reaches the profile (a reload re-reads the node).
  await test.step('it reaches the profile', async () => {
    await page.reload()
    await page.goto('/#/profile')
    await expect(profileTile(page, id)).toBeVisible({ timeout: 30_000 })
  })

  await test.step('delete through the profile UI', () => deleteThroughProfileUi(page, id))

  // Gone from the profile right away.
  await test.step('gone from the profile right away', async () => {
    await expect(profileTile(page, id)).toHaveCount(0, { timeout: 20_000 })
  })

  // THE PROOF: a reload. The tombstone must be re-read from durable storage,
  // or the post is back on the profile.
  await test.step('still gone after a reload', async () => {
    await page.reload()
    await page.goto('/#/profile')
    await expect(profileTile(page, id)).toHaveCount(0, { timeout: 30_000 })
  })

  // And it is gone from the timeline too.
  await test.step('gone from the timeline too', async () => {
    await page.goto('/#/feed')
    await expect(page.locator(`article[data-post-id="${id}"]`)).toHaveCount(0, { timeout: 20_000 })
  })
})

test('a deleted post is really gone from the node: no read path lists it', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/feed')
  const id = await test.step('publish through the signed API', () =>
    publishViaApi(page, `e2e delete server ${Date.now()}`),
  )

  await test.step('it reaches the profile', async () => {
    await page.reload()
    await page.goto('/#/profile')
    await expect(profileTile(page, id)).toBeVisible({ timeout: 30_000 })
  })

  await test.step('delete through the profile UI', () => deleteThroughProfileUi(page, id))

  // The node no longer serves it: the feed, the profile query and the detail.
  await test.step('the node does not serve it anymore', async () => {
    expect(await nodeView(page, id)).toEqual({ inFeed: false, inProfile: false, detailStatus: 404 })
  })
})
