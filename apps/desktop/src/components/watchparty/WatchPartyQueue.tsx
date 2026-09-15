'use client'

// Room playlist: resolved videos waiting to play. The current entry is
// marked; the host can play any entry now or drop entries. Add runs the
// server media pipeline (same parse as START PARTY) into the queue without
// interrupting playback.

import { useState } from 'react'
import { ListVideo, Play, Plus, X } from 'lucide-react'
import { BTN, MUTED } from '../../ui/styles'
import { loadPartyVideo, queueOp, type PartyRuntime } from '../../hooks/watchPartyStore'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchPartyQueue({ party, identity }: { party: PartyRuntime; identity: IdentityLike }) {
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const isHost = party.host === identity.orbitId
  const canAdd = isHost || !party.lockVideo

  const submit = async () => {
    if (!url.trim()) return
    setError('')
    const res = await loadPartyVideo(identity, party.id, url.trim(), '', true)
    if (!res.ok) {
      setError(res.error || 'Could not queue this video.')
      return
    }
    setUrl('')
    setAdding(false)
  }

  return (
    <div className="border-t border-border-glass">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-retro-muted">
          <ListVideo className="w-3.5 h-3.5" />
          Queue {party.queue.length > 0 && `(${party.queue.length})`}
        </p>
        {canAdd && (
          <button type="button" onClick={() => setAdding((v) => !v)} aria-label="Add to queue" className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {adding && (
        <div className="px-3 pb-2 space-y-1">
          <input
            autoFocus
            aria-label="Queue video URL"
            value={url}
            placeholder="Video URL or page link"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
            className="glass-inset w-full px-2.5 py-1.5 text-xs font-mono"
          />
          {error && <p className="text-[10px] text-retro-error">{error}</p>}
        </div>
      )}
      {party.queue.length > 0 && (
        <ul className="px-3 pb-2 max-h-28 overflow-y-auto space-y-0.5 styled-scrollbar">
          {party.queue.map((q, i) => (
            <li key={q.id} className="flex items-center gap-2 text-xs">
              <span className={MUTED}>{i + 1}</span>
              <span className={`truncate flex-1 ${q.id === party.current ? 'text-retro-fg font-semibold' : 'text-retro-muted'}`}>
                {q.name || q.url}
              </span>
              {isHost && q.id !== party.current && (
                <button type="button" onClick={() => queueOp(party.id, 'play', q.id)} aria-label="Play now" className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
                  <Play className="w-3 h-3" />
                </button>
              )}
              {isHost && (
                <button type="button" onClick={() => queueOp(party.id, 'remove', q.id)} aria-label="Remove from queue" className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {party.queue.length === 0 && !adding && <p className="px-3 pb-2 text-[10px] text-retro-muted">Empty.</p>}
      {canAdd && party.queue.length > 0 && (
        <div className="px-3 pb-2">
          <button type="button" onClick={() => queueOp(party.id, 'next')} className={`${BTN} px-2 py-1 text-[10px] uppercase tracking-wider`}>
            Play next
          </button>
        </div>
      )}
    </div>
  )
}
