/**
 * `@mention` detection for chat.
 *
 * Deliberately local and conservative: a mention is `@` + the viewer's display
 * name (spaces allowed, or underscored) or the first 8 chars of their orbit id,
 * on a word boundary. No server metadata, no invented mention list, and no
 * match inside an email address or a longer handle — `@kenneth` must not ping
 * `@kenny`.
 */

export interface MentionTarget {
  displayName?: string | null
  orbitId?: string | null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type MentionMatcher = (text: string | null | undefined) => boolean

/** Compile once per viewer, then reuse for every message. */
export function createMentionMatcher(target: MentionTarget): MentionMatcher {
  const names = new Set<string>()
  const display = (target.displayName || '').trim()
  if (display) {
    names.add(display)
    const underscored = display.replace(/\s+/g, '_')
    if (underscored !== display) names.add(underscored)
  }
  const id = (target.orbitId || '').trim()
  if (id.length >= 4) names.add(id.slice(0, 8))

  const alternatives = [...names]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)

  if (alternatives.length === 0) return () => false
  const re = new RegExp(`(^|[^a-z0-9_@])@(?:${alternatives.join('|')})(?![a-z0-9_])`, 'i')
  return (text) => (typeof text === 'string' ? re.test(text) : false)
}

/** True when any message newer than `sinceTs` mentions the viewer. */
export function countMentions(
  messages: ReadonlyArray<{ text?: string | null; ts: number; own?: boolean }> | undefined | null,
  matcher: MentionMatcher,
  sinceTs = 0,
): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0
  let count = 0
  for (const message of messages) {
    if (!message || message.own) continue
    if (!Number.isFinite(message.ts) || message.ts <= sinceTs) continue
    if (matcher(message.text)) count += 1
  }
  return count
}
