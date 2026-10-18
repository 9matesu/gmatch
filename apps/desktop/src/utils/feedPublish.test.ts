import { describe, it, expect, vi } from 'vitest'
import { postVisibleInFeed, reconcilePublishedPost } from './feedPublish'

describe('postVisibleInFeed', () => {
  it('matches by post id', () => {
    expect(postVisibleInFeed([{ id: 'p1' }], 'p1')).toBe(true)
    expect(postVisibleInFeed([{ id: 'p1' }], 'p2')).toBe(false)
  })

  it('matches a multi-image post whose media names the uploaded object', () => {
    const posts = [{ id: 'group-1', mediaUrls: ['/api/objects/aaa', '/api/objects/obj-9'] }]
    expect(postVisibleInFeed(posts, 'obj-9')).toBe(true)
  })

  it('never reports an empty or missing id as visible', () => {
    expect(postVisibleInFeed([{ id: '' }], '')).toBe(false)
    expect(postVisibleInFeed(null, 'p1')).toBe(false)
    expect(postVisibleInFeed(undefined, 'p1')).toBe(false)
  })
})

describe('reconcilePublishedPost', () => {
  it('keeps retrying until the node indexes the row, then stops', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'older' }])
      .mockResolvedValueOnce([{ id: 'older' }])
      .mockResolvedValueOnce([{ id: 'older' }, { id: 'new-post' }])
    const wait = vi.fn(async () => {})

    await expect(reconcilePublishedPost({ id: 'new-post', refresh, wait })).resolves.toBe(true)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('gives up after the bounded attempts (the caller keeps the local tile)', async () => {
    const refresh = vi.fn(async () => [{ id: 'older' }])
    const wait = vi.fn(async () => {})

    await expect(reconcilePublishedPost({ id: 'ghost', refresh, wait, attempts: 3 })).resolves.toBe(false)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('a failing refresh never throws out of the reconciler', async () => {
    const refresh = vi.fn(async () => { throw new Error('node asleep') })
    await expect(
      reconcilePublishedPost({ id: 'x', refresh, wait: async () => {}, attempts: 2 }),
    ).resolves.toBe(false)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('still refreshes once when the upload carried no id', async () => {
    const refresh = vi.fn(async () => [{ id: 'older' }])
    await expect(reconcilePublishedPost({ id: '', refresh, wait: async () => {} })).resolves.toBe(false)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
