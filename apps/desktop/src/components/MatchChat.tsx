"use client";

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@orbit/shared'
import { playChatMessage, resetChatSfx } from '../utils/sounds'
import { MessageSquare, ChevronUp, ChevronDown, Send } from 'lucide-react'

interface Props {
  matchId: string
  selfId: string
  messages: ChatMessage[]
  onSend: (matchId: string, body: string) => Promise<boolean>
  onLoad: (matchId: string) => Promise<ChatMessage[]>
  soundEnabled?: boolean
}

export function MatchChat({ matchId, selfId, messages, onSend, onLoad, soundEnabled = false }: Props) {
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const loadedRef = useRef(false)
  const prevCountRef = useRef(0)

  useEffect(() => {
    loadedRef.current = false
    prevCountRef.current = 0
  }, [matchId])

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void onLoad(matchId)
  }, [matchId, onLoad])

  useEffect(() => {
    const grew = messages.length > prevCountRef.current
    if (grew && soundEnabled) {
      const last = messages[messages.length - 1]
      if (last && last.sender_id !== selfId) playChatMessage()
      else resetChatSfx()
    }
    prevCountRef.current = messages.length
  }, [messages, open, soundEnabled, selfId])

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, open])

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    const ok = await onSend(matchId, text)
    setSending(false)
    if (ok) setDraft('')
  }

  const list = messages || []

  return (
    <div className="border border-border-glass rounded-2xl overflow-hidden bg-surface-raised shadow-xs font-sans">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-retro-body hover:text-retro-fg hover:bg-glass-w5 cursor-pointer transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-cyan-300" />
          <span>Match Chat {open ? '' : `(${list.length})`}</span>
        </span>
        <span className="text-retro-muted flex items-center gap-1 text-[11px]">
          <span>{open ? 'Collapse' : 'Expand'}</span>
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border-glass">
          <div ref={scrollRef} className="max-h-40 overflow-y-auto styled-scrollbar p-2.5 space-y-2 bg-surface-raised select-text">
            {list.length === 0 ? (
              <div className="text-center text-xs text-retro-muted py-3 select-none">
                No messages yet — say hello to your opponent.
              </div>
            ) : (
              list.map((m) => {
                const mine = m.sender_id === selfId
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-xs shadow-xs select-text ${
                        mine
                          ? 'bg-gradient-to-r from-cyan-600 to-amber-600 text-white rounded-br-xs'
                          : 'bg-cyan-500/10 text-retro-fg border border-purple-100 rounded-bl-xs'
                      }`}
                    >
                      {!mine && (
                        <div className="text-[9px] font-bold text-cyan-300 uppercase mb-0.5 select-none">
                          {m.sender_name?.trim() || 'Unknown User'}
                        </div>
                      )}
                      <div className="break-words whitespace-pre-wrap leading-relaxed select-text cursor-text">{m.body}</div>
                      <time className={`mt-1 block text-[8px] select-none ${mine ? 'text-white/60 text-right' : 'text-retro-muted'}`} dateTime={m.created_at}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="flex gap-1.5 p-2 border-t border-border-glass bg-surface-raised">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="Send a message to your opponent..."
              className="flex-1 bg-surface-interactive border border-border-glass text-retro-fg placeholder:text-retro-muted text-xs px-3 py-1.5 rounded-xl outline-none focus:border-purple-500 transition-colors"
            />
            <button
              type="button"
              disabled={!draft.trim() || sending}
              onClick={() => void handleSend()}
              className="px-3 py-1.5 text-xs font-bold bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-40 rounded-xl transition-colors cursor-pointer flex items-center gap-1 shrink-0 shadow-xs"
            >
              <Send className="w-3 h-3" />
              <span>Send</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
