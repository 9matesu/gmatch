/**
 * One normalized shape for a DM partner.
 *
 * The chat surfaces are fed from three different places — the online
 * directory (`{ orbitId, name }`), server user rows (`{ id, display_name }`)
 * and stored thread rows — and the old state slot was `User | null` receiving
 * all of them. That is why every call site carried `as User` / `as never`
 * casts and why an id could silently be `undefined`: `pmPeer.id` did not exist
 * on the directory shape. Normalizing here makes a wrong id a type error.
 */
export interface ChatPeer {
  /** orbit id (the delivery address for sealed mail). */
  id: string
  /** Display name as last known; never invented, may be absent. */
  name?: string
  /** Avatar url or object id. */
  pfp?: string
}

interface ChatPeerInput {
  id?: string | null
  orbitId?: string | null
  name?: string | null
  display_name?: string | null
  pfp?: string | null
}

/** Accepts any of the three shapes; null when no id is present. */
export function toChatPeer(input: ChatPeerInput | null | undefined): ChatPeer | null {
  if (!input) return null
  const id = input.id || input.orbitId || ''
  if (!id) return null
  const name = input.name || input.display_name || undefined
  const pfp = input.pfp || undefined
  return { id, ...(name ? { name } : {}), ...(pfp ? { pfp } : {}) }
}
