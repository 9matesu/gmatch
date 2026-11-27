import { expect, test } from '@playwright/test'
import { generateIdentity } from '../src/identity.cjs'
import { seedApp } from './helpers'

/**
 * The L4 acceptance claim, executed: the feed READS and WRITES with the node's
 * stateful post routes unavailable.
 *
 * Two halves, both on the production path:
 * - READ: a post replicated from a peer lives in this device's durable
 *   operation log, and its bytes are resolved from their content hash. With
 *   `/api/posts` AND `/api/objects` aborted the row still renders, with media -
 *   no node row, no signed object fetch.
 * - WRITE: a post made while those routes are dead is committed locally first
 *   (durable outbox + signed operation), shows immediately, and is STILL there
 *   after a reload.
 *
 * This pins the whole point of the refactor: an unreachable node must not empty
 * the timeline or refuse a post. The node never stores operations, so a row
 * that survives the aborted reload can only come from local storage.
 */
test.setTimeout(240_000)

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const PEER_CAPTION = 'offline-peer-caption'
const MY_CAPTION = 'offline-my-caption'

test('the feed reads peer posts and posts my own with the node post routes down', async ({ page }) => {
  await seedApp(page, { displayName: 'Offline Tester' })
  await page.goto('/#/feed')

  // A genuine PEER row: another identity's signed post.create, committed to
  // this device's log, with the bytes held locally under id and content hash.
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
      registerLocalObject(hash, blob)
      const operation = await publishSignedPostOperation(peerKeys, {
        objectId: hash,
        contentCid: hash,
        mimeType: 'image/png',
        sizeBytes: blob.size,
        caption,
      }, sharedSocialOperationLog())
      return { objectId: hash, operationId: operation.operationId }
    },
    { peerKeys: peer as unknown as Record<string, string>, b64: PNG_1x1.toString('base64'), caption: PEER_CAPTION },
  )

  // Everything the timeline used to need from the node is now gone.
  await page.route('**/api/posts**', (route) => route.abort())
  await page.route('**/api/objects**', (route) => route.abort())

  await page.reload()
  await page.goto('/#/feed')

  // READ: the peer row and its media are on screen anyway.
  const peerCard = page.locator(`[data-post-id="${published.objectId}"]`)
  await expect(peerCard).toContainText(PEER_CAPTION, { timeout: 60_000 })
  await expect
    .poll(
      () => peerCard.locator('img').evaluateAll((els) =>
        els.some((el) => (el as HTMLImageElement).naturalWidth > 0),
      ),
      { timeout: 60_000, message: 'the peer media never decoded (node object route is dead)' },
    )
    .toBe(true)

  // WRITE: publish through the real composer while those routes stay dead.
  await page.getByRole('button', { name: 'Create a post', exact: true }).click()
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const drop = page.getByText('Drop a file, click to browse, or paste from the clipboard')
  await expect(drop).toBeVisible({ timeout: 20_000 })
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), drop.click()])
  await chooser.setFiles({ name: 'offline.png', mimeType: 'image/png', buffer: PNG_1x1 })
  await page.getByRole('button', { name: 'Use this media', exact: true }).click()
  await page.getByPlaceholder('Write a caption...').fill(MY_CAPTION)
  await page.getByRole('button', { name: 'Share', exact: true }).click()

  // The row lands locally without any node round trip.
  await expect(page.getByText(MY_CAPTION).first()).toBeVisible({ timeout: 30_000 })

  // A reload with the node still dead: the peer row comes from the operation
  // log, my own from the durable outbox. Neither is the node's.
  await page.reload()
  await page.goto('/#/feed')

  await expect(page.getByText(PEER_CAPTION).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(MY_CAPTION).first()).toBeVisible({ timeout: 60_000 })

  // The outbox entry is local, and the app says so instead of pretending the
  // node took it.
  const syncState = await page.evaluate(async () => {
    const { listOutbox } = await import('/src/services/postOutbox.ts')
    return listOutbox().map((entry) => entry.state)
  })
  expect(syncState.some((state) => state === 'local' || state === 'pending')).toBe(true)
})