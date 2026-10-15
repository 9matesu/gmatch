import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  ALL_SOURCES,
  DIRECT_SOURCES,
  capabilitiesFor,
  devFetchable,
  pxAllowHosts,
  pxAllowPattern,
  refererFor,
  sourceByHealthId,
  sourceByKind,
  sourceById,
  sourcesForTags,
} from './booruSources'

/**
 * Registry guards. The registry exists to kill drift between the renderer's
 * source list, Electron main's source list and the vite dev proxy — so these
 * tests assert the three AGREE, not just that each one is internally valid.
 * Without them, adding a mirror in one place and forgetting the other two is
 * exactly the bug that shipped allgirl.booru.org and rule34.booru.org as
 * main-only sources for months.
 */

const require = createRequire(import.meta.url)
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const MAIN_CJS = join(REPO_ROOT, 'apps', 'desktop', 'electron', 'main.cjs')
const REGISTRY_CJS = join(REPO_ROOT, 'apps', 'desktop', 'electron', 'booru-registry.cjs')

/** Shared sources.json read the way main.cjs reads it. */
const loadRegistryCaps = (): { sources: Array<{ id: string; caps?: unknown }> } =>
  require(REGISTRY_CJS).loadRegistry({ isPackaged: false })

describe('booru source registry', () => {
  it('every source has the fields both runtimes need', () => {
    for (const s of ALL_SOURCES) {
      expect(s.id, `${s.id}: id`).toBeTruthy()
      expect(s.healthId, `${s.id}: healthId`).toBeTruthy()
      expect(['real', 'hentai'], `${s.id}: category`).toContain(s.category)
      expect(s.origin.startsWith('https://'), `${s.id}: origin must be https`).toBe(true)
      expect(() => new URL(s.origin), `${s.id}: origin parses`).not.toThrow()
    }
  })

  it('ids and healthIds are unique', () => {
    const ids = ALL_SOURCES.map((s) => s.id)
    const health = ALL_SOURCES.map((s) => s.healthId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(health).size).toBe(health.length)
  })

  it('devProxy prefixes are unique so no proxy can shadow another', () => {
    const prefixes = ALL_SOURCES.map((s) => s.devProxy).filter((p): p is string => !!p)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('booru.org mirrors declare the shared parent referer', () => {
    // The subdomains serve from a shared CDN; the parent referer is what all
    // four hand-copied maps agreed on and what the mirrors accept.
    for (const s of ALL_SOURCES.filter((x) => x.origin.includes('.booru.org'))) {
      expect(s.referer, `${s.id} referer`).toBe('https://booru.org/')
    }
  })

  it('moebooru sources declare the id prefix their parser stamps', () => {
    for (const s of ALL_SOURCES.filter((x) => x.kind === 'moebooru')) {
      expect(s.parsePrefix, `${s.id}: parsePrefix`).toBeTruthy()
    }
  })

  it('lookups resolve by canonical id, health id and kind', () => {
    expect(sourceById('tbib')?.origin).toBe('https://tbib.org')
    expect(sourceByHealthId('tbib-direct')?.id).toBe('tbib')
    expect(sourceByKind('babesource')?.id).toBe('babesource')
    expect(sourceById('nope')).toBeUndefined()
  })
})

describe('DIRECT_SOURCES (renderer dev-proxy path)', () => {
  it('carries every dapi/moebooru/realhtml/booruorg source with a devProxy', () => {
    const eligible = ALL_SOURCES.filter(
      (s) => ['dapi', 'moebooru', 'realhtml', 'booruorg'].includes(s.kind) && s.devProxy,
    )
    expect(DIRECT_SOURCES.length).toBe(eligible.length)
    for (const s of eligible) {
      expect(DIRECT_SOURCES.map((d) => d.id), `${s.id} must be reachable in dev`).toContain(s.healthId)
    }
  })

  it('never includes a scraper-only kind', () => {
    for (const d of DIRECT_SOURCES) {
      expect(['dapi', 'moebooru', 'realhtml', 'booruorg']).toContain(d.type)
    }
  })

  it('excludes scrapers, which dapiFallbacks drives directly', () => {
    for (const kind of ['redgifs', 'babesource', 'imhentai', 'paheal'] as const) {
      const s = sourceByKind(kind)
      if (!s) continue
      expect(DIRECT_SOURCES.map((d) => d.id), `${s.id} must not be a DIRECT source`).not.toContain(s.healthId)
    }
  })
})

describe('refererFor', () => {
  it('returns the registry referer for a mirror origin', () => {
    expect(refererFor('realbooru.com')).toBe('https://realbooru.com/')
    expect(refererFor('imhentai.xxx')).toBe('https://imhentai.xxx/')
    expect(refererFor('rule34.paheal.net')).toBe('https://rule34.paheal.net/')
  })

  it('returns the parent referer for every booru.org mirror', () => {
    for (const s of ALL_SOURCES.filter((x) => x.origin.includes('.booru.org'))) {
      expect(refererFor(new URL(s.origin).hostname), `${s.id}`).toBe('https://booru.org/')
    }
  })

  it('resolves a media host through its source (redgifs CDN, babesource thumbs)', () => {
    expect(refererFor('media.redgifs.com')).toBe('https://www.redgifs.com/')
    expect(refererFor('media.babesource.com')).toBe('https://babesource.com/')
  })

  it('falls back to own origin for an unknown host', () => {
    expect(refererFor('example.com')).toBe('https://example.com/')
  })
})

describe('devFetchable', () => {
  it('routes registry origins through their same-origin prefix', () => {
    expect(devFetchable('https://tbib.org/index.php?page=dapi')).toBe('/booru/tbib/index.php?page=dapi')
    expect(devFetchable('https://konachan.com/post.json')).toBe('/booru/kona/post.json')
  })

  it('routes the redgifs CDN through its media prefix', () => {
    expect(devFetchable('https://media.redgifs.com/m/abc.mp4')).toBe('/rg-media/m/abc.mp4')
  })

  it('routes redirect/hotlink hosts through /px', () => {
    // yande.re 302s bytes to files.yande.re; a path proxy passes the 302
    // through and the browser then dies on CORS.
    expect(devFetchable('https://yande.re/image/x.png')).toBe(
      `/px?u=${encodeURIComponent('https://yande.re/image/x.png')}`,
    )
    expect(devFetchable('https://files.yande.re/image/x.png')).toBe(
      `/px?u=${encodeURIComponent('https://files.yande.re/image/x.png')}`,
    )
  })

  it('refuses non-https and unknown hosts', () => {
    expect(devFetchable('http://tbib.org/x.png')).toBeNull()
    expect(devFetchable('https://unknown.example/x.png')).toBeNull()
    expect(devFetchable('not a url')).toBeNull()
  })
})

describe('px allowlist (no open proxy)', () => {
  it('covers every source origin, media host and declared byte host', () => {
    const hosts = pxAllowHosts()
    for (const s of ALL_SOURCES) {
      expect(hosts, `${s.id} origin`).toContain(new URL(s.origin).hostname)
      for (const h of s.imageHosts ?? []) expect(hosts, `${s.id} imageHost`).toContain(h)
    }
    expect(hosts).toContain('media.redgifs.com')
    expect(hosts).toContain('twimg.com')
  })

  it('matches subdomains of an allowed host but nothing else', () => {
    const re = pxAllowPattern()
    expect(re.test('media.babesource.com')).toBe(true)
    expect(re.test('evil.com')).toBe(false)
    expect(re.test('tbib.org.evil.com')).toBe(false)
  })
})

describe('audited provider capabilities', () => {
  it('every source declares caps (absent fields mean UNKNOWN, not false)', () => {
    for (const s of ALL_SOURCES) {
      expect(s.caps, `${s.id} must carry a caps block`).toBeTruthy()
    }
  })

  it('booru.org is declared tagless + post-filtered, as its builder proves', () => {
    // booru-sources-core.cjs accepts `variant` and never puts it in the URL.
    for (const s of ALL_SOURCES.filter((x) => x.kind === 'booruorg')) {
      expect(capabilitiesFor(s.id).tags, `${s.id}`).toBe('none')
      expect(capabilitiesFor(s.id).postFilter, `${s.id}`).toBe(true)
    }
  })

  it('paheal is declared single-tag, as main.cjs proves', () => {
    // main.cjs: `const tag = variant.split(/\s+/)[0]`
    expect(capabilitiesFor('paheal').tags).toBe('single')
    expect(capabilitiesFor('paheal').maxTags).toBe(1)
  })

  it('excludes tagless sources whenever a tag is required', () => {
    const one = sourcesForTags(1).map((s) => s.id)
    expect(one).not.toContain('hgoon')
    expect(one).not.toContain('allgirl')
    expect(one).toContain('tbib')
  })

  it('excludes single-tag sources from a multi-tag query but keeps them for one tag', () => {
    expect(sourcesForTags(1).map((s) => s.id)).toContain('paheal')
    expect(sourcesForTags(2).map((s) => s.id)).not.toContain('paheal')
    expect(sourcesForTags(2).map((s) => s.id)).toContain('tbib')
  })

  it('keeps unknown-capability sources eligible (cannot exclude what is unmeasured)', () => {
    const unknown = ALL_SOURCES.filter((s) => s.caps?.tags === undefined).map((s) => s.id)
    expect(unknown.length).toBeGreaterThan(0)
    for (const id of unknown) {
      expect(sourcesForTags(2).map((s) => s.id), `${id} must stay eligible`).toContain(id)
    }
  })

  it('capabilitiesFor accepts a canonical id or a healthId', () => {
    expect(capabilitiesFor('tbib').pagination).toBe('random-pid')
    expect(capabilitiesFor('tbib-direct').pagination).toBe('random-pid')
    expect(capabilitiesFor('no-such-source')).toEqual({})
  })

  it('an untagged query may use any source, tagless ones included', () => {
    expect(sourcesForTags(0).length).toBe(ALL_SOURCES.length)
  })

  it('the main-process registry carries the same caps', () => {
    const reg = loadRegistryCaps()
    const byId = new Map(reg.sources.map((s) => [s.id, s.caps]))
    for (const s of ALL_SOURCES) {
      expect(byId.get(s.id), `${s.id} caps in main registry`).toEqual(s.caps)
    }
  })
})

describe('electron main reads the same registry', () => {
  const { refererFor: mainRefererFor, loadRegistry } = require(REGISTRY_CJS) as {
    refererFor: (hostname: string, sources: unknown[]) => string
    loadRegistry: (app: unknown) => { sources: unknown[]; byteHosts: string[] }
  }

  it('parses shared/sources.json', () => {
    const reg = loadRegistry({ isPackaged: false })
    expect(reg.sources.length).toBe(ALL_SOURCES.length)
  })

  it('agrees with the renderer on every referer', () => {
    const reg = loadRegistry({ isPackaged: false })
    for (const s of ALL_SOURCES) {
      expect(mainRefererFor(new URL(s.origin).hostname, reg.sources), `${s.id}`).toBe(
        refererFor(new URL(s.origin).hostname),
      )
    }
  })

  it('main.cjs no longer hardcodes a booru origin', () => {
    // The whole point: a mirror lives in ONE file. If a hostname reappears in
    // main.cjs, someone bypassed the registry and the drift is back.
    const main = readFileSync(MAIN_CJS, 'utf8')
    for (const s of ALL_SOURCES) {
      const host = new URL(s.origin).hostname
      expect(main.includes(`'${host}`), `main.cjs must not hardcode ${host}`).toBe(false)
      expect(main.includes(`"${host}`), `main.cjs must not hardcode ${host}`).toBe(false)
    }
    // The RedGifs API/CDN are reached through registry fields too.
    expect(main.includes('api.redgifs.com')).toBe(false)
    expect(main.includes('media.redgifs.com')).toBe(false)
  })
})
