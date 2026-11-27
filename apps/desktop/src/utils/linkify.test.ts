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
    expect(containsUrl('visit https://gmatch.pages.dev')).toBe(true)
  })
})

/**
 * A URL that becomes an <a href> is a scheme the browser may ACT on, not just
 * text. Peer-authored captions and DMs are untrusted input, so an executable
 * scheme must degrade to inert text rather than a live sink.
 */
describe('linkify rejects executable schemes (security)', () => {
  const dangerous = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'tg://resolve?domain=x',
    'about:blank',
  ]

  for (const url of dangerous) {
    it(`does not linkify ${url}`, () => {
      const tokens = tokenizeUrls(`click ${url} now`)
      // The dangerous token must survive as TEXT, never as a url token.
      expect(tokens.some((t) => t.type === 'url')).toBe(false)
      expect(tokens.map((t) => t.value).join('')).toContain(url)
    })
  }

  it('still linkifies a real share link', () => {
    const tokens = tokenizeUrls('see https://gmatch.pages.dev/p/abc')
    expect(tokens.filter((t) => t.type === 'url')).toHaveLength(1)
  })

  it('does not linkify a bare www. token that resolves to a non-http scheme', () => {
    // `www.` always normalizes to http://, so this must stay a link.
    const tokens = tokenizeUrls('go to www.example.com')
    expect(tokens[1]).toEqual({ type: 'url', value: 'http://www.example.com' })
  })
})