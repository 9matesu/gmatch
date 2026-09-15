'use client'

// Slim vertical edge tab that toggles the Watch Party dock. Renders nothing
// unless the user opted in (settings.watchPartyEnabled) in App.tsx.

import { Clapperboard } from 'lucide-react'
import { useWatchParty } from '../../hooks/watchPartyStore'

export function WatchPartyEdgeTab({ side, onToggle }: { side: 'left' | 'right'; onToggle: () => void }) {
  const { open, parties } = useWatchParty()
  const live = parties.length > 0
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle watch party"
      aria-pressed={open}
      className={`self-center shrink-0 h-fit py-3 px-1.5 glass-toolbar text-retro-muted hover:text-retro-fg flex flex-col items-center gap-2 cursor-pointer transition-colors duration-150 ${
        side === 'left' ? 'rounded-l-none mr-0.5' : 'rounded-r-none ml-0.5'
      }`}
    >
      <Clapperboard className="w-4 h-4" />
      <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-bold uppercase tracking-wider">
        {live ? 'Watch Party' : 'Watch'}
      </span>
    </button>
  )
}
