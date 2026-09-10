/**
 * Ask the root CardDetailView host to open a card's full info modal (plan §12).
 * Any view that renders canonical cards (Play / Deck / Lobby) can call this on
 * a single click without prop-drilling a modal into every surface. The event is
 * handled once in App.tsx, so only one detail modal ever mounts.
 */
export const OPEN_CARD_EVENT = 'gmatch:open-card'

/** Resolve the canonical card id a merged card object exposes, or its media id. */
export function canonicalCardId(card: { id: string; card_id?: string | null }): string {
  return (card as { card_id?: string }).card_id || card.id
}

export function openCardDetail(card: { id: string; card_id?: string | null }): void {
  const cardId = canonicalCardId(card)
  if (!cardId) return
  window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: { cardId } }))
}
