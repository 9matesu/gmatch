import { describe, expect, it } from 'vitest'
import { classifyLocalFile, classifyStaticUrl, normalizeWatchUrl, providerForHost } from './watchSource'

describe('watchSource static classification', () => {
  it('accepts direct video URLs as static candidates', () => {
    const hint = classifyStaticUrl('https://cdn.example.com/clip.mp4?x=1')
    expect(hint.ok).toBe(true)
    expect(hint.ext).toBe('mp4')
  })

  it('rejects images and dangerous schemes with reasons', () => {
    expect(classifyStaticUrl('https://cdn.example.com/pic.jpg').reason).toMatch(/image/i)
    expect(classifyStaticUrl('javascript:alert(1)').reason).toMatch(/scheme/i)
    expect(classifyStaticUrl('ipfs://bafy').reason).toMatch(/not supported/i)
  })

  it('labels known providers and generic pages', () => {
    expect(providerForHost('x.com')).toBe('x')
    expect(providerForHost('www.redgifs.com')).toBe('redgifs')
    expect(providerForHost('pmvhaven.com')).toBe('pmvhaven')
    expect(providerForHost('gelbooru.com')).toBe('booru')
    expect(providerForHost('example.com')).toBe('page')
  })

  it('classifies local files by MIME, then extension', () => {
    expect(classifyLocalFile({ name: 'clip.mp4', type: 'video/mp4' }).ok).toBe(true)
    expect(classifyLocalFile({ name: 'pic.jpg', type: '' }).ok).toBe(false)
    expect(classifyLocalFile({ name: 'notes.txt', type: '' }).ok).toBe(false)
  })

  it('normalizes URLs for dedupe and drops unusable ones', () => {
    expect(normalizeWatchUrl('https://example.com/v#t=10')).toBe('https://example.com/v')
    expect(normalizeWatchUrl('javascript:alert(1)')).toBe('')
  })
})
