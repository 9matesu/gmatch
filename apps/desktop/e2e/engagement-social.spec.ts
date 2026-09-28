import { expect, test, type Page } from '@playwright/test'
import { seedApp } from './helpers'
import { generateIdentity } from '../src/identity.cjs'
import { legalVersionKey } from '../src/legal/documents'

// Instagram-style engagement: a like must actually reach the author's bell,
// and the post must name who liked it.
//
// The load-bearing bug this pins: routes/posts.ts selected only `id` and then
// read `owner_id` off that row, so the notification guard was permanently
// false — liking a feed post wrote nothing and pushed nothing. Same defect on
// the comment path.

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.use({ contextOptions: { serviceWorkers: 'block' } })

// Each test drives two browser contexts through a real publish (upload + crop)
// and a real like round trip, so the 30s default budget dies mid-click.
test.setTimeout(240_000)

/** A second signed-in identity in its own context (a peer, not a fixture). */
async function newPeer(browser: import('@playwright/test').Browser, name: string) {
  const id = generateIdentity()
  const ctx = await browser.newContext({ serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.addInitScript(
    ([i, n, legalKey]: [Record<string, unknown>, string, string]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(i))
      localStorage.setItem('goonMatch_age_verified', 'true')
      localStorage.setItem('orbit_legal_accepted', legalKey)
      localStorage.setItem('orbit_display_name', n)
      localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
      // Suppress the "What's New" modal, same as seedApp: it is a
      // pointer-events-blocking overlay over the feed.
      localStorage.setItem('gmatch_last_seen_changelog', '1.5.1')
    },
    [id, name, legalVersionKey()],
  )
  return { ctx, page, id }
}

/** Wait for the shell; the signed boot request registers the Users row. */
async function bootPeer(page: Page, name?: string) {
  await page.goto('/#/feed')
  await expect(page.getByRole('button', { name: 'Feed', exact: true }).first()).toBeVisible({
    timeout: 30_000,
  })
  if (!name) return
  // Same call the app makes when a user completes onboarding. Without it the
  // node has no display_name, every notification for this peer is titled
  // "Someone", and the activity fold collapses them into one actor.
  await page.evaluate(async (displayName: string) => {
    const mod = await import('/src/utils/api.ts')
    const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    await mod.orbitFetch('/api/users/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    }, ident)
  }, name)
}

/** The real composer flow (mirrors social.spec.ts, incl. the crop step). */
async function publishPost(page: Page, caption: string): Promise<void> {
  await page.goto('/#/feed')
  await page.getByRole('button', { name: 'Create Post', exact: true }).click()
  const drop = page.getByText('Drag & drop photos or click to browse')
  await expect(drop).toBeVisible({ timeout: 20_000 })
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), drop.click()])
  await chooser.setFiles({ name: 'e2e-post.png', mimeType: 'image/png', buffer: PNG_1x1 })
  const apply = page.getByRole('button', { name: 'Apply', exact: true })
  await expect(apply).toBeVisible({ timeout: 10_000 })
  await apply.click()
  await page.getByPlaceholder('Write a caption...').fill(caption)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText('Post shared.')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(3500) // outlast the 3s orbitFetch GET cache
}

/** Read a published post's id back through the app's own signed API. */
async function postIdFor(page: Page, caption: string): Promise<string> {
  return page.evaluate(async (cap: string) => {
    const mod = await import('/src/utils/api.ts')
    const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const res = await mod.orbitFetch('/api/posts?limit=50&sort=latest', {}, ident)
    const body = await res.json()
    const hit = (body.posts || []).find((p: { caption?: string | null }) => p.caption === cap)
    if (!hit) throw new Error(`published post not found in feed: ${cap}`)
    return String(hit.id)
  }, caption)
}

