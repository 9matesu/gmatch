import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playCountdownOnce, playMatchOnce, throttled } from './sounds'

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { AudioContext?: unknown }).AudioContext = class {
    currentTime = 0
    state = 'running'
    sampleRate = 44100
    destination = {}
    resume() { return Promise.resolve() }
    createOscillator() {
      const gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
      return { type: '', frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(() => ({ connect: vi.fn() })), start: vi.fn(), stop: vi.fn(), _gain: gain }
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(() => ({ connect: vi.fn() })) }
    }
    createBuffer(_ch: number, len: number) { return { getChannelData: () => new Float32Array(len) } }
    createBufferSource() { return { buffer: null, connect: vi.fn(() => ({ connect: vi.fn(() => ({ connect: vi.fn() })) })), start: vi.fn(), stop: vi.fn() } }
    createBiquadFilter() { return { type: '', frequency: 0, Q: 0, connect: vi.fn(() => ({ connect: vi.fn(() => ({ connect: vi.fn() })) })) } }
  }
})
afterEach(() => { vi.useRealTimers() })

describe('sfx throttle', () => {
  it('collapses burst calls of the same key inside the window', () => {
    let n = 0
    const fn = throttled(() => { n += 1 }, 400)
    fn(); fn(); fn()
    expect(n).toBe(1)
    vi.advanceTimersByTime(401)
    fn()
    expect(n).toBe(2)
  })

  it('distinct keys do not suppress each other', () => {
    let a = 0; let b = 0
    const fa = throttled(() => { a += 1 }, 400, 'a')
    const fb = throttled(() => { b += 1 }, 400, 'b')
    fa(); fa(); fb(); fb()
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  it('game-event wrappers exist and survive bursts', () => {
    expect(() => {
      for (let i = 0; i < 8; i++) { playMatchOnce(); playCountdownOnce() }
    }).not.toThrow()
  })
})
