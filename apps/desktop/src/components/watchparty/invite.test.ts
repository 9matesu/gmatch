import { describe, expect, it } from 'vitest'
import { watchInviteFromHash, watchRoomFromHash, stripWatchRoom } from './invite'

describe('watch invite links', () => {
  it('parses room-only links', () => {
    expect(watchInviteFromHash('#/watch?room=abcdef12')).toEqual({ room: 'abcdef12' })
    expect(watchRoomFromHash('#/watch?room=ABCDEF12')).toBe('abcdef12')
  })

  it('parses valid private invite tokens and ignores malformed ones', () => {
    const token = 'a'.repeat(32)
    expect(watchInviteFromHash(`#/watch?room=abcdef12&invite=${token}`)).toEqual({ room: 'abcdef12', invite: token })
    expect(watchInviteFromHash('#/watch?room=abcdef12&invite=short')).toEqual({ room: 'abcdef12' })
    expect(watchInviteFromHash('#/watch?room=nope')).toBeNull()
  })

  it('strips invite query state from the address bar', () => {
    expect(stripWatchRoom('#/watch?room=abcdef12&invite=1')).toBe('#/watch')
  })
})
