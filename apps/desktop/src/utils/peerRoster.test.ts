import { describe, expect, it } from 'vitest'
import type { User } from '@orbit/shared'
import { mergeRoster } from './peerRoster'

const u = (id: string, extra: Partial<User> = {}): User =>
  ({ id, publicKey: `pk-${id}`, createdAt: '2026-01-01T00:00:00Z', display_name: id, online: false, ...extra }) as User

describe('mergeRoster', () => {
  it('adds unknown roster peers as offline and reports a change', () => {
    const m = new Map<string, User>()
    expect(mergeRoster(m, [u('alice')], 'me')).toBe(true)
    expect(m.get('alice')?.online).toBe(false)
  })

  it('skips self and keeps known-online peers untouched (no downgrade)', () => {
    const m = new Map<string, User>([['me', u('me')], ['alice', u('alice', { online: true })]])
    expect(mergeRoster(m, [u('me'), u('alice', { online: true })], 'me')).toBe(false)
    expect(m.get('alice')?.online).toBe(true)
  })

  it('refreshes profile fields on known peers', () => {
    const m = new Map<string, User>([['alice', u('alice', { display_name: 'Old' })]])
    expect(mergeRoster(m, [u('alice', { display_name: 'Alice <3', score: 42 })], 'me')).toBe(true)
    expect(m.get('alice')?.display_name).toBe('Alice <3')
    expect(m.get('alice')?.score).toBe(42)
  })
})
