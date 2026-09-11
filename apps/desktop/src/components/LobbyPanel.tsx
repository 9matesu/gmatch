"use client";

import { useMemo, useState, useRef, useEffect } from 'react'
import { type OrbitObject, type LobbyImage, type LobbyComment, type User, type LeagueEntry } from '@orbit/shared'
import type { OrbitIdentity } from '@orbit/crypto'
import { currentMatch, activeTask } from '../utils/lobby'
import type { useLobby } from '../hooks/useLobby'
import { MatchRoundPanel } from './MatchRoundPanel'
import { YourMatchTab } from './YourMatchTab'
import { orbitFetch, uploadWithProgress } from '../utils/api'
import { createCardFromMedia } from '../utils/cardCollection'
import { playQueueJoin, playLike, playMatch } from '../utils/sounds'
import { SpectateModal } from './SpectateModal'
import { useToast } from './Toast'
import { useConfirm } from './ConfirmDialog'
import { MatchChat } from './MatchChat'
import { isMediaVideo, resolveMediaUrl } from '../utils/media'
import { MessageCircle } from 'lucide-react'
import { LazyVideo } from './LazyVideo'
import { LeagueBoard } from './lobby/LeagueBoard'
import { PlayerRoster } from './lobby/PlayerRoster'
import { QueueControls } from './lobby/QueueControls'
import { CardTile } from './home/CardTile'
import { openCardDetail } from '../utils/openCard'

interface LobbyTileProps {
  img: LobbyImage
  now: number
  soundEnabled: boolean
  onLike: (id: string) => void
  onExpandItem?: (id: string) => void
  onOpenImage?: (url: string) => void
  onGetLikers?: (id: string) => Promise<string[]>
  onGetComments?: (id: string) => Promise<LobbyComment[]>
  onAddComment?: (id: string, body: string) => Promise<LobbyComment | null>
  onDeleteComment?: (commentId: string) => Promise<boolean>
  onReportComment?: (commentId: string) => void
  onReport?: (id: string, category: string, reason: string) => Promise<{ hidden?: boolean } | null>
  selfId?: string
  onOpenProfile?: (user: User) => void
  users?: User[]
}

