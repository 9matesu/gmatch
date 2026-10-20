import { describe, expect, it } from 'vitest'
import { toChatPeer } from './chatPeer'

describe('toChatPeer', () => {
  it('accepts the directory shape', () => {
    expect(toChatPeer({ orbitId: 'abc', name: 'Kenny' })).toEqual({ id: 'abc', name: 'Kenny' })
  })

  it('accepts a server user row', () => {
    expect(toChatPeer({ id: 'abc', display_name: 'Kenny' })).toEqual({ id: 'abc', name: 'Kenny' })
  })

  it('refuses a peer with no id instead of producing an empty address', () => {
    expect(toChatPeer({ name: 'Nobody' })).toBeNull()
    expect(toChatPeer(null)).toBeNull()
  })

  it('omits absent optional fields rather than storing undefined keys', () => {
    expect(toChatPeer({ id: 'abc' })).toEqual({ id: 'abc' })
  })

  it('keeps an avatar when present', () => {
    expect(toChatPeer({ id: 'abc', pfp: 'obj-1' })).toEqual({ id: 'abc', pfp: 'obj-1' })
  })
})
