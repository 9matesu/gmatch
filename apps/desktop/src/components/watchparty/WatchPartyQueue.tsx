'use client'

// Room playlist: resolved videos waiting to play. The current entry is
// marked; the host can play any entry now or drop entries. Add accepts up
// to 10 URLs (one per line) and runs the server media pipeline on them
// without interrupting playback.

import { useRef, useState } from 'react'
import { ListVideo, Play, Plus, X, Download, Loader2, Flag } from 'lucide-react'
import { BTN, BTN_PRIMARY, MUTED } from '../../ui/styles'
import { loadPartyVideos, moveQueueEntry, queueOp, canControlParty, type PartyRuntime } from '../../hooks/watchPartyStore'
import { signalLocalReady, useLocalEntryTransfer } from '../../hooks/watchLocalShare'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

function parseLines(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  // 10 normal urls per add, or up to 30 pmvhaven playlists (each expands
  // server-side to max 30 videos, hard-capped at 100 after expansion).
  return lines.slice(0, lines.every(isPmvPlaylist) ? 30 : 10)
}

function isPmvPlaylist(u: string): boolean {
  return /pmvhaven\.com\/playlists\//i.test(u)
}

/**
 * Receiver controls for a consent-shared local entry: explicit fetch with
 * integrity + progress + cancel, then a readiness claim. Nothing auto-starts.
 */
function LocalEntryTransfer({ partyId, entryId, objectId, hash }: {
  partyId: string
  entryId: string
  objectId: string | null
  hash?: string
}) {
  const { status, received, total, error, receive, cancel } = useLocalEntryTransfer(objectId, hash)

  // A verified local copy (own share, or a completed transfer) claims
  // readiness once; the slot does the same for the playing entry.
  if (status === 'have-local' || status === 'ready') {
    return (
      <button
        type="button"
        onClick={() => signalLocalReady(partyId, entryId, hash)}
        title="Bytes verified on this machine — tell the room"
        aria-label="Mark local file ready"
        className="p-1 rounded-md hover:bg-glass-w10 text-emerald-400 hover:text-emerald-300 cursor-pointer"
      >
        <Download className="w-3 h-3" />
      </button>
    )
  }
  if (status === 'receiving') {
    const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
    return (
      <span className="flex items-center gap-1" title={`Receiving from peers (${pct}%)`}>
        <Loader2 className="w-3 h-3 animate-spin text-retro-muted" />
        <span className="font-mono text-[10px] text-retro-muted">{pct}%</span>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel transfer"
          title="Cancel transfer"
          className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void receive()}
      title={error ? `Receive from peers (last try: ${error})` : 'Receive from peers'}
      aria-label="Receive local file from peers"
      className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer"
    >
      <Download className="w-3 h-3" />
    </button>
  )
}

