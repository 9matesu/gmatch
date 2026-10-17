import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { seedApp } from './helpers'

// Profile before/after captures at fixed viewports. wcag-audit.spec.ts already
// shoots 10_profile, but it gates on a bare waitForTimeout, which is exactly
// the anti-pattern button-audit.spec.ts calls out: it screenshots whatever
// happens to be on screen, including nothing. This gates on the profile's own
// Edit profile control, so the frame is the real page or a hard failure.
// The feed block below shares the harness: it route-mocks the /api/posts
// collection (same pattern as engagement.spec.ts) with synthetic SVG posts so
// a populated card can be captured without depending on the composer UI.
const OUT_DIR = join(process.cwd(), 'test-results', 'profile-shots')
mkdirSync(OUT_DIR, { recursive: true })

const VIEWPORTS = [
  { name: 'wide', width: 1366, height: 860 },
  { name: 'narrow', width: 390, height: 844 },
]

/** seedApp pins the changelog marker one version back, so the What's New
 *  modal opens over the profile. It mounts after first paint, so this is only
 *  meaningful once the page itself is up. */
async function dismissChangelog(page: import('@playwright/test').Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' })
  await gotIt.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click()
  await expect(gotIt).toBeHidden({ timeout: 5_000 })
}

/** Bright, busy SVG wallpaper: the contrast stress case translucent surfaces
 *  fail against. data: URLs render directly (App resolveWallpaperUrl), so no
 *  byte pipeline is involved. Merges into goonmatch-settings; call after
 *  seedApp (both are init scripts, registration order = run order). */
const WALLPAPER_URL = (() => {
  const shapes = Array.from({ length: 28 }, (_, i) => {
    const x = (i * 173) % 1600
    const y = (i * 251) % 900
    const r = 40 + ((i * 37) % 120)
    const c = ['#ffffff', '#fef9c3', '#cffafe', '#fce7f3', '#fef3c7'][i % 5]
    return `<circle cx='${x}' cy='${y}' r='${r}' fill='${c}' opacity='0.85'/>`
  }).join('')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'><defs><linearGradient id='w' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#f8fafc'/><stop offset='0.5' stop-color='#e0f2fe'/><stop offset='1' stop-color='#fef9c3'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#w)'/>${shapes}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})()

async function seedWallpaper(page: import('@playwright/test').Page) {
  await page.addInitScript((url: string) => {
    try {
      const raw = localStorage.getItem('goonmatch-settings')
      const s = raw ? JSON.parse(raw) : {}
      s.wallpaperUrl = url
      s.wallpaperPreset = 'custom'
      s.wallpaperFit = 'cover'
      s.wallpaperMime = 'image/svg+xml'
      localStorage.setItem('goonmatch-settings', JSON.stringify(s))
    } catch { /* seed best-effort; capture asserts the real page */ }
  }, WALLPAPER_URL)
}

test.describe('profile capture', () => {
  test.setTimeout(180_000)


  for (const vp of VIEWPORTS) {
    test(`${vp.name} ${vp.width}x${vp.height}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: vp.width, height: vp.height },
      })
      const page = await ctx.newPage()
      await seedApp(page)
      await page.goto('/#/profile')
      await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible({ timeout: 30_000 })
      await dismissChangelog(page)
      await page.screenshot({ path: join(OUT_DIR, `${vp.name}.png`), fullPage: false })
      await ctx.close()
    })
  }

  test('empty states', async ({ browser }) => {
    const ctx = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1366, height: 860 },
    })
    const page = await ctx.newPage()
    await seedApp(page)
    await page.goto('/#/profile')
    const postsTab = page.getByRole('tab', { name: /Posts/ })
    await expect(postsTab).toBeVisible({ timeout: 30_000 })
    await dismissChangelog(page)
    for (const tab of ['Saved', 'Reposts', 'Cards']) {
      await page.getByRole('tab', { name: new RegExp(tab) }).click()
      await page.getByRole('tabpanel').waitFor({ state: 'visible' })
      await page.screenshot({ path: join(OUT_DIR, `empty-${tab.toLowerCase()}.png`), fullPage: false })
    }
    await ctx.close()
  })
})

/** Synthetic feed posts with real aspect ratios. SVG data URLs render
 *  straight through CachedImg with no signed fetch, so the card layout
 *  (typography, actions, counts, caption, tags) can be captured without
 *  depending on the composer UI. */
function svgPost(w: number, h: number, c1: string, c2: string, label: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='52%' font-family='sans-serif' font-size='42' fill='white' text-anchor='middle'>${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

test.describe('feed capture', () => {  test.setTimeout(180_000)

  for (const vp of VIEWPORTS) {
    test(`feed ${vp.name} ${vp.width}x${vp.height}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: vp.width, height: vp.height },
      })
      const page = await ctx.newPage()
      await seedApp(page)
      const now = new Date().toISOString()
      await page.route('**/api/posts?*', (route) =>
        route.fulfill({
          json: {
            posts: [
              {
                id: 'shot-landscape', author_id: 'shot-mira', author_name: 'Mira Voss',
                url: svgPost(1200, 675, '#3b1d5e', '#0ea5e9', '16:9'),
                mime_type: 'image/svg+xml',
                caption: 'Rooftop session after the rain. The whole city was glowing and nobody wanted to go home yet.',
                location: 'Neo-Kyoto', tags: ['nightcity', 'neon'],
                created_at: now, like_count: 128,
                likers: [{ user_id: 'u-jon', display_name: 'Jon' }, { user_id: 'u-ada', display_name: 'Ada' }],
                comment_count: 4,
              },
              {
                id: 'shot-portrait', author_id: 'shot-theo', author_name: 'Theo Marchetti',
                url: svgPost(768, 1024, '#7c2d12', '#f59e0b', '3:4'),
                mime_type: 'image/svg+xml', caption: 'Golden hour, no filter.',
                tags: ['portrait'], created_at: now, like_count: 7, comment_count: 0,
              },
              {
                id: 'shot-square', author_id: 'shot-ada', author_name: 'Ada Okafor',
                url: svgPost(800, 800, '#064e3b', '#34d399', '1:1'),
                mime_type: 'image/svg+xml',
                created_at: now, like_count: 0, comment_count: 0,
              },
            ],
          },
        }))
      await page.goto('/#/feed')
      await expect(page.getByRole('button', { name: 'For You', exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('article').first()).toBeVisible({ timeout: 30_000 })
      await dismissChangelog(page)
      await page.screenshot({ path: join(OUT_DIR, `feed-${vp.name}.png`), fullPage: false })
      // Second frame partway down the first card: header scrolls off, the
      // action row, counts, caption and tags are what this frame verifies.
      await page.locator('article').first().scrollIntoViewIfNeeded()
      await page.mouse.wheel(0, 420)
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(OUT_DIR, `feed-${vp.name}-actions.png`), fullPage: false })
      await ctx.close()
    })
  }
})

