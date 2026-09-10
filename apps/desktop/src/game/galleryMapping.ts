import { parseTags } from '@orbit/shared'
import type { CanonicalCard } from '../utils/cardCollection'

/**
 * Overlay an item's canonical card onto the raw media object for gallery
 * rendering. When there is no canonical card the item is returned unchanged.
 *
 * Canonical card fields are the source of truth: notably `tags` always comes
 * from the card, so removing every tag on a card cannot resurrect the stale
 * tags baked into the underlying media object (SPEC §8 gallery hygiene).
 */
export function applyCanonicalCard<T extends Record<string, any>>(
  item: T,
  canonical: CanonicalCard | null | undefined,
): T {
  if (!canonical) return item
  const tags = Array.isArray(canonical.tags) ? canonical.tags : parseTags(canonical.tags)
  return {
    ...item,
    card_id: canonical.id,
    name: canonical.name ?? item.caption ?? undefined,
    caption: canonical.name ?? item.caption ?? undefined,
    value: canonical.value ?? item.gacha_downloads_count ?? 0,
    gacha_downloads_count: canonical.value ?? item.gacha_downloads_count ?? 0,
    rarity: canonical.rarity,
    frame: canonical.frame,
    accent_color: canonical.accentColor,
    tags,
    description: canonical.description ?? item.description,
    likes_count: canonical.likeCount ?? item.likes_count ?? 0,
    like_count: canonical.likeCount ?? item.like_count ?? 0,
  }
}
