// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { validateSocialOperation } from '@orbit/protocol'
import { SocialOperationLog, type OperationLogBackend } from './socialOperationLog'
import { publishSignedPostOperation } from './socialPublish'
import {
  editPostCaptionAsOperation,
  editPostCaptionOnNode,
  postEditHeads,
  postEditRoute,
} from './postEdit'
import { orbitFetch } from '../utils/api'

vi.mock('../utils/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/api')>()
  return { ...mod, orbitFetch: vi.fn(async () => new Response('{}', { status: 200 })) }
})

const mockedFetch = vi.mocked(orbitFetch)
const IDENTITY = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const OTHER = restoreIdentity('22'.repeat(32), '33'.repeat(32))

function memoryBackend(): OperationLogBackend & { store: Map<string, import('./socialOperationLog').LoggedOperation> } {
  const store = new Map<string, import('./socialOperationLog').LoggedOperation>()
  return {
    store,
    async put(entry) { store.set(entry.operationId, entry) },
    async get(id) { return store.get(id) ?? null },
    async getAll() { return [...store.values()] },
    async delete(id) { store.delete(id) },
  }
}

describe('postEditRoute', () => {
  it('a node post is edited on the node', () => {
    expect(postEditRoute({ origin: 'server' })).toBe('server')
    expect(postEditRoute(null)).toBe('server')
  })

  it('a peer-replicated post is edited as a signed operation', () => {
    expect(postEditRoute({ origin: 'peer' })).toBe('peer-operation')
  })
})

describe('postEditHeads', () => {
  it('the create is the only head before any edit', () => {
    const create = { type: 'post.create', objectId: 'p1', operationId: 'op1', payload: {} } as any
    expect(postEditHeads([create], 'p1').map((h) => h.operationId)).toEqual(['op1'])
  })

  it('an edit that supersedes the create replaces it as the head', () => {
    const create = { type: 'post.create', objectId: 'p1', operationId: 'op1', payload: {} } as any
    const edit = { type: 'post.edit', objectId: 'p1', operationId: 'op2', payload: { supersedes: ['op1'] } } as any
    expect(postEditHeads([create, edit], 'p1').map((h) => h.operationId)).toEqual(['op2'])
  })

  it('a second edit supersedes the first edit, not the create', () => {
    const create = { type: 'post.create', objectId: 'p1', operationId: 'op1', payload: {} } as any
    const edit1 = { type: 'post.edit', objectId: 'p1', operationId: 'op2', payload: { supersedes: ['op1'] } } as any
    const edit2 = { type: 'post.edit', objectId: 'p1', operationId: 'op3', payload: { supersedes: ['op2'] } } as any
    expect(postEditHeads([create, edit1, edit2], 'p1').map((h) => h.operationId)).toEqual(['op3'])
  })
})

describe('editPostCaptionOnNode', () => {
  beforeEach(() => mockedFetch.mockReset())

  it('PATCHes the caption and reports the saved value', async () => {
    mockedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, caption: 'new text' }), { status: 200 }))
    const res = await editPostCaptionOnNode(IDENTITY as any, 'p1', 'new text')
    expect(res.ok).toBe(true)
    expect(res.caption).toBe('new text')
    const [endpoint, options] = mockedFetch.mock.calls[0]
    expect(endpoint).toBe('/api/posts/p1')
    expect((options as RequestInit).method).toBe('PATCH')
    expect(String((options as RequestInit).body)).toContain('new text')
  })

  it('a 403 says the post is not the author\'s', async () => {
    mockedFetch.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    const res = await editPostCaptionOnNode(IDENTITY as any, 'p1', 'nope')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/author/i)
  })

  it('an unreachable node is reported, not swallowed', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('offline'))
    const res = await editPostCaptionOnNode(IDENTITY as any, 'p1', 'nope')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('refuses an over-long caption before touching the network', async () => {
    const res = await editPostCaptionOnNode(IDENTITY as any, 'p1', 'x'.repeat(2001))
    expect(res.ok).toBe(false)
    expect(mockedFetch).not.toHaveBeenCalled()
  })
})

describe('editPostCaptionAsOperation', () => {
  let backend: ReturnType<typeof memoryBackend>
  let log: SocialOperationLog

  beforeEach(() => {
    backend = memoryBackend()
    log = new SocialOperationLog(backend, { now: () => 1_000_000 })
  })

  it('commits a signed post.edit that supersedes the create', async () => {
    const create = await publishSignedPostOperation(IDENTITY as any, {
      objectId: 'post-1',
      contentCid: 'a'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      caption: 'hello world',
    }, log)

    const res = await editPostCaptionAsOperation(IDENTITY as any, 'post-1', 'the new caption', log)
    expect(res.ok).toBe(true)
    expect(res.caption).toBe('the new caption')

    const edit = (await log.listAllOperations()).find((e) => e.record.type === 'post.edit')
    expect(edit).toBeTruthy()
    const record = edit!.record as any
    expect(validateSocialOperation(record)).toBeNull()
    expect(record.payload.supersedes).toEqual([create.operationId])
    expect(record.payload.caption).toBe('the new caption')
    // The manifest is unchanged: a caption edit does not touch the bytes.
    expect(record.payload.contentCid).toBe('a'.repeat(64))
    expect(record.payload.manifestHash).toBe(create.payload.manifestHash)
  })

  it('a second edit supersedes the FIRST edit', async () => {
    await publishSignedPostOperation(IDENTITY as any, {
      objectId: 'post-1', contentCid: 'a'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1234, caption: 'one',
    }, log)
    await editPostCaptionAsOperation(IDENTITY as any, 'post-1', 'two', log)
    await editPostCaptionAsOperation(IDENTITY as any, 'post-1', 'three', log)

    const edits = (await log.listAllOperations()).filter((e) => e.record.type === 'post.edit')
    expect(edits).toHaveLength(2)
    const second = edits[1].record as any
    expect(second.payload.supersedes).toEqual([(edits[0].record as any).operationId])
  })

  it('an empty caption CLEARS the text (the field is still named)', async () => {
    await publishSignedPostOperation(IDENTITY as any, {
      objectId: 'post-1', contentCid: 'a'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1234, caption: 'one',
    }, log)
    const res = await editPostCaptionAsOperation(IDENTITY as any, 'post-1', '   ', log)
    expect(res.ok).toBe(true)
    expect(res.caption).toBeNull()
    const edit = (await log.listAllOperations()).find((e) => e.record.type === 'post.edit')!.record as any
    expect(edit.payload.caption).toBe('')
  })

  it('a non-author cannot edit', async () => {
    await publishSignedPostOperation(IDENTITY as any, {
      objectId: 'post-1', contentCid: 'a'.repeat(64), mimeType: 'image/jpeg', sizeBytes: 1234, caption: 'one',
    }, log)
    const res = await editPostCaptionAsOperation(OTHER as any, 'post-1', 'hijack', log)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/author/i)
  })

  it('a post that is not in the log is reported honestly', async () => {
    const res = await editPostCaptionAsOperation(IDENTITY as any, 'unknown', 'nope', log)
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })
})
