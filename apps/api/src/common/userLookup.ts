import type { D1Turso } from '../db';
import { generateFallbackName } from '@orbit/shared';

/**
 * THE way to read a user's display name.
 *
 * `SELECT display_name FROM Users WHERE id = ?` was hand-copied at 21 call
 * sites across the node, each with its own row type and its own fallback
 * ("Someone", "Unknown User", "Bot Duelist", null). The read is now one
 * function; each site keeps the fallback it already had, so nothing about
 * the rendered text changed.
 *
 * `findDisplayName` returns the stored name VERBATIM (or null when the user
 * has none) — it does not trim, so a caller that wants the trimmed name or
 * a specific fallback applies it explicitly.
 */

/** The stored display name, verbatim (null when the user has none). */
export async function findDisplayName(
  db: D1Turso,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const row = await db
    .prepare('SELECT display_name FROM Users WHERE id = ?')
    .bind(userId)
    .first<{ display_name: string | null }>();
  return row?.display_name ?? null;
}

/**
 * The name to SHOW for a user.
 *
 * The stored name when it has one, else the canonical readable handle
 * (`User_abc123`) derived from the orbit id — never a raw id and never a
 * truncated hash fragment (SPEC §15).
 *
 * PURE on purpose: the caller may already have the stored name because it
 * came in the same query as other columns. Use `findDisplayName` to read it.
 */
export function displayNameFor(
  stored: string | null | undefined,
  userId: string,
): string {
  const name = stored?.trim();
  return name ? name : generateFallbackName(userId);
}