/** Open a post's lightbox deterministically via the app's own permalink. */
async function likePostFromPeer(peerPage: Page, postId: string) {
  await peerPage.goto(`/#/feed?post=${encodeURIComponent(postId)}`)
  const lightbox = peerPage.getByRole('dialog', { name: 'Post' })
  await expect(lightbox).toBeVisible({ timeout: 30_000 })
  await lightbox.getByRole('button', { name: 'Like post' }).click()
  await expect(lightbox.getByRole('button', { name: 'Unlike post' })).toBeVisible({ timeout: 20_000 })
}

/**
 * Wait for the AUTHOR's server-side view of the post to reach `expected` likes.
 * The heart flips on optimistic local state, so asserting the button proved
 * nothing; this polls the real count and turns a race into a wait.
 */
async function waitForLikeCount(page: Page, postId: string, expected: number) {
  await expect
    .poll(
      async () => page.evaluate(async (pid: string) => {
        const mod = await import('/src/utils/api.ts')
        const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
        const res = await mod.orbitFetch(`/api/posts/${pid}`, {}, ident)
        const b = await res.json()
        return Number(b.like_count || 0)
      }, postId),
      { timeout: 30_000, message: `post never reached ${expected} like(s)` },
    )
    .toBe(expected)
}

async function openNotifications(page: Page) {
  // The sidebar nav entry also answers "Notifications" but navigates to
  // Messages; the bell is the one that opens the panel.
  await page.locator('[data-notifications-toggle="true"]').click()
  await expect(page.getByText('Mark all read').first()).toBeVisible({ timeout: 20_000 })
}

test('a like notifies the author and names the liker on the post', async ({ page, browser }) => {
  await seedApp(page)
  const caption = `like me ${Date.now()}`
  await publishPost(page, caption)
  const postId = await postIdFor(page, caption)

  const likerName = `Liker ${Date.now()}`
  const { ctx: peerCtx, page: peerPage } = await newPeer(browser, likerName)
  await bootPeer(peerPage, likerName)
  await likePostFromPeer(peerPage, postId)
  await waitForLikeCount(page, postId, 1)
  // The liker themself only ever sees the bare count (a summary naming you is
  // noise), so the "Liked by" line is asserted on the AUTHOR's screen.
  await peerCtx.close()

  // Author view: the post names who liked it. The name itself is the server's
  // fallback handle — a synthetic peer context never pushes a real profile —
  // so assert the summary renders, not the handle.
  await page.goto('/#/feed')
  await page.reload()
  await expect(page.getByText(caption).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Liked by /i).first()).toBeVisible({ timeout: 30_000 })

  // And the bell carries it — this is what the owner_id bug killed.
  await openNotifications(page)
  await expect(page.getByText(/liked your post/i).first()).toBeVisible({ timeout: 30_000 })
})

test('three likers fold to "Liked by A, B and 1 other"', async ({ page, browser }) => {
  await seedApp(page)
  const caption = `three likes ${Date.now()}`
  await publishPost(page, caption)
  const postId = await postIdFor(page, caption)

  // Three, not two: with exactly 2 the summary is "Liked by A and B" (nothing
  // is left over), so only a third liker exercises the "and 1 other" tail.
  const names = ['Ada', 'Bo', 'Cy']
  let expected = 0
  for (const who of names) {
    expected += 1
    const peerName = `${who} ${Date.now()}`
    const { ctx, page: peerPage } = await newPeer(browser, peerName)
    await bootPeer(peerPage, peerName)
    await likePostFromPeer(peerPage, postId)
    await waitForLikeCount(page, postId, expected)
    await ctx.close()
  }

  // Author side: the post folds to "Liked by A, B and 1 other", and the bell
  // folds the three rows into "… and 2 others liked your post".
  await page.goto('/#/feed')
  await page.reload()
  await expect(page.getByText(caption).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Liked by .* and 1 other/i).first()).toBeVisible({ timeout: 30_000 })

  await openNotifications(page)
  await expect(page.getByText(/and 2 others liked your post/i).first()).toBeVisible({ timeout: 30_000 })
})
