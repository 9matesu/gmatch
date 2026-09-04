// GameRegistry — the single source of truth for registered game modules.
//
// The platform owns infrastructure (identity, persistence, economy, chat,
// leaderboards, moderation); each game owns its rules. A game is registered
// here with its id, human name, and deck requirements so that:
//   - unknown game ids are rejected safely (no orphaned deck/game state)
//   - deck size/eligibility rules stay game-defined and configurable
//   - adding a new game does not touch feed, auth, chat, or economy code
//
// Adding a game: append a GameModule to GAMES below. That is the only change
// required for the platform to accept deck submissions for the new game id.

import { notFound } from './common/errors'
import type { DeckRules } from './decks'

export interface GameModule {
  id: string
  name: string
  deckRules: DeckRules
}

export const GAMES: readonly GameModule[] = [
  { id: 'card-duel', name: 'Card Duel', deckRules: { minSize: 1, maxSize: 5 } },
]

const byId = new Map(GAMES.map((g) => [g.id, g]))

export function isKnownGame(gameId: string): boolean {
  return byId.has(gameId)
}

// Returns the registered game module or throws NOT_FOUND for unknown ids.
export function getGame(gameId: string): GameModule {
  const game = byId.get(gameId)
  if (!game) throw notFound('unknown game')
  return game
}

export function gameDeckRules(gameId: string): DeckRules {
  return getGame(gameId).deckRules
}
