import { expect, test, type Browser, type Page } from '@playwright/test'
import { firstRunOverlayKeys, seedApp } from './helpers'
import { generateIdentity } from '../src/identity.cjs'
import { legalVersionKey } from '../src/legal/documents'

/**
 * A follow made while the node cannot answer survives a restart.
 *
 * A follow is a signed operation and was committed durably, but nothing read it
 * back: `followingIds` came from `GET /api/users/:id/following` alone. With the
 * node unreachable the list came back empty, so a follow made offline was gone
 * on the next launch — the feed re-suggested people the player already follows
 * and every followed profile offered "Follow" again.
 *
 * The row is proved through a REAL product consequence: the empty feed's
 * "Or follow someone" suggestions exclude everybody you follow. Two peers are
 * online so the block keeps rendering; only the FOLLOWED one may disappear.
 */
test.setTimeout(240_000)

/** A second signed-in identity in its own context (a peer, not a fixture). */
async function newPeer(browser: Browser, name: string) {
  const id = generateIdentity()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.addInitScript(
    ([i, n, legalKey, overlayKeys]: [Record<string, unknown>, string, string, [string, string][]]) => {
      localStorage.setItem('orbit_identity', JSON.stringify(i))
      localStorage.setItem('goonMatch_age_verified', 'true')
      localStorage.setItem('orbit_legal_accepted', legalKey)
      localStorage.setItem('orbit_display_name', n)
      localStorage.setItem('orbit_tags', JSON.stringify(['e2e']))
      for (const [k, v] of overlayKeys) localStorage.setItem(k, v)
    },
    [id, name, legalVersionKey(), firstRunOverlayKeys(id.orbitId)],
  )
  return { ctx, page, id }
}

/** Boot the peer and register its Users row (the directory the suggestions read). */
async function bootPeer(page: Page, name: string) {
  await page.goto('/#/feed')
  await expect(page.getByRole('button', { name: 'Feed', exact: true }).first()).toBeVisible({
    timeout: 30_000,
  })
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

test('a follow made with the node unreachable survives a reload', async ({ browser, page }) => {
  const me = await seedApp(page, { displayName: 'Follow Tester' })

  const followedName = `Followed ${Date.now()}`
  const otherName = `Other ${Date.now()}`
  const followed = await newPeer(browser, followedName)
  const other = await newPeer(browser, otherName)
  await bootPeer(followed.page, followedName)
  await bootPeer(other.page, otherName)

  // The node cannot answer the follow graph at all: neither the write (so no
  // follower row is ever created) nor the read (so the node's list is empty).
  await page.route('**/api/users/*/follow', (route) => route.abort())
  await page.route('**/api/users/*/following', (route) => route.abort())

  await page.goto('/#/feed')

  const followTarget = page.getByRole('button', { name: `Follow ${followedName}`, exact: true })
  await expect(followTarget).toBeVisible({ timeout: 60_000 })
  await followTarget.click()

  // The operation is what actually recorded the follow.
  await expect
    .poll(
      () => page.evaluate(async ({ actorId, targetId }) => {
        const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
        const entries = await sharedSocialOperationLog().listAllOperations()
        return entries.some((entry) =>
          entry.actorId === actorId &&
          entry.record.type === 'follow.add' &&
          (entry.record.payload as { targetId?: string })?.targetId === targetId,
        )
      }, { actorId: me.orbitId, targetId: followed.id.orbitId }),
      { timeout: 30_000, message: 'the follow operation was never committed' },
    )
    .toBe(true)

  // A reload boots the app with an EMPTY node list. Only the operation can
  // still know the follow, so the suggestion must stay hidden after it.
  await page.reload()
  await page.goto('/#/feed')

  // The block is on screen (the OTHER peer is still suggested): the assertion
  // below cannot pass just because the suggestions never rendered.
  await expect(page.getByRole('button', { name: `Follow ${otherName}`, exact: true }))
    .toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: `Follow ${followedName}`, exact: true }))
    .toHaveCount(0)

  await followed.ctx.close()
  await other.ctx.close()
})