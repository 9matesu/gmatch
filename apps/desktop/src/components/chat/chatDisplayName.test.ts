// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { chatDisplayName } from './chatDisplayName'
import { toNameRoster } from '../../utils/displayName'

function stubLocalStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)) },
    removeItem: (k: string) => { data.delete(k) },
    clear: () => data.clear(),
  } as unknown as Storage)
  return data
}

afterEach(() => vi.unstubAllGlobals())

const SELF = 'me'
const PEER = 'peer'

describe('chatDisplayName', () => {
  const roster = toNameRoster([
    { id: PEER, name: 'Roster Name' },
    { id: 'placeholder', name: 'User_1da964' },
  ])

  it('keeps the fixed labels for the two public channels', () => {
    expect(chatDisplayName({ id: 'global_lobby' })).toBe('Lobby Lounge (Everyone)')
    expect(chatDisplayName({ id: 'card_queue' })).toBe('Card Game Queue')
    // Even with a name attached, a channel is not a person.
    expect(chatDisplayName({ id: 'global_lobby', payloadName: 'someone' })).toBe('Lobby Lounge (Everyone)')
  })

  it('prefers the name carried on the message', () => {
    // Sealed DMs and rooms now carry one; this is what fixed rooms rendering
    // every sender as "User".
    expect(
      chatDisplayName({ id: PEER, payloadName: 'Message Name', roster }),
    ).toBe('Message Name')
  })

  it('falls back to the roster when the message carries no name', () => {
    expect(chatDisplayName({ id: PEER, roster })).toBe('Roster Name')
  })

  it('returns "Unknown User" for a peer in no source (never a bare "User")', () => {
    // The old chain returned 'User' here, which reads like a real name and
    // made an unlabelled stranger look like an account called "User".
    expect(chatDisplayName({ id: 'stranger', roster })).toBe('Unknown User')
  })

  it('does not downgrade an unusual but real name', () => {
    // The old code rejected any name starting '0x' or longer than 32 chars and
    // showed 'User' instead. A name is a name.
    const odd = toNameRoster([{ id: PEER, name: '0xNinja' }])
    expect(chatDisplayName({ id: PEER, roster: odd })).toBe('0xNinja')
    const long = toNameRoster([{ id: PEER, name: 'x'.repeat(40) }])
    expect(chatDisplayName({ id: PEER, roster: long })).toBe('x'.repeat(40))
  })

  it('ignores a minted placeholder name in the roster', () => {
    expect(chatDisplayName({ id: 'placeholder', roster })).toBe('Unknown User')
  })

  it('renders the viewer as their own name, or "You"', () => {
    const store = stubLocalStorage()
    store.set('orbit_display_name', 'Matco')
    expect(chatDisplayName({ id: SELF, selfId: SELF, roster })).toBe('Matco')
    // A stale name on a message must not relabel you as somebody else.
    expect(chatDisplayName({ id: SELF, selfId: SELF, payloadName: 'Old Name', roster })).toBe('Matco')
  })

  it('works with no roster at all (logged-out / not yet loaded)', () => {
    stubLocalStorage()
    expect(chatDisplayName({ id: PEER, payloadName: 'Kenny' })).toBe('Kenny')
    expect(chatDisplayName({ id: PEER })).toBe('Unknown User')
  })
})
