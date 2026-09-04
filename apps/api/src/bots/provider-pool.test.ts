import { describe, it, expect } from 'vitest'
import { pickWeightedProvider, orderByWeightDesc, validateProviderUrl } from './provider-pool'

describe('provider-pool', () => {
  it('picks an enabled provider', () => {
    const providers = [
      { id: 'a', enabled: false },
      { id: 'b', enabled: true },
    ]
    expect(pickWeightedProvider(providers)?.id).toBe('b')
  })

  it('returns undefined when no providers are enabled', () => {
    expect(pickWeightedProvider([{ id: 'a', enabled: false }])).toBeUndefined()
  })

  it('honors weights for a large sample (roughly)', () => {
    const providers = [
      { id: 'heavy', enabled: true, weight: 1000 },
      { id: 'light', enabled: true, weight: 1 },
    ]
    let heavy = 0
    for (let i = 0; i < 200; i++) {
      if (pickWeightedProvider(providers)?.id === 'heavy') heavy++
    }
    expect(heavy).toBeGreaterThan(180)
  })

  it('orders providers by descending weight', () => {
    const ordered = orderByWeightDesc([
      { id: 'low', enabled: true, weight: 1 },
      { id: 'high', enabled: true, weight: 10 },
      { id: 'mid', enabled: true, weight: 5 },
    ])
    expect(ordered.map((p) => p.id)).toEqual(['high', 'mid', 'low'])
  })

  it('validates provider URLs against private/internal hosts', () => {
    expect(validateProviderUrl('https://api.waifu.im/search').ok).toBe(true)
    expect(validateProviderUrl('http://localhost:8080/x').ok).toBe(false)
    expect(validateProviderUrl('http://127.0.0.1/x').ok).toBe(false)
    expect(validateProviderUrl('http://192.168.1.10/x').ok).toBe(false)
    expect(validateProviderUrl('http://10.0.0.5/x').ok).toBe(false)
    expect(validateProviderUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false)
    expect(validateProviderUrl('http://host.internal/x').ok).toBe(false)
    expect(validateProviderUrl('ftp://example.com').ok).toBe(false)
    expect(validateProviderUrl('not a url').ok).toBe(false)
  })
})
