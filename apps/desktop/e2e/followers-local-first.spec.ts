import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * The profile's Followers tab lists a follow the NODE never received.
 *
 * A follow is a signed operation, so a peer can deliver it while the node's
 * `Followers` table knows nothing about it (the write failed, the node was
 * unreachable, or the row lagged). The modal used to render the node's JSON
 * verbatim, so that follower was invisible on the very profile that should show
 * it. Both lists are now merged with the accepted operations.
 *
 * The proof is peer-to-peer: context B signs and publishes the follow, the
 * operation reaches context A over the swarm (the node stores no operations),
 * A's node answers NOTHING for either list, and A's Followers tab still shows B.
 */
test.setTimeout(240_000)

async function waitForSwarm(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const mod = await import('/src/utils/p2pSwarm.ts')
      return mod.sendSwarmFrame({ type: 'SWARM_HAVE', ids: [] })
    },
    undefined,
    { timeout: 60_000 },
  )
}

async function roster(page: Page): Promise<{ id: string }[]> {
  return page.evaluate(async () => {
    const { orbitFetch } = await import('/src/utils/api.ts')
    const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const res = await orbitFetch('/api/users/online', {}, identity)
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    return Array.isArray(data?.users) ? data.users.map((u: { id: string }) => ({ id: u.id })) : []
  })
}

async function waitForPeerInRoster(page: Page, peerId: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const users = await roster(page)
    if (users.some((u) => u.id === peerId)) return
    await page.waitForTimeout(1000)
  }
  throw new Error(`peer ${peerId.slice(0, 12)} never appeared in the roster`)
}

/** Wait until A's durable operation log holds the operation B signed. */
async function waitForOperation(page: Page, operationId: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const has = await page.evaluate(async (opId) => {
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      return sharedSocialOperationLog().hasOperation(opId)
    }, operationId)
    if (has) return
    await page.waitForTimeout(1000)
  }
  throw new Error(`operation ${operationId.slice(0, 12)} never reached the target's log`)
}

test('a follower delivered by a peer shows up while the node answers nothing', async ({ browser }: { browser: Browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    const idA = await seedApp(pageA, { displayName: 'Follow Target' })
    const idB = await seedApp(pageB, { displayName: 'Follow Peer' })

    await pageA.goto('/#/feed')
    await pageB.goto('/#/feed')
    await waitForPeerInRoster(pageA, idB.orbitId)
    await waitForPeerInRoster(pageB, idA.orbitId)
    await waitForSwarm(pageA)
    await waitForSwarm(pageB)

    // The node knows nothing about this graph: neither list answers for A, so
    // the modal's list can only come from the operation B signed.
    await pageA.route('**/api/users/*/followers', (route) => route.abort())
    await pageA.route('**/api/users/*/following', (route) => route.abort())

    // B follows A through the real signed-operation path (no node call at all).
    const operationId = await pageB.evaluate(async (targetId: string) => {
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      const { publishFollow } = await import('/src/services/socialInteraction.ts')
      const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
      const op = await publishFollow(identity, targetId, sharedSocialOperationLog())
      return op.operationId
    }, idA.orbitId)

    await waitForOperation(pageA, operationId)

    await pageA.goto('/#/profile')

    // The counter above the tab merges the same operations, so it cannot
    // disagree with the list the tab opens.
    await expect(pageA.getByText('followers', { exact: true }).locator('..'))
      .toContainText('1', { timeout: 30_000 })

    await pageA.getByText('followers', { exact: true }).click()

    // The count and the row both come from the merged view.
    await expect(pageA.getByText('1 Followers')).toBeVisible({ timeout: 30_000 })
    await expect(pageA.getByText(`${idB.orbitId.slice(0, 12)}...`)).toBeVisible()
  } finally {
    await contextA.close()
    await contextB.close()
  }
})