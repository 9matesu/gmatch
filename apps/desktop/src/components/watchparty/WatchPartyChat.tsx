'use client'

// Party chat: relayed text over the watch WS room (server rate-limits).
// Session history only; a room is ephemeral, so no persistence by design.

import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { sendPartyChat, deletePartyChat, type PartyRuntime } from '../../hooks/watchPartyStore'
import { Avatar } from '../Avatar'
import { MUTED } from '../../ui/styles'
import { renderChatText } from './chatText'

export function WatchPartyChat({ party, profilePics, myId, isHost }: {
  party: PartyRuntime | null
  profilePics: Record<string, string>
  myId: string
  isHost?: boolean
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

  const chat = party?.chat || []

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t border-border-glass">
      <p className={`px-3 pt-2 pb-1 uppercase tracking-wider ${MUTED}`}>Chat</p>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-1.5 styled-scrollbar">
        {chat.map((m, i) => m.sys ? (
          <p key={`${m.at}-${i}`} className="text-center text-[10px] uppercase tracking-wider text-retro-muted">{m.text}</p>
        ) : (
          <div key={`${m.at}-${i}`} className="group flex items-start gap-2">
            <Avatar id={m.from || m.id} size={18} imageUrl={profilePics[m.from || m.id] || null} />
            <div className="min-w-0 flex-1">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${m.from === myId ? 'text-retro-fg' : 'text-retro-muted'}`}>
                {m.name}
              </span>
              <p className="text-xs text-retro-fg break-words">{renderChatText(m.text)}</p>
            </div>
            {(isHost || m.from === myId) && (
              <button
                type="button"
                onClick={() => party && deletePartyChat(party.id, m.id)}
                aria-label="Delete message"
                className="p-1 rounded-md text-retro-muted hover:text-retro-error hover:bg-glass-w10 opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {chat.length === 0 && (
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
          {text.length >= 60 && <p className={`pt-1 text-right ${MUTED}`}>{text.length}/80</p>}
        </div>
      )}
    </div>
  )
}
