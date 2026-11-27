'use client'

// Room playlist: resolved videos waiting to play. The current entry is
// marked; the host can play any entry now or drop entries. Add accepts up
// to 10 URLs (one per line) and runs the server media pipeline on them
// without interrupting playback.

import { useRef, useState } from 'react'
import { Download, Flag, ListVideo, Loader2, Play, Plus, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button, Textarea } from '../../ui/kit'
import {
  CHROME,
  COLOR,
  GAP,
  ICON,
  MONO,
  RADIUS,
  STATUS,
  TRACKING,
  TYPE,
  cx,
} from '../../ui/tokens'
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
        className={cx(CHROME.iconButton, STATUS.success)}
      >
        <Download className={ICON.sm} />
      </button>
    )
  }
  if (status === 'receiving') {
    const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
    return (
      <span className={cx('flex items-center', GAP[1])} title={`Receiving from peers (${pct}%)`}>
        <Loader2 className={cx(ICON.sm, 'animate-spin', COLOR.muted)} />
        <span className={cx(TYPE.caption, MONO, COLOR.muted)}>{pct}%</span>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel transfer"
          title="Cancel transfer"
          className={CHROME.iconButton}
        >
          <X className={ICON.sm} />
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
      className={CHROME.iconButton}
    >
      <Download className={ICON.sm} />
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
    <div className="border-t border-edge">
      <div className={cx('flex items-center justify-between px-3 pt-2 pb-1')}>
        <p className={cx('flex items-center', GAP[1.5], TYPE.caption, 'font-bold uppercase', TRACKING.wider, COLOR.muted)}>
          <ListVideo className={ICON.sm} aria-hidden />
          Queue {party.queue.length > 0 && `(${party.queue.length})`}
        </p>
        {canAdd && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-label="Add to queue"
            className={CHROME.iconButton}
          >
            <Plus className={ICON.sm} />
          </button>
        )}
      </div>

      {adding && (
        <div className="px-3 pb-2 space-y-1.5">
          <Textarea
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
            className={cx('w-full font-mono resize-y')}
          />
          <p className={cx(TYPE.caption, COLOR.muted, 'text-pretty')}>Up to 10 per add, or one pmvhaven playlist link per line. Parsing runs server-side.</p>
          {error && <p className={cx(TYPE.caption, STATUS.danger)}>{error}</p>}
          <div className={cn('flex', GAP[2])}>
            <Button variant="secondary" size="sm" onClick={() => void submit(true)} disabled={busy} className="flex-1 py-1 text-2xs uppercase tracking-wider">
              {busy ? 'Parsing...' : 'Add'}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submit(false)} disabled={busy} className="flex-1 py-1 text-2xs uppercase tracking-wider">
              Add and play
            </Button>
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
              className={cn(
                'flex items-center', GAP[2], TYPE.body,
                canControl && 'cursor-grab active:cursor-grabbing',
                q.status === 'unavailable' && 'opacity-50',
              )}
            >
              <span className={COLOR.muted}>{i + 1}</span>
              <span
                className={cn('truncate flex-1', q.id === party.current ? cx(TYPE.body, 'font-semibold', COLOR.fg) : COLOR.muted)}
                title={q.provider ? `via ${q.provider}` : undefined}
              >
                {q.name || q.url}
              </span>
              {q.status === 'proposed' && (
                <span className={CHROME.warningPill} title="A participant suggestion — the host approves it before it can play">
                  proposed
                </span>
              )}
              {q.status === 'unavailable' && (
                <span className={cx(RADIUS.pill, 'border', STATUS.dangerEdge, TYPE.caption, 'font-semibold uppercase', TRACKING.wider, STATUS.danger)} title="Flagged as unplayable — skipped by next/previous">
                  unavailable
                </span>
              )}
              {q.local && (
                <span
                  className={cx(MONO, TYPE.caption, COLOR.muted)}
                  title={`Local file · sha256:${(q.hash || '').slice(0, 12)}… · ready ${(party.ready[q.id] || []).length}/${party.members.length}`}
                >
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => queueOp(party.id, 'approve', q.id)}
                  aria-label={`Approve ${q.name || 'video'}`}
                  title="Approve suggestion"
                  className={cx('px-2 py-0.5', TYPE.caption, 'font-bold uppercase', TRACKING.wider)}
                >
                  Approve
                </Button>
              )}
              {canControl && q.id !== party.current && q.status !== 'proposed' && q.status !== 'unavailable' && (
                <button type="button" onClick={() => queueOp(party.id, 'play', q.id)} aria-label="Play now" className={CHROME.iconButton}>
                  <Play className={ICON.sm} />
                </button>
              )}
              {canControl && (
                <button type="button" onClick={() => queueOp(party.id, 'remove', q.id)} aria-label="Remove from queue" className={CHROME.iconButton}>
                  <X className={ICON.sm} />
                </button>
              )}
              {canControl && q.status !== 'unavailable' && (
                <button type="button" onClick={() => queueOp(party.id, 'flag', q.id)} aria-label="Flag as unavailable" title="Flag as unavailable" className={cx(CHROME.iconButton, STATUS.dangerHoverHard)}>
                  <Flag className={ICON.sm} />
                </button>
              )}
              {canControl && q.status === 'unavailable' && (
                <button type="button" onClick={() => queueOp(party.id, 'unflag', q.id)} aria-label="Mark as available" title="Mark as available again" className={cx(CHROME.iconButton, TYPE.caption, 'font-semibold uppercase', TRACKING.wider)}>
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {party.queue.length === 0 && !adding && <p className={cx('px-3 pb-2', TYPE.caption, COLOR.muted)}>Empty.</p>}
      {canControl && party.queue.length > 0 && (
        <div className="px-3 pb-2">
          <Button variant="secondary" size="sm" onClick={() => queueOp(party.id, 'next')} className={cx('px-2 py-1', TYPE.caption, 'uppercase', TRACKING.wider)}>
            Play next
          </Button>
        </div>
      )}
    </div>
  )
}