/** Store captures: seeded empty state, plus a populated variant with the
 *  /api/cards collection and /api/cards/market routes mocked (market pattern
 *  first: Playwright serves the first matching route). Artwork is SVG data
 *  URLs so tiles render with no signed fetch. */
const storeCard = (over: Record<string, unknown> = {}) => ({
  id: 'card-9',
  creatorId: 'creator-1',
  mediaObjectId: 'obj-9',
  name: 'Rare Find',
  tags: [],
  description: null,
  frame: 'chrome',
  accentColor: '#fff',
  rarity: 'gold',
  value: 900,
  likeCount: 0,
  marketStatus: 'none',
  moderationState: 'active',
  ownerId: 'me-1',
  ownerName: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  contentUrl: svgPost(800, 800, '#064e3b', '#34d399', 'gold'),
  mimeType: 'image/svg+xml',
  ...over,
})

async function mockStore(page: import('@playwright/test').Page, cards: unknown[], listings: unknown[]) {
  // Non-overlapping patterns: the collection fetch is a bare /api/cards with
  // no query string, so anchor it at end-of-path instead of overlapping the
  // market pattern (route precedence between overlapping globs is not a
  // contract worth depending on).
  await page.route('**/api/cards/market*', (route) => route.fulfill({ json: { listings } }))
  await page.route('**/api/cards', (route) => route.fulfill({ json: { cards } }))
}

test.describe('store capture', () => {
  test.setTimeout(180_000)

  for (const vp of VIEWPORTS) {
    test(`store empty ${vp.name} ${vp.width}x${vp.height}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: vp.width, height: vp.height },
      })
      const page = await ctx.newPage()
      await seedApp(page)
      await page.goto('/#/store')
      await expect(page.getByRole('heading', { name: 'Community Market' })).toBeVisible({ timeout: 30_000 })
      await dismissChangelog(page)
      await page.screenshot({ path: join(OUT_DIR, `store-empty-${vp.name}.png`), fullPage: false })
      await ctx.close()
    })

    test(`store populated ${vp.name} ${vp.width}x${vp.height}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: vp.width, height: vp.height },
      })
      const page = await ctx.newPage()
      await seedApp(page)
      await mockStore(
        page,
        [
          storeCard({}),
          storeCard({ id: 'card-10', name: 'Neon Drift', rarity: 'diamond', value: 5200, contentUrl: svgPost(800, 800, '#3b1d5e', '#0ea5e9', 'diamond') }),
          storeCard({ id: 'card-11', name: null, rarity: 'common', value: 40, contentUrl: svgPost(800, 800, '#7c2d12', '#f59e0b', 'common') }),
        ],
        [
          { listingId: 'l1', cardId: 'card-9', price: 500, sellerId: 'seller-1', sellerName: 'Ada', card: storeCard({ marketStatus: 'listed' }) },
        ],
      )
      await page.goto('/#/store')
      await expect(page.getByText('Rare Find').first()).toBeVisible({ timeout: 30_000 })
      await dismissChangelog(page)
      await page.screenshot({ path: join(OUT_DIR, `store-${vp.name}.png`), fullPage: false })
      await ctx.close()
    })
  }
})

/** Wallpaper contrast proofs: same pages as above but with the bright
 *  wallpaper seeded, so a translucent surface fails visibly and an opaque
 *  one reads. */
test.describe('wallpaper contrast', () => {
  test.setTimeout(180_000)

  test('profile wide wallpaper', async ({ browser }) => {
    const ctx = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1366, height: 860 },
    })
    const page = await ctx.newPage()
    await seedApp(page)
    await seedWallpaper(page)
    await page.goto('/#/profile')
    await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible({ timeout: 30_000 })
    await dismissChangelog(page)
    await page.screenshot({ path: join(OUT_DIR, 'profile-wallpaper.png'), fullPage: false })
    await ctx.close()
  })

  test('store wide wallpaper', async ({ browser }) => {
    const ctx = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1366, height: 860 },
    })
    const page = await ctx.newPage()
    await seedApp(page)
    await seedWallpaper(page)
    await mockStore(
      page,
      [storeCard({}), storeCard({ id: 'card-10', name: 'Neon Drift', rarity: 'diamond', value: 5200 })],
      [],
    )
    await page.goto('/#/store')
    await expect(page.getByRole('heading', { name: 'Community Market' })).toBeVisible({ timeout: 30_000 })
    await dismissChangelog(page)
    await page.screenshot({ path: join(OUT_DIR, 'store-wallpaper.png'), fullPage: false })
    await ctx.close()
  })
})
