import { expect, test } from '@playwright/test'
import { seedApp, firstRunOverlayKeys } from './helpers'
import { generateIdentity } from '../src/identity.cjs'

import { legalVersionKey } from '../src/legal/documents'

// Release-1.0 social-suite journeys (plan P4.1).
// SWs blocked: service-worker caching breaks route mocks + identity seeding
// determinism (same reason as journeys.spec.ts).
test.use({ contextOptions: { serviceWorkers: 'block' } })

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// Register a fresh identity with the dev API + seed the shell's local state,
// then drive it from its own page context (orbitAuth auto-creates Users rows).
async function newPeerContext(page: import('@playwright/test').Page, name: string) {
  const id = generateIdentity()
  const ctx = await page.context().browser()!.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.addInitScript(
    ([i, n, legalKey, overlayKeys]: [Record<string, unknown>, string, string, [string, string][]]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(i))
      localStorage.setItem('goonMatch_age_verified', 'true')

      localStorage.setItem('orbit_legal_accepted', legalKey)

      localStorage.setItem('orbit_display_name', n)
      localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
      // Same first-run overlay dismissal as seedApp. Missing it put a z-120
      // "What's New" modal over the feed, so the peer's clicks went nowhere.
      for (const [k, v] of overlayKeys) localStorage.setItem(k, v)
    },
    [id, name, legalVersionKey(), firstRunOverlayKeys(id.orbitId)],
  )
  return { ctx, p, id }
}

async function publishPost(page: import('@playwright/test').Page, caption: string) {
  await page.goto('/#/feed')
  await composePost(page, caption)
  await page.waitForTimeout(3500) // outlast the 3s orbitFetch GET cache
  await page.reload()
  await expect(page.getByText(caption).first()).toBeVisible({ timeout: 20_000 })
}

/** The composer flow, usable from any page (a peer's context included). */
async function composePost(page: import('@playwright/test').Page, caption: string) {
  await page.getByRole('button', { name: 'Create Post', exact: true }).click()
  const drop = page.getByText('Drag & drop photos or click to browse')
  await expect(drop).toBeVisible({ timeout: 20_000 })
  // Real user flow: clicking the dropzone opens the OS file chooser; other
  // hidden inputs on the page make setInputFiles().first() ambiguous.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    drop.click(),
  ])
  await chooser.setFiles({ name: 'e2e-post.png', mimeType: 'image/png', buffer: PNG_1x1 })
  // The 1.0.x composer crops every upload: apply the default crop first.
  const apply = page.getByRole('button', { name: 'Apply', exact: true })
  await expect(apply).toBeVisible({ timeout: 10_000 })
  await apply.click()
  await page.getByPlaceholder('Write a caption...').fill(caption)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText('Post shared.')).toBeVisible({ timeout: 20_000 })
}

/** Profile stats render <div><span>{value}</span><span>{label}</span></div>. */
async function statValue(page: import('@playwright/test').Page, label: string) {
  const el = page.getByText(label, { exact: true }).first()
  return ((await el.locator('xpath=preceding-sibling::span[1]').textContent()) || '').trim()
}

test('journey 1: publish a post from Create and see it in the feed', async ({ page }) => {
  await seedApp(page)
  await publishPost(page, `e2e post ${Date.now()}`)
})

test('journey 2: like + comment round trip on a post', async ({ page }) => {
  await seedApp(page)
  const caption = `comment target ${Date.now()}`
  await publishPost(page, caption)
  await page.locator('button[aria-label="Like post"]').first().click()
  // Comment button opens the post lightbox; the lightbox carries its own
  // comment composer (CommentsModal's placeholder lives in the DM/chat sheet).
  await page.locator('button[aria-label="Comment"]').first().click()
  const box = page.getByPlaceholder('Add a comment...')
  await expect(box).toBeVisible({ timeout: 15_000 })
  const text = `e2e comment ${Date.now()}`
  await box.fill(text)
  await box.press('Enter')
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 })
})

// The comment list used to be read from a map seeded off `post.comments`, which
// no feed endpoint returns, and the only fetch in the app was keyed on a state
// that was never assigned a post id. So EVERY post read "No comments yet" and
// the assertion above passed purely on an optimistic local append that never
// touched the server. Reopening the lightbox after a reload is what proves the
// list is actually read back.
test('journey 2b: a comment survives a reload and reappears in the lightbox', async ({ page }) => {
  // Publish + comment + reload + reopen is more work than any other journey.
  test.slow()
  await seedApp(page)
  const caption = `comment reload ${Date.now()}`
  await publishPost(page, caption)
  const text = `persisted comment ${Date.now()}`
  // Scope to THIS post's card. The feed can hold several posts with one
  // comment, so a bare `.first()` on "View all N comments" can open someone
  // else's post.
  const card = page.locator('article').filter({ hasText: caption }).first()

  await card.locator('button[aria-label="Comment"]').click()
  const box = page.getByPlaceholder('Add a comment...')
  await expect(box).toBeVisible({ timeout: 15_000 })
  await box.fill(text)
  await box.press('Enter')
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 })

  // Reload: nothing survives in React state, so the comment can only come back
  // from GET /api/posts/:id/comments. (persistComment invalidates that path, so
  // the 3s response cache cannot serve the pre-comment list here.)
  await page.reload()
  const cardAfter = page.locator('article').filter({ hasText: caption }).first()
  await expect(cardAfter).toBeVisible({ timeout: 20_000 })
  // The card must advertise the real count from the server, not "Add a
  // comment…" — that gate used to read the always-empty local map.
  const viewAll = cardAfter.getByRole('button', { name: /View all 1 comment/ })
  await expect(viewAll).toBeVisible({ timeout: 20_000 })

  await viewAll.click()
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 })
  // Server timestamps render as relative time, not a raw SQLite string.
  await expect(page.getByText('just now').first()).toBeVisible({ timeout: 10_000 })
})

