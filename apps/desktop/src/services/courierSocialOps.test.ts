import { describe, expect, it, vi } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import {
  SocialOperationLog,
  OPERATION_LOG_CHANGED_EVENT,
  type LoggedOperation,
  type OperationLogBackend,
} from './socialOperationLog'
import { publishSignedPostOperation } from './socialPublish'
import { projectPosts } from './socialFeedProjection'
import {
  OPS_TOKEN,
  drainSocialOpsFromMailbox,
  publishSocialOpsToMailbox,
  wireCourierSocialOps,
} from './courierSocialOps'

/**
 * Cross-node social ops over the FREE rendezvous, with no node in the loop.
 * A commits a signed post into a mailbox, B drains the same box, and the
 * existing authorizer + projection produce the feed row. The Worker is blind:
 * a tampered op must fail the signed validation, and a replay must be a no-op.
 */
const AUTHOR = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const READER_ID = '22'.repeat(64)
const BASE = 'https://rendezvous.test'

function memoryBackend(): OperationLogBackend & { store: Map<string, LoggedOperation> } {
  const store = new Map<string, LoggedOperation>()
  return {
    store,
    async put(entry) { store.set(entry.operationId, entry) },
    async get(id) { return store.get(id) ?? null },
    async getAll() { return [...store.values()] },
    async delete(id) { store.delete(id) },
  }
}

type Envelope = { v: number; kind: string; to: string; id: string; sealed: string; exp: number }

function seal(op: unknown): Envelope {
  return {
    v: 2,
    kind: 'announce',
    to: OPS_TOKEN,
    id: 'abcdef0123456789',
    sealed: btoa(unescape(encodeURIComponent(JSON.stringify({ op })))),
    exp: Date.now() + 120_000,
  }
}

/** An in-memory Worker mailbox: PUT stores under envelope id, GET lists. */
function fakeMailbox(initial: Envelope[] = []) {
  const boxes = new Map<string, Map<string, Envelope>>()
  const putCalls: Array<{ url: string; env: Envelope }> = []
  const box = new Map(initial.map((env) => [env.id, env]))
  boxes.set(OPS_TOKEN, box)
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    expect(url).toBe(`${BASE}/api/mail/${OPS_TOKEN}`)
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { env: Envelope }
      box.set(body.env.id, body.env)
      putCalls.push({ url, env: body.env })
      return { ok: true, status: 202, json: async () => ({ ok: true }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({ envelopes: [...box.values()] }) } as Response
  }) as unknown as typeof globalThis.fetch
  return { fetchImpl, putCalls, box }
}

async function authorPost(log: SocialOperationLog, n: number) {
  return publishSignedPostOperation(AUTHOR, {
    objectId: `post-${n}`,
    contentCid: `${n}`.repeat(64).slice(0, 64),
    mimeType: 'image/jpeg',
    sizeBytes: 100 + n,
    caption: `caption ${n}`,
  }, log)
}

describe('social operations via the free rendezvous mailbox (no node)', () => {
  it('carries a signed post from A to B and projects the row, exactly once', async () => {
    const mailbox = fakeMailbox()
    const logA = new SocialOperationLog(memoryBackend())
    const logB = new SocialOperationLog(memoryBackend())
    const targetA = new EventTarget()
    const targetB = new EventTarget()

    const unwireA = wireCourierSocialOps({
      log: logA, selfId: AUTHOR.orbitId, base: BASE, fetchImpl: mailbox.fetchImpl,
      target: targetA, drainIntervalMs: 3_600_000,
    })
    const operation = await authorPost(logA, 1)
    targetA.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))
    await vi.waitFor(() => expect(mailbox.putCalls).toHaveLength(1))

    // The wire is the SAME announce envelope presence uses; the Worker sees an
    // opaque 64-hex token and base64 bytes it never opens.
    const { url, env } = mailbox.putCalls[0]
    expect(url).toBe(`${BASE}/api/mail/${OPS_TOKEN}`)
    expect(env).toMatchObject({ v: 2, kind: 'announce', to: OPS_TOKEN })
    expect(env.sealed.length).toBeGreaterThan(0)
    expect(JSON.parse(decodeURIComponent(escape(atob(env.sealed))))).toEqual({ op: operation })

    // A second commit event must not re-send the same operation id.
    targetA.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))
    await Promise.resolve()
    expect(mailbox.putCalls).toHaveLength(1)

    // B drains at boot; its own identity is not ours, so the op is accepted.
    const unwireB = wireCourierSocialOps({
      log: logB, selfId: READER_ID, base: BASE, fetchImpl: mailbox.fetchImpl,
      target: targetB, drainIntervalMs: 3_600_000,
    })
    await vi.waitFor(async () => {
      expect(await logB.listAllOperations()).toHaveLength(1)
    })
    const projected = projectPosts(await logB.listAllOperations())
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({
      id: 'post-1',
      authorId: AUTHOR.orbitId,
      contentCid: `${'1'.repeat(64)}`,
      caption: 'caption 1',
    })

    // A replay of the same box is a duplicate, never a second row.
    const again = await drainSocialOpsFromMailbox(logB, READER_ID, BASE, mailbox.fetchImpl)
    expect(again.duplicate).toBe(1)
    expect(projectPosts(await logB.listAllOperations())).toHaveLength(1)

    unwireA()
    unwireB()
  })

  it('rejects a tampered op from the blind box', async () => {
    const logA = new SocialOperationLog(memoryBackend())
    const operation = await authorPost(logA, 1)
    const envelope = seal({ ...operation, signature: 'f'.repeat(128) })
    const mailbox = fakeMailbox([envelope])

    const result = await drainSocialOpsFromMailbox(new SocialOperationLog(memoryBackend()), READER_ID, BASE, mailbox.fetchImpl)
    expect(result.rejected).toBe(1)
    expect(result.accepted).toBe(0)
  })

  it('ignores self-authored and malformed envelopes', async () => {
    const logA = new SocialOperationLog(memoryBackend())
    const operation = await authorPost(logA, 1)
    const malformed = { ...seal(operation), id: 'badbadbadbadbad0', sealed: '!!!not-base64!!!' }
    const mailbox = fakeMailbox([seal(operation), malformed])
    const logB = new SocialOperationLog(memoryBackend())

    // Our own envelope is not news, and the garbage envelope decodes to nothing.
    const own = await drainSocialOpsFromMailbox(logA, AUTHOR.orbitId, BASE, mailbox.fetchImpl)
    expect(own).toEqual({ accepted: 0, duplicate: 0, rejected: 0 })

    const other = await drainSocialOpsFromMailbox(logB, READER_ID, BASE, mailbox.fetchImpl)
    expect(other.accepted).toBe(1)
    expect(other.rejected).toBe(0)
  })

  it('publishes to the mailbox only once per operation id', async () => {
    const mailbox = fakeMailbox()
    const log = new SocialOperationLog(memoryBackend())
    await authorPost(log, 1)
    await authorPost(log, 2)
    const publishedIds = new Set<string>()

    expect(await publishSocialOpsToMailbox(log, AUTHOR.orbitId, publishedIds, BASE, mailbox.fetchImpl)).toBe(2)
    expect(await publishSocialOpsToMailbox(log, AUTHOR.orbitId, publishedIds, BASE, mailbox.fetchImpl)).toBe(0)
    expect(mailbox.putCalls).toHaveLength(2)
    // Other actors' operations are never re-published as ours.
    expect(await publishSocialOpsToMailbox(log, READER_ID, new Set(), BASE, mailbox.fetchImpl)).toBe(0)
  })
})
