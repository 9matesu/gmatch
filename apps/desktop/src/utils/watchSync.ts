// Watch Party sync math. Pure, no DOM. All times in seconds.

export interface SyncFrame {
  url: string
  action: 'play' | 'pause'
  /** Media position (seconds) at updatedAt. */
  position: number
  /** playbackRate. Locked to 1 in V1 (server rejects anything else). */
  rate: number
  /** Server clock seconds when the frame was stamped. */
  updatedAt: number
}

/** Where the party SHOULD be right now, per the server clock. */
export function computeTargetPosition(frame: SyncFrame, serverNow: number): number {
  if (frame.action === 'pause') return frame.position
  return frame.position + frame.rate * Math.max(0, serverNow - frame.updatedAt)
}

/**
 * Decide what to do with a local video given the party target.
 * Deadband avoids seeking every tick (seeks stall buffering); while playing,
 * small forward drift is absorbed by playbackRate=1 lag and only hardresync
 * worth gaps get a seek.
 */
export function driftCorrection(
  current: number,
  target: number,
  localPlaying: boolean,
  partyAction: 'play' | 'pause',
  deadband = 0.3,
  hardresync = 2,
): { seekTo: number | null; play: boolean; pause: boolean } {
  const drift = current - target
  const seek =
    partyAction === 'pause' || !localPlaying
      ? Math.abs(drift) > deadband
      : drift > deadband || -drift > hardresync
  return {
    seekTo: seek ? target : null,
    play: partyAction === 'play' && !localPlaying,
    pause: partyAction === 'pause' && localPlaying,
  }
}

/**
 * Estimated server clock. Offset = (t1 + rtt/2 - t3) of the lowest-RTT sample.
 */
export class ClockOffset {
  private offset = 0
  private bestRtt = Infinity
  async sample(ping: () => Promise<{ t0: number; t1: number; t3: number }>): Promise<void> {
    const { t0, t1, t3 } = await ping()
    const rtt = t3 - t0
    if (rtt < this.bestRtt) {
      this.bestRtt = rtt
      this.offset = t1 + rtt / 2 - t3
    }
  }
  now(): number {
    return Date.now() / 1000 + this.offset
  }
}

/** Queue-advance guard: host only, playing room, queue present (a single
 * entry loops it all night), and never twice for the same server frame.
 * endedKey is `${current}:${frame.updatedAt}` — a wrap re-stamps updatedAt,
 * so the guard re-arms itself without relying on the entry id changing. */
export function shouldFireQueueNext(opts: {
  isHost: boolean
  queueLength: number
  action: 'play' | 'pause'
  endedKey: string
  lastFiredKey: string
}): boolean {
  return opts.isHost && opts.action === 'play' && opts.queueLength >= 1 &&
    opts.endedKey !== opts.lastFiredKey
}
