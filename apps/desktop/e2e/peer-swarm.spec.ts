import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedApp } from './helpers'
import { createHash } from 'node:crypto'

/**
 * Two INDEPENDENT clients (separate browser contexts = separate identities,
 * storage and sockets) on the SAME localhost node.
 *
 * What it proves:
 *
 *   1. DISCOVERY — each client finds the OTHER on the node's roster. This is
 *      the "online players are found on this PC" half.
 *   2. DATA — the second client pulls the first client's media object over
 *      the swarm and gets the EXACT bytes back (sha256), even though the node
 *      that relayed the frames never saw the plaintext (swarm-v1 seals every
 *      chunk to the fetcher's offer key). This is the "get data from them"
 *      half.
 *
 * Both halves run against the node's WebSocket relay — the guaranteed path
 * when a direct WebRTC hole cannot be punched. The frames ride the same
 * SWARM_FRAME envelope the production client uses, so this is the production
 * path, not a test double.
 */
test.setTimeout(180_000)

/** A media payload big enough to span several 4 KiB swarm chunks. */
const PAYLOAD = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  Buffer.alloc(40 * 1024, 0x5a),
  Buffer.from([0xff, 0xd9]),
])
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex')
const PAYLOAD_B64 = PAYLOAD.toString('base64')
const OBJECT_ID = '7c2f9a10-4d3e-4a51-9d2b-6f1e0c8a55b1'

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
    return Array.isArray(data?.users) ? data.users.map((u: { id: string; display_name?: string }) => ({ id: u.id, name: u.display_name })) : []
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

test('clients on this node find each other and pull media over the swarm', async ({ browser }: { browser: Browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    const idA = await seedApp(pageA, { displayName: 'Swarm Holder' })
    const idB = await seedApp(pageB, { displayName: 'Swarm Fetcher' })

    await pageA.goto('/#/feed')
    await pageB.goto('/#/feed')

    // 1. DISCOVERY: each side sees the other on the node's roster.
    await waitForPeerInRoster(pageA, idB.orbitId)
    await waitForPeerInRoster(pageB, idA.orbitId)

    // 2. DATA: the holder keeps the bytes locally (as a peer that has already
    //    seeded the object would), the fetcher asks the swarm for them.
    await waitForSwarm(pageA)
    await waitForSwarm(pageB)

    const held = await pageA.evaluate(
      async ({ id, b64 }: { id: string; b64: string }) => {
        const mod = await import('/src/utils/p2pSwarm.ts')
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        mod.registerLocalObject(id, new Blob([bytes], { type: 'image/jpeg' }))
        mod.announceHeldObjects()
        return mod.heldSwarmObjectIds()
      },
      { id: OBJECT_ID, b64: PAYLOAD_B64 },
    )
    expect(held).toContain(OBJECT_ID)

    const fetched = await pageB.evaluate(
      async (id: string) => {
        const mod = await import('/src/utils/p2pSwarm.ts')
        const blob = await mod.requestSwarmObject(id, 45_000)
        const sha = await mod.sha256HexBlob(blob)
        return { size: blob.size, sha }
      },
      OBJECT_ID,
    )

    expect(fetched.size).toBe(PAYLOAD.length)
    expect(fetched.sha).toBe(PAYLOAD_SHA)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
