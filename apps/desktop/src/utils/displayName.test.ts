// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  DISPLAY_NAME_KEY,
  SELF_NAME,
  UNKNOWN_NAME,
  isUsableName,
  ownDisplayName,
  resolveDisplayName,
  toNameRoster,
} from './displayName'

/** Node 26 exposes a `localStorage` global that throws without a --file flag,
 *  and jsdom's is not installed in this repo's setup. Stub it like the other
 *  storage tests do. */
function stubLocalStorage() {
  const data = new Map<string, string>()
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)) },
    removeItem: (k: string) => { data.delete(k) },
    clear: () => data.clear(),
  }
  const proxy = new Proxy(store, {
    ownKeys: () => Array.from(data.keys()),
    getOwnPropertyDescriptor: (_t, prop) =>
      typeof prop === 'string' && data.has(prop)
        ? { configurable: true, enumerable: true, value: data.get(prop) }
        : undefined,
  }) as unknown as Storage
  vi.stubGlobal('localStorage', proxy)
  return data
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const SELF = 'aaaa-self'
const PEER = 'bbbb-peer'

describe('isUsableName', () => {
  it('accepts ordinary names', () => {
    for (const n of ['Matco', 'Kenny', 'x', 'Lucy Lawless', 'a'.repeat(50)]) {
      expect(isUsableName(n), n).toBe(true)
    }
  })

  it('rejects empty, non-strings and whitespace', () => {
    for (const n of ['', '   ', null, undefined, 42, {}, []]) {
      expect(isUsableName(n), String(n)).toBe(false)
    }
  })

  it('rejects server-minted placeholder names', () => {
    // These are what an un-onboarded account renders as. Showing one as a real
    // name is worse than showing "Unknown User".
    for (const n of ['User', 'user', 'User_1da964', 'user-abc', 'Unknown User', 'Anonymous']) {
      expect(isUsableName(n), n).toBe(false)
    }
  })

  it('rejects implausible lengths', () => {
    expect(isUsableName('a'.repeat(51))).toBe(false)
  })

  it('accepts a long-but-legal name at the server limit', () => {
    // MAX_DISPLAY_NAME_LENGTH is 50; this must not be off-by-one rejected.
    expect(isUsableName('a'.repeat(50))).toBe(true)
  })
})

describe('ownDisplayName', () => {
  it('reads the shared storage key', () => {
    const store = stubLocalStorage()
    store.set(DISPLAY_NAME_KEY, 'Matco')
    expect(ownDisplayName()).toBe('Matco')
  })

  it('returns empty when unset or a placeholder', () => {
    const store = stubLocalStorage()
    expect(ownDisplayName()).toBe('')
    store.set(DISPLAY_NAME_KEY, 'User_1da964')
    expect(ownDisplayName()).toBe('')
  })

  it('returns empty rather than throwing when storage is unavailable', () => {
    // A private-mode / quota-exhausted read must degrade to the default, never
    // blow up a chat render.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
    })
    expect(ownDisplayName()).toBe('')
  })
})

