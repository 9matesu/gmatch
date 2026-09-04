"use client";

import { useState, useRef, useCallback } from 'react'
import { orbitFetch } from '../utils/api'
import { playBeep } from '../utils/sounds'
import type { OrbitIdentity } from '@orbit/crypto'

export function AttentionButton({ identity }: { identity: OrbitIdentity }) {
  const [cooldown, setCooldown] = useState(0)
  const [attending, setAttending] = useState(false)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimer = useCallback(() => {
    if (cooldownRef.current) {
      clearInterval(cooldownRef.current)
      cooldownRef.current = null
    }
  }, [])

  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds)
    clearTimer()
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearTimer()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [clearTimer])

  const handleClick = async () => {
    if (cooldown > 0 || attending) return

    playBeep()
    setAttending(true)

    try {
      const res = await orbitFetch('/api/users/attention', { method: 'POST' }, identity)
      const data = await res.json()
      if (res.ok) {
        startCooldown(30)
      } else if (res.status === 429 && data.cooldown_remaining) {
        startCooldown(data.cooldown_remaining)
      }
    } catch {
      startCooldown(5)
    } finally {
      setAttending(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={cooldown > 0 || attending}
      className={`
        w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors
        ${cooldown > 0
          ? 'bg-retro-panel text-retro-muted cursor-not-allowed border border-retro-border'
          : 'bg-retro-bg text-retro-warning border border-retro-warning hover:bg-retro-panel'
        }
      `}
      title={cooldown > 0 ? `Wait ${cooldown}s` : 'Signal you need pictures — appear at the top of the network'}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 15h12" /><path d="M17 15v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-4" /><path d="M12 3v8" /><path d="m9 7 3-4 3 4" />
      </svg>
      {cooldown > 0 ? `Wait ${cooldown}s` : 'SEND ME MORE!'}
    </button>
  )
}