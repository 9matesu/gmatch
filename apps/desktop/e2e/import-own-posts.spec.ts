import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedApp } from './helpers'

/**
 * The opt-in migration, executed on the production path.
 *
 * A post published BEFORE the local-first path existed lives only as a row on
 * this machine's node: no signed `post.create`, so no peer can address it and
 * it disappears the moment the node stops answering. This test manufactures
 * exactly that state using the real node (register, no signed operation), then
 * runs `importOwnPosts` and proves the post becomes addressable:
 *
 *   1. the node lists the row and holds its bytes (the raw material);
 *   2. the durable log does NOT carry it yet (it really is pre-local-first);
 *   3. the import commits a signed `post.create` and the row projects with the
 *      content hash the node computed from the stored bytes;
 *   4. the bytes are locally servable under that hash, so a peer that receives
 *      the operation has a seeder.
 *
 * No test double anywhere: seedApp, the node, the log and the service are all
 * the shipping code paths.
 */
test.setTimeout(180_000)

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const CAPTION = 'legacy-node-only-post'

/** Register a post straight onto the node: a row with bytes, NO signed op. */
async function registerLegacyPost(page: Page): Promise<{ objectId: string; contentHash: string }> {
  return page.evaluate(
    async ({ b64, caption }: { b64: string; caption: string }) => {
      const { orbitFetch } = await import('/src/utils/api.ts')
      const { sha256HexBlob } = await import('/src/utils/p2pSwarm.ts')
      const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const objectId = `legacy-${Math.random().toString(36).slice(2, 10)}`
      const res = await orbitFetch('/api/objects/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: objectId,
          size_bytes: bytes.length,
          mime_type: 'image/png',
          post_caption: caption,
          tags: 'portrait',
          is_public: true,
          data_base64: b64,
          data_mime: 'image/png',
        }),
      }, identity)
      if (!res.ok) throw new Error(`register failed: ${res.status}`)
      const stored = await res.json().catch(() => null) as { content_hash?: string } | null
      // Prefer the hash the NODE computed from the bytes it stored; fall back
      // to hashing locally (identical for these bytes).
      const contentHash = stored?.content_hash
        || await sha256HexBlob(new Blob([bytes]))
      return { objectId, contentHash }
    },
    { b64: PNG_1x1.toString('base64'), caption: CAPTION },
  )
}

/** The node's own view of this author's posts (the import's input). */
async function nodePosts(page: Page): Promise<Array<{ id: string }>> {
  return page.evaluate(async () => {
    const { orbitFetch } = await import('/src/utils/api.ts')
    const identity = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
    const res = await orbitFetch(
      `/api/posts?author_id=${encodeURIComponent(identity.orbitId)}&limit=50&sort=latest`,
      {},
      identity,
    )
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    return Array.isArray(data?.posts) ? data.posts.map((p: { id: string }) => ({ id: p.id })) : []
  })
}

test('an existing node-only post is imported into the signed log and served', async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    const identity = await seedApp(page, { displayName: 'Importer' })
    await page.goto('/#/feed')

    const legacy = await registerLegacyPost(page)
    expect(legacy.contentHash).toMatch(/^[0-9a-f]{64}$/)

    // 1. The node lists the row (the import's candidate source).
    await expect
      .poll(async () => (await nodePosts(page)).some((p) => p.id === legacy.objectId), { timeout: 20_000 })
      .toBe(true)

    // 2. The legacy post is not in the signed log yet: it really is
    //    pre-local-first. (The precondition is about THIS post — an unrelated
    //    operation from the running app must not mask it.)
    const beforeRows = await page.evaluate(async () => {
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      const { projectPosts } = await import('/src/services/socialFeedProjection.ts')
      return projectPosts(await sharedSocialOperationLog().listAllOperations())
        .map((p) => ({ id: p.id, authorId: p.authorId }))
    })
    expect(
      beforeRows.filter((r) => r.id === legacy.objectId),
      `log already carried: ${JSON.stringify(beforeRows)}`,
    ).toEqual([])

    // 3. Run the opt-in import through the shipping service.
    const summary = await page.evaluate(async () => {
      const { importOwnPosts } = await import('/src/services/socialPostImport.ts')
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
      const result = await importOwnPosts(ident, sharedSocialOperationLog())
      return {
        imported: result.imported.length,
        bytesSeeded: result.bytesSeeded,
        skipped: result.skipped,
      }
    })
    expect(summary.skipped).toEqual([])
    expect(summary.imported).toBe(1)
    expect(summary.bytesSeeded).toBe(1)

    // The projected row carries the content hash, so peers can address it.
    const projected = await page.evaluate(async (id: string) => {
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      const { projectPosts } = await import('/src/services/socialFeedProjection.ts')
      return projectPosts(await sharedSocialOperationLog().listAllOperations())
        .filter((p) => p.id === id)
        .map((p) => ({ id: p.id, authorId: p.authorId, caption: p.caption, contentCid: p.contentCid }))
    }, legacy.objectId)
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({
      id: legacy.objectId,
      authorId: identity.orbitId,
      caption: CAPTION,
      contentCid: legacy.contentHash,
    })

    // 4. The bytes are now locally servable under the content hash — a peer
    //    that receives the operation has a seeder.
    const served = await page.evaluate(async (hash: string) => {
      const { getLocalObject, sha256HexBlob } = await import('/src/utils/p2pSwarm.ts')
      const blob = await getLocalObject(hash)
      if (!blob) return null
      return { size: blob.size, sha: await sha256HexBlob(blob) }
    }, legacy.contentHash)
    expect(served).not.toBeNull()
    expect(served!.size).toBe(PNG_1x1.length)
    expect(served!.sha).toBe(legacy.contentHash)

    // Running it again changes nothing (idempotent by object id).
    const again = await page.evaluate(async () => {
      const { importOwnPosts } = await import('/src/services/socialPostImport.ts')
      const { sharedSocialOperationLog } = await import('/src/services/socialOperationLog.ts')
      const ident = JSON.parse(localStorage.getItem('orbit_identity') || 'null')
      const result = await importOwnPosts(ident, sharedSocialOperationLog())
      return { imported: result.imported.length, skipped: result.skipped }
    })
    expect(again.imported).toBe(0)
    expect(again.skipped).toEqual([{ id: legacy.objectId, reason: 'already' }])
  } finally {
    await context.close()
  }
})
