/**
 * Display-name resolution — ONE resolver for every chat surface.
 *
 * The bug this replaces: each chat lane resolved names its own way, so the same
 * person rendered as their real name in one place and as "User" /
 * "Unknown User" / "" in another. Four variants existed:
 *
 *   - GMatchDMs.displayNameFor  — consulted a peers map the chat hub built from
 *     a capped /api/users page, so anyone outside that page fell to 'User'.
 *     It also rejected names starting with '0x' or longer than 32 chars, which
 *     silently downgraded legitimate names to 'User'.
 *   - courier DM / server PM / group  — each had its own `senderName:` ternary
 *     reading `users.find(...)`, `peerUser?.display_name`, 'You' or a literal.
 *   - sealed rooms — App.tsx hardcoded `senderName: ''`. RoomMessage had no
 *     name field at all, so room senders were ALWAYS nameless.
 *
 * The rule is now: a name that travelled with the message wins, then the
 * roster, then the shared-name default. Nothing here guesses from an id shape.
 */

import { isDefaultPeerName } from '@orbit/shared'

export const DISPLAY_NAME_KEY = 'orbit_display_name'

/** Shown when a message carries no usable name and the roster has none. */
export const UNKNOWN_NAME = 'Unknown User'

/** Shown in place of the viewer's own name (never a real name). */
export const SELF_NAME = 'You'

/** A name worth showing: non-empty, not a minted default, not absurdly long. */
export function isUsableName(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const t = raw.trim()
  if (t.length === 0) return false
  // Server-minted "User_1da964" placeholders (shared/index.ts) are not names.
  if (isDefaultPeerName(t)) return false
  // A name longer than the server's MAX_DISPLAY_NAME_LENGTH is a corrupt row
  // or an id pasted into the wrong field — either way, not a display name.
  if (t.length > 50) return false
  return true
}

/** The viewer's own chosen name from local storage ('' when unset). */
export function ownDisplayName(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    const v = localStorage.getItem(DISPLAY_NAME_KEY)
    return isUsableName(v) ? v.trim() : ''
  } catch {
    return ''
  }
}

/** Minimal roster shape any caller can satisfy. */
export interface NameRosterEntry {
  display_name?: string | null
  name?: string | null
}

export interface ResolveNameOptions {
  /** The viewer's own orbit id — resolves to SELF_NAME. */
  selfId?: string | null
  /** Sender's orbit id (used for the self check and to key the roster). */
  senderId?: string | null
  /** Name carried in the message payload (the authoritative one). */
  payloadName?: string | null
  /** The live roster, keyed by orbit id. */
  roster?: ReadonlyMap<string, NameRosterEntry> | null
  /** Fallback passed by the caller (e.g. a thread's cached peer_name). */
  fallback?: string | null
}

/**
 * Resolve who a message came from, in priority order:
 *   self → message payload → roster → caller fallback → UNKNOWN_NAME.
 *
 * The payload is checked BEFORE the roster on purpose: a name that travelled
 * with the message is the sender's name at send time, so it survives a rename
 * and a roster that has not caught up yet. A renamed user must not retroactively
 * relabel their whole history.
 */
export function resolveDisplayName(opts: ResolveNameOptions): string {
  const { selfId, senderId, payloadName, roster, fallback } = opts

  if (selfId && senderId && selfId === senderId) {
    const own = ownDisplayName()
    return own || SELF_NAME
  }

  if (isUsableName(payloadName)) return payloadName.trim()
  if (roster && senderId) {
    const entry = roster.get(senderId)
    if (entry) {
      if (isUsableName(entry.display_name)) return entry.display_name.trim()
      if (isUsableName(entry.name)) return entry.name.trim()
    }
  }
  if (isUsableName(fallback)) return fallback.trim()
  return UNKNOWN_NAME
}

/** Build the roster map a chat surface keeps for its own render pass. */
export function toNameRoster(
  users: readonly (NameRosterEntry & { id?: string; orbitId?: string })[],
): Map<string, NameRosterEntry> {
  const map = new Map<string, NameRosterEntry>()
  for (const u of users) {
    const id = u.id || u.orbitId
    if (!id) continue
    map.set(id, u)
  }
  return map
}
