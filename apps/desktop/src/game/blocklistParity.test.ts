import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { hitsAtTokenStart, normalizeTagText } from '@orbit/shared'

/**
 * The blocklist rule is implemented twice on purpose: the canonical rule
 * lives in packages/shared/src/blocklist.ts (the renderer, the API and the
 * protocol all import it) and electron/blocklistRule.cjs is the CommonJS
 * mirror (the Electron main process cannot import TypeScript).
 *
 * These tests pin BOTH against the same fixtures so they cannot drift: the
 * packaged app and a browser session must draw the same hard line. A
 * disagreement between the renderer and the main process is a safety hole,
 * not a cosmetic bug.
 */
const require = createRequire(import.meta.url)
const cjs = require('../../electron/blocklistRule.cjs') as {
  normalizeTagText: (raw: string) => string
  hitsAtTokenStart: (tag: string, term: string) => boolean
}

const TERMS = [
  'loli', 'shota', 'child', 'kid', 'infant', 'baby', 'toddler', 'minor',
  'underage', 'juvenile', 'kindergarten', 'preteen', 'teen', 'schoolgirl',
  'schoolboy', 'ageplay', 'age_play', 'bestiality', 'zoo', 'necro', 'rape',
  'noncon', 'non_consensual', 'incest', 'gore', 'scat', 'urine', 'blood',
  'murder', 'death',
]

/** Tags that MUST be blocked: real compounds of a banned term. */
const MUST_BLOCK = [
  'lolicon', 'lolicon_shota', 'shotacon', 'teenager', 'teens', 'childhood_friends',
  'child_friendly', 'kiddy', 'infantile', 'minors', 'necrophilia', 'necromancer',
  'zoo_philia', 'zoophilia', 'raped', 'non-consensual', 'nonconsensual', 'ageplay',
  'age_play', 'schoolgirl', 'Loli', 'x_loli_y', 'sweet_teen', 'teen_school',
  'bare_feet_teen', 'toddlerish',
]

/** Tags that MUST survive: legal tags that merely contain a banned substring. */
const MUST_ALLOW = [
  'fifteen', 'scrape', 'grape', 'grapes', 'nineteen', 'candid', 'thumbnail',
  'interior', 'accumulate', 'wizard', 'scrapbook', 'candy', 'sweet_sixteen',
]

/**
 * Tags that stay blocked because a banned term is a PREFIX of the token:
 * letting 'zoom' (zoo) or 'babydoll' (baby) through would mean dropping the
 * 'zoo'/'baby' terms, which would leak 'zoophilia' and 'baby'-prefixed
 * terms. SPEC §8 calls this out as a policy decision, not a bug.
 */
const MUST_BLOCK_BY_PREFIX = ['zoom', 'babydoll', 'childless', 'kidding', 'teeny']

const TAGS = [...MUST_BLOCK, ...MUST_BLOCK_BY_PREFIX, ...MUST_ALLOW]

describe('renderer/main parity (blocklistRule.cjs vs @orbit/shared)', () => {
  it('normalizes identically', () => {
    for (const raw of [' Big-Ass ', 'big  ass', 'NON_CONSENT', 'Schoolgirl', '', 'a-b c']) {
      expect(normalizeTagText(raw), raw).toBe(cjs.normalizeTagText(raw))
    }
  })

  it('gives the same verdict for every term against every tag', () => {
    for (const tag of TAGS) {
      for (const term of TERMS) {
        expect(hitsAtTokenStart(normalizeTagText(tag), normalizeTagText(term)), `${tag} / ${term}`).toBe(
          cjs.hitsAtTokenStart(cjs.normalizeTagText(tag), cjs.normalizeTagText(term)),
        )
      }
    }
  })

  it('gives the same verdict for an empty / missing input', () => {
    for (const [tag, term] of [['', 'loli'], ['loli', ''], ['', '']] as const) {
      expect(hitsAtTokenStart(tag, term)).toBe(cjs.hitsAtTokenStart(tag, term))
    }
  })
})

describe('the rule itself (must-block / must-allow)', () => {
  const blocked = (tag: string) => TERMS.some((term) => hitsAtTokenStart(normalizeTagText(tag), normalizeTagText(term)))

  it('blocks every real compound of a banned term', () => {
    for (const tag of [...MUST_BLOCK, ...MUST_BLOCK_BY_PREFIX]) {
      expect(blocked(tag), tag).toBe(true)
    }
  })

  it('allows every legal tag that merely contains a banned substring', () => {
    for (const tag of MUST_ALLOW) {
      expect(blocked(tag), tag).toBe(false)
    }
  })
})
