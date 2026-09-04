import { describe, expect, it } from 'vitest'
import {
  REDGIFS_MEDIA,
  parseRedgifs,
  parseRedgifsToken,
  redgifsAuthUrl,
  redgifsPlayable,
  redgifsQuery,
  redgifsSearchUrl,
} from './redgifs'

const SAMPLE = {
  gifs: [
    {
      id: 'dentalswelteringdwarfrabbit',
      width: 1080,
      height: 1920,
      tags: ['Amateur', 'BBC', 'Blowjob'],
      niches: ['alt-girls', 'the-spiciest-of-spicy-content'],
      urls: {
        hd: 'https://media.redgifs.com/DentalSwelteringDwarfrabbit.mp4',
        poster: 'https://media.redgifs.com/DentalSwelteringDwarfrabbit-poster.jpg',
      },
    },
    { id: 'broken', urls: {} },
    'junk',
  ],
}

describe('redgifs adapter', () => {
  it('maps underscores to search words', () => {
    expect(redgifsQuery('skylar_vox')).toBe('skylar vox')
    expect(redgifsQuery('black_cock')).toBe('black cock')
  })

  it('parses search payloads into video posts', () => {
    const posts = parseRedgifs(SAMPLE)
    expect(posts).toHaveLength(1)
    const p = posts[0]
    expect(p.id).toBe('rg-dentalswelteringdwarfrabbit')
    expect(p.url).toMatch(/\.mp4$/)
    expect(p.kind).toBe('video')
    expect(p.rating).toBe('e')
    expect(p.preview).toMatch(/poster\.jpg$/)
    expect(p.tags).toContain('bbc')
    expect(p.tags).toContain('blowjob')
    expect(p.tags).toContain('alt_girls')
  })

  it('never throws on garbage', () => {
    expect(parseRedgifs(null)).toEqual([])
    expect(parseRedgifs({})).toEqual([])
    expect(parseRedgifs({ gifs: 'nope' })).toEqual([])
  })

  it('builds the temp-auth + search URLs (verified live)', () => {
    expect(redgifsAuthUrl()).toBe('https://api.redgifs.com/v2/auth/temporary')
    expect(parseRedgifsToken({ token: 'abc' })).toBe('abc')
    expect(parseRedgifsToken({})).toBeNull()
    expect(parseRedgifsToken(null)).toBeNull()
    const url = redgifsSearchUrl('skylar_vox', 10, 2)
    expect(url).toContain('search_text=skylar%20vox')
    expect(url).toContain('count=10')
    expect(url).toContain('page=2')
  })
})

describe('redgifsPlayable (dev same-origin media)', () => {
  // Vitest runs with import.meta.env.DEV === true, i.e. the vite-dev branch.
  it('rewrites media.redgifs.com bytes to /rg-media', () => {
    expect(redgifsPlayable(`${REDGIFS_MEDIA}/Foo.mp4`)).toBe('/rg-media/Foo.mp4')
  })

  it('passes other hosts through untouched', () => {
    expect(redgifsPlayable('https://tbib.org/images/1.jpg')).toBe('https://tbib.org/images/1.jpg')
  })
})
