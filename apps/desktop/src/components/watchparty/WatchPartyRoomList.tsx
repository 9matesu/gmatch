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

export function WatchPartyRoomList({ identity, onNewParty, kickedNotice }: { identity: IdentityLike; onNewParty: () => void; kickedNotice?: string }) {
  const [rooms, setRooms] = useState<Array<{ id: string; name: string; members: number; mediaName?: string }>>([])
  const [failed, setFailed] = useState(false)
  const [code, setCode] = useState('')
  const [joinError, setJoinError] = useState('')

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

  const joinByCode = async () => {
    const id = code.trim().toLowerCase()
    if (!/^[0-9a-f]{8}$/.test(id)) {
      setJoinError('Room codes are 8 letters.')
      return
    }
    setJoinError('')
    const ok = await joinPartyById(identity, id)
    if (!ok) setJoinError('No room with that code. It may have closed.')
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 styled-scrollbar">
      <div className="max-w-lg mx-auto space-y-3">
        {kickedNotice && (
          <p role="status" className="text-center text-xs text-retro-error">{kickedNotice}</p>
        )}
        <button type="button" onClick={onNewParty} className={`${BTN_PRIMARY} w-full py-3 text-xs flex items-center justify-center gap-2`}>
          <Plus className="w-4 h-4" />
          START A PARTY
        </button>

        <div className="flex items-center gap-2">
          <input
            aria-label="Join by room code"
            value={code}
            placeholder="Room code"
            maxLength={8}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void joinByCode() }}
            className="glass-inset flex-1 px-2.5 py-1.5 text-xs font-mono uppercase"
          />
          <button type="button" onClick={() => void joinByCode()} disabled={!code.trim()} className={`${BTN} px-3 py-1.5 text-xs uppercase tracking-wider disabled:opacity-40`}>
            Join
          </button>
        </div>
        {joinError && <p className="text-[10px] text-retro-error">{joinError}</p>}

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
                className={`${BTN} w-full px-3 py-2.5 text-xs text-left flex flex-col gap-0.5`}
              >
                <span className="flex items-center justify-between gap-2 w-full">
                  <span className="truncate font-semibold text-retro-fg">{r.name}</span>
                  <span className={`${MUTED} shrink-0`}>{r.members}/8</span>
                </span>
                {r.mediaName ? (
                  <span className={`truncate ${MUTED}`}>{r.mediaName}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
