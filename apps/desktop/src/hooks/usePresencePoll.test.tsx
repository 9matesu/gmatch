// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { usePresencePoll, __resetPresencePollForTests } from './usePresencePoll'
import { usePresence, __resetPresenceForTests } from '../game/presenceStore'
import * as api from '../utils/api'

const identity = { orbitId: 'me' } as never

function Mount() {
  usePresencePoll(identity)
  return null
}

function dash(users: unknown[], online = 1, active = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ users, online_count: online, active_24h_count: active }),
  } as Response
}

describe('shared presence poll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetPresenceForTests()
    __resetPresencePollForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('feeds the store on mount', async () => {
    vi.spyOn(api, 'orbitFetch').mockResolvedValue(
      dash([{ id: 'u1', display_name: 'U1', online: true, last_seen: new Date().toISOString() }], 3, 9),
    )
    render(<Mount />)
    await vi.waitFor(() => expect(usePresence.getState().isOnline('u1')).toBe(true))
    expect(usePresence.getState().counts).toEqual({ online: 3, active: 9 })
  })

  it('polls ONCE no matter how many consumers are mounted', async () => {
    const spy = vi.spyOn(api, 'orbitFetch').mockResolvedValue(dash([]))
    render(
      <>
        <Mount />
        <Mount />
        <Mount />
      </>,
    )
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  })

  it('reuses the same store for every consumer, so they cannot disagree', async () => {
    vi.spyOn(api, 'orbitFetch').mockResolvedValue(
      dash([{ id: 'u1', online: true, last_seen: new Date().toISOString() }]),
    )
    render(<Mount />)
    await vi.waitFor(() => expect(usePresence.getState().isOnline('u1')).toBe(true))
    // Two independent reads of the single source of truth.
    expect(usePresence.getState().isOnline('u1')).toBe(usePresence.getState().isOnline('u1'))
  })

  it('stops polling once the last consumer unmounts', async () => {
    const spy = vi.spyOn(api, 'orbitFetch').mockResolvedValue(dash([]))
    const { unmount } = render(<Mount />)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    // A second tick would prove the interval is still alive after teardown.
    vi.useFakeTimers()
    unmount()
    vi.advanceTimersByTime(120_000)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while at least one consumer is still mounted', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(api, 'orbitFetch').mockResolvedValue(dash([]))
    function One() {
      usePresencePoll(identity)
      return null
    }
    function Two() {
      usePresencePoll(identity)
      return null
    }
    const first = render(<One />)
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalledTimes(1)
    // One of the two consumers leaves; the other still wants presence.
    first.rerender(<Two />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spy.mock.calls.length).toBeGreaterThan(1)
  })

  it('still polls before an identity exists, so the header counts are never blank', async () => {
    // The dashboard answers without an identity, and the chat header shows the
    // server's online/24h counts before the local identity has loaded.
    const spy = vi.spyOn(api, 'orbitFetch').mockResolvedValue(dash([], 4, 8))
    function NoId() {
      usePresencePoll(null)
      return null
    }
    render(<NoId />)
    await vi.waitFor(() => expect(usePresence.getState().counts).toEqual({ online: 4, active: 8 }))
    expect(spy).toHaveBeenCalled()
  })

  it('survives a failed poll and does not throw', async () => {
    vi.spyOn(api, 'orbitFetch').mockRejectedValue(new Error('offline'))
    expect(() => render(<Mount />)).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(usePresence.getState().counts).toBe(null)
  })

  it('clears counts when the server stops sending them', async () => {
    vi.spyOn(api, 'orbitFetch')
      .mockResolvedValueOnce(dash([], 4, 8))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ users: [] }) } as Response)
    function Switch({ id }: { id: string }) {
      usePresencePoll({ orbitId: id } as never)
      return null
    }
    const { rerender } = render(<Switch id="a" />)
    await vi.waitFor(() => expect(usePresence.getState().counts).toEqual({ online: 4, active: 8 }))
    // Switching node re-polls; this response carries no counts.
    rerender(<Switch id="b" />)
    await vi.waitFor(() => expect(usePresence.getState().counts).toBe(null))
  })
})
