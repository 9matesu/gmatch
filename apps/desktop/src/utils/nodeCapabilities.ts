/**
 * Does this node host stateful routes?
 *
 * `detectMailMode` answers a different question: it reports whether the
 * legacy `/api/pm` inbox still exists. Every current node — full or blind —
 * answers "courier" there, so mail mode cannot tell a node that hosts matches
 * from one that only forwards sealed envelopes. Chat used to treat the two as
 * the same thing, which is how a game invite ended up as a 404 toast.
 *
 * The probe is an unauthenticated GET on a route only a stateful node mounts.
 * Any answer other than 404 means mounted (401/403 on a full node, 200 on a
 * permissive one); a 404 or a network failure means we cannot prove it exists,
 * and the UI says so instead of pretending.
 */

export type NodeCapability = 'stateful'

const cache = new Map<string, boolean>()
const inflight = new Map<string, Promise<boolean>>()

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

export function cachedNodeCapability(url: string): boolean | undefined {
  return cache.get(base(url))
}

export async function hasStatefulRoutes(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<boolean> {
  const key = base(url)
  const known = cache.get(key)
  if (known !== undefined) return known
  const ongoing = inflight.get(key)
  if (ongoing) return ongoing
  const p = (async (): Promise<boolean> => {
    try {
      const res = await fetchImpl(`${key}/api/lobby/invites`, { method: 'GET' }).catch(() => null)
      // 404 = blind courier (route intentionally absent). Anything else means
      // the node mounts stateful gameplay; an auth failure still proves it.
      const value = !!res && res.status !== 404
      cache.set(key, value)
      return value
    } catch {
      return cache.get(key) ?? false
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

/** test seam */
export function _resetNodeCapabilityCache(): void {
  cache.clear()
  inflight.clear()
}
