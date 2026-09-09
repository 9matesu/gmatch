import { describe, it, expect } from 'vitest'
import { legalDocFromHash, isLegalDocId } from './legal-route'

describe('legal-route (#/?legal=doc deep link)', () => {
  it('parses known docs', () => {
    expect(legalDocFromHash('#/?legal=privacy')).toBe('privacy')
    expect(legalDocFromHash('#/feed?legal=e2e-disclaimer')).toBe('e2e-disclaimer')
    expect(legalDocFromHash('#/?legal=TERMS')).toBe('terms')
  })
  it('null when absent or malformed', () => {
    expect(legalDocFromHash('#/feed')).toBeNull()
    expect(legalDocFromHash('')).toBeNull()
    expect(legalDocFromHash('#/?legal=')).toBeNull()
  })
  it('id guard matches the canonical corpus', () => {
    expect(isLegalDocId('terms')).toBe(true)
    expect(isLegalDocId('nonsense')).toBe(false)
    expect(isLegalDocId(null)).toBe(false)
  })
})
