import type { TierMatch, LobbyDecision } from '@orbit/shared'

export type SpecialTabPhase = 'pick' | 'decide' | 'reveal' | 'ended'

export interface SpecialTabState {
  phase: SpecialTabPhase
  mySlot: 'a' | 'b'
  opponentId: string
  myCardId: string | null
  opponentCardId: string | null
  myDecision: LobbyDecision | null
  opponentDecision: LobbyDecision | null
  lastResult: TierMatch['last_result']
  tier: number
  lastCardA: string | null
  lastCardB: string | null
}

/** Derive the tab state for a special-tier match from selfId's perspective. */
export function specialTabState(match: TierMatch, selfId: string): SpecialTabState | null {
  if (match.user_a !== selfId && match.user_b !== selfId) return null
  const mySlot = match.user_a === selfId ? 'a' : 'b'
  const myCardId = (mySlot === 'a' ? match.card_a : match.card_b) ?? null
  const opponentCardId = (mySlot === 'a' ? match.card_b : match.card_a) ?? null
  const myDecision = (mySlot === 'a' ? match.decision_a : match.decision_b) ?? null
  const opponentDecision = (mySlot === 'a' ? match.decision_b : match.decision_a) ?? null

  let phase: SpecialTabPhase = 'pick'
  if (match.status === 'ended') phase = 'ended'
  else if (match.last_result === 'both_like') phase = 'reveal'
  else if (myCardId && opponentCardId) phase = 'decide'

  return {
    phase,
    mySlot,
    opponentId: mySlot === 'a' ? match.user_b : match.user_a,
    myCardId,
    opponentCardId,
    myDecision,
    opponentDecision,
    lastResult: match.last_result ?? null,
    tier: match.tier,
    lastCardA: match.last_card_a ?? null,
    lastCardB: match.last_card_b ?? null,
  }
}

/** Cards to display during a reveal/ended state (falls back to live cards). */
export function revealedCards(st: SpecialTabState): { mine: string | null; theirs: string | null } {
  if (st.phase === 'reveal' || st.phase === 'ended') {
    return {
      mine: st.mySlot === 'a' ? st.lastCardA : st.lastCardB,
      theirs: st.mySlot === 'a' ? st.lastCardB : st.lastCardA,
    }
  }
  return { mine: st.myCardId, theirs: st.opponentCardId }
}
