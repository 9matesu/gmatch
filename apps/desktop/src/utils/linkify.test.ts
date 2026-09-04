import { describe, it, expect } from 'vitest'
import { tokenizeUrls, containsUrl } from './linkify'

describe('tokenizeUrls', () => {
  it('leaves plain text untouched', () => {
    expect(tokenizeUrls('hello world')).toEqual([{ type: 'text', value: 'hello world' }])
  })

  it('splits a bare URL out of surrounding text', () => {
    const tokens = tokenizeUrls('join us at https://discord.gg/WMEz9jgr3 ok')
    expect(tokens).toEqual([
      { type: 'text', value: 'join us at ' },
      { type: 'url', value: 'https://discord.gg/WMEz9jgr3' },
      { type: 'text', value: ' ok' },
    ])
  })

  it('normalizes a www. URL with an http href', () => {
    const tokens = tokenizeUrls('see www.example.com here')
    expect(tokens[1]).toEqual({ type: 'url', value: 'http://www.example.com' })
  })

  it('trims trailing punctuation from a URL', () => {
    const tokens = tokenizeUrls('link: https://example.com/a,b.')
    expect(tokens[1].type).toBe('url')
    expect(tokens[1].value).toBe('https://example.com/a,b')
  })

  it('handles multiple URLs and preserves newlines in text segments', () => {
    const text = 'a https://x.io b\nc https://y.com d'
    const urls = tokenizeUrls(text).filter((t) => t.type === 'url')
    expect(urls.map((t) => t.value)).toEqual(['https://x.io', 'https://y.com'])
  })

  it('containsUrl detects URLs', () => {
    expect(containsUrl('no links here')).toBe(false)
    expect(containsUrl('visit https://goonmatch.fly.dev')).toBe(true)
  })
})