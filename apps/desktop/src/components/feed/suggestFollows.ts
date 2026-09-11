export interface SuggestUser {
  id: string
  display_name?: string
  tags?: string[]
  followers_count?: number
  online?: boolean
}

// ponytail: linear scan over the loaded directory (~hundreds); upgrade path is a
// server /api/suggestions endpoint if lists ever reach thousands.
export function suggestFollows(
  users: SuggestUser[],
  selfId: string | null | undefined,
  myTags: string[],
  following: ReadonlySet<string>,
  limit = 3,
): SuggestUser[] {
  const mine = new Set(myTags.map((t) => t.toLowerCase()));
  return users
    .filter((x) => x.id && x.id !== selfId && !following.has(x.id))
    .map((x) => ({
      x,
      score:
        (x.online ? 100 : 0) +
        (x.tags?.some((t) => mine.has(t.toLowerCase())) ? 50 : 0) +
        Math.min(49, Number(x.followers_count ?? 0) / 10), // followers tie-break, never outranks presence+affinity
    }))
    .sort((a, b) => b.score - a.score || (b.x.followers_count ?? 0) - (a.x.followers_count ?? 0))
    .slice(0, limit)
    .map((s) => s.x);
}
