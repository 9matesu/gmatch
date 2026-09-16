/**
 * Ask the root CardDetailView host to open a card's full info modal (plan §12).
 * Only canonical cards have a detail endpoint: legacy keepsakes (media Objects
 * without a Cards row) must NOT open it — GET /api/cards/<media-id> 404s
 * (the gallery path has guarded this all along; DeckBuilder/LobbyPanel route
 * through here, so the guard lives in this one shared function).
 */
export const OPEN_CARD_EVENT = 'gmatch:open-card'

export function openCardDetail(card: { id: string; card_id?: string | null }): void {
  if (!card.card_id) return
  window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: { cardId: card.card_id } }))
}
