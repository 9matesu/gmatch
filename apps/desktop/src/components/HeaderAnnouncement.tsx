"use client";

import { useEffect, useState } from 'react'
import { orbitFetch } from '../utils/api'
import type { OrbitIdentity } from '@orbit/crypto'
import { Sparkles, X } from 'lucide-react'
import { playPress } from '../utils/sounds'

interface AnnouncementItem {
  id: string
  message: string
  created_at: string
  created_by_name?: string | null
  is_active?: number
}

export function HeaderAnnouncement({ identity }: { identity: OrbitIdentity | null }) {
  const [announcement, setAnnouncement] = useState<AnnouncementItem | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  useEffect(() => {
    if (!identity) return

    const fetchActiveAnnouncement = async () => {
      try {
        const res = await orbitFetch('/api/announcements', {}, identity)
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data) && data.length > 0) {
            const nextItem = data[0]
            setAnnouncement((prev) =>
              prev?.id === nextItem.id &&
              prev?.message === nextItem.message &&
              prev?.is_active === nextItem.is_active
                ? prev
                : nextItem
            )
          } else {
            setAnnouncement(null)
          }
        }
      } catch {}
    }

    fetchActiveAnnouncement()
    const interval = setInterval(fetchActiveAnnouncement, 120_000)
    return () => clearInterval(interval)
  }, [identity])

  if (
    !announcement ||
    (announcement.is_active !== undefined && !announcement.is_active) ||
    dismissedId === announcement.id
  ) {
    return null
  }

  return (
    <div
      role="alert"
      className="fixed top-15 left-0 right-0 z-40 pointer-events-none flex items-center justify-center px-4 font-sans select-none"
    >
      <div className="pointer-events-auto max-w-xl w-full px-3.5 py-2 rounded-2xl bg-surface-canvas/95 border border-cyan-500/40 shadow-2xl shadow-cyan-950/40 backdrop-blur-2xl flex items-center justify-between gap-2.5 text-xs text-retro-fg animate-orbit-slide-up">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="shrink-0 text-[10px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 px-2 py-0.5 border border-cyan-500/40 rounded-md flex items-center gap-1 shadow-sm">
            <Sparkles className="w-2.5 h-2.5" />
            <span>Broadcast</span>
          </span>
          <span className="truncate font-semibold text-retro-fg text-xs">
            {announcement.message}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            playPress(650)
            setDismissedId(announcement.id)
          }}
          className="text-retro-muted hover:text-retro-fg hover:bg-surface-elevated/80 transition-colors p-1 rounded-lg shrink-0 cursor-pointer"
          title="Dismiss announcement"
          aria-label="Dismiss announcement"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}