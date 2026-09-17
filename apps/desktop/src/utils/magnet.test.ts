import { describe, it, expect } from 'vitest'
import { isMagnetUri, getInfoHashFromMagnet, buildMagnetUri } from './magnet'

describe('magnet utilities', () => {
  it('detects magnet URIs correctly', () => {
    expect(isMagnetUri('magnet:?xt=urn:btih:da39a3ee5e6b4b0d3255bfef95601890afd80709')).toBe(true)
    expect(isMagnetUri('urn:sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(false)
    expect(isMagnetUri('/api/objects/123')).toBe(false)
    expect(isMagnetUri('')).toBe(false)
  })

  it('extracts info-hash from magnet URIs', () => {
    const hash = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    const magnet = `magnet:?xt=urn:btih:${hash}&dn=card.mp4&tr=wss%3A%2F%2Ftracker.openwebtorrent.com`
    expect(getInfoHashFromMagnet(magnet)).toBe(hash)
    expect(getInfoHashFromMagnet('invalid-url')).toBeNull()
  })

  it('builds canonical magnet URI with open WebTorrent trackers', () => {
    const hash = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    const magnet = buildMagnetUri(hash, 'card.mp4')
    expect(magnet).toContain(`xt=urn:btih:${hash}`)
    expect(magnet).toContain('dn=card.mp4')
    expect(magnet).toContain('tracker.openwebtorrent.com')
  })
})
