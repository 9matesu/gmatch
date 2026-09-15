'use client'

// Watch Party join/create modal. One input, one list, no wizard.

import { useEffect, useState } from 'react'
import { Modal } from '../Modal'
import { BTN, BTN_PRIMARY } from '../../ui/styles'
import { orbitFetch } from '../../utils/api'
import { createParty, joinParty } from '../../hooks/watchPartyStore'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchPartyUrlModal({
  identity,
  onClose,
}: {
  identity: IdentityLike
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parties, setParties] = useState<Array<{ id: string; name: string; members: number }>>([])

  useEffect(() => {
    let dead = false
    void orbitFetch('/api/watchparty', {}, identity)
      .then((r) => (r.ok ? r.json() : { parties: [] }))
      .then((b: any) => { if (!dead && Array.isArray(b.parties)) setParties(b.parties) })
      .catch(() => {})
    return () => { dead = true }
  }, [identity])

  const submit = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    const res = await createParty(identity, url.trim(), name.trim())
    setBusy(false)
    if (!res.ok) {
      setError(res.error || 'Could not start the party.')
      return
    }
    onClose()
  }

  return (
    <Modal title="Watch Party" onClose={onClose}>
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
        <input
          aria-label="Party name"
          value={name}
          placeholder="Party name (optional)"
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          className="glass-field w-full px-3 py-2 text-xs"
        />
        {error && <p className="text-xs text-retro-error">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!url.trim() || busy}
          className={`${BTN_PRIMARY} w-full py-2 text-xs disabled:opacity-40`}
        >
          {busy ? 'Parsing...' : 'START PARTY'}
        </button>

        {parties.length > 0 && (
          <div className="pt-1 border-t border-border-glass">
            <p className="text-[10px] uppercase tracking-wider text-retro-muted mb-2">Open parties</p>
            <ul className="space-y-1">
              {parties.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void orbitFetch(`/api/watchparty/${p.id}`, {}, identity)
                        .then((r) => (r.ok ? r.json() : null))
                        .then((snap: any) => {
                          if (snap) {
                            joinParty(identity, { id: snap.id, name: snap.name, url: snap.url })
                            onClose()
                          }
                        })
                        .catch(() => {})
                    }}
                    className={`${BTN} w-full px-3 py-2 text-xs text-left flex items-center justify-between`}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-retro-muted">{p.members}/8</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
