'use client'

// Party chat: relayed text over the watch WS room (server rate-limits).
// Local store only; a party is ephemeral, so no persistence by design.

import { useEffect, useRef, useState } from 'react'
import { sendPartyChat, type PartyRuntime } from '../../hooks/watchPartyStore'
import { Avatar } from '../Avatar'
import { MUTED } from '../../ui/styles'

export function WatchPartyChat({ party, profilePics, myId }: {
  party: PartyRuntime | null
  profilePics: Record<string, string>
  myId: string
}) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [party?.chat.length])

  const send = () => {
    if (!party || !text.trim()) return
    sendPartyChat(party.id, text)
    setText('')
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-border-glass">
      <p className={`px-3 pt-2 pb-1 uppercase tracking-wider ${MUTED}`}>Chat</p>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-1.5 styled-scrollbar">
        {(party?.chat || []).map((m, i) => (
          <div key={`${m.at}-${i}`} className="flex items-start gap-2">
            <Avatar id={m.id} size={18} imageUrl={profilePics[m.id] || null} />
            <div className="min-w-0">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${m.id === myId ? 'text-retro-fg' : 'text-retro-muted'}`}>
                {m.name}
              </span>
              <p className="text-xs text-retro-fg break-words">{m.text}</p>
            </div>
          </div>
        ))}
        {(!party || party.chat.length === 0) && (
          <p className="text-[10px] text-retro-muted">No messages yet.</p>
        )}
      </div>
      {party && (
        <div className="p-2 border-t border-border-glass">
          <input
            value={text}
            aria-label="Party chat message"
            placeholder="Message"
            maxLength={80}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            className="glass-inset w-full px-2.5 py-1.5 text-xs"
          />
        </div>
      )}
    </div>
  )
}