// Each lobby board tile owns its own broken-image state so a 404 on an
// expired /api/lobby/images/:id/content ref is hidden by returning null
// instead of rendering a placeholder. The CSS grid reflows to close the gap.
function LobbyTile({ img, now, soundEnabled, onLike, onExpandItem, onOpenImage, onGetLikers, onGetComments, onAddComment, onDeleteComment, onReportComment, onReport, selfId, users }: LobbyTileProps) {
  const [errored, setErrored] = useState(false)
  const [showLikers, setShowLikers] = useState(false)
  const [likers, setLikers] = useState<string[]>([])
  const [likersLoading, setLikersLoading] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<LobbyComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportCategory, setReportCategory] = useState('inappropriate')
  const [reportReason, setReportReason] = useState('')
  const [reporting, setReporting] = useState(false)
  const isVid = isMediaVideo(img.content_url) || Boolean(img.mime_type?.startsWith('video/'))
  const createdAtMs = img.created_at ? new Date(img.created_at).getTime() : 0
  const expireAtMs = createdAtMs > 0 ? createdAtMs + (3 * 3600 * 1000) : 0
  const wipeMsLeft = Math.max(0, expireAtMs - now)
  const wipeHoursLeft = Math.floor(wipeMsLeft / 3_600_000)
  const wipeMinsLeft = Math.floor((wipeMsLeft % 3_600_000) / 60_000)
  const wipeText = createdAtMs > 0 && wipeMsLeft > 0 ? `${wipeHoursLeft}h ${wipeMinsLeft}m` : '3h wipe'
  const mediaSrc = resolveMediaUrl(img.content_url || `/api/lobby/images/${img.id}/content`)

  // uploader name (B3): prefer the row column, fall back to a Users lookup.
  const uploaderName = useMemo(() => {
    if (img.uploader_name) return img.uploader_name
    if (users && img.owner_id) {
      const u = users.find((x) => x.id === img.owner_id)
      if (u?.display_name) return u.display_name
    }
    return null
  }, [img.uploader_name, img.owner_id, users])

  const handleMediaError = () => {
    setErrored(true)
    // Only evict the row from client state on a genuine server-fetch failure.
    // A video decode miss in the <img> branch (e.g. when a previously-detected
    // video tile briefly falls back to <img>) or a data:/blob: decode failure
    // must NOT prune the tile permanently — the server still has it.
    if (
      typeof window !== 'undefined' &&
      img.id &&
      !isVid &&
      mediaSrc.startsWith('/api/')
    ) {
      window.dispatchEvent(new CustomEvent('orbit-lobby-image-404', { detail: { imageId: img.id } }))
    }
  }

  const loadLikers = async () => {
    if (!onGetLikers) return
    setLikersLoading(true)
    try {
      const list = await onGetLikers(img.id)
      setLikers(list)
    } finally {
      setLikersLoading(false)
    }
  }

  const loadComments = async () => {
    if (!onGetComments) return
    setCommentsLoading(true)
    try {
      const list = await onGetComments(img.id)
      setComments(list)
    } finally {
      setCommentsLoading(false)
    }
  }

  const submitComment = async () => {
    const body = newComment.trim()
    if (!body || !onAddComment) return
    setSubmitting(true)
    try {
      const created = await onAddComment(img.id, body)
      if (created) {
        setComments((prev) => [...prev, created])
        setNewComment('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const removeComment = async (commentId: string) => {
    if (!onDeleteComment) return
    const ok = await onDeleteComment(commentId)
    if (ok) setComments((prev) => prev.filter((c) => c.id !== commentId))
  }

  const submitReport = async () => {
    if (!onReport) return
    setReporting(true)
    try {
      await onReport(img.id, reportCategory, reportReason.trim())
      setShowReport(false)
      setReportReason('')
    } finally {
      setReporting(false)
    }
  }

  if (errored || !mediaSrc) return null

  return (
    <div
      key={img.id}
      className="relative group border border-retro-border rounded-lg overflow-hidden animate-orbit-fade-in cursor-pointer aspect-square bg-black shadow-sm"
      onClick={() => {
        if (showComments || showLikers || showReport) return
        if (onExpandItem) {
          onExpandItem(img.id)
        } else if (onOpenImage && mediaSrc) {
          onOpenImage(mediaSrc)
        }
      }}
    >
      {isVid ? (
        <LazyVideo
          src={mediaSrc}
          videoClassName="hover:opacity-90 transition-opacity"
          onError={handleMediaError}
        />
      ) : (
        <img
          src={mediaSrc}
          alt={img.caption || ''}
          onError={handleMediaError}
          className="w-full aspect-square object-cover hover:opacity-90 transition-opacity"
        />
      )}

      {/* Auto-wipe countdown timestamp timer badge */}
      <div className="absolute top-1.5 right-1.5 bg-black/85 border border-retro-border text-retro-muted group-hover:text-retro-accent text-[8px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider flex items-center gap-1 z-10 pointer-events-none shadow">
        <span>⏱</span> {wipeText}
      </div>

      {/* Uploader name badge (B3) */}
      {uploaderName && (
        <div className="absolute top-1.5 left-1.5 bg-black/85 border border-retro-border text-retro-fg group-hover:text-retro-accent text-[8px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider z-10 pointer-events-none shadow max-w-[60%] truncate">
          @{uploaderName}
        </div>
      )}

      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 gap-1.5 z-20">
        {img.caption && <span className="text-[9px] text-retro-fg truncate font-medium">{img.caption}</span>}
        <div className="flex gap-1.5 pointer-events-auto flex-wrap">
          {/* B2: star -> like label change ("★ LIKE") */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onLike(img.id)
              if (soundEnabled) playLike()
            }}
            className="text-[9px] font-black tracking-widest text-retro-accent border border-retro-accent/60 px-2.5 py-1 hover:bg-retro-accent hover:text-retro-fg cursor-pointer bg-black/80 rounded transition-colors uppercase"
          >
            ★ LIKE ({img.likes_count || 0})
          </button>
          {/* B4: who-liked popover toggle */}
          {onGetLikers && (img.likes_count || 0) > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (!showLikers) loadLikers()
                setShowLikers((v) => !v)
                setShowComments(false)
                setShowReport(false)
              }}
              className="text-[9px] font-bold tracking-wider text-retro-muted border border-retro-border px-2 py-1 hover:bg-retro-fg hover:text-retro-fg cursor-pointer bg-black/80 rounded transition-colors uppercase"
              title="See who liked"
            >
              ⓘ
            </button>
          )}
          {/* B1: comments toggle */}
          {onGetComments && onAddComment && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (!showComments) loadComments()
                setShowComments((v) => !v)
                setShowLikers(false)
                setShowReport(false)
              }}
              className="text-[9px] font-bold tracking-wider text-retro-muted border border-retro-border px-2 py-1 hover:bg-retro-fg hover:text-retro-fg cursor-pointer bg-black/80 rounded transition-colors uppercase"
              title="Comments"
            >
              <MessageCircle className="w-3 h-3" />
            </button>
          )}
          {/* B5: report button */}
          {onReport && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowReport((v) => !v)
                setShowLikers(false)
                setShowComments(false)
              }}
              className="text-[9px] font-bold tracking-wider text-retro-muted border border-retro-border px-2 py-1 hover:bg-red-800 hover:text-white cursor-pointer bg-black/80 rounded transition-colors uppercase"
              title="Report"
            >
              ⚑
            </button>
          )}
        </div>
      </div>

      {/* B4: who-liked popover */}
      {showLikers && (
        <div
          className="absolute inset-0 z-30 bg-black/95 p-2 flex flex-col gap-1 text-retro-fg animate-orbit-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-retro-accent">
            <span>Liked by</span>
            <button type="button" onClick={() => setShowLikers(false)} className="text-retro-muted hover:text-retro-fg">✕</button>
          </div>
          <div className="flex-1 overflow-auto text-[9px] font-mono">
            {likersLoading ? (
              <div className="text-retro-muted">Loading…</div>
            ) : likers.length === 0 ? (
              <div className="text-retro-muted">No likes recorded.</div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {likers.map((name, i) => (
                  <li key={i} className="truncate">@{name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* B1: comments popover */}
      {showComments && (
        <div
          className="absolute inset-0 z-30 bg-black/95 p-2 flex flex-col gap-1 text-retro-fg animate-orbit-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-retro-accent">
            <span>Comments</span>
            <button type="button" onClick={() => setShowComments(false)} className="text-retro-muted hover:text-retro-fg">✕</button>
          </div>
          <div className="flex-1 overflow-auto text-[9px] font-mono flex flex-col gap-1">
            {commentsLoading ? (
              <div className="text-retro-muted">Loading…</div>
            ) : comments.length === 0 ? (
              <div className="text-retro-muted">No comments yet.</div>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="border border-retro-border rounded px-1.5 py-1">
                  <div className="flex items-center justify-between">
                    <span className="text-retro-accent font-bold">@{c.display_name || 'anon'}</span>
                    {(selfId && (c.user_id === selfId)) && (
                      <button
                        type="button"
                        onClick={() => removeComment(c.id)}
                        className="text-retro-muted hover:text-red-500 text-[8px]"
                      >del</button>
                    )}
                    {(!selfId || (selfId && c.user_id !== selfId)) && onReportComment && (
                      <button
                        type="button"
                        title="Report comment"
                        onClick={() => onReportComment(c.id)}
                        className="text-retro-muted hover:text-red-400 text-[8px]"
                      >flag</button>
                    )}
                  </div>
                  <div className="text-retro-fg break-words">{c.body}</div>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              maxLength={500}
              placeholder="Add a comment…"
              className="flex-1 bg-black/80 border border-retro-border rounded px-1.5 py-1 text-[9px] text-retro-fg focus:outline-none focus:border-retro-accent"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) {
                  e.preventDefault()
                  submitComment()
                }
              }}
            />
            <button
              type="button"
              disabled={submitting || !newComment.trim()}
              onClick={(e) => { e.stopPropagation(); submitComment() }}
              className="text-[9px] font-bold tracking-wider text-retro-accent border border-retro-accent/60 px-2 py-1 hover:bg-retro-accent hover:text-retro-fg bg-black/80 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* B5: report popover */}
      {showReport && (
        <div
          className="absolute inset-0 z-30 bg-black/95 p-2 flex flex-col gap-1.5 text-retro-fg animate-orbit-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest text-red-500">
            <span>Report image</span>
            <button type="button" onClick={() => setShowReport(false)} className="text-retro-muted hover:text-retro-fg">✕</button>
          </div>
          <select
            value={reportCategory}
            onChange={(e) => setReportCategory(e.target.value)}
            className="bg-black/80 border border-retro-border rounded px-1.5 py-1 text-[9px] text-retro-fg"
            onClick={(e) => e.stopPropagation()}
          >
            <option value="inappropriate">Inappropriate</option>
            <option value="spam">Spam</option>
            <option value="copyright">Copyright</option>
            <option value="other">Other</option>
          </select>
          <textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            maxLength={500}
            placeholder="Reason (optional)"
            rows={3}
            className="bg-black/80 border border-retro-border rounded px-1.5 py-1 text-[9px] text-retro-fg resize-none"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            disabled={reporting}
            onClick={(e) => { e.stopPropagation(); submitReport() }}
            className="text-[9px] font-bold tracking-wider text-white border border-red-600 px-2 py-1 hover:bg-red-700 bg-red-900/70 rounded disabled:opacity-50"
          >
            {reporting ? 'Sending…' : 'Submit report'}
          </button>
        </div>
      )}
    </div>
  )
}

type IdentityLike = OrbitIdentity | null;

interface Props {
  lobby: ReturnType<typeof useLobby>
  identity: IdentityLike | null
  myCards: OrbitObject[]
  soundEnabled: boolean
  onOpenImage?: (url: string) => void
  onExpandItem?: (itemId: string) => void
  onOpenHelp?: () => void
  onOpenProfile?: (user: User) => void
  users?: User[]
  onOpenSpectateItem?: (items: OrbitObject[], initialId: string) => void
  onOpenCardChat?: () => void
  onOpenCreateCard?: () => void
  onOpenDeckBuilder?: () => void
  // Override functions that request notification permission
  toggleAutoQueue?: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  sendInvite?: (userId: string) => Promise<{ ok: boolean; error?: string }>
}

export function LobbyPanel({ lobby, identity, myCards, soundEnabled, onExpandItem, onOpenProfile, users, onOpenSpectateItem, onOpenCardChat, onOpenCreateCard, onOpenDeckBuilder, toggleAutoQueue, sendInvite }: Props) {
const { state, images, joined, autoQueueEnabled, loading, toggleAutoQueue: lobbyToggleAutoQueue, sendInvite: lobbySendInvite, spectateMatch, closeSpectate, spectatingMatchId, spectatingSnapshot, liveMatches, pickCard, decide, quitMatch, activeSpecials, submitSpecialCard, endSpecialMatch, decideSpecialMatch, onlineUsers } = lobby

  // Use passed-in override functions if provided, otherwise fall back to lobby functions
  const effectiveToggleAutoQueue = toggleAutoQueue ?? lobbyToggleAutoQueue
  const effectiveSendInvite = sendInvite ?? lobbySendInvite

const selfId = identity?.orbitId || ''
  const { toast } = useToast()
  const confirm = useConfirm()
  const [spectateRequesting, setSpectateRequesting] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [dismissedExpired, setDismissedExpired] = useState(false)
  const [league, setLeague] = useState<LeagueEntry[]>([])
  const [showLeagueTab, setShowLeagueTab] = useState(false)

  // Load league ranks
  useEffect(() => {
    if (!identity) return
    let active = true
    const loadLeague = async () => {
      try {
        const res = await orbitFetch('/api/lobby/league', { method: 'GET' }, identity)
        if (res.ok && active) {
          const data = await res.json()
          setLeague(data.league || [])
        }
      } catch { }
    }
    loadLeague()
    const id = setInterval(loadLeague, 15000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [identity])

  // Most recent special match that ended by idle timeout (opponent AFK).
  const latestExpired = useMemo(() => {
    const recent = lobby.specialMatches?.recent || []
    return recent.find((m) => m.last_result === 'expired') || null
  }, [lobby.specialMatches])

  useEffect(() => {
    if (!lobby.specialMatches?.recent?.some((m) => m.last_result === 'expired')) {
      setDismissedExpired(false)
    }
  }, [lobby.specialMatches])

  useEffect(() => {
    if (!joined && !autoQueueEnabled && !state?.match && activeSpecials.length === 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [joined, autoQueueEnabled, state?.match, activeSpecials.length])

  const match = useMemo(() => currentMatch(state), [state])
  const hasMatch = Boolean(match)
  const matchRoundInfo = useMemo(
    () => (match ? { seq: match.round_seq || 1, max: match.max_rounds || 5, deadline: match.phase_deadline ?? 0 } : null),
    [match]
  )
  
  const matchPanelKey = match ? match.id : null

  const prevCount = useRef<number | null>(null)
  const prevWaiting = useRef<number | null>(null)
  useEffect(() => {
    if (state?.waiting_count == null) return
    if (prevWaiting.current != null && state.waiting_count > prevWaiting.current && soundEnabled) {
      playQueueJoin()
    }
    prevWaiting.current = state.waiting_count
  }, [state?.waiting_count, soundEnabled])

  useEffect(() => {
    if (state?.match && prevCount.current === null && soundEnabled) {
      playMatch()
    }
    prevCount.current = state?.match ? 1 : 0
  }, [state?.match, soundEnabled])

  const prevResultRef = useRef<string | null>(null)
  useEffect(() => {
    const result = state?.match?.result ?? null
    if (result && result !== prevResultRef.current) {
      const sm = state?.match?.score_mine ?? 0
      const so = state?.match?.score_opponent ?? 0
      if (result === 'winner_a' || result === 'winner_b') {
        const won = (result === 'winner_a' && state?.match?.user_a_info?.id === selfId) || (result === 'winner_b' && state?.match?.user_b_info?.id === selfId)
        toast(won ? 'Match victory. +50 points.' : 'Match complete.', won ? 'success' : 'info')
      } else if (result === 'draw') {
        toast('Match draw. +10 points.', 'info')
      } else if (result === 'quit' && state?.match?.forfeit_user && state.match.forfeit_user !== 'both' && state.match.forfeit_user !== selfId) {
        toast('Opponent forfeited. You win.', 'success')
      }
    }
    prevResultRef.current = result
  }, [state?.match?.result, state?.match?.score_mine, state?.match?.score_opponent, state?.match?.forfeit_user, selfId, toast])

  const players = state?.players || []

  // Merged player list: all recently-seen online users, annotated with match & queue status.
  const mergedPlayers = useMemo(() => {
    const queueMap = new Map(players.map((p) => [p.user_id, p]))
    const usersMap = new Map((users || []).map((u) => [u.id, u]))
    const seen = new Set<string>()
    const result: Array<{
      id: string
      display_name: string | null
      pfp_url: string | null
      tags: string[]
      queueStatus: 'in_match' | 'in_queue' | 'idle' | 'online'
      activeMatchId?: string
      matchRound?: number
    }> = []

    const resolveName = (id: string, directName?: string | null): string | null => {
      if (directName && directName.trim()) return directName
      const fromUsers = usersMap.get(id)?.display_name
      if (fromUsers && fromUsers.trim()) return fromUsers
      if (id === selfId && typeof window !== 'undefined') {
        try {
          const local = localStorage.getItem('orbit_display_name')
          if (local && local.trim()) return local
        } catch { }
      }
      return null
    }

    const resolvePfp = (id: string, directPfp?: string | null): string | null => {
      if (directPfp) return directPfp
      return usersMap.get(id)?.pfp_url || null
    }

    const findMatch = (userId: string) => {
      return liveMatches.find((m) => m.user_a.id === userId || m.user_b.id === userId)
    }

    // Roster ordering is intentionally stable: players in the lobby queue are
    // listed first in their joined_at order (new players append to the right,
    // existing positions never shift), then any other online users.
    for (const p of players) {
      seen.add(p.user_id)
      const userEntry = usersMap.get(p.user_id)
      const lm = findMatch(p.user_id)
      const isSelfInMatch = p.user_id === selfId && Boolean(state?.match)

      let queueStatus: 'in_match' | 'in_queue' | 'idle' | 'online' = 'online'
      if (lm || isSelfInMatch || p.status === 'in_match') {
        queueStatus = 'in_match'
      } else if (p.status === 'waiting' && (p.auto_queue ?? true)) {
        queueStatus = 'in_queue'
      } else if (p.auto_queue === false || p.status === 'idle') {
        queueStatus = 'idle'
      }

      result.push({
        id: p.user_id,
        display_name: resolveName(p.user_id, p.display_name),
        pfp_url: resolvePfp(p.user_id, p.pfp_url),
        tags: Array.isArray(p.tags) && p.tags.length > 0 ? (p.tags as string[]) : (userEntry?.tags || []),
        queueStatus,
        activeMatchId: lm?.id || (isSelfInMatch ? state?.match?.id : undefined),
        matchRound: lm?.round_seq || (isSelfInMatch ? state?.match?.round_seq : undefined),
      })
    }

    for (const u of onlineUsers) {
      if (seen.has(u.id)) continue
      seen.add(u.id)
      const qp = queueMap.get(u.id)
      const userEntry = usersMap.get(u.id)
      const lm = findMatch(u.id)
      const isSelfInMatch = u.id === selfId && Boolean(state?.match)

      let queueStatus: 'in_match' | 'in_queue' | 'idle' | 'online' = 'online'
      if (lm || isSelfInMatch || qp?.status === 'in_match') {
        queueStatus = 'in_match'
      } else if (qp?.status === 'waiting' && (qp.auto_queue ?? true)) {
        queueStatus = 'in_queue'
      } else if (qp?.auto_queue === false || qp?.status === 'idle') {
        queueStatus = 'idle'
      }

      result.push({
        id: u.id,
        display_name: resolveName(u.id, u.display_name),
        pfp_url: resolvePfp(u.id, u.pfp_url),
        tags: (u.tags && u.tags.length > 0) ? u.tags : (userEntry?.tags || []),
        queueStatus,
        activeMatchId: lm?.id || (isSelfInMatch ? state?.match?.id : undefined),
        matchRound: lm?.round_seq || (isSelfInMatch ? state?.match?.round_seq : undefined),
      })
    }

    // Always ensure the local logged-in player is in the list
    if (selfId && !seen.has(selfId)) {
      const userEntry = usersMap.get(selfId)
      const lm = findMatch(selfId)
      result.unshift({
        id: selfId,
        display_name: resolveName(selfId, userEntry?.display_name),
        pfp_url: resolvePfp(selfId, userEntry?.pfp_url),
        tags: userEntry?.tags || [],
        queueStatus: lm ? 'in_match' : autoQueueEnabled ? 'in_queue' : 'idle',
        activeMatchId: lm?.id,
        matchRound: lm?.round_seq,
      })
    }

    return result
  }, [onlineUsers, players, users, liveMatches, state?.match, selfId, autoQueueEnabled])

  const lobbyPlayers = useMemo(() => {
    const ordered: typeof mergedPlayers = []
    const placed = new Set<string>()
    // 1. Group active dueling pairs side by side
    for (const p of mergedPlayers) {
      if (p.queueStatus === 'in_match' && p.activeMatchId && !placed.has(p.id)) {
        const members = mergedPlayers.filter((m) => m.activeMatchId === p.activeMatchId)
        for (const m of members) placed.add(m.id)
        ordered.push(...members)
      }
    }
    // 2. Queued players
    for (const p of mergedPlayers) {
      if (p.queueStatus === 'in_queue' && !placed.has(p.id)) {
        placed.add(p.id)
        ordered.push(p)
      }
    }
    // 3. Idle / Paused players
    for (const p of mergedPlayers) {
      if (p.queueStatus === 'idle' && !placed.has(p.id)) {
        placed.add(p.id)
        ordered.push(p)
      }
    }
    // 4. Remaining online players
    for (const p of mergedPlayers) {
      if (!placed.has(p.id)) {
        placed.add(p.id)
        ordered.push(p)
      }
    }
    return ordered
  }, [mergedPlayers])

  // Render segments: dueling pairs are grouped as one unit so a single
  // combined SPECTATE row renders above each matched pair, followed by the
  // two player tiles. Everyone else renders as an individual tile.
  

  const boardImages = useMemo(() => {
    const seen = new Set<string>()
    const clean: typeof images = []
    for (const img of images) {
      if (!img.content_url) continue
      // Dedup purely on img.id — setLobbyImage always assigns a
      // crypto.randomUUID(), so id is never falsy. The previous
      // `|| img.content_url` fallback was dead-weight that could dedupe
      // unrelated tiles sharing a stale content_url prefix.
      const key = img.id
      if (seen.has(key)) continue
      seen.add(key)
      clean.push(img)
    }
    return clean
  }, [images])

  const hiddenBoardCount = images.length - boardImages.length

  const [queuedSinceFallback, setQueuedSinceFallback] = useState<number | null>(null)
  useEffect(() => {
    if (autoQueueEnabled) {
      setQueuedSinceFallback((prev) => prev ?? Date.now())
    } else {
      setQueuedSinceFallback(null)
    }
  }, [autoQueueEnabled])

  const selfQueueRow = state?.players.find((p) => p.user_id === selfId)
  const queuedSinceRaw = selfQueueRow?.waiting_since || selfQueueRow?.joined_at
  const queuedSinceMs = queuedSinceRaw
    ? Math.max(0, now - new Date(queuedSinceRaw).getTime())
    : (autoQueueEnabled && queuedSinceFallback ? Math.max(0, now - queuedSinceFallback) : 0)

  // Let the page footer refetch users/score immediately after a match action
  // awards points server-side (decisions, forfeits, special-tier climbs).
  const refreshScore = () => {
    try { window.dispatchEvent(new CustomEvent('orbit-score-refresh')) } catch { }
  }

  const handlePickCard = async (matchId: string, cardId: string): Promise<boolean> => {
    const ok = await pickCard(matchId, cardId)
    if (ok) refreshScore()
    return ok
  }

  const handleDecide = async (matchId: string, decision: 'like' | 'reject' | 'boost') => {
    const res = await decide(matchId, decision)
    refreshScore()
    return res
  }

  const handleQuit = async (matchId: string, opts?: { alreadyEnded?: boolean }): Promise<boolean> => {
    // Don't bother the player with a "Quit this match?" confirm when the
    // match has already ended (phase=result) and they're just leaving the
    // scoreboard view to go back to the lobby. That forward flow should be
    // frictionless.
    if (!opts?.alreadyEnded && typeof window !== 'undefined') {
      const confirmed = await confirm({
        title: 'Quit this match?',
        description: 'You will forfeit the duel and the current round.',
        confirmLabel: 'Quit',
        tone: 'danger',
      })
      if (!confirmed) return false
    }
    const ok = await quitMatch(matchId)
    refreshScore()
    return ok
  }

  const handlePlaySpecialCard = async (matchId: string, cardId: string): Promise<boolean> => {
    const ok = await submitSpecialCard(cardId, matchId)
    refreshScore()
    return ok
  }

  // Called from the result-phase "PLAY AGAIN" button — re-enters the lobby
  // queue after a match has ended. Uses `toggleAutoQueue(true)` so the server
  // enforces the same card-count gate as the regular Quick-Play entry.
  const handlePlayAgain = async () => {
    const r = await effectiveToggleAutoQueue(true)
    if (!r.ok) {
      toast(r.error || 'Could not re-join the queue.', 'warning')
    }
  }

  const handleDecideSpecial = async (matchId: string, decision: 'like' | 'reject') => {
    const res = await decideSpecialMatch(matchId, decision)
    refreshScore()
    return res
  }

  const handleEndSpecial = async (matchId: string): Promise<boolean> => {
    const ok = await endSpecialMatch(matchId)
    refreshScore()
    return ok
  }

  

  

  

  const handleSpectate = async (matchId: string) => {
    if (spectateRequesting) return
    setSpectateRequesting(matchId)
    toast('Entering spectator mode…', 'info')
    try {
      await spectateMatch(matchId)
    } catch {
      toast('Could not join spectator view', 'error')
    } finally {
      setSpectateRequesting(null)
    }
  }

  return (
    <div className={match ? "flex flex-col gap-6 pb-14" : "space-y-6"}>
      {/* Active 5-Round Match Panel (When In Match) */}
      {match && matchPanelKey && (
        <div key={matchPanelKey} className="animate-orbit-slide-up grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] gap-5 items-start">
          <MatchRoundPanel
            match={match}
            players={players}
            users={users}
            identity={identity}
            myCards={myCards}
            soundEnabled={soundEnabled}
            onPick={handlePickCard}
            onDecide={handleDecide}
            onQuit={handleQuit}
            onPlayAgain={handlePlayAgain}
            onOpenProfile={onOpenProfile}
            onOpenDeckBuilder={onOpenDeckBuilder}
          />
          {/* Match chat pinned to the left column so it stays visible beside the duel */}
          <div className="lg:sticky lg:top-[72px]">
            <MatchChat
              matchId={match.id}
              selfId={selfId}
              messages={lobby.matchChats[match.id] || []}
              onSend={lobby.sendMatchChat}
              onLoad={lobby.loadMatchChat}
              soundEnabled={soundEnabled}
            />
          </div>
        </div>
      )}

      {/* Your Match — Special Match Ladder (if active) */}
      {activeSpecials.length > 0 && activeSpecials.map((specialMatch) => (
        <div key={specialMatch.id} className="space-y-2">
          <YourMatchTab
            match={specialMatch}
            selfId={selfId}
            myCards={myCards}
            identity={identity}
            soundEnabled={soundEnabled}
            users={users}
            onPlayCard={handlePlaySpecialCard}
            onDecide={handleDecideSpecial}
            onEnd={handleEndSpecial}
            onOpenProfile={onOpenProfile}
          />
          <MatchChat
            matchId={specialMatch.id}
            selfId={selfId}
            messages={lobby.matchChats[specialMatch.id] || []}
            onSend={lobby.sendMatchChat}
            onLoad={lobby.loadMatchChat}
            soundEnabled={soundEnabled}
          />
        </div>
      ))}

      {/* Expired special-match notice */}
      {!dismissedExpired && latestExpired && (
        <div className="border border-retro-warning/50 bg-retro-warning/5 p-3 flex items-center justify-between gap-3 rounded-lg animate-orbit-fade-in">
          <p className="text-xs text-retro-muted">
            <span className="text-retro-warning font-medium">Match expired</span>
            {' — '}{latestExpired.opponent_name?.trim() || 'Unknown User'} went idle. You&apos;ve been re-queued.
          </p>
          <button
            type="button"
            onClick={() => setDismissedExpired(true)}
            className="text-xs font-medium text-retro-muted hover:text-retro-fg border border-retro-border px-2 py-1 cursor-pointer rounded transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 01 — Online Players Roster & League (hidden while in a match) */}
      {!match && (
        <>
          <section className="module">
            <div className="module-header flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <span className="module-title">Players</span>
                <span className="module-subtitle">
                  {mergedPlayers.length} online
                </span>
              </div>

<QueueControls
                state={state}
                match={match}
                matchRoundInfo={matchRoundInfo}
                autoQueueEnabled={autoQueueEnabled}
                soundEnabled={soundEnabled}
                myCardsCount={myCards.length}
                queuedSinceMs={queuedSinceMs}
                showLeagueTab={showLeagueTab}
                onToggleAutoQueue={effectiveToggleAutoQueue}
                onOpenCreateCard={onOpenCreateCard}
                onOpenDeckBuilder={onOpenDeckBuilder}
                onShowLeagueTab={setShowLeagueTab}
                onOpenCardChat={onOpenCardChat}
                toast={toast}
                now={now}
              />
            </div>

            <div className="module-body space-y-3">
              {showLeagueTab ? (
                <LeagueBoard league={league} users={users} onOpenProfile={onOpenProfile} />
              ) : (
                <PlayerRoster
                  players={lobbyPlayers}
                  selfId={selfId}
                  spectateRequesting={spectateRequesting}
                  users={users}
                  onOpenProfile={onOpenProfile}
                  onSpectate={handleSpectate}
                  loading={loading}
                  state={state}
                />
              )}
            </div>
          </section>

          {/* 02 — Your Cards: collection strip right below the player cards */}
          <section className="module">
            <div className="module-header flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <span className="module-title">Your Cards</span>
                <span className="module-subtitle">
                  {myCards.length} in collection
                </span>
              </div>
              {onOpenDeckBuilder && (
                <button
                  type="button"
                  onClick={onOpenDeckBuilder}
                  className="border border-retro-border px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-surface-interactive cursor-pointer rounded-lg transition-colors"
                >
                  Open collection
                </button>
              )}
            </div>
            <div className="module-body">
              {myCards.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs text-retro-muted">No cards yet — forge one or win duels to build your deck.</p>
                  {onOpenCreateCard && (
                    <button
                      type="button"
                      onClick={onOpenCreateCard}
                      className="px-3 py-1.5 text-xs font-bold bg-retro-accent text-black hover:bg-retro-accent-hover transition-colors cursor-pointer rounded-lg whitespace-nowrap"
                    >
                      Create Card
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 select-none">
                  {myCards.slice(0, 10).map((card) => (
                    <CardTile
                      key={card.id}
                      item={card as any}
                      users={users}
                      identity={identity}
                      onClick={() => openCardDetail(card)}
                      onDoubleClick={() => onExpandItem?.(card.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

        </>
      )}

      {/* Floating Spectator Modal Overlay */}
      {spectatingMatchId && (
        <SpectateModal
          match={spectatingSnapshot}
          onClose={closeSpectate}
          soundEnabled={soundEnabled}
          onOpenItem={onOpenSpectateItem}
          identity={identity}
        />
      )}
    </div>
  )
}
