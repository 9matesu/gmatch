/**
 * Query timing, for measuring where a round actually spends its time.
 *
 * Added because the audit could only CONFIRM structural problems (duplicate
 * fan-out, tagless providers, post-fetch filtering) and could not quantify the
 * per-stage split without a live provider. Stage marks are recorded per round
 * and are read back through `readQueryTimings()`; nothing is logged unless the
 * caller asks.
 *
 * Deliberately tiny: a ring buffer of recent rounds, no timers, no sampling
 * policy, no background work. If it is not being read, it costs one push.
 */

export type QueryStage = 'plan' | 'request' | 'filter' | 'decode'

interface RoundTiming {
  /** Stable label for the round (the query, or caller-supplied). */
  label: string
  /** Monotonic ms per stage, only for stages that actually ran. */
  stages: Partial<Record<QueryStage, number>>
  at: number
}

const MAX_ROUNDS = 50
const rounds: RoundTiming[] = []

/** Begin timing a round. Returns the label to pass to endRound. */
export function startRound(label: string): RoundTiming {
  return { label, stages: {}, at: Date.now() }
}

/** Record one stage's duration on a round. */
export function markStage(round: RoundTiming, stage: QueryStage, ms: number): RoundTiming {
  round.stages[stage] = (round.stages[stage] ?? 0) + Math.max(0, ms)
  return round
}

/** Finish a round: pushes it into the ring buffer. */
export function endRound(round: RoundTiming): void {
  rounds.push(round)
  while (rounds.length > MAX_ROUNDS) rounds.shift()
}

/** Recent rounds, newest last. Returns a copy. */
export function readQueryTimings(): RoundTiming[] {
  return rounds.slice()
}

/** Median ms per stage across recorded rounds. NaN stage = never ran. */
export function timingSummary(): Record<QueryStage, number> {
  const out = { plan: NaN, request: NaN, filter: NaN, decode: NaN } as Record<QueryStage, number>
  for (const stage of Object.keys(out) as QueryStage[]) {
    const vals = rounds.map((r) => r.stages[stage]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
    if (!vals.length) continue
    const mid = Math.floor(vals.length / 2)
    out[stage] = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  }
  return out
}

export function clearQueryTimings(): void {
  rounds.length = 0
}
