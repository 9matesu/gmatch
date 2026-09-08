import { describe, expect, it } from 'vitest'
import {
  isServerUrl,
  normalizeServerUrl,
  resolveServerUrl,
} from '../../electron/server-mode-core.cjs'
import {
  isServerUrl as isServerUrlTs,
  normalizeServerUrl as normalizeServerUrlTs,
} from '../utils/serverUrl'

describe('server-mode-core (no central server, P-R3)', () => {
  it('accepts http(s) host[:port] urls only', () => {
    expect(isServerUrl('http://192.168.0.42:8790')).toBe(true)
    expect(isServerUrl('https://grid.example.com')).toBe(true)
    expect(isServerUrl('file:///c:/x')).toBe(false)
    expect(isServerUrl('javascript:alert(1)')).toBe(false)
    expect(isServerUrl('')).toBe(false)
    expect(normalizeServerUrl('http://a.b:8790///')).toBe('http://a.b:8790')
  })

  it('resolveServerUrl: env > stored client > host default', () => {
    expect(
      resolveServerUrl({ envUrl: 'http://env:1', stored: { mode: 'client', url: 'http://st:2' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'client', url: 'http://env:1' })
    expect(
      resolveServerUrl({ stored: { mode: 'client', url: 'http://st:2' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'client', url: 'http://st:2' })
    expect(
      resolveServerUrl({ stored: { mode: 'client', url: 'garbage' }, hostUrl: 'http://127.0.0.1:8790' }),
    ).toEqual({ mode: 'host', url: 'http://127.0.0.1:8790' })
    expect(resolveServerUrl({ hostUrl: 'http://127.0.0.1:8790' })).toEqual({ mode: 'host', url: 'http://127.0.0.1:8790' })
  })

  it('renderer TS mirror behaves identically (drift guard)', () => {
    expect(isServerUrlTs('http://192.168.0.42:8790')).toBe(true)
    expect(isServerUrlTs('javascript:alert(1)')).toBe(false)
    expect(normalizeServerUrlTs('http://a.b:8790///')).toBe('http://a.b:8790')
    expect(normalizeServerUrlTs('nope')).toBe(null)
  })
})
