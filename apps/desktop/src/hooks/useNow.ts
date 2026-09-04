"use client";

import { useEffect, useState } from 'react'

// Returns the current epoch-ms, refreshed on a fixed interval. Lets render
// logic derive time-dependent values (expiry countdowns, online status) from
// state instead of calling Date.now() during render (keeps renders pure).
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs <= 0) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
