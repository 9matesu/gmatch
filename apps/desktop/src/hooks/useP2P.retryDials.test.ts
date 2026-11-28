// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import type { User } from '@orbit/shared'
import { planRetryDials } from './useP2P'

const u = (id: string, over: Partial<User> = {}): User => ({ id, online: true, ...over } as User)

describe('planRetryDials — one bounded attempt per eligible cross-node peer', () => {
  it('dials exactly one peer with keys, once each', () => {
    const peers: [string, User][] = [
      ['a', u('a', { publicKey: 'pa', encryptionPubKey: 'ea' } as any)],
      ['b', u('b', { publicKey: 'pb', encryptionPubKey: 'eb' } as any)],
    ]
    const dial = vi.fn()
    const issued = planRetryDials(peers, 'self', () => true, dial)
    expect(issued).toBe(2)
    expect(dial).toHaveBeenCalledTimes(2)
    expect(dial).toHaveBeenCalledWith('a', 'pa', 'ea')
    expect(dial).toHaveBeenCalledWith('b', 'pb', 'eb')
  })

  it('skips self, offline peers, same-node peers and peers without keys', () => {
    const peers: [string, User][] = [
      ['self', u('self', { publicKey: 'p', encryptionPubKey: 'e' } as any)],
      ['off', u('off', { online: false, publicKey: 'p', encryptionPubKey: 'e' } as any)],
      ['same', u('same', { publicKey: 'p', encryptionPubKey: 'e' } as any)],
      ['nokey', u('nokey')],
      ['ok', u('ok', { publicKey: 'p', encryptionPubKey: 'e' } as any)],
    ]
    const dial = vi.fn()
    const issued = planRetryDials(peers, 'self', (id) => id !== 'same', dial)
    expect(issued).toBe(1)
    expect(dial).toHaveBeenCalledTimes(1)
    expect(dial).toHaveBeenCalledWith('ok', 'p', 'e')
  })

  it('issues no attempt when there are no eligible peers', () => {
    const dial = vi.fn()
    expect(planRetryDials([], 'self', () => true, dial)).toBe(0)
    expect(dial).not.toHaveBeenCalled()
  })
})