export function WatchPartyQueue({ party, identity }: { party: PartyRuntime; identity: IdentityLike }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isHost = party.host === identity.orbitId
  const canAdd = isHost || !party.lockVideo
  const canControl = canControlParty(party, identity.orbitId)
  const dragId = useRef<string | null>(null)

  const submit = async (queueOnly: boolean) => {
    const urls = parseLines(text)
    if (urls.length === 0 || busy) return
    if (urls.length > 10 && !urls.every(isPmvPlaylist)) {
      setError('Add up to 10 videos at a time. One pmvhaven playlist per add works too.')
      return
    }
    setError('')
    setBusy(true)
    if (urls.some(isPmvPlaylist)) setError('Expanding playlists, parsing each video in order...')
    const res = await loadPartyVideos(identity, party.id, urls, queueOnly)
    setBusy(false)
    if (!res.ok) {
      setError(res.failedDetails?.[0]?.reason || (res.failed.length
        ? `${res.error} Failed: ${res.failed.join(', ')}`
        : (res.error || 'Could not queue these videos.')))
      return
    }
    if (res.failed.length > 0) {
      const truncNote = res.truncated ? ' (Queue reached 50 limit)' : ''
      const detail = res.failedDetails?.[0]?.reason
      setError(detail || `Added ${res.added}. Failed ${res.failed.length}: ${res.failed[0]}${truncNote}`)
      if (res.added > 0) setText('')
      return
    }
    if (res.truncated) {
      setError(`Queue limit (50) reached. Added ${res.added} videos; remaining were omitted.`)
      setText('')
      return
    }
    setText('')
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
        <div className="px-3 pb-2 space-y-1.5">
          <textarea
            autoFocus
            aria-label="Queue video URLs"
            value={text}
            rows={4}
            placeholder="Video URLs, one per line"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(true)
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                void submit(true)
              }
            }}
            className="glass-inset w-full px-2.5 py-1.5 text-xs font-mono resize-y"
          />
          <p className={`text-[10px] ${MUTED}`}>Up to 10 per add, or one pmvhaven playlist link per line. Parsing runs server-side.</p>
          {error && <p className="text-[10px] text-retro-error">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void submit(true)} disabled={busy} className={`${BTN} flex-1 py-1 text-[10px] uppercase tracking-wider disabled:opacity-40`}>
              {busy ? 'Parsing...' : 'Add'}
            </button>
            <button type="button" onClick={() => void submit(false)} disabled={busy} className={`${BTN_PRIMARY} flex-1 py-1 text-[10px] uppercase tracking-wider disabled:opacity-40`}>
              Add and play
            </button>
          </div>
        </div>
      )}
      {party.queue.length > 0 && (
        <ul
          className="px-3 pb-2 max-h-28 overflow-y-auto space-y-0.5 styled-scrollbar"
          onDragOver={(e) => { if (dragId.current) e.preventDefault() }}
          onDrop={(e) => {
            // Dropped past the last row: append to the end (no `before`).
            e.preventDefault()
            const src = dragId.current
            dragId.current = null
            if (src) moveQueueEntry(party.id, src, '')
          }}
        >
          {party.queue.map((q, i) => (
            <li
              key={q.id}
              draggable={canControl}
              onDragStart={(e) => { dragId.current = q.id; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { if (dragId.current && dragId.current !== q.id) e.preventDefault() }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const src = dragId.current
                dragId.current = null
                // Insert before the row you drop on (moving to the very
                // last slot: drop the tail entry onto its own successor).
                if (src && src !== q.id) moveQueueEntry(party.id, src, q.id)
              }}
              className={`flex items-center gap-2 text-xs ${canControl ? 'cursor-grab active:cursor-grabbing' : ''} ${q.status === 'unavailable' ? 'opacity-50' : ''}`}
            >
              <span className={MUTED}>{i + 1}</span>
              <span className={`truncate flex-1 ${q.id === party.current ? 'text-retro-fg font-semibold' : 'text-retro-muted'}`}>
                {q.name || q.url}
              </span>
              {q.status === 'proposed' && (
                <span className="rounded-full border border-amber-400/40 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-amber-300" title="A participant suggestion — the host approves it before it can play">
                  proposed
                </span>
              )}
              {q.status === 'unavailable' && (
                <span className="rounded-full border border-retro-error/40 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-retro-error" title="Flagged as unplayable — skipped by next/previous">
                  unavailable
                </span>
              )}
              {q.local && (
                <span className="font-mono text-[10px] text-retro-muted" title={`Local file · sha256:${(q.hash || '').slice(0, 12)}… · ready ${(party.ready[q.id] || []).length}/${party.members.length}`}>
                  {(party.ready[q.id] || []).length}/{party.members.length} ready
                </span>
              )}
              {q.local && (
                <LocalEntryTransfer
                  partyId={party.id}
                  entryId={q.id}
                  objectId={(/\/api\/objects\/([0-9a-fA-F-]{36})/.exec(q.url || '') || [])[1] || null}
                  hash={q.hash}
                />
              )}
              {isHost && q.status === 'proposed' && (
                <button type="button" onClick={() => queueOp(party.id, 'approve', q.id)} aria-label={`Approve ${q.name || 'video'}`} title="Approve suggestion" className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer text-[10px] font-bold uppercase tracking-wider">
                  Approve
                </button>
              )}
              {canControl && q.id !== party.current && q.status !== 'proposed' && q.status !== 'unavailable' && (
                <button type="button" onClick={() => queueOp(party.id, 'play', q.id)} aria-label="Play now" className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
                  <Play className="w-3 h-3" />
                </button>
              )}
              {canControl && (
                <button type="button" onClick={() => queueOp(party.id, 'remove', q.id)} aria-label="Remove from queue" className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
              {canControl && q.status !== 'unavailable' && (
                <button type="button" onClick={() => queueOp(party.id, 'flag', q.id)} aria-label="Flag as unavailable" title="Flag as unavailable" className="p-1 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-error cursor-pointer">
                  <Flag className="w-3 h-3" />
                </button>
              )}
              {canControl && q.status === 'unavailable' && (
                <button type="button" onClick={() => queueOp(party.id, 'unflag', q.id)} aria-label="Mark as available" title="Mark as available again" className="px-2 py-0.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer text-[10px] font-semibold uppercase tracking-wider">
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {party.queue.length === 0 && !adding && <p className="px-3 pb-2 text-[10px] text-retro-muted">Empty.</p>}
      {canControl && party.queue.length > 0 && (
        <div className="px-3 pb-2">
          <button type="button" onClick={() => queueOp(party.id, 'next')} className={`${BTN} px-2 py-1 text-[10px] uppercase tracking-wider`}>
            Play next
          </button>
        </div>
      )}
    </div>
  )
}
