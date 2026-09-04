/**
 * Weighted provider-pool selection plus safe URL validation for admin-supplied
 * image API endpoints. Kept independent of the bot config module so it can be
 * unit-tested without a database.
 */

export interface WeightedProvider {
  enabled: boolean
  weight?: number
}

function weightOf(provider: WeightedProvider): number {
  const w = Number(provider.weight)
  return Number.isFinite(w) && w > 0 ? w : 0
}

/** Pick a provider respecting configured weights; uniform when no weights set. */
export function pickWeightedProvider<T extends WeightedProvider>(providers: T[]): T | undefined {
  const eligible = providers.filter((p) => p.enabled)
  if (eligible.length === 0) return undefined

  const weights = eligible.map(weightOf)
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) {
    return eligible[Math.floor(Math.random() * eligible.length)]
  }

  let roll = Math.random() * total
  for (let i = 0; i < eligible.length; i++) {
    roll -= weights[i]
    if (roll < 0) return eligible[i]
  }
  return eligible[eligible.length - 1]
}

/** Order providers by descending weight so heavier providers are tried first. */
export function orderByWeightDesc<T extends WeightedProvider>(providers: T[]): T[] {
  return [...providers].sort((a, b) => weightOf(b) - weightOf(a))
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local / metadata
  if (a === 127) return true
  if (a === 0) return true
  return false
}

export interface UrlValidation {
  ok: boolean
  error?: string
}

/** Reject non-http(s), localhost, private, link-local, and internal hosts. */
export function validateProviderUrl(raw: string): UrlValidation {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only http/https URLs are allowed' }
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '169.254.169.254' ||
    host.endsWith('.internal') ||
    host.endsWith('.compute.internal') ||
    isPrivateIpv4(host)
  ) {
    return { ok: false, error: 'Private or internal network addresses are not allowed' }
  }

  return { ok: true }
}
