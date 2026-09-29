// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { getRoomVolume, setRoomVolume, readElementVolume, applyRoomVolume } from './watchVolume'

// The shared test setup does not expose a real localStorage, so stub one
// (same approach as onboardingState.test.ts / tourState.test.ts).
const store = new Map<string, string>()
const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  },
})
afterAll(() => {
  if (realLocalStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
  else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: realLocalStorage })
})

describe('per-room watch volume', () => {
  beforeEach(() => store.clear())

  it('defaults to full, unmuted for an unknown room', () => {
    expect(getRoomVolume('room-a')).toEqual({ volume: 1, muted: false })
    expect(getRoomVolume(null)).toEqual({ volume: 1, muted: false })
  })

  it('remembers per room and keeps rooms independent', () => {
    setRoomVolume('room-a', { volume: 0.25, muted: false })
    setRoomVolume('room-b', { volume: 0.9, muted: true })
    expect(getRoomVolume('room-a')).toEqual({ volume: 0.25, muted: false })
    expect(getRoomVolume('room-b')).toEqual({ volume: 0.9, muted: true })
  })

  it('survives a reload (it is localStorage, not React state)', () => {
    setRoomVolume('room-a', { volume: 0.3, muted: false })
    // A fresh read is what a remounted component sees.
    expect(getRoomVolume('room-a').volume).toBe(0.3)
  })

  it('merges a partial update', () => {
    setRoomVolume('room-a', { volume: 0.5, muted: false })
    setRoomVolume('room-a', { muted: true })
    expect(getRoomVolume('room-a')).toEqual({ volume: 0.5, muted: true })
  })

  it('clamps and rejects garbage from a corrupted store', () => {
    localStorage.setItem('gmatch_watch_volumes_v1', JSON.stringify({
      'room-a': { volume: 42, muted: 'yes' },
      'room-b': { volume: -3, muted: false },
      'room-c': { volume: 'loud', muted: false },
    }))
    expect(getRoomVolume('room-a').volume).toBe(1)
    expect(getRoomVolume('room-a').muted).toBe(true)
    expect(getRoomVolume('room-b').volume).toBe(0)
    // Non-numeric falls back to the default rather than NaN on the element.
    expect(getRoomVolume('room-c').volume).toBe(1)
  })

  it('returns defaults for an unparseable store instead of throwing', () => {
    localStorage.setItem('gmatch_watch_volumes_v1', 'not json')
    expect(getRoomVolume('room-a')).toEqual({ volume: 1, muted: false })
  })

  it('caps the number of remembered rooms', () => {
    for (let i = 0; i < 60; i++) setRoomVolume(`room-${i}`, { volume: 0.5, muted: false })
    const raw = JSON.parse(localStorage.getItem('gmatch_watch_volumes_v1') || '{}')
    expect(Object.keys(raw).length).toBeLessThanOrEqual(40)
    // The most recent write survived.
    expect(getRoomVolume('room-59').volume).toBe(0.5)
  })

  it('reads and applies an element, tolerating a missing one', () => {
    const v = document.createElement('video')
    v.volume = 0.4
    v.muted = true
    expect(readElementVolume(v)).toEqual({ volume: 0.4, muted: true })
    expect(readElementVolume(null)).toBeNull()

    applyRoomVolume(v, { volume: 0.8, muted: false })
    expect(v.volume).toBe(0.8)
    expect(v.muted).toBe(false)
    expect(() => applyRoomVolume(null, { volume: 1, muted: false })).not.toThrow()
  })
})
