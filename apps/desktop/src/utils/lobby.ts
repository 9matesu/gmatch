import type { LobbyState, MatchSnapshot, User } from '@orbit/shared'
import { LOBBY_LOBBY_SECONDS, LOBBY_PICK_SECONDS, LOBBY_REVEAL_SECONDS, LOBBY_DECIDE_SECONDS, LOBBY_ROUND_RESULT_SECONDS, generateFallbackName } from '@orbit/shared'

/** The live 1v1 match, if any. */
export function currentMatch(state: LobbyState | null): MatchSnapshot | null {
  return state?.match ?? null
}

export type MatchTask = 'lobby' | 'pick' | 'reveal' | 'decide' | 'round_result' | 'result' | null

/** The task currently awaiting me, driven by match phase. */
export function activeTask(match: MatchSnapshot | null): MatchTask {
  if (!match) return null
  if (match.phase === 'lobby') return 'lobby'
  if (match.phase === 'pick') return match.my_card ? 'reveal' : 'pick'
  if (match.phase === 'reveal') return 'reveal'
  if (match.phase === 'decide') return match.my_decided ? (match.opponent_decided ? 'round_result' : 'reveal') : 'decide'
  if (match.phase === 'round_result') return 'round_result'
  if (match.phase === 'result') return 'result'
  return null
}

/** My card id inside the match, if I've played. */
export function myCardId(match: MatchSnapshot | null): string | null {
  return match?.my_card ?? null
}

/** The opponent's card id — only present server-side once revealed. */
export function opponentCardId(match: MatchSnapshot | null): string | null {
  return match?.opponent_card ?? null
}

/** Milliseconds remaining until a phase deadline, clamped at 0. */
export function countdownMs(deadline: number, nowMs: number): number {
  if (!deadline) return 0
  return Math.max(0, deadline - nowMs)
}

/** Format milliseconds as m:ss (e.g. 45000 -> "0:45"). */
export function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format elapsed milliseconds as m:ss (e.g. 125000 -> "2:05"). */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** The phase's total time budget in ms (lobby vs pick vs decide). */
export function matchWindowMs(match: MatchSnapshot | null): number {
  if (!match) return LOBBY_DECIDE_SECONDS * 1000
  if (match.phase === 'lobby') return LOBBY_LOBBY_SECONDS * 1000
  if (match.phase === 'pick') return LOBBY_PICK_SECONDS * 1000
  if (match.phase === 'reveal') return LOBBY_REVEAL_SECONDS * 1000
  if (match.phase === 'round_result') return LOBBY_ROUND_RESULT_SECONDS * 1000
  return LOBBY_DECIDE_SECONDS * 1000
}

export function displayName(id: string, players: LobbyState['players']): string {
  const found = players.find((p) => p.user_id === id)
  return found?.display_name?.trim() || generateFallbackName(id)
}

export interface NameResolutionSources {
  users?: User[] | null
  players?: LobbyState['players'] | null
  fallbackName?: string | null
}

/**
 * Resolve a player's display name from the broadest available source first.
 * The full `users` directory almost always knows the display_name even when
 * the opponent is no longer in the active lobby roster (`players`), which the
 * bare `displayName()` helper misses. Falls back to a server-provided
 * `fallbackName` (e.g. `match.opponent_name`) and finally a generated name.
 */
export function resolveDisplayName(id: string, sources: NameResolutionSources = {}): string {
  const { users, players, fallbackName } = sources
  const fromUsers = users?.find((u) => u.id === id)?.display_name
  if (fromUsers && fromUsers.trim()) return fromUsers
  const fromPlayers = players?.find((p) => p.user_id === id)?.display_name
  if (fromPlayers && fromPlayers.trim()) return fromPlayers
  if (fallbackName && fallbackName.trim()) return fallbackName
  return generateFallbackName(id)
}

export interface TagResolutionSources {
  users?: User[] | null
  players?: LobbyState['players'] | null
}

/** Tags come from the users directory when available; fall back to the lobby roster. */
export function resolveTags(id: string, sources: TagResolutionSources = {}): string[] | null {
  const { users, players } = sources
  const fromUsers = users?.find((u) => u.id === id)?.tags
  if (fromUsers && fromUsers.length > 0) return fromUsers
  const fromPlayers = players?.find((p) => p.user_id === id)?.tags
  if (fromPlayers) return Array.isArray(fromPlayers) ? fromPlayers : [fromPlayers]
  return null
}
