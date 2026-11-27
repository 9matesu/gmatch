/**
 * Narrow an untrusted value to a plain record (no arrays, no null).
 *
 * The canonical helper for "this is a JSON object I can read fields from".
 * Both ends of every wire contract use it, so the rule is written once.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