describe('resolveDisplayName', () => {
  const roster = toNameRoster([
    { id: PEER, display_name: 'Roster Name' },
    { id: 'ccc-placeholder', display_name: 'User_1da964' },
  ])

  it('resolves the viewer to their own name', () => {
    const store = stubLocalStorage()
    store.set(DISPLAY_NAME_KEY, 'Matco')
    expect(resolveDisplayName({ selfId: SELF, senderId: SELF, roster })).toBe('Matco')
  })

  it('falls back to "You" when the viewer has no name set', () => {
    stubLocalStorage()
    expect(resolveDisplayName({ selfId: SELF, senderId: SELF, roster })).toBe(SELF_NAME)
  })

  it('prefers the name carried in the message over the roster', () => {
    // A renamed user must not have their whole history relabelled by a roster
    // that caught up late — the payload is the sender's name at send time.
    expect(
      resolveDisplayName({
        selfId: SELF,
        senderId: PEER,
        payloadName: 'Name At Send Time',
        roster,
      }),
    ).toBe('Name At Send Time')
  })

  it('falls through to the roster when the payload is unusable', () => {
    for (const payloadName of ['', '   ', 'User_1da964', null, undefined]) {
      expect(
        resolveDisplayName({ selfId: SELF, senderId: PEER, payloadName, roster }),
        String(payloadName),
      ).toBe('Roster Name')
    }
  })

  it('uses the caller fallback when the roster has no entry', () => {
    expect(
      resolveDisplayName({
        selfId: SELF,
        senderId: 'unknown-peer',
        roster,
        fallback: 'Thread Peer',
      }),
    ).toBe('Thread Peer')
  })

  it('resolves UNKNOWN_NAME when every source is unusable', () => {
    expect(resolveDisplayName({ selfId: SELF, senderId: 'nobody', roster })).toBe(UNKNOWN_NAME)
    expect(
      resolveDisplayName({ selfId: SELF, senderId: PEER, payloadName: '', roster: null, fallback: null }),
    ).toBe(UNKNOWN_NAME)
  })

  it('NEVER renders a remote sender under the viewer own name', () => {
    // The reported bug: a stranger showed up as "dev" — the viewer's own
    // username — because the hub passed its own name down as the universal
    // fallback and the resolver applied it to any sender.
    const store = stubLocalStorage()
    store.set(DISPLAY_NAME_KEY, 'dev')
    // A peer the roster has never heard of, with no name on the payload: the
    // exact shape that used to fall through to the viewer's own name.
    const stranger = 'stranger-outside-roster'
    expect(resolveDisplayName({ selfId: SELF, senderId: stranger, roster })).not.toBe('dev')
    // Even when the caller explicitly hands the viewer's own name back.
    expect(
      resolveDisplayName({ selfId: SELF, senderId: stranger, roster, fallback: ownDisplayName() }),
    ).toBe(UNKNOWN_NAME)
  })

  it('still resolves SELF to the viewer own name', () => {
    const store = stubLocalStorage()
    store.set(DISPLAY_NAME_KEY, 'dev')
    expect(resolveDisplayName({ selfId: SELF, senderId: SELF, roster })).toBe('dev')
  })

  it('a genuine per-sender fallback still works even if it collides with ours', () => {
    // Two accounts may share a display name. Guarding the leak must not break
    // the legitimate case, so the refusal is scoped to remote senders only.
    const other = toNameRoster([{ orbitId: 'other', display_name: 'dev' }])
    expect(
      resolveDisplayName({ selfId: SELF, senderId: 'other', roster: other, fallback: 'dev' }),
    ).toBe('dev')
  })

  it('ignores a placeholder in the roster', () => {
    // The row exists but its name is a minted default: "Unknown User" is the
    // honest answer, not "User_1da964".
    expect(resolveDisplayName({ selfId: SELF, senderId: 'ccc-placeholder', roster })).toBe(UNKNOWN_NAME)
  })

  it('accepts a roster entry that uses `name` instead of `display_name`', () => {
    const alt = toNameRoster([{ orbitId: PEER, name: 'Alt Shape' }])
    expect(resolveDisplayName({ selfId: SELF, senderId: PEER, roster: alt })).toBe('Alt Shape')
  })

  it('never treats a 0x-prefixed or long value as a name', () => {
    // displayNameFor used to reject these outright and render 'User'. If such a
    // value really is someone's chosen name, the payload path still shows it —
    // the check is about not inventing names from ids, not about censoring.
    const odd = toNameRoster([{ id: PEER, display_name: '0xdeadbeef' }])
    expect(resolveDisplayName({ selfId: SELF, senderId: PEER, roster: odd })).toBe('0xdeadbeef')
    expect(
      resolveDisplayName({ selfId: SELF, senderId: PEER, payloadName: 'x'.repeat(80) }),
    ).toBe(UNKNOWN_NAME)
  })

  it('tolerates a missing self id (logged-out render pass)', () => {
    expect(resolveDisplayName({ senderId: PEER, payloadName: 'Anon', roster })).toBe('Anon')
  })
})

describe('toNameRoster', () => {
  it('keys on id or orbitId and skips rows with neither', () => {
    const map = toNameRoster([
      { id: 'a', display_name: 'A' },
      { orbitId: 'b', display_name: 'B' },
      { display_name: 'C' },
    ])
    expect([...map.keys()]).toEqual(['a', 'b'])
  })
})