test('journey 3: DM a peer and both sides see the message', async ({ page }) => {
  await seedApp(page)
  const peerName = `E2E Peer ${Date.now()}`
  const { ctx: ctxB, p: pageB } = await newPeerContext(page, peerName)
  await pageB.goto('/#/profile')
  await expect(pageB.getByText(peerName).first()).toBeVisible({ timeout: 25_000 })

  await page.goto('/#/messages')
  // '#/messages' resolves straight to the unified rooms/chat view (App maps
  // messages -> rooms), so there is no "Open rooms →" interstitial any more.
  const search = page.getByPlaceholder('Search...')
  await expect(search).toBeVisible({ timeout: 20_000 })
  await search.fill(peerName)
  const peerRow = page.getByText(peerName).first()
  await expect(peerRow).toBeVisible({ timeout: 20_000 })
  await peerRow.click()
  const msg = `ping ${Date.now()}`
  const composer = page.getByPlaceholder(/^Message /).or(page.getByPlaceholder('Message...'))
  await composer.fill(msg)
  await page.keyboard.press('Enter')
  await expect(page.getByText(msg).first()).toBeVisible({ timeout: 15_000 })

  await pageB.goto('/#/messages')
  await expect(pageB.getByText(msg).first()).toBeVisible({ timeout: 25_000 })
  await ctxB.close()
})

test('journey 4: view a post author profile from the feed', async ({ page }) => {
  // Share-DM + permalink are covered by RTL (SharePostModal.test) and the pm
  // round trip by journey 3; this closes the profile-viewing loop instead of
  // a contrived follow-seeding dance.
  await seedApp(page)
  const caption = `profile probe ${Date.now()}`
  await publishPost(page, caption)
  // Open the author from that post's own card. (The caption is not a click
  // target — clicking it does not open the lightbox.)
  const card = page.locator('article').filter({ hasText: caption }).first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  const author = card.getByRole('button', { name: /^View profile of |^Watch story of / }).first()
  await expect(author).toBeVisible({ timeout: 15_000 })
  await author.click()
  // The post's author is ME here, so the profile modal correctly has no Follow
  // button (onToggleFollow is undefined for self). Assert the modal opened.
  await expect(page.getByRole('dialog', { name: /^Profile of / })).toBeVisible({ timeout: 15_000 })
})

test('journey 4b: a new follower updates my "followers" count on the profile tab', async ({ page }) => {
  test.setTimeout(180_000)
  await seedApp(page)
  const peerName = `E2E Follower ${Date.now()}`
  const { ctx: ctxB, p: pageB } = await newPeerContext(page, peerName)
  const caption = `follow target ${Date.now()}`
  await publishPost(page, caption)

  // The peer opens my profile from my post's card and follows me.
  await pageB.goto('/#/feed')
  const card = pageB.locator('article').filter({ hasText: caption }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  const authorBtn = card.getByRole('button', { name: /^View profile of |^Watch story of / }).first()
  await expect(authorBtn).toBeVisible({ timeout: 20_000 })
  // force: the feed re-renders on every roster poll / WS frame, so Playwright's
  // stability check never settles on this second page and the click hangs until
  // the test times out. The element is present and visible; skip only the
  // actionability wait.
  await authorBtn.click({ force: true })
  await expect(pageB.getByRole('dialog', { name: /^Profile of / })).toBeVisible({ timeout: 20_000 })
  await pageB.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(pageB.getByRole('button', { name: 'Following', exact: true })).toBeVisible({ timeout: 20_000 })

  // My own profile, opened with NO manual reload. Regression: the tab read
  // followers_count from a cached roster refreshed only every 60-120s, and for
  // anyone outside the server's capped directory it fell through to
  // likes_received (or a hardcoded 0) and never moved at all.
  await page.goto('/#/profile')
  await expect.poll(() => statValue(page, 'followers'), { timeout: 45_000 }).toBe('1')
  await ctxB.close()
})

test('journey 5: store renders priced items from the server', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/store')
  await expect(page.locator('text=/g\\$\\s?[\\d.,]+/').first()).toBeVisible({ timeout: 25_000 })
})

// The admin suite is a PIN-gated MODAL opened from the HUD, not a route.
// It used to be '#/admin', and that route was left registered after it became
// a modal — so it resolved to a view with no render branch (blank stage) and
// persisted into orbit_main_view. This journey drives the real entry point.
test('journey 6: admin panel opens from the HUD and shows the PIN gate', async ({ page }) => {
  await seedApp(page)
  await page.goto('/#/grid')
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(page.getByText('Admin Operations')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByPlaceholder('Secret Passcode')).toBeVisible()
})
