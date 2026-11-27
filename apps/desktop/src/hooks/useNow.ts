"use client";

import { useEffect, useRef, useState } from 'react'

/**
 * ONE clock for the whole app.
 *
 * Time-dependent UI (countdowns, "online 30s ago", notification ages) used to
 * give each panel its own `setInterval(..., 1000)`: the lobby, the match panel,
 * the spectate modal and the notification list each re-rendered once a second,
 * and a hidden window kept all of them running for nobody. This module owns a
 * single 1 Hz timer shared by every caller — it starts with the first
 * subscriber and stops with the last — and it is paused while
 * `document.hidden`, catching up in one beat when the window comes back.
 *
 * `useNow(intervalMs)` still honours a caller's own cadence: the shared beat
 * fires at 1 Hz and each hook re-renders only when ITS interval has elapsed.
 */
type Listener = (now: number) => void

const listeners = new Set<Listener>()
let timer: ReturnType<typeof setInterval> | null = null

function beat() {
  const now = Date.now()
  for (const listener of Array.from(listeners)) listener(now)
}

function stopTimer() {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function startTimer() {
  if (timer !== null || typeof window === 'undefined') return
  if (listeners.size === 0) return
  if (typeof document !== 'undefined' && document.hidden) return
  timer = setInterval(beat, 1000)
}

function onVisibility() {
  if (typeof document === 'undefined') return
  if (document.hidden) {
    stopTimer()
    return
  }
  // Catch up immediately: a countdown that expired while hidden should show
  // the truth on the first paint, not one second later.
  beat()
  startTimer()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  if (typeof document !== 'undefined' && listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisibility)
  }
  startTimer()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopTimer()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }
}

// Returns the current epoch-ms, refreshed on a fixed interval. Lets render
// logic derive time-dependent values (expiry countdowns, online status) from
// state instead of calling Date.now() during render (keeps renders pure).
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  const lastRef = useRef(now)

  useEffect(() => {
    if (intervalMs <= 0) return
    const unsubscribe = subscribe((value) => {
      if (value - lastRef.current < intervalMs) return
      lastRef.current = value
      setNow(value)
    })
    return unsubscribe
  }, [intervalMs])

  return now
}
