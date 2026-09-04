import React, { useEffect, useState, useCallback } from 'react'
import { parseTags, type User } from '@orbit/shared'
import type { DecisionItem } from '../hooks/useGame'
import { ObjectImage } from './ObjectImage'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export interface MatchResult {
  decision?: string
  matched?: boolean
  matches?: number
  unavailable?: boolean
  tier?: number
}

interface DecisionPopupProps {
  item: DecisionItem
  users?: User[]
  identity?: IdentityLike | null
  onDecide: (objectId: string, decision: 'like' | 'reject' | 'pass') => Promise<MatchResult | null>
  onDismiss: (objectId: string) => void
  onRespond: (ownerId: string) => void
}

export function DecisionPopup({ item, users, identity = null, onDecide, onDismiss, onRespond }: DecisionPopupProps) {
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [failed, setFailed] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  const handleAction = useCallback(async (decision: 'like' | 'reject' | 'pass') => {
    if (deciding) return
    setDeciding(true)
    try {
      const res = await onDecide(item.id, decision)
      if (res && res.unavailable) {
        setUnavailable(true)
        window.setTimeout(() => onDismiss(item.id), 1800)
      } else if (res && res.matched) {
        setMatchResult(res)
      } else if (res) {
        // Server confirmed a non-match decision — advance the queue
        onDismiss(item.id)
      } else {
        // Failed / offline fallback — keep item in queue for retry (T-U2)
        setFailed(true)
      }
    } catch {
      onDismiss(item.id)
    } finally {
      setDeciding(false)
    }
  }, [deciding, item, onDecide, onDismiss])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (deciding || matchResult) return
      if (e.key === 'ArrowLeft') {
        handleAction('reject')
      } else if (e.key === 'ArrowRight') {
        handleAction('like')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [item, deciding, matchResult, handleAction])

  if (!item) return null

  const senderUser = users?.find((u) => u.id === item?.owner_id)
  const senderTags: string[] = parseTags(item?.tags || senderUser?.tags)
  const senderName = item.display_name?.trim() || item.owner_name?.trim() || senderUser?.display_name?.trim() || 'Unknown User'
  const isP2pLocal = typeof item?.id === 'string' && item.id.startsWith('p2p-obj-')
  const imageUrl = item.content_url || (item.id && !isP2pLocal ? `/api/objects/${item.id}` : null)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-retro-panel border border-retro-border rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col font-sans">
        {/* Header */}
        <div className="p-4 border-b border-retro-border flex items-center justify-between bg-retro-bg">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-retro-panel border border-retro-border flex items-center justify-center font-bold text-white text-sm shadow">
              {senderName.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-sm font-bold text-retro-fg">{senderName}</h3>
              <p className="text-[11px] text-retro-muted">Sent you an image card</p>
              {senderTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {senderTags.map((tag: string) => (
                    <span key={tag} className="text-[9px] font-bold px-1.5 py-0.5 bg-retro-panel border border-retro-border text-retro-accent">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => handleAction('pass')}
            className="text-xs text-retro-muted hover:text-white px-2.5 py-1 rounded border border-retro-border hover:bg-retro-border transition"
          >
            Skip (Pass)
          </button>
        </div>

        {/* Match Result Overlay */}
        {matchResult ? (
          <div className="p-8 flex flex-col items-center text-center space-y-6 bg-retro-panel border-t border-retro-border">
            <div className="w-16 h-16 rounded-full bg-retro-bg border-2 border-white flex items-center justify-center text-3xl animate-bounce">
              ★
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-white tracking-wider">IT&apos;S A MATCH!</h2>
              <p className="text-xs text-retro-muted mt-2">
                You and {senderName} liked each other&apos;s images!
              </p>
              <div className="mt-3 inline-block px-4 py-1.5 rounded-full bg-retro-bg border border-white text-white text-xs font-semibold">
                Tier {matchResult.tier} · {matchResult.matches ?? 0} Mutual Match{(matchResult.matches ?? 0) > 1 ? 'es' : ''}
              </div>
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => {
                  onRespond(item.owner_id)
                  onDismiss(item.id)
                }}
                className="flex-1 py-3 px-4 rounded-xl chrome-accent text-black font-bold text-xs uppercase tracking-wider shadow-lg transition"
              >
                Send Response Image ▶
              </button>
              <button
                onClick={() => onDismiss(item.id)}
                className="py-3 px-4 rounded-xl bg-retro-bg hover:bg-retro-border text-retro-fg font-bold text-xs uppercase border border-retro-border transition"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Image Preview */}
            <div className="relative bg-retro-bg min-h-[280px] max-h-[400px] flex items-center justify-center overflow-hidden p-2">
              {imageUrl ? (
                <ObjectImage
                  contentUrl={item.content_url}
                  objectId={item.id}
                  identity={identity}
                  alt="Card Preview"
                  className="max-h-[380px] w-auto object-contain rounded-lg shadow-inner"
                  videoClassName="max-h-[380px] w-auto object-contain rounded-lg shadow-inner"
                  autoPlay
                  loop
                  controls
                  playsInline
                />
              ) : (
                <div className="text-center p-8 text-retro-muted">
                  <span className="text-4xl block mb-2">▣</span>
                  <span className="text-xs">Image card received</span>
                </div>
              )}
              {item.caption && (
                <div className="absolute bottom-3 left-3 right-3 bg-black/80 backdrop-blur-sm border border-retro-border rounded-lg p-2 text-xs text-retro-fg">
                  &quot;{item.caption}&quot;
                </div>
              )}
            </div>

            {/* Decision Controls */}
            <div className="p-4 bg-retro-panel border-t border-retro-border space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={deciding}
                  onClick={() => handleAction('reject')}
                  className="py-3.5 px-4 rounded-xl bg-retro-bg hover:bg-retro-border border border-retro-border text-retro-muted hover:text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow transition active:scale-95 disabled:opacity-30 cursor-pointer"
                >
                  <span>✖</span>
                  <span>REJECT (←)</span>
                </button>

                <button
                  disabled={deciding}
                  onClick={() => handleAction('like')}
                  className="py-3.5 px-4 rounded-xl chrome-accent text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow transition active:scale-95 disabled:opacity-30 cursor-pointer"
                >
                  <span>★</span>
                  <span>LIKE (→)</span>
                </button>
              </div>

              <div className="text-center text-[10px] text-retro-muted">
                Use <kbd className="px-1.5 py-0.5 bg-retro-bg border border-retro-border rounded text-retro-fg font-sans">←</kbd> / <kbd className="px-1.5 py-0.5 bg-retro-bg border border-retro-border rounded text-retro-fg font-sans">→</kbd> arrow keys to decide
              </div>

              {failed && (
                <div className="text-center text-[10px] text-retro-warning border border-retro-warning bg-retro-bg px-2 py-1.5">
                  Could not reach the server. Your decision was not saved — try again.
                </div>
              )}

              {unavailable && (
                <div className="text-center text-[10px] text-retro-warning border border-retro-warning bg-retro-bg px-2 py-1.5">
                  This card is no longer available to like.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
