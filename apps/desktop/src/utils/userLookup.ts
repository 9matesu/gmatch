import type { User } from '@orbit/shared';

/**
 * ONE way to find a directory row by id.
 *
 * App.tsx used to spell this out 17 times, in two flavours:
 *
 *   users.find((u) => u.id === id)
 *   users.find((u) => u.id === id || (u as any).orbitId === id)
 *
 * The second flavour is dead weight: `User.id` IS the orbit id (the API
 * selects `u.id` from the Users table, whose primary key is the orbit id, and
 * the P2P peer map is keyed by orbit id), and the `User` type has no
 * `orbitId` field — so the cast guarded a shape that cannot occur and
 * returned nothing. The casts were also a type-safety hole: they silenced
 * the compiler on every row in the directory.
 *
 * For hot paths (a lookup inside a map over the feed), build the index once
 * with `buildUserIndex` instead of scanning the array per row.
 */

/** Linear lookup. Returns undefined for an empty/absent id. */
export function findUserById(
  users: readonly User[],
  id: string | null | undefined,
): User | undefined {
  if (!id) return undefined;
  return users.find((u) => u.id === id);
}
