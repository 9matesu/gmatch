import { parseTags, type OrbitObject } from "@orbit/shared";
import { orbitFetch } from "./api";

/**
 * Minimal identity shape needed to call the card-creation API. Matches the
 * `OrbitIdentityLike` contract accepted by `orbitFetch`.
 */
export interface CardCreationIdentity {
  orbitId: string;
  publicKeyHex: string;
  privateKeyHex: string;
  encryptionPubHex?: string;
}

/**
 * A canonical card as returned by the API (`GET /api/cards`). The media content
 * is projected onto the record (contentUrl/mimeType/caption) so it is renderable
 * without a separate object lookup.
 */
export interface CanonicalCard {
  id: string;
  creatorId: string;
  mediaObjectId: string;
  name: string | null;
  tags: string[];
  description: string | null;
  frame: string;
  accentColor: string;
  rarity: string;
  value: number;
  likeCount: number;
  marketStatus: string;
  moderationState: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  contentUrl?: string | null;
  mimeType?: string | null;
  caption?: string | null;
}

export interface CardCreationMetadata {
  tags?: string[];
  description?: string | null;
  frame?: string;
  accentColor?: string;
}

/** Extra canonical metadata attached to a merged card entry. */
export interface MergedCard extends OrbitObject {
  card_id?: string;
  name?: string | null;
  rarity?: string;
  value?: number;
  likes_count?: number;
  like_count?: number;
  market_status?: string;
  moderation_state?: string;
  tags?: string[];
  description?: string | null;
  frame?: string;
  accent_color?: string;
}

/**
 * Turn an uploaded media object into a canonical card with the given name.
 * Server-authoritative: value/rarity/border are derived server-side; the client
 * only supplies the name. Returns the created card (camelCase projection) or
 * null when creation fails (e.g. the media was already carded or not owned).
 */
export async function createCardFromMedia(
  identity: CardCreationIdentity | null,
  mediaObjectId: string,
  name?: string | null,
  metadata?: CardCreationMetadata,
): Promise<CanonicalCard | null> {
  if (!identity || !mediaObjectId) return null;
  try {
    const res = await orbitFetch(
      "/api/cards",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_object_id: mediaObjectId,
          name: name?.trim() || null,
          tags: metadata?.tags || [],
          description: metadata?.description?.trim() || null,
          frame: metadata?.frame || 'chrome',
          accent_color: metadata?.accentColor || '#9FE3FF',
        }),
      },
      identity
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const card = data?.card ?? null;
    if (card && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("orbit-cards-refresh"));
    }
    return card;
  } catch {
    return null;
  }
}

export async function transferCard(
  identity: CardCreationIdentity | null,
  cardId: string,
  toUserId: string,
): Promise<CanonicalCard | null> {
  if (!identity || !cardId || !toUserId) return null;
  try {
    const res = await orbitFetch(
      `/api/cards/${cardId}/transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_user_id: toUserId }),
      },
      identity
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const card = data?.card ?? null;
    if (card && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("orbit-cards-refresh"));
    }
    return card;
  } catch {
    return null;
  }
}

function isPublicPost(item: OrbitObject): boolean {
  const pub = (item as any).is_public;
  return pub === 1 || pub === '1' || pub === true || pub === 'true';
}

function isChatAttachment(item: OrbitObject): boolean {
  const chat = (item as any).is_chat;
  return chat === 1 || chat === '1' || chat === true || chat === 'true';
}

function isAvatarObject(item: OrbitObject, pfpUrl?: string | null): boolean {
  const av = (item as any).is_avatar;
  if (av === 1 || av === '1' || av === true || av === 'true') return true;
  if (!pfpUrl) return false;
  if (pfpUrl.includes(item.id)) return true;
  if (item.content_url && pfpUrl === item.content_url) return true;
  return false;
}

/**
 * Card collection derivation: the set of cards the current identity owns.
 *
 * A "card" is a non-story, non-chat, non-avatar object the user uploaded themselves.
 * P2P-imported entries (ids starting with `p2p-obj-`), public posts, chat attachments,
 * avatars/profile pictures, and stories are excluded.
 */
export function deriveMyCards(items: readonly OrbitObject[], ownerId: string, pfpUrl?: string | null): OrbitObject[] {
  const raw = items.filter(
    (i) => !i.is_story && !isPublicPost(i) && !isChatAttachment(i) && !isAvatarObject(i, pfpUrl) && !i.id.startsWith("p2p-obj-") && i.owner_id === ownerId
  );
  const seen = new Set<string>();
  const unique: OrbitObject[] = [];
  for (const card of raw) {
    if (!seen.has(card.id)) {
      seen.add(card.id);
      unique.push(card);
    }
  }
  return unique;
}

/**
 * Merge canonical cards (from `/api/cards`) with the object gallery so the
 * collection UI shows canonical ownership/rarity/value while remaining
 * playable: a canonical card's `id` is its media object id, which the match
 * routes already accept. Legacy objects that are the media of a canonical card
 * are de-duplicated (the canonical entry wins). Public posts, chat attachments,
 * avatars, and stories are excluded from the card collection.
 */
export function mergeMyCards(
  items: readonly OrbitObject[],
  canonicalCards: readonly CanonicalCard[],
  ownerId: string,
  pfpUrl?: string | null
): MergedCard[] {
  const canonicalByMedia = new Map<string, CanonicalCard>();
  for (const c of canonicalCards) canonicalByMedia.set(c.mediaObjectId, c);

  const result: MergedCard[] = [];
  const seen = new Set<string>();

  for (const c of canonicalCards) {
    if (seen.has(c.mediaObjectId)) continue;
    seen.add(c.mediaObjectId);
    const parsedCardTags = Array.isArray(c.tags) ? c.tags : parseTags(c.tags);
    result.push({
      id: c.mediaObjectId,
      owner_id: c.ownerId || ownerId,
      size_bytes: 0,
      mime_type: c.mimeType || "image/jpeg",
      created_at: c.createdAt,
      content_url: c.contentUrl || undefined,
      caption: c.name ?? c.caption ?? undefined,
      name: c.name ?? c.caption ?? undefined,
      is_story: 0,
      gacha_downloads_count: c.value,
      card_id: c.id,
      rarity: c.rarity,
      value: c.value,
      likes_count: c.likeCount ?? 0,
      like_count: c.likeCount ?? 0,
      market_status: c.marketStatus,
      moderation_state: c.moderationState,
      tags: parsedCardTags,
      description: c.description,
      frame: c.frame,
      accent_color: c.accentColor,
    });
  }

  for (const i of items) {
    if (i.is_story || isPublicPost(i) || isChatAttachment(i) || isAvatarObject(i, pfpUrl) || i.id.startsWith("p2p-obj-") || i.owner_id !== ownerId) continue;
    if (canonicalByMedia.has(i.id) || seen.has(i.id)) continue;
    seen.add(i.id);
    result.push(i);
  }

  return result;
}

/** Duel pick-grid scope: when an active deck exists, only its members;
 * falls back to the full owned list when the deck resolves to nothing. */
export function filterToActiveDeck<T extends { id: string; card_id?: string | null }>(
  allCards: readonly T[],
  activeDeck?: { cards: string[] } | null,
): T[] {
  if (!activeDeck || activeDeck.cards.length === 0) return [...allCards]
  const inDeck = allCards.filter((c) => activeDeck.cards.includes(c.card_id || c.id))
  return inDeck.length > 0 ? inDeck : [...allCards]
}
