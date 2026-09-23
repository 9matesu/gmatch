import { describe, expect, it } from 'vitest'
import {
  REDGIFS_MEDIA,
  parseRedgifs,
  parseRedgifsNiches,
  parseRedgifsToken,
  pickRedgifsNiche,
  redgifsAuthUrl,
  redgifsNicheGifsUrl,
  redgifsNicheMatchesQuery,
  redgifsNicheSearchUrl,
  redgifsPlayable,
  redgifsQuery,
  redgifsQueryTags,
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

  it('builds niche search + gif-list URLs (verified live)', () => {
    expect(redgifsNicheSearchUrl('fair haired')).toBe(
      'https://api.redgifs.com/v2/niches/search?query=fair%20haired',
    )
    expect(redgifsNicheGifsUrl('fair-haired', 15, 3)).toBe(
      'https://api.redgifs.com/v2/niches/fair-haired/gifs?count=15&page=3',
    )
    expect(redgifsQueryTags('Skylar_Vox bbc')).toEqual(['skylar', 'vox', 'bbc'])
  })
})

describe('redgifs niches (query-aware search)', () => {
  const NICHES = parseRedgifsNiches({
    niches: [
      { id: 'fair-haired', name: 'Fair-Haired', tags: ['Blonde', 'Pale'], subscribers: 92705 },
      { id: 'pornstars', name: 'Pornstars', tags: ['Pornstar', 'XXX'], subscribers: 136907 },
      { id: 'sluty-milfs', name: 'Slutty MILFs', tags: ['MILF', 'Mom'], subscribers: 68409 },
    ],
  })

  it('parses niche payloads', () => {
    expect(NICHES).toHaveLength(3)
    expect(NICHES[0]).toMatchObject({ id: 'fair-haired', subscribers: 92705 })
    expect(NICHES[0].tags).toContain('blonde')
    expect(parseRedgifsNiches(null)).toEqual([])
    expect(parseRedgifsNiches({})).toEqual([])
  })

  it('picks the niche overlapping the query tokens', () => {
    expect(pickRedgifsNiche('blonde', NICHES)?.id).toBe('fair-haired')
    expect(pickRedgifsNiche('mom curves', NICHES)?.id).toBe('sluty-milfs')
  })

  it('refuses fragment-only niche matches (wrong-tag rounds)', () => {
    // `sky` shares a fragment with `skylar_vox` but no full token: electing
    // it used to stamp foreign posts with the query tags (mistag pipeline).
    const frag = parseRedgifsNiches({
      niches: [{ id: 'sky-high', name: 'Sky High', tags: ['Sky'], subscribers: 999999 }],
    })
    expect(pickRedgifsNiche('skylar_vox', frag)).toBeNull()
    // A full-token niche still elects.
    const exact = parseRedgifsNiches({
      niches: [{ id: 'skylar-vox', name: 'Skylar Vox', tags: [], subscribers: 10 }],
    })
    expect(pickRedgifsNiche('skylar_vox', exact)?.id).toBe('skylar-vox')
  })

  it('gates query-tag stamping on full-token niche agreement', () => {
    const frag = parseRedgifsNiches({
      niches: [{ id: 'sky-high', name: 'Sky High', tags: ['Sky'], subscribers: 1 }],
    })[0]
    const exact = parseRedgifsNiches({
      niches: [{ id: 'skylar-vox', name: 'Skylar Vox', tags: [], subscribers: 1 }],
    })[0]
    expect(redgifsNicheMatchesQuery(exact, 'skylar_vox')).toBe(true)
    expect(redgifsNicheMatchesQuery(frag, 'skylar_vox')).toBe(false)
    expect(redgifsNicheMatchesQuery(frag, '')).toBe(false)
  })

  it('returns null for pornstar names with no niche overlap (generic fallback)', () => {
    expect(pickRedgifsNiche('skylar vox', NICHES)).toBeNull()
    expect(pickRedgifsNiche('', NICHES)).toBeNull()
    expect(pickRedgifsNiche('blonde', [])).toBeNull()
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
