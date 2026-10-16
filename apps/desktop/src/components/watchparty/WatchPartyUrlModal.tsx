'use client'

// Watch Party video modal. Create mode (URL + party name) when no room is
// open; LOAD/QUEUE mode against the active room otherwise.

import { useState } from 'react'
import { classifyStaticUrl } from '@orbit/shared'
import { Modal } from '../Modal'
import { BTN_PRIMARY } from '../../ui/styles'
import { createParty, expandPlaylist, loadPartyVideo, loadPartyVideos } from '../../hooks/watchPartyStore'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchPartyUrlModal({
  identity,
  onClose,
  joinPartyId = null,
  queueMode = false,
  lockVideo = false,
}: {
  identity: IdentityLike
  onClose: () => void
  /** Room to load into; null = create a new party. */
  joinPartyId?: string | null
  /** Load into the queue without interrupting playback. */
  queueMode?: boolean
  lockVideo?: boolean
}) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)

  const inRoom = Boolean(joinPartyId)
  const blocked = inRoom && lockVideo
  const firstLine = url.split(/\n+/).map((l) => l.trim()).filter(Boolean)[0] || ''
  const hint = firstLine ? classifyStaticUrl(firstLine) : null
  const hintText = !firstLine
    ? 'Direct .mp4 links, playlists, and video pages (pmvhaven, redgifs, X, Reddit) are parsed server-side.'
    : !hint?.ok
      ? hint?.reason || 'That link will not play here.'
      : hint.ext
        ? `Direct video candidate (.${hint.ext}). The server still verifies it before playing.`
        : `Provider page (${hint.provider || 'page'}). The server will try to find a playable file; some pages cannot be embedded.`

  const submit = async () => {
    if (!url.trim() || busy || blocked) return
    setBusy(true)
    setError(null)
    setStatusText(null)

    const trimmedUrl = url.trim()
    const lines = trimmedUrl.split(/\n+/).map((l) => l.trim()).filter(Boolean)

    const isValidUrl = (val: string): boolean => {
      try {
        const u = new URL(val)
        // The media pipeline only resolves HTTP/HTTPS. Accepting ipfs: here
        // would pass client validation and fail server-side with no recovery.
        return u.protocol === 'http:' || u.protocol === 'https:'
      } catch {
        return false
      }
    }

    if (lines.length === 0 || !lines.some(isValidUrl)) {
      setBusy(false)
      setError('Please enter a valid HTTP or HTTPS media URL.')
      return
    }

    // Inspect / expand link if it might be a playlist
    setStatusText('Checking link...')
    const expandRes = await expandPlaylist(identity, trimmedUrl)

    const isPlaylist = Boolean(expandRes.ok && expandRes.isPlaylist && (expandRes.items?.length ?? 0) > 1)
    const expandedUrls = isPlaylist && expandRes.items ? expandRes.items.map((it) => it.url) : lines

    if (!inRoom) {
      if (isPlaylist) {
        setStatusText(`Detected playlist: ${expandedUrls.length} videos found. Starting party with video 1...`)
        const partyName = name.trim() || expandRes.playlistTitle || 'Party'
        const res = await createParty(identity, expandedUrls[0], partyName)
        if (!res.ok) {
          setBusy(false)
          setStatusText(null)
          setError(res.error || 'Could not start the party.')
          return
        }
        const partyId = res.partyId || ''
        const remainingUrls = expandedUrls.slice(1)
        if (remainingUrls.length > 0 && partyId) {
          let totalAdded = 0
          for (let i = 0; i < remainingUrls.length; i += 10) {
            const batch = remainingUrls.slice(i, i + 10)
            const end = Math.min(i + 10, remainingUrls.length)
            setStatusText(`Party created! Queuing videos ${i + 1}-${end} of ${remainingUrls.length}...`)
            const bulk = await loadPartyVideos(identity, partyId, batch, true)
            if (!bulk.ok || bulk.failed.length === batch.length) {
              setError(bulk.failedDetails?.[0]?.reason || `Party started. ${bulk.failed.length} videos failed to queue.`)
              setBusy(false)
              setStatusText(null)
              return
            }
            totalAdded += bulk.added
          }
          setStatusText(`All ${totalAdded || remainingUrls.length} videos added to queue! Entering room...`)
        }
      } else if (lines.length > 1) {
        setStatusText(`Starting party with video 1 of ${lines.length}...`)
        const res = await createParty(identity, lines[0], name.trim())
        if (!res.ok) {
          setBusy(false)
          setStatusText(null)
          setError(res.error || 'Could not start the party.')
          return
        }
        const partyId = res.partyId || ''
        const remainingUrls = lines.slice(1)
        if (partyId && remainingUrls.length > 0) {
          let totalAdded = 0
          for (let i = 0; i < remainingUrls.length; i += 10) {
            const batch = remainingUrls.slice(i, i + 10)
            const end = Math.min(i + 10, remainingUrls.length)
            setStatusText(`Party created! Queuing videos ${i + 1}-${end} of ${remainingUrls.length}...`)
            const bulk = await loadPartyVideos(identity, partyId, batch, true)
            if (!bulk.ok || bulk.failed.length === batch.length) {
              setError(bulk.failedDetails?.[0]?.reason || `Party started. ${bulk.failed.length} videos failed to queue.`)
              setBusy(false)
              setStatusText(null)
              return
            }
            totalAdded += bulk.added
          }
          setStatusText(`All ${totalAdded || remainingUrls.length} videos added to queue! Entering room...`)
        }
      } else {
        setStatusText('Starting party...')
        const res = await createParty(identity, lines[0], name.trim())
        if (!res.ok) {
          setBusy(false)
          setStatusText(null)
          setError(res.error || 'Could not start the party.')
          return
        }
      }
    } else {
      const targetPartyId = joinPartyId as string
      if (isPlaylist || lines.length > 1) {
        const toQueue = isPlaylist ? expandedUrls : lines
        let totalAdded = 0
        for (let i = 0; i < toQueue.length; i += 10) {
          const batch = toQueue.slice(i, i + 10)
          const end = Math.min(i + 10, toQueue.length)
          setStatusText(`Adding videos ${i + 1}-${end} of ${toQueue.length} to queue...`)
          const res = await loadPartyVideos(identity, targetPartyId, batch, queueMode)
          if (!res.ok) {
            setBusy(false)
            setStatusText(null)
            setError(res.failedDetails?.[0]?.reason || res.error || 'Could not load these videos.')
            return
          }
          if (res.failed.length === batch.length) {
            const detail = res.failedDetails?.[0]?.reason
            setError(detail || `Failed to queue: ${res.failed[0]}`)
            setBusy(false)
            setStatusText(null)
            return
          }
          totalAdded += res.added
        }
        setStatusText(`Added ${totalAdded} videos to queue!`)
      } else {
        setStatusText('Loading video...')
        const res = await loadPartyVideo(identity, targetPartyId, trimmedUrl, name.trim(), queueMode)
        if (!res.ok) {
          setBusy(false)
          setStatusText(null)
          setError(res.failedDetails?.[0]?.reason || res.error || 'Could not load this video.')
          return
        }
        if (res.failed && res.failed.length > 0) {
          const detail = res.failedDetails?.[0]?.reason
          setError(detail || `Failed to load: ${res.failed[0]}`)
          setBusy(false)
          setStatusText(null)
          return
        }
      }
    }
    setBusy(false)
    setStatusText(null)
    onClose()
  }

  return (
    <Modal title={inRoom ? (queueMode ? 'Add to queue' : 'Load video') : 'Watch Party'} onClose={onClose}>
      <div className="space-y-3">
        <textarea
          autoFocus
          aria-label="Video URL"
          value={url}
          rows={inRoom ? 2 : 4}
          placeholder={inRoom ? 'Video or playlist URLs, one per line' : 'Video or playlist URLs, one per line (first starts the party)'}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (inRoom && !e.shiftKey && !url.includes('\n')) {
                e.preventDefault()
                void submit()
              } else if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                void submit()
              }
            }
          }}
          className="glass-field w-full px-3 py-2 text-xs font-mono resize-y"
        />
        <p className="text-[10px] text-retro-muted">
          {hintText}
        </p>
        {!inRoom && (
          <input
            aria-label="Party name"
            value={name}
            placeholder="Party name (optional)"
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
            className="glass-field w-full px-3 py-2 text-xs"
          />
        )}
        {blocked && <p className="text-xs text-retro-muted">Only the host can load videos in this room.</p>}
        {statusText && (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-glass-w5 border border-border-glass text-xs font-mono text-retro-fg animate-orbit-fade-in">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="truncate">{statusText}</span>
          </div>
        )}
        {error && <p className="text-xs text-retro-error">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!url.trim() || busy || blocked}
            className={`${BTN_PRIMARY} flex-1 py-2 text-xs disabled:opacity-40`}
          >
            {busy ? (statusText || 'Parsing...') : inRoom ? (queueMode ? 'ADD TO QUEUE' : 'LOAD VIDEO') : 'START PARTY'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
