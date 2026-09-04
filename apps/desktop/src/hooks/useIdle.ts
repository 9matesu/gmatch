"use client";

import { useState, useEffect, useRef } from 'react'

export function useIdle(timeoutMinutes: number, enabled: boolean): { isIdle: boolean } {
  const [isIdle, setIsIdle] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isIdleRef = useRef(false)

  useEffect(() => { isIdleRef.current = isIdle }, [isIdle])

  useEffect(() => {
    if (!enabled) {
      setIsIdle(false)
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (isIdleRef.current) setIsIdle(false)
      timerRef.current = setTimeout(() => setIsIdle(true), timeoutMinutes * 60 * 1000)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const
    for (const ev of events) {
      window.addEventListener(ev, reset, { passive: true })
    }

    reset()

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, reset)
      }
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [timeoutMinutes, enabled])

  return { isIdle }
}
