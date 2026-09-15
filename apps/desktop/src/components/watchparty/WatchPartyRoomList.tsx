'use client'

// Watch section room list (theater landing before a party is open).

import { useEffect, useState } from 'react'
import { Clapperboard, Plus } from 'lucide-react'
import { orbitFetch } from '../../utils/api'
import { BTN, BTN_PRIMARY, MUTED, PLATE } from '../../ui/styles'
import { joinPartyById } from '../../hooks/watchPartyStore'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchPartyRoomList({ identity, onNewParty }: { identity: IdentityLike; onNewParty: () => void }) {
  const [rooms, setRooms] = useState<Array<{ id: string; name: string; members: number }>>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let dead = false
    void orbitFetch('/api/watchparty', {}, identity)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((b: any) => {
        if (!dead && Array.isArray(b.parties)) { setRooms(b.parties); setFailed(false) }
      })
      .catch(() => { if (!dead) setFailed(true) })
    return () => { dead = true }
  }, [identity])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 styled-scrollbar">
      <div className="max-w-lg mx-auto space-y-3">
        <button type="button" onClick={onNewParty} className={`${BTN_PRIMARY} w-full py-3 text-xs flex items-center justify-center gap-2`}>
          <Plus className="w-4 h-4" />
          START A PARTY
        </button>

        <p className={`pt-2 uppercase tracking-wider ${MUTED}`}>Open rooms</p>
        {failed && <p className="text-xs text-retro-muted">Room list unavailable.</p>}
        {!failed && rooms.length === 0 && (
          <div className={`${PLATE} p-6 flex flex-col items-center gap-2 text-center`}>
            <Clapperboard className="w-6 h-6 text-retro-muted" />
            <p className="text-xs text-retro-muted">No parties right now. Start one and paste a video URL.</p>
          </div>
        )}
        <ul className="space-y-1.5">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => { void joinPartyById(identity, r.id) }}
                className={`${BTN} w-full px-3 py-2.5 text-xs text-left flex items-center justify-between`}
              >
                <span className="truncate">{r.name}</span>
                <span className={MUTED}>{r.members}/8</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
