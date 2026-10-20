// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { wsUrlForBase } from './api'

/**
 * The API base -> WebSocket URL rule had two copies, and they drifted: the
 * swarm socket knew that a relative base means "same origin, ride the dev
 * proxy", the courier mail socket did not. In browser dev the mail socket
 * therefore asked for `ws:///api/mail/ws`, which throws — so DMs, delivery
 * acks and read receipts only ever landed on a manual pull. One owner now, and
 * these pin every shape that matters (packaged sidecar, browser dev, remote
 * node, https).
 */

describe('wsUrlForBase', () => {
  const realLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true })
  })

  function at(origin: string, protocol = 'http:') {
    Object.defineProperty(window, 'location', {
      value: { host: new URL(origin).host, origin, protocol },
      writable: true,
      configurable: true,
    })
  }

  it('a relative base rides the page origin — never an invalid ws:/// url', () => {
    at('http://localhost:5273')
    const url = wsUrlForBase('', '/api/mail/ws')
    expect(url).toBe('ws://localhost:5273/api/mail/ws')
    expect(() => new URL(url)).not.toThrow()
  })

  it('a relative base on https upgrades to wss', () => {
    at('https://dev.example.test', 'https:')
    expect(wsUrlForBase(undefined, '/api/mail/ws')).toBe('wss://dev.example.test/api/mail/ws')
  })

  it('an absolute http base becomes ws with the path appended', () => {
    expect(wsUrlForBase('http://127.0.0.1:8790', '/api/mail/ws')).toBe('ws://127.0.0.1:8790/api/mail/ws')
  })

  it('an absolute https base becomes wss and a trailing slash is ignored', () => {
    expect(wsUrlForBase('https://node.example.test///', '/api/ws')).toBe('wss://node.example.test/api/ws')
  })

  it('a path without a leading slash still becomes absolute', () => {
    expect(wsUrlForBase('http://127.0.0.1:8790', 'api/ws')).toBe('ws://127.0.0.1:8790/api/ws')
  })
})
