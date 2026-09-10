/**
 * Deep-link for legal documents: `#/?legal=terms` (or any known doc id) opens
 * the LegalCenter at that doc — works for users logged out too, so the
 * landing page / age gate can link legal text without auth. Unknown values
 * are ignored. Pure function for testing.
 */
export function legalDocFromHash(hash: string): string | null {
  const m = /[?&]legal=([a-z0-9-]+)/i.exec(hash || '')
  return m ? m[1].toLowerCase() : null
}

export const LEGAL_DOC_IDS = ['terms', 'privacy', 'community', 'abuse', 'records', 'e2e-disclaimer'] as const
export type LegalDocId = (typeof LEGAL_DOC_IDS)[number]

export function isLegalDocId(v: string | null): v is LegalDocId {
  return !!v && (LEGAL_DOC_IDS as readonly string[]).includes(v)
}
