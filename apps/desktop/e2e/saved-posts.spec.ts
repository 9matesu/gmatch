import { expect, test, type Page } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * A saved post must actually land in the profile "Saved" tab.
 *
 * The load-bearing bug this pins: the tab was fed by
 * `feedPosts.filter((p) => p.is_saved)` — the 50-row TIMELINE snapshot. A post
 * saved yesterday that fell out of the feed was invisible, and the tab read
 * "No saved posts" forever. The save itself worked (the node had the row); the
 * LIST was derived from the wrong source.
 *
 * The node is the authority, so the tab now reads its own query (`?saved=1`).
 *
 * The post is published through the app's OWN signed API rather than the
 * composer: the composer's media picker is a hover/click bubble that every
 * e2e spec in this repo already fails on. What is under test here is the
 * SAVE -> Saved tab path, so the publish step must not be the flaky part.
 */

test.use({ contextOptions: { serviceWorkers: 'block' } })
test.setTimeout(120_000)

const PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Publish one public post with real bytes through the app's own signed path. */
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

/** The tile inside the profile "Saved" tab. */
function savedTile(page: Page, id: string) {
  return page.locator(`div.grid.grid-cols-3 [data-post-id="${id}"]`)
}

/** What the NODE serves for the saved list, read through the signed API. */
async function nodeSavedIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const mod = await import('/src/utils/api.ts')
    const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const res = await mod.orbitFetch('/api/posts?saved=1&limit=200&sort=latest', {}, ident)
    if (!res.ok) throw new Error(`saved list failed: ${res.status}`)
    const data = await res.json()
    return (data.posts || []).map((p: { id: string }) => p.id)
  })
}

test('a saved post shows up in the profile Saved tab, and un-saving removes it', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/feed')
  const id = await test.step('publish through the signed API', () =>
    publishViaApi(page, `e2e saved ${Date.now()}`),
  )

  // It reaches the timeline.
  await test.step('it reaches the timeline', async () => {
    await page.reload()
    await page.goto('/#/feed')
    const card = page.locator(`article[data-post-id="${id}"]`)
    await expect(card).toBeVisible({ timeout: 30_000 })
  })

  // Save it through the real UI.
  await test.step('save through the timeline UI', async () => {
    const card = page.locator(`article[data-post-id="${id}"]`)
    const save = card.getByRole('button', { name: 'Save post' })
    await expect(save).toBeVisible({ timeout: 20_000 })
    await save.click()
  })

  // The node records it.
  await test.step('the node records the save', async () => {
    await expect
      .poll(async () => (await nodeSavedIds(page)).includes(id), { timeout: 20_000 })
      .toBe(true)
  })

  // THE PROOF: the profile "Saved" tab lists it.
  await test.step('the profile Saved tab lists it', async () => {
    await page.goto('/#/profile')
    const tab = page.getByRole('button', { name: /saved/i })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()
    await expect(savedTile(page, id)).toBeVisible({ timeout: 30_000 })
  })

  // Un-saving through the same UI removes it again.
  await test.step('un-save removes it from the tab', async () => {
    await page.goto('/#/feed')
    const save = page.locator(`article[data-post-id="${id}"]`).getByRole('button', { name: 'Save post' })
    await expect(save).toBeVisible({ timeout: 20_000 })
    await save.click()

    await page.goto('/#/profile')
    const tab = page.getByRole('button', { name: /saved/i })
    await tab.click()
    await expect(savedTile(page, id)).toHaveCount(0, { timeout: 30_000 })
    expect(await nodeSavedIds(page)).not.toContain(id)
  })
})
