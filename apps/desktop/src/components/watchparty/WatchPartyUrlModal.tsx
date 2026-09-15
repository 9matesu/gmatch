'use client'

// Watch Party video modal. Create mode (URL + party name) when no room is
// open; LOAD/QUEUE mode against the active room otherwise.

import { useState } from 'react'
import { Modal } from '../Modal'
import { BTN, BTN_PRIMARY } from '../../ui/styles'
import { createParty, loadPartyVideo } from '../../hooks/watchPartyStore'

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

  const inRoom = Boolean(joinPartyId)
  const blocked = inRoom && lockVideo

  const submit = async () => {
    if (!url.trim() || busy || blocked) return
    setBusy(true)
    setError(null)
    const res = inRoom
      ? await loadPartyVideo(identity, joinPartyId as string, url.trim(), name.trim(), queueMode)
      : await createParty(identity, url.trim(), name.trim())
    setBusy(false)
    if (!res.ok) {
      setError(res.error || 'Could not start the party.')
      return
    }
    onClose()
  }

  return (
    <Modal title={inRoom ? (queueMode ? 'Add to queue' : 'Load video') : 'Watch Party'} onClose={onClose}>
      <div className="space-y-3">
        <input
          autoFocus
          aria-label="Video URL"
          value={url}
          placeholder="Video URL or page link"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          className="glass-field w-full px-3 py-2 text-xs font-mono"
        />
        <p className="text-[10px] text-retro-muted">
          Direct .mp4 links and video pages (pmvhaven, redgifs, X, Reddit) are parsed server-side.
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
        {error && <p className="text-xs text-retro-error">{error}</p>}
        <div className="flex gap-2">
          {inRoom && queueMode && (
            <button
              type="button"
              onClick={() => void loadIntoRoom()}
              disabled={!url.trim() || busy || blocked}
              className={`${BTN} flex-1 py-2 text-xs disabled:opacity-40`}
            >
              LOAD NOW
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!url.trim() || busy || blocked}
            className={`${BTN_PRIMARY} flex-1 py-2 text-xs disabled:opacity-40`}
          >
            {busy ? 'Parsing...' : inRoom ? (queueMode ? 'ADD TO QUEUE' : 'LOAD VIDEO') : 'START PARTY'}
          </button>
        </div>
      </div>
    </Modal>
  )

  async function loadIntoRoom() {
    if (!url.trim() || busy || blocked || !joinPartyId) return
    setBusy(true)
    setError(null)
    const res = await loadPartyVideo(identity, joinPartyId, url.trim(), name.trim(), false)
    setBusy(false)
    if (!res.ok) {
      setError(res.error || 'Could not load this video.')
      return
    }
    onClose()
  }
}
