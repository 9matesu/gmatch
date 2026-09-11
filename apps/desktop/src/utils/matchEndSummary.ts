export interface MatchPayout {
  gp: number
  reason: 'mutual_like' | 'no_match' | string
}

/** One honest sentence for what just happened at a match end — used by the
 * result panel and the background notification so both say the same truth. */
export function matchEndSummary(
  lastResult: string | null | undefined,
  payout: MatchPayout | null | undefined,
  final: boolean,
): string {
  if (lastResult === 'both_like') {
    const head = final ? 'Mutual like! Rank up' : 'Mutual like! Tier up'
    return payout ? `${head} · +${payout.gp} g$` : head
  }
  if (lastResult === 'expired') return payout ? `Timed out · +${payout.gp} g$ consolation` : 'Match timed out.'
  if (lastResult === 'quit') return 'Match ended — you\'ve been re-queued.'
  if (lastResult === 'ended') {
    return payout?.reason === 'no_match' ? `No match · +${payout.gp} g$ consolation` : 'No match this round.'
  }
  return 'Match over.'
}
