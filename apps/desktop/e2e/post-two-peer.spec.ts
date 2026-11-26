import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * A post made while the OTHER client is ALREADY online must reach it.
 *
 * This is the delivery half of L4, executed on the production path: two
 * independent contexts (separate identities, storage and sockets) on the same
 * localhost node. A publishes through the real durable forge path; B receives
 * the signed `post.create` over the swarm and pulls the bytes from A by their
 * content hash.
 *
 * Why the assertions are shaped this way:
 * - the proof that the metadata travelled PEER TO PEER is B's OPERATION LOG.
 *   The node stores no operations (the log is local IndexedDB), so a row that
 *   appears there can only have arrived over `SWARM_OP`.
 * - the proof for the media is the sha256 of the bytes B actually received,
 *   fetched by content hash through the same ladder the feed tile uses.
 *
 * Regression this pins: the outbound transport used to wave only on BOOT and
 * on PEER_ONLINE, so an operation appended while a peer was already online sat
 * at `committed` until one of the two reconnected.
 */
test.setTimeout(240_000)

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const CAPTION = 'p2p-live-caption'

/** Wait until the client's swarm transport is wired (the WS relay is up). */
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

/** The node's roster of currently-online clients (the caller is excluded). */
async function roster(page: Page): Promise<{ id: string; name?: string }[]> {
  return page.evaluate(async () => {
    const { orbitFetch } = await import('/src/utils/api.ts')
    const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const res = await orbitFetch('/api/users/online', {}, identity)
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    return Array.isArray(data?.users)
      ? data.users.map((u: { id: string; display_name?: string }) => ({ id: u.id, name: u.display_name }))
      : []
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

/** Wait until B's durable operation log holds the operation. */
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
  throw new Error(`operation ${operationId.slice(0, 12)} never reached the peer's log`)
}

test('a post made while a peer is online reaches that peer, with its media', async ({ browser }: { browser: Browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    const idA = await seedApp(pageA, { displayName: 'P2P Author' })
    const idB = await seedApp(pageB, { displayName: 'P2P Reader' })

    await pageA.goto('/#/feed')
    await pageB.goto('/#/feed')

    // Both clients are up and each sees the other BEFORE anything is posted:
    // the "peer was already online" condition the old wave never handled.
    await waitForPeerInRoster(pageA, idB.orbitId)
    await waitForPeerInRoster(pageB, idA.orbitId)
    await waitForSwarm(pageA)
    await waitForSwarm(pageB)

    // A publishes through the real product path (the same function the Create
    // Post modal calls): bytes seeded locally under object id AND content
    // hash, a signed post.create committed to the durable log, outbox queued.
    const posted = await pageA.evaluate(
      async ({ b64, caption }: { b64: string; caption: string }) => {
        const { forgeMediaLocally } = await import('/src/services/mediaForge.ts')
        const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], 'peer-post.png', { type: 'image/png' })
        const forged = await forgeMediaLocally(file, identity, {
          caption,
          postCaption: caption,
          isPublic: true,
          durable: true,
          tags: 'portrait',
        })
        return {
          id: forged.id,
          contentHash: forged.contentHash,
          operationId: forged.socialOperationId ?? null,
        }
      },
      { b64: PNG_1x1.toString('base64'), caption: CAPTION },
    )

    // The signed operation was committed locally (durable-first publish).
    expect(posted.operationId).toBeTruthy()

    // 1. The operation reaches B over the swarm. The node stores no
    //    operations, so this row can only come from A.
    await waitForOperation(pageB, posted.operationId!)

    // 2. B's local projection turns it into the post B renders.
    const projected = await pageB.evaluate(async () => {
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      const { projectPosts } = await import('/src/services/socialFeedProjection.ts')
      return projectPosts(await sharedSocialOperationLog().listAllOperations()).map((p) => ({
        id: p.id,
        authorId: p.authorId,
        caption: p.caption,
        contentCid: p.contentCid,
      }))
    })
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({
      id: posted.id,
      authorId: idA.orbitId,
      caption: CAPTION,
      contentCid: posted.contentHash,
    })

    // 3. B pulls the BYTES from A, addressed by their content hash.
    const media = await pageB.evaluate(async (hash: string) => {
      const { requestSwarmObject, sha256HexBlob } = await import('/src/utils/p2pSwarm.ts')
      const blob = await requestSwarmObject(hash, 45_000, { expectedHash: hash })
      return { size: blob.size, sha: await sha256HexBlob(blob) }
    }, posted.contentHash!)
    expect(media.size).toBe(PNG_1x1.length)
    expect(media.sha).toBe(posted.contentHash)

    // 3b. The receipt round trip completed: serving minted a challenge, B
    //     persisted the bytes, read them BACK from its own store, and signed an
    //     attestation. A's custody count is therefore 2 (A + B) — it was 1 (A
    //     alone) before. This is the machine-level truth the "Stored on N
    //     devices" line renders; the line itself is pinned by the
    //     ProfileExpandedPost test.
    await expect
      .poll(
        () =>
          pageA.evaluate(async (hash: string) => {
            const { durableCustodyHolders } = await import('/src/utils/p2pSwarm.ts')
            return durableCustodyHolders(hash)
          }, posted.contentHash!),
        { timeout: 45_000, message: 'A never recorded B as a durable holder of the bytes' },
      )
      .toBe(2)

    // 4. And it is on B's screen, in B's own timeline.
    await pageB.goto('/#/feed')
    await expect(pageB.getByText(CAPTION)).toBeVisible({ timeout: 60_000 })
  } finally {
    await contextA.close()
    await contextB.close()
  }
})