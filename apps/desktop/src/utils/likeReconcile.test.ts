import { describe, it, expect, vi } from 'vitest'
import { createLikeGovernor } from './likeReconcile'

vi.mock('./api', () => ({ invalidateCache: vi.fn() }));

function sink() {
  const liked: Record<string, boolean> = {}
  const counts: Record<string, number> = {}
  const calls: Array<[string, boolean | number]> = []
  return {
    liked,
    counts,
    calls,
    commit: {
      setLiked: (id: string, v: boolean) => { liked[id] = v; calls.push([id, v]) },
      setCount: (id: string, n: number) => { counts[id] = n; calls.push([id, n]) },
    },
  }
}

describe('createLikeGovernor (mutation sequence, no React)', () => {
  it('applies exactly one optimistic edge per toggle', () => {
    const s = sink()
    const gov = createLikeGovernor(s.commit)
    gov.toggle('p', false, 10, { persist: async () => 11 })
    expect(s.liked.p).toBe(true)
    expect(s.counts.p).toBe(11)
  })

  it('latest mutation wins when responses resolve out of order', async () => {
    const s = sink()
    const gov = createLikeGovernor(s.commit)
    let resolvePost!: (n: number) => void
    let resolveDelete!: (n: number) => void
    const persist = vi.fn(
      (_id: string, liked: boolean): Promise<number | undefined> =>
        new Promise((res) => { if (liked) resolvePost = res; else resolveDelete = res }),
    )
    gov.toggle('p', false, 10, { persist })
    gov.toggle('p', true, 11, { persist })
    expect(persist).toHaveBeenCalledTimes(2)
    resolveDelete(9) // latest mutation (unlike) resolves first
    await Promise.resolve()
    resolvePost(11) // stale like resolves last: must be discarded
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(s.liked.p).toBe(false)
    expect(s.counts.p).toBe(9)
  })

  it('rolls back on failure only when no newer mutation owns the post', async () => {
    const s = sink()
    const gov = createLikeGovernor(s.commit)
    let rejectFirst!: (e: unknown) => void
    const failing = vi.fn(
      (): Promise<number | undefined> =>
        new Promise((_res, rej) => { rejectFirst = rej }),
    )
    gov.toggle('p', false, 10, { persist: failing })
    expect(s.counts.p).toBe(11)
    rejectFirst(new Error('down'))
    await new Promise((r) => setTimeout(r, 0))
    expect(s.liked.p).toBe(false)
    expect(s.counts.p).toBe(10)
  })

  it('a newer mutation shields its state from an older failure', async () => {
    const s = sink()
    const gov = createLikeGovernor(s.commit)
    let rejectFirst!: (e: unknown) => void
    let resolveSecond!: (n: number) => void
    const calls: Array<Promise<number | undefined>> = []
    const persist = vi.fn((): Promise<number | undefined> => {
      const p = calls.length === 0
        ? new Promise<number | undefined>((_res, rej) => { rejectFirst = rej })
        : new Promise<number | undefined>((res) => { resolveSecond = res as (n: number) => void })
      calls.push(p)
      return p
    })
    gov.toggle('p', false, 10, { persist }) // gen 1, optimistic 11
    gov.toggle('p', true, 11, { persist }) // gen 2, optimistic 10
    rejectFirst(new Error('down')) // stale failure must not touch gen-2 state
    resolveSecond(10)
    await new Promise((r) => setTimeout(r, 0))
    expect(s.liked.p).toBe(false)
    expect(s.counts.p).toBe(10)
  })

  it('localOnly flips locally without persist or generation', async () => {
    const s = sink()
    const gov = createLikeGovernor(s.commit)
    const persist = vi.fn(async (): Promise<number | undefined> => 99)
    const boost = vi.fn()
    gov.toggle('p', false, 10, { persist, localOnly: true, tags: ['a'], onOptimisticLike: boost })
    expect(s.liked.p).toBe(true)
    expect(s.counts.p).toBe(11)
    expect(persist).not.toHaveBeenCalled()
    expect(boost).toHaveBeenCalledWith('p', ['a'])
  })

  it('never drops below zero and isolates posts', async () => {
    const s = sink()
    const gov = createLikeGovernor(s.commit)
    gov.toggle('p', true, 0, { persist: async () => 0 })
    expect(s.counts.p).toBe(0)
    gov.toggle('q', false, 3, { persist: async () => 4 })
    expect(s.counts.q).toBe(4)
    expect(s.counts.p).toBe(0)
  })
})
