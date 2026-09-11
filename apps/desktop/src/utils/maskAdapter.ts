/**
 * Wave 2 (C1): handle.gmatch.com masks.
 *
 * In a Session-style session, peers address each OTHER only through opaque
 * delivery tokens — never hosts, never IPs. A mask is the human-shareable
 * rendering of a token; the adapter is the single place that converts between
 * the two, so no other module ever needs to parse an address.
 */
export const HANDLE_ORIGIN = 'https://handle.gmatch.com'

const TOKEN_RE = /^[0-9a-f]{64}$/

export function handleMask(token: string): string {
  if (!TOKEN_RE.test(token.toLowerCase())) throw new Error('not a delivery token')
  return `${HANDLE_ORIGIN}/${token.toLowerCase()}`
}

export function tokenFromMask(value: string): string | null {
  const m = value.trim().match(/^https?:\/\/handle\.gmatch\.com\/([0-9a-f]{64})\/?$/i)
  return m ? m[1].toLowerCase() : null
}
