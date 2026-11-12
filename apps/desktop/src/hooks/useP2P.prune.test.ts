import { describe, expect, it } from 'vitest'
import { pruneStalePeers } from './useP2P'
import type { User } from '@orbit/shared'

const iso = (msAgo: number, now: number) => new Date(now - msAgo).toISOString()

const peer = (id: string, lastSeen: string): User =>
  ({ id, last_seen: lastSeen }) as unknown as User

describe('pruneStalePeers (plan B1)', () => {
  it('drops entries unseen for over 24h and keeps fresh ones', () => {
    const now = Date.now()
    const map = new Map<string, User>([
      ['fresh', peer('fresh', iso(60_000, now))],
      ['hours', peer('hours', iso(5 * 3600_000, now))],
      ['ghost', peer('ghost', iso(25 * 3600_000, now))],
      ['ancient', peer('ancient', iso(400 * 3600_000, now))],
    ])
    const dropped = pruneStalePeers(map, now)
    expect(dropped).toBe(2)
    expect(map.has('fresh')).toBe(true)
    expect(map.has('hours')).toBe(true)
    expect(map.has('ghost')).toBe(false)
    expect(map.has('ancient')).toBe(false)
  })

  it('never ages a peer that carries no timestamp at all', () => {
    const now = Date.now()
    const map = new Map<string, User>([['notime', peer('notime', '')]])
    expect(pruneStalePeers(map, now)).toBe(0)
    expect(map.has('notime')).toBe(true)
  })

  it('returns 0 and mutates nothing when everything is fresh', () => {
    const now = Date.now()
    const map = new Map<string, User>([['a', peer('a', iso(1_000, now))]])
    expect(pruneStalePeers(map, now)).toBe(0)
    expect(map.size).toBe(1)
  })
})

