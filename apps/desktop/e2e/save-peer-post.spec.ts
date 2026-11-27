import { expect, test } from '@playwright/test'
import { generateIdentity } from '../src/identity.cjs'
import { seedApp } from './helpers'

/**
 * Bookmarking a PEER-replicated post is durable, not a silent 404.
 *
 * A save used to be one call for every post: `POST /api/posts/:id/save`. A
 * post replicated from a peer has no `Objects` row on the node, so the node
 * answers `404 Post not found` — the bookmark was dropped in silence, the icon
 * stayed hollow, and a reload lost it. The profile's Saved tab could never list
 * such a post either.
 *
 * A bookmark is the reader's own private intent (unlike a like, whose count is
 * public and travels as a signed operation), so the peer half is kept on this
 * device in `utils/peerSaves.ts` and folded back into the peer projection.
 *
 * The row here is manufactured the way a REAL peer row arrives: a signed
 * `post.create` authored by another identity, committed to this device's
 * durable operation log, with the bytes held under both the object id and the
 * content hash. It is never registered on the node (that would make it a server
 * row and hide the bug), which is exactly why the node 404s its save.
 */
test.setTimeout(180_000)

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const CAPTION = 'peer-save-caption'

test('a bookmark on a peer post survives a reload', async ({ page }) => {
  const me = await seedApp(page, { displayName: 'Bookmark Tester' })
  await page.goto('/#/feed')

  const peer = generateIdentity()

  const published = await page.evaluate(
    async ({ peerKeys, b64, caption }: { peerKeys: Record<string, string>; b64: string; caption: string }) => {
      const { publishSignedPostOperation } = await import('/src/services/socialPublish.ts')
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      const { registerLocalObject, sha256HexBlob } = await import('/src/utils/p2pSwarm.ts')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'image/png' })
      const hash = await sha256HexBlob(blob)
      // Content-addressed: the row id and its content hash agree, and the bytes
      // are held under BOTH so the media ladder resolves without a node.
      const objectId = hash
      registerLocalObject(objectId, blob)
      registerLocalObject(hash, blob)
      const operation = await publishSignedPostOperation(peerKeys, {
        objectId,
        contentCid: hash,
        mimeType: 'image/png',
        sizeBytes: blob.size,
        caption,
      }, sharedSocialOperationLog())
      return { objectId, hash, operationId: operation.operationId }
    },
    { peerKeys: peer as unknown as Record<string, string>, b64: PNG_1x1.toString('base64'), caption: CAPTION },
  )

  // The projection turns the accepted operation into a feed row, with no node
  // involvement at all.
  const card = page.locator(`[data-post-id="${published.objectId}"]`)
  await expect(card).toContainText(CAPTION, { timeout: 60_000 })

  // Premise, pinned: the node refuses to save a row it does not hold. This is
  // the exact response the old single-path implementation sent the save to.
  const nodeSave = await page.evaluate(async (id) => {
    const { orbitFetch } = await import('/src/utils/api.ts')
    const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const res = await orbitFetch(`/api/posts/${id}/save`, { method: 'POST' }, identity)
    return res.status
  }, published.objectId)
  expect(nodeSave).toBe(404)

  // The row is a PEER row, so the save must take the local route.
  const origin = await page.evaluate(async (id) => {
    const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
    const { projectPosts } = await import('/src/services/socialFeedProjection.ts')
    const { projectedPostsToFeedPosts } = await import('/src/hooks/usePeerFeedPosts.ts')
    const rows = projectedPostsToFeedPosts(
      projectPosts(await sharedSocialOperationLog().listAllOperations()), null,
    )
    return rows.find((row) => row.id === id)?.origin ?? null
  }, published.objectId)
  expect(origin).toBe('peer')

  // Save it through the real UI.
  await card.getByRole('button', { name: 'Save post' }).click()

  const savedAfterClick = await page.evaluate(async (orbitId) => {
    const { readPeerSavedIds } = await import('/src/utils/peerSaves.ts')
    return [...readPeerSavedIds(orbitId)]
  }, me.orbitId)
  expect(savedAfterClick).toContain(published.objectId)

  // A reload is a fresh boot: the bookmark must still be there, and the peer
  // projection must carry `is_saved` back into the row.
  await page.reload()
  await page.goto('/#/feed')

  const afterReload = await page.evaluate(async ({ orbitId, id }) => {
    const { readPeerSavedIds } = await import('/src/utils/peerSaves.ts')
    const { applySavesToFeedPosts, projectedPostsToFeedPosts } = await import('/src/hooks/usePeerFeedPosts.ts')
    const { projectPosts } = await import('/src/services/socialFeedProjection.ts')
    const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
    const stored = [...readPeerSavedIds(orbitId)]
    const rows = applySavesToFeedPosts(
      projectedPostsToFeedPosts(projectPosts(await sharedSocialOperationLog().listAllOperations()), orbitId),
      readPeerSavedIds(orbitId),
    )
    return { stored, isSaved: rows.find((row) => row.id === id)?.is_saved ?? false }
  }, { orbitId: me.orbitId, id: published.objectId })

  expect(afterReload.stored).toContain(published.objectId)
  expect(afterReload.isSaved).toBe(true)

  // And the UI agrees once the row renders again.
  await expect(page.locator(`[data-post-id="${published.objectId}"]`)).toContainText(CAPTION, { timeout: 60_000 })
})