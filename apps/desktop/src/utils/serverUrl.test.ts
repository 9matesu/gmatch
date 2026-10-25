import { describe, it, expect } from 'vitest'
import { isCurrentServerUrl } from './serverUrl'

describe('isCurrentServerUrl', () => {
  it('matches hint against base across scheme/trailing-slash/case', () => {
    expect(isCurrentServerUrl('https://gmatch.pages.dev', 'gmatch.pages.dev')).toBe(true)
    expect(isCurrentServerUrl('http://10.0.0.5:8790/', '10.0.0.5:8790')).toBe(true)
    expect(isCurrentServerUrl('https://a.test', 'https://b.test')).toBe(false)
    expect(isCurrentServerUrl('https://a.test', '')).toBe(false)
  })
})
