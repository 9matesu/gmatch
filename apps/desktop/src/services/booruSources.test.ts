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
// Raw registry, including `enabled: false` rows that ALL_SOURCES filters out.
import registry from '../../../../shared/sources.json'

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

  it('registers red, which was measured at ~98% explicit', () => {
    // Probed live across pid 0/400/8000: 59/60 posts were rating:Explicit, so it
    // survives the fail-closed gate. It carries bestiality/rape tags, which the
    // HARD blocklist drops per-post (bestiality, rape), and furry/anthro/
    // kemonomimi, which are opt-in `suggested` excludes.
    const red = sourceById('red')
    expect(red, 'red must be registered').toBeTruthy()
    expect(red!.kind).toBe('booruorg')
    expect(red!.enabled).not.toBe(false)
    expect(red!.referer).toBe('https://booru.org/')
    expect(red!.imageHosts).toContain('img.booru.org')
  })

  it('keeps utopia disabled — it is 100% Questionable, so it yields nothing', () => {
    // 80 posts sampled across pid 0/400/8000/16000 were ALL rating:Questionable,
    // in both the thumb title= and the posts[N] JS literal, so this is genuine
    // source data and not a parser artifact. Under the fail-closed 18+ gate it
    // can never contribute. The row stays documented (enabled:false) so the
    // probe result survives; `enabled: false` must keep it out of every runtime.
    const row = (registry.sources as Array<Record<string, unknown>>).find((s) => s.id === 'utopia')
    expect(row, 'utopia row should still be documented').toBeTruthy()
    expect(row!.enabled).toBe(false)
    expect(row!._disabledReason, 'a disabled row must say why').toMatch(/questionable/i)
    expect(sourceById('utopia'), 'a disabled source must not resolve').toBeUndefined()
    expect(DIRECT_SOURCES.map((d) => d.id)).not.toContain('utopia-direct')
  })

  it('keeps rule34-org disabled — the "sub" is a 301 to rule34.xxx', () => {
    // Verified live 2026-10-07: rule34.booru.org answers
    // `301 Moved Permanently` with `Location: https://rule34.xxx/`, i.e. this
    // subdomain now redirects to the login-walled source that was removed from
    // the registry on purpose. In browser dev the redirect escapes the Vite
    // proxy and dies on CORS; in Electron main it follows to a login page that
    // parses to nothing. Either way it is one wasted request per round, so the
    // row is disabled but kept documented (same contract as utopia).
    const row = (registry.sources as Array<Record<string, unknown>>).find((s) => s.id === 'rule34-org')
    expect(row, 'rule34-org row should still be documented').toBeTruthy()
    expect(row!.enabled).toBe(false)
    expect(row!._disabledReason, 'a disabled row must say why').toMatch(/rule34\.xxx/)
    expect(sourceById('rule34-org'), 'a disabled source must not resolve').toBeUndefined()
    expect(DIRECT_SOURCES.map((d) => d.id)).not.toContain('rule34-org-direct')
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

  it('namespaces post ids by CANONICAL id, never the healthId', () => {
    // Regression: the renderer used `${src.id}-` where `id` is the healthId, so
    // it stamped `tbib-direct-101` while Electron main stamped `tbib-101` (main
    // passes the canonical `s.id`). The two runtimes therefore disagreed about
    // which posts had been seen, and a new source inherited the mismatch.
    for (const d of DIRECT_SOURCES) {
      const src = sourceByHealthId(d.id)
      expect(d.prefix, `${d.id}: prefix`).toBe(`${src?.parsePrefix || src?.id}-`)
      expect(d.prefix.startsWith(d.id), `${d.id}: must not use the healthId`).toBe(false)
    }
  })

  it('builds the same id namespace main does, for every DIRECT source', () => {
    // main's rule, read from electron/booru-sources-core.cjs (dapiSource passes
    // `` `${id}-` ``) and main.cjs SOURCE_FETCHERS (`s.parsePrefix || s.id`).
    // Pinned here so a registry rename cannot silently fork the two runtimes.
    for (const d of DIRECT_SOURCES) {
      const src = sourceByHealthId(d.id)
      expect(src, `${d.id}: registry row`).toBeTruthy()
      const mainPrefix = d.type === 'moebooru' ? `${src!.parsePrefix || src!.id}` : `${src!.id}`
      expect(d.prefix, `${d.id}: renderer vs main`).toBe(`${mainPrefix}-`)
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
