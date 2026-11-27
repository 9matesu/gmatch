import { describe, expect, it } from 'vitest'
import { thumbUrl } from './thumb'

describe('thumbUrl', () => {
  it('points the local cache at the thumbnail route', () => {
    expect(thumbUrl('gmcache://f/abc123.jpg')).toBe('gmcache://thumb/abc123.jpg')
  })

  it('leaves an already-thumbnailed url alone', () => {
    expect(thumbUrl('gmcache://thumb/abc123.jpg')).toBe('gmcache://thumb/abc123.jpg')
  })

  it('does not invent a thumbnail for a remote or vault url', () => {
    // There is no server-side resizer: claiming one would 404.
    expect(thumbUrl('https://e.test/a.jpg')).toBe('https://e.test/a.jpg')
    expect(thumbUrl('vault://f/deadbeef')).toBe('vault://f/deadbeef')
  })

  it('passes an empty url through', () => {
    expect(thumbUrl(undefined)).toBeUndefined()
    expect(thumbUrl('')).toBeUndefined()
  })
})
