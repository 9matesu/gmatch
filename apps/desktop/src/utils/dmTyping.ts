/**
 * Transient typing state for courier DMs.
 *
 * Typing is the one DM event with no history: it is never written to the
 * thread store, it expires on its own, and it exists only so a keystroke does
 * not become a sealed courier PUT. Throttle and TTL live here (pure) so both
 * the transport and the UI can be tested without timers.
 */

/** One sealed ping per burst window, not per keystroke. */
export const TYPING_THROTTLE_MS = 3_000
/** How long a received "typing" stays visible without a follow-up. */
export const TYPING_TTL_MS = 8_000

export function shouldEmitTyping(
  lastSentAt: number,
  now: number,
  throttleMs: number = TYPING_THROTTLE_MS,
): boolean {
  if (!Number.isFinite(now)) return false
  if (!Number.isFinite(lastSentAt) || lastSentAt <= 0) return true
  return now - lastSentAt >= throttleMs
}

export function isTypingFresh(
  receivedAt: number,
  now: number,
  ttlMs: number = TYPING_TTL_MS,
): boolean {
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return false
  if (!Number.isFinite(now)) return false
  const age = now - receivedAt
  // A timestamp from the future is a clock-skew artifact, not evidence of
  // typing: treat it as stale rather than pinning the indicator on.
  return age >= 0 && age < ttlMs
}

/** Peers still typing at `now`. Never mutates the caller's map. */
export function activeTypists(
  state: Record<string, number>,
  now: number,
  ttlMs: number = TYPING_TTL_MS,
): string[] {
  return Object.keys(state).filter((id) => isTypingFresh(state[id], now, ttlMs))
}

/** Drop expired entries; returns a fresh map (identity when nothing changed). */
export function pruneTypingState(
  state: Record<string, number>,
  now: number,
  ttlMs: number = TYPING_TTL_MS,
): Record<string, number> {
  const next: Record<string, number> = {}
  let dropped = false
  for (const [id, at] of Object.entries(state)) {
    if (isTypingFresh(at, now, ttlMs)) next[id] = at
    else dropped = true
  }
  return dropped ? next : state
}
