// Phase C: the legal corpus must be complete, versioned and consistent.
// English-only binding corpus (no PT-BR anywhere in-app).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGAL_DOCS, LEGAL_IDS, LEGAL_VERSION, legalVersionKey, type LegalId } from './documents'

describe('legal corpus (canonical source)', () => {
  const ids: LegalId[] = ['terms', 'privacy', 'community', 'abuse', 'records', 'e2e-disclaimer']

  it('has exactly the six mandated documents', () => {
    expect([...LEGAL_IDS].sort()).toEqual([...ids].sort())
  })

  it('each doc: current version, ISO date, jurisdiction, >=4 sections', () => {
    for (const id of ids) {
      const d = LEGAL_DOCS[id]
      expect(d.version, id).toBe(LEGAL_VERSION)
      expect(d.updated, id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d.jurisdiction.length, id).toBeGreaterThan(5)
      const sections = d.body.filter((l) => l.startsWith('## '))
      expect(sections.length, `${id} sections`).toBeGreaterThanOrEqual(4)
      // every section has body text after it
      for (let i = 0; i < d.body.length; i++) {
        if (d.body[i].startsWith('## ') && i + 1 < d.body.length) {
          expect(d.body[i + 1].length).toBeGreaterThan(0)
        }
      }
      expect(d.title.length).toBeGreaterThan(3)
    }
  })

  it('binding text is English (smoke: core anchors, no PT-BR body)', () => {
    const t = LEGAL_DOCS.terms.body.join(' ')
    expect(t).toContain('18 years old')
    expect(t).toContain('Federative Republic of Brazil')
    expect(LEGAL_DOCS.privacy.body.join(' ')).toContain('LGPD')
    const all = Object.values(LEGAL_DOCS).map((d) => `${d.title} ${d.body.join(' ')}`).join(' ')
    for (const pt of ['Você', 'Não fazemos', 'Termos de Uso', 'Política de Privacidade', 'você declara']) {
      expect(all).not.toContain(pt)
    }
  })

  it('generated public/legal/version.json mirrors the canonical key (anti-drift)', () => {
    const file = readFileSync(join(__dirname, '..', '..', 'public', 'legal', 'version.json'), 'utf8')
    expect(JSON.parse(file).key).toBe(legalVersionKey())
  })

  it('legalVersionKey is stable and covers all docs', () => {
    const k = legalVersionKey()
    for (const id of ids) expect(k).toContain(`${id}@`)
    expect(k).toBe(legalVersionKey())
  })
})
