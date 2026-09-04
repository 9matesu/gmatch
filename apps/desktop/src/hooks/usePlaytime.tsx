'use client'

import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'goonmatch_playtime_ms'
const ACK_KEY = 'goonmatch_coffee_acked_at'
// Trigger thresholds per the owner's spec: 60 min playtime OR 12 matches.
const PLAYTIME_MS_THRESHOLD = 60 * 60 * 1000
const MATCHES_THRESHOLD = 12
// Suppress the popup for 30 days after a user dismisses it.
const ACK_QUIET_DAYS = 30

/**
 * Accumulate active time locally across the site. We tick the running total
 * every 5s while the tab is active and visible (sustained session engagement)
 * and persist to localStorage. Returns current accumulated playtime in ms.
 */
export function usePlaytime(opts: { inMatch: boolean; matchesTotal: number; identityId: string | null }) {
  const { inMatch, matchesTotal } = opts
  const [playtimeMs, setPlaytimeMs] = useState<number>(() => readNumber(STORAGE_KEY) || 0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const handleTick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      setPlaytimeMs((prev) => {
        const next = prev + 5000
        try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
        return next
      })
    }

    tickRef.current = setInterval(handleTick, 5000)
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [inMatch])

  useEffect(() => {
    try { localStorage.setItem('goonmatch_matches_total', String(matchesTotal)) } catch {}
  }, [matchesTotal])

  return { playtimeMs, matchesTotal }
}

/**
 * Decide whether the "Support the project" coffee popup should fire.
 * Returns the gate breach reason when true so the modal can show a
 * informative message ("you've played 14 matches" vs "you've spent 80 min").
 */
export function useCoffeeGate(playtimeMs: number, matchesTotal: number): {
  showCoffee: boolean
  triggerReason: 'time' | 'matches' | null
  openVoluntarily: () => void
  dismiss: (mode: 'later' | 'never') => void
} {
  const [ackAt, setAckAt] = useState<number>(() => readNumber(ACK_KEY) || 0)
  const [neverAck, setNeverAck] = useState<boolean>(() => readBool('goonmatch_coffee_never'))
  const [showCoffee, setShowCoffee] = useState(false)
  const sessionRef = useRef(false)

  useEffect(() => {
    if (neverAck) { setShowCoffee(false); return }
    const quietMsAcked = ackAt ? Date.now() - ackAt < ACK_QUIET_DAYS * 24 * 60 * 60 * 1000 : false
    if (quietMsAcked || sessionRef.current) { setShowCoffee(false); return }
    if (playtimeMs >= PLAYTIME_MS_THRESHOLD || matchesTotal >= MATCHES_THRESHOLD) {
      sessionRef.current = true
      setShowCoffee(true)
    }
  }, [playtimeMs, matchesTotal, ackAt, neverAck])

  const openVoluntarily = () => {
    setShowCoffee(true)
  }

  const dismiss = (mode: 'later' | 'never') => {
    setShowCoffee(false)
    if (mode === 'never') {
      setNeverAck(true)
      try { localStorage.setItem('goonmatch_coffee_never', '1') } catch {}
    } else {
      const ts = Date.now()
      setAckAt(ts)
      try { localStorage.setItem(ACK_KEY, String(ts)) } catch {}
    }
  }

  const triggerReason: 'time' | 'matches' | null =
    matchesTotal >= MATCHES_THRESHOLD
      ? matchesTotal >= MATCHES_THRESHOLD && playtimeMs < PLAYTIME_MS_THRESHOLD
        ? 'matches'
        : playtimeMs >= PLAYTIME_MS_THRESHOLD
          ? 'time'
          : 'matches'
      : 'time'

  return { showCoffee, triggerReason, openVoluntarily, dismiss }
}

function readNumber(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    if (!v) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
