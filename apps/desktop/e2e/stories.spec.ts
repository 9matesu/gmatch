import { expect, test } from '@playwright/test'
import { seedApp, mockBooruFeed } from './helpers'

// Stories tray: stale-first rendering, media preloading and the dead-story
// auto-skip. Before this, the tray blanked itself for the whole first fetch
// even though up to 200 rows were cached in localStorage, and every tap paid a
// cold signed fetch (a 6s watchdog could outlast a 5s story).

const STORY = {
  owner_id: 'user-9',
  display_name: 'Story Gal',
  pfp_url: null,
  mime_type: 'image/jpeg',
  view_count: 0,
}

test.use({ contextOptions: { serviceWorkers: 'block' } })

test('renders cached stories while the network revalidates', async ({ page }) => {
  await seedApp(page)
  await mockBooruFeed(page)
  const cached = [
    { ...STORY, id: 'cached-1', content_url: 'https://cdn.example/cached-1.jpg', created_at: new Date().toISOString() },
    { ...STORY, id: 'cached-2', content_url: 'https://cdn.example/cached-2.jpg', created_at: new Date().toISOString() },
  ]
  await page.addInitScript((rows: unknown[]) => {
    localStorage.setItem('orbit_cached_stories', JSON.stringify(rows))
  }, cached)
  // Hold the stories request open: whatever paints must come from the mirror.
  await page.route('**/api/objects/stories*', async (route) => {
    await new Promise((r) => setTimeout(r, 8000))
    await route.fulfill({ json: [] })
  })

  await page.goto('/#/feed')
  // The cached row is on screen well before the 8s request settles.
  await expect(page.getByText('Story Gal').first()).toBeVisible({ timeout: 15_000 })
})

test('preloads story media ahead of the tap', async ({ page }) => {
  await seedApp(page)
  await mockBooruFeed(page)
  const objectRequests: string[] = []
  page.on('request', (req) => {
    if (/\/api\/objects\/story-preload-1$/.test(req.url())) objectRequests.push(req.url())
  })
  // Serve the object bytes so the preload can complete.
  await page.route('**/api/objects/story-preload-1', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ) }),
  )
  await page.route('**/api/objects/stories*', (route) => route.fulfill({ json: [
    { ...STORY, id: 'story-preload-1', content_url: '/api/objects/story-preload-1', created_at: new Date().toISOString() },
  ] }))

  await page.goto('/#/feed')
  // The tray shows the story and its bytes were warmed without any tap.
  await expect(page.getByText('Story Gal').first()).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => objectRequests.length, { timeout: 20_000 }).toBeGreaterThan(0)
})

test('a dead story is skipped by its own clock', async ({ page }) => {
  await seedApp(page)
  await mockBooruFeed(page)
  await page.route('**/api/objects/stories*', (route) => route.fulfill({ json: [
    { ...STORY, id: 'story-dead', content_url: '/api/objects/story-dead', created_at: new Date().toISOString() },
    { ...STORY, id: 'story-alive', content_url: 'https://cdn.example/alive.jpg', created_at: new Date().toISOString() },
  ] }))
  // The first story's object never resolves: the unavailability watchdog
  // (4s for stories) must skip it instead of parking on a dead frame.
  await page.route('**/api/objects/story-dead', () => new Promise(() => {}))

  await page.goto('/#/feed')
  await page.getByText('Story Gal').first().click()
  // Second story becomes the active one.
  await expect.poll(async () => {
    const segs = await page.locator('[data-testid^="seg-fill-"]').count()
    return segs
  }, { timeout: 20_000 }).toBeGreaterThan(1)
})

// Regression. A zero-media P2P story stores its magnet URI in content_url (the
// node writes magnet_uri into the content_url column — objects.ts). The
// prefetcher used to pass content_url as the object id, and a magnet in a path
// is silently truncated at its `?`: the browser asked for
// /api/objects/magnet:?xt=…&dn=… so the node looked up the id "magnet:",
// returned 404, and the story tile died. Every other story spec here seeds the
// well-formed /api/objects/<id> shape, so the whole suite passed straight
// through this bug — hence a spec that seeds the magnet shape on purpose.
test('a magnet content_url is never requested as an object id', async ({ page }) => {
  await seedApp(page)
  await mockBooruFeed(page)
  const magnet = 'magnet:?xt=urn:btih:db08ff020a08003eee9d5b8c879a913fb082cf3f'
    + '&dn=story_1790520864986.jpg'
    + '&tr=wss%3A%2F%2Ftracker.openwebtorrent.com'

  // The story row is a real object (id + own content_url is the magnet); its
  // media must be fetched BY ID.
  await page.route('**/api/objects/story-magnet-1', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ) }),
  )
  await page.route('**/api/objects/stories*', (route) => route.fulfill({ json: [
    { ...STORY, id: 'story-magnet-1', content_url: magnet, created_at: new Date().toISOString() },
  ] }))

  const badRequests: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (/\/api\/objects\/magnet/i.test(url) || /\/api\/objects\/[^/?#]*[?&]/.test(url)) {
      badRequests.push(url)
    }
  })

  await page.goto('/#/feed')
  await expect(page.getByText('Story Gal').first()).toBeVisible({ timeout: 20_000 })
  // Give the preload a moment to (not) fire the bad request.
  await page.waitForTimeout(2500)

  expect(badRequests, 'a magnet/descriptor must never reach /api/objects/').toEqual([])
})
