"use client";

import { useState, useEffect, useCallback, useRef } from 'react'
import type { LobbyState, LobbyImage, LobbyComment, SpecialMatchesResponse, TierMatch, MatchSnapshot, MatchEvent, ChatMessage, FlashEvent } from '@orbit/shared'
import { orbitFetch } from '../utils/api'
import { createCardFromMedia } from '../utils/cardCollection'
import { subscribeOrbitWebSocket } from '../utils/orbitWebSocket'
import { logger } from '../utils/logger';
import { getStoredActiveDeckId } from '../components/games/DeckBuilder';

interface OrbitIdentity {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
  encryptionPubHex?: string
}

interface SettingsLike {
  autoRefresh: boolean
}

// Phase progression used to reject stale/out-of-order WS match patches.
const phaseOrder = ['lobby', 'pick', 'reveal', 'decide', 'round_result', 'result']

export interface LobbyDecisionResult {
  match?: MatchSnapshot
  matched?: boolean
  points_awarded?: number
  decision?: string
  tier?: number
}

export interface LobbyDecisionFailure {
  ok: false
  status: number
  error?: string
}

export interface SpecialDecisionResult {
  ok: true
  waiting?: boolean
  advanced?: boolean
  both_like?: boolean
  ended?: boolean
  rematch?: boolean
  tier?: number
}

export function useLobby({
  identity,
  settings,
}: {
  identity: OrbitIdentity | null
  settings: SettingsLike
}) {
  const [state, setState] = useState<LobbyState | null>(null)
  const [images, setImages] = useState<LobbyImage[]>([])
  const [joined, setJoined] = useState(false)
  const [autoQueueEnabled, setAutoQueueEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [specialMatches, setSpecialMatches] = useState<SpecialMatchesResponse>({ active: [], recent: [] })
  const [lobbyName, setLobbyNameState] = useState<string | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<Array<{ id: string; display_name: string | null; pfp_url: string | null; tags: string[] }>>([])
  const [spectatingMatchId, setSpectatingMatchId] = useState<string | null>(null)
  const [spectatingSnapshot, setSpectatingSnapshot] = useState<MatchSnapshot | null>(null)
  const [matchChats, setMatchChats] = useState<Record<string, ChatMessage[]>>({})
  const [flash, setFlash] = useState<FlashEvent | null>(null)
  const [babecockVersion, setBabecockVersion] = useState(0)
  const [notifications, setNotifications] = useState<Array<{ id: string; type: string; title: string; body: string | null; data: any; read: boolean; created_at: string }>>([])
  const [unreadCount, setUnreadCount] = useState(0)
  /** Unread split per notification type — badges for likes/follows separately. */
  const [unreadByType, setUnreadByType] = useState<Record<string, number>>({})
  const [invites, setInvites] = useState<Array<{ id: string; inviter_id: string; invitee_id: string; status: string; created_at: string; expires_at: string; inviter_name: string | null; inviter_pfp_url: string | null }>>([])
  // Match id the player just quit (optimistically cleared). WS pushes for this
  // id are suppressed until either (a) a fresh snapshot confirms the quit OR
  // (b) `quitClearedUntilRef` expires — whichever comes first. Suppression
  // also serves the "result tab keeps popping back after leaving" race: a
  // stale WS `result` patch that arrives a moment after the optimistic clear
  // would re-insert the match panel without this guard.
  // TTL extended to 30s to cover the full 20s result window + 10s buffer.
  const quitClearedRef = useRef<string | null>(null)
  const quitClearedUntilRef = useRef(0)

  const activeSpecials = specialMatches.active

  // Structural-equality guards so unchanged poll results don't produce new
  // object identities (and thus don't force a full-page re-render every tick).
  const stateSigRef = useRef('')
  const imagesSigRef = useRef('')
  const onlineSigRef = useRef('')
  const specialSigRef = useRef('')
  const lastImagesRefreshRef = useRef(0)
  const lastSpecialRefreshRef = useRef(0)
  // Monotonic sequence for image fetches: only the newest-issued refresh's
  // result is allowed to land in setImages. Older in-flight fetches that
  // resolve later are dropped, so a slow stale snapshot can't clobber a
  // newer one (the "two different lobbies" flicker).
  const imagesSeqRef = useRef(0)

  const refresh = useCallback(async (options?: { force?: boolean; includeImages?: boolean; includeSpecial?: boolean }) => {
    if (!identity) return
    try {
      const now = Date.now()
      const includeImages = options?.force || options?.includeImages || now - lastImagesRefreshRef.current >= 10_000
      const includeSpecial = options?.force || options?.includeSpecial || now - lastSpecialRefreshRef.current >= 5_000
      if (includeImages) lastImagesRefreshRef.current = now
      if (includeSpecial) lastSpecialRefreshRef.current = now
      // Stamp a sequence when actually issuing the images request; after the
      // await resolves we'll only honor the result if no newer fetch has
      // started since. Without this, two overlapping refresh() calls (poll +
      // WS push + post-mutation) would race and the older snapshot could
      // resolve last, clobbering newer board state.
      const imgSeq = includeImages ? ++imagesSeqRef.current : 0
      const [stateRes, imgRes, specialRes] = await Promise.all([
        orbitFetch(`/api/lobby?_t=${Date.now()}`, { method: 'GET' }, identity),
        // Cache-bust the images list: a 3s response cache + in-flight dedup
        // (keyed on method:endpoint) in orbitFetch would otherwise serve the
        // pre-upload snapshot right after a POST. The _t= param makes each
        // call a unique cache key, mirroring the /api/lobby?_t= convention.
        includeImages ? orbitFetch(`/api/lobby/images?_t=${Date.now()}`, { method: 'GET' }, identity) : Promise.resolve(null),
        includeSpecial ? orbitFetch('/api/lobby/special', { method: 'GET' }, identity) : Promise.resolve(null),
      ])
      if (stateRes.ok) {
        const data = await stateRes.json()
        if (data && typeof data.status === 'string') {
          // Suppress match update if we're in the quit suppression window
          // for this match. This prevents the "result tab keeps popping back"
          // race where a stale poll returns the ended match after we quit.
          const quitSuppressed = quitClearedRef.current
            && data.match?.id === quitClearedRef.current
            && Date.now() < quitClearedUntilRef.current

          // A fresh snapshot confirms the quit — stop suppressing pushes
          // for it. Also expire the suppression after the TTL window so a
          // server-delayed quit that hasn't landed in the poll yet still
          // lifts the guard eventually (the user can then re-queue, see a
          // new match form, etc.). Worst case is 30s of being deaf to that
          // matchId, which is exactly what we want to swallow the late
          // WS "result" patch that was re-inserting the panel.
          if (quitClearedRef.current) {
            const stale = !data.match || data.match.id !== quitClearedRef.current
            const expired = Date.now() >= quitClearedUntilRef.current
            if (stale || expired) {
              quitClearedRef.current = null
              quitClearedUntilRef.current = 0
            }
          }

          if (!quitSuppressed) {
            const sig = JSON.stringify(data)
            if (sig !== stateSigRef.current) {
              stateSigRef.current = sig
              setState(data as LobbyState)
            }
          }
          if (typeof data.auto_queue === 'boolean') {
            setAutoQueueEnabled(data.auto_queue)
          }
          // Also pull the extended fields piggybacked on the lobby response
          if (typeof data.lobby_name === 'string' || data.lobby_name === null) {
            setLobbyNameState(data.lobby_name ?? null)
          }
          if (Array.isArray(data.online_users)) {
            const onlineSig = JSON.stringify(data.online_users)
            if (onlineSig !== onlineSigRef.current) {
              onlineSigRef.current = onlineSig
              setOnlineUsers(data.online_users)
            }
          }
        }
      }
      if (imgRes?.ok) {
        const data = await imgRes.json()
        if (Array.isArray(data)) {
          // Drop stale snapshots: a newer refresh (e.g. post-upload) may have
          // started while this fetch was in flight — let that one win. We only
          // skip setImages, not the rest of the refresh, so special matches
          // and loading state still reconcile.
          const stale = imgSeq !== imagesSeqRef.current
          if (!stale) {
            // Signature keys only on stable fields: id + likes_count. We
            // deliberately exclude content_url/length because the server
            // rotates data:→/api/lobby/images/:id/content on every LIST
            // response (routes/lobby.ts), and including its length here
            // would force a spurious setImages every time a tile's src
            // flipped between the optimistic data: URL and the rotated
            // /content URL — the "duplicate lobby showing different images"
            // flicker. caption is immutable after upload so it is omitted
            // too.
            const sig = data.map((img: any) => `${img.id}:${img.likes_count}`).join('|')
            if (sig !== imagesSigRef.current) {
              imagesSigRef.current = sig
              setImages(data as LobbyImage[])
            }
          }
        }
      }
      if (specialRes?.ok) {
        const data = await specialRes.json()
        const payload = data && typeof data === 'object' && Array.isArray((data as { active?: unknown }).active) ? data : { active: [], recent: [] }
        const sig = JSON.stringify(payload)
        if (sig !== specialSigRef.current) {
          specialSigRef.current = sig
          setSpecialMatches(payload as SpecialMatchesResponse)
        }
      }
    } catch (err) {
      logger.warn('[useLobby] refresh failed:', err)
    } finally {
      setLoading(false)
    }
  }, [identity])

  const refreshNotifications = useCallback(async () => {
    if (!identity) return
    try {
      const [notifRes, invitesRes] = await Promise.all([
        orbitFetch('/api/notifications', { method: 'GET' }, identity),
        orbitFetch('/api/lobby/invites', { method: 'GET' }, identity),
      ])
      if (notifRes.ok) {
        const body = await notifRes.json()
        if (Array.isArray(body.notifications)) {
          setNotifications(body.notifications)
          setUnreadCount(Number(body.unread || 0))
          // Per-type badges (likes/follows separate). Additive on the server:
          // older nodes omit the field and we simply keep an empty map.
          setUnreadByType(
            body.unread_by_type && typeof body.unread_by_type === 'object'
              ? (body.unread_by_type as Record<string, number>)
              : {},
          )
        }
      }
      if (invitesRes.ok) {
        const body = await invitesRes.json()
        if (Array.isArray(body.invites)) {
          const open = body.invites.filter((i: any) => i.status === 'open')
          setInvites(open)
        }
      }
    } catch (err) {
      logger.warn('[useLobby] refreshNotifications failed:', err)
    }
  }, [identity])

  const join = useCallback(async () => {
    if (!identity) return
    const body = JSON.stringify({ deck_id: getStoredActiveDeckId() })
    const res = await orbitFetch('/api/lobby/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, identity)
    if (res.ok) {
      setJoined(true)
      setAutoQueueEnabled(true)
      refresh({ force: true })
    }
  }, [identity, refresh])

  const leave = useCallback(async () => {
    if (!identity) return
    const res = await orbitFetch('/api/lobby/leave', { method: 'POST' }, identity)
    if (res.ok) {
      setJoined(false)
      setAutoQueueEnabled(false)
      refresh({ force: true })
    }
  }, [identity, refresh])

  const toggleAutoQueue = useCallback(async (enabled: boolean): Promise<{ ok: boolean; error?: string }> => {
    if (!identity) return { ok: false }
    setAutoQueueEnabled(enabled)
    setJoined(enabled)
    const res = await orbitFetch(
      '/api/lobby/autoqueue',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, ...(enabled ? { deck_id: getStoredActiveDeckId() } : {}) }),
      },
      identity
    )
    if (res.ok) {
      refresh({ force: true })
      return { ok: true }
    }
    // Roll back the optimistic state — the server rejected the toggle
    // (e.g. no cards in library) so the queue chip should not suggest we
    // are still queued.
    setAutoQueueEnabled(!enabled)
    setJoined(!enabled)
    let err: string | undefined
    try { const b = await res.json(); err = b?.error } catch { /* ignore */ }
    return { ok: false, error: err }
  }, [identity, refresh])

  const spectateMatch = useCallback(async (matchId: string) => {
    if (!identity) return
    setSpectatingMatchId(matchId)
    try {
      const res = await orbitFetch(`/api/lobby/match/${matchId}/spectate`, { method: 'GET' }, identity)
      if (res.ok) {
        const data = await res.json()
        setSpectatingSnapshot(data.snapshot || null)
      }
    } catch (err) {
      logger.warn('[useLobby] spectate failed:', err)
    }
  }, [identity])

  const closeSpectate = useCallback(() => {
    setSpectatingMatchId(null)
    setSpectatingSnapshot(null)
  }, [])

  // Poll spectating snapshot while watching a match
  useEffect(() => {
    if (!identity || !spectatingMatchId) return
    const id = setInterval(async () => {
      try {
        const res = await orbitFetch(`/api/lobby/match/${spectatingMatchId}/spectate`, { method: 'GET' }, identity)
        if (res.ok) {
          const data = await res.json()
          setSpectatingSnapshot(data.snapshot || null)
        } else if (res.status === 404) {
          setSpectatingSnapshot((prev) => prev ? { ...prev, status: 'ended' } : null)
        }
      } catch {}
    }, 1500)
    return () => clearInterval(id)
  }, [identity, spectatingMatchId])

  // Automatically dismiss spectator modal when player gets matched into their own game
  useEffect(() => {
    if (state?.match && spectatingMatchId) {
      setSpectatingMatchId(null)
      setSpectatingSnapshot(null)
    }
  }, [state?.match, spectatingMatchId])

  // Sync joined flag and autoqueue from server state. Autoqueue is opt-in now:
  // the user must press Quick Play; there is no paused flag to respect.
  useEffect(() => {
    if (!identity || !state) return
    const selfInQueue = state.players.some(
      (p) => p.user_id === identity.orbitId && (p.status === 'waiting' || p.status === 'in_match')
    )
    setJoined(selfInQueue)
    setAutoQueueEnabled(selfInQueue)
  }, [identity, state])

  // Prune dead/404 lobby images immediately when a tile errors
  useEffect(() => {
    const handleLobbyImage404 = (e: Event) => {
      const customEvent = e as CustomEvent<{ imageId?: string }>
      const id = customEvent.detail?.imageId
      if (!id) return
      setImages((prev) => {
        const next = prev.filter((img) => img.id !== id)
        if (next.length !== prev.length) {
          imagesSigRef.current = ''
        }
        return next
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('orbit-lobby-image-404', handleLobbyImage404)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('orbit-lobby-image-404', handleLobbyImage404)
      }
    }
  }, [])

  // Initial load: fetch lobby state. No auto-join — Quick Play is the only way in.
  useEffect(() => {
    if (!identity) return
    const initLobby = async () => {
      await refresh({ force: true })
      await refreshNotifications()
    }
    void initLobby()
  }, [identity, refresh, refreshNotifications])

  // Poll the lobby (DB truth) as a fast fallback behind the WS push. A single
  // stable interval avoids tearing down/recreating the timer on every poll
  // (state?.match changes identity each refresh, which used to reset the
  // interval every 3 s). Cadence is re-evaluated on each tick via refs.
  const inMatchRef = useRef(false)
  const autoQueueRef = useRef(autoQueueEnabled)
  useEffect(() => {
    inMatchRef.current = Boolean(state?.match)
    autoQueueRef.current = autoQueueEnabled
  }, [state?.match, autoQueueEnabled])
  const lastPollRef = useRef(0)
  useEffect(() => {
    if (!identity) return
    if (!settings.autoRefresh) return

    // Recursive timeout (no 1s busy interval): schedule the next poll at the
    // effective cadence, then re-evaluate after each refresh completes.
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const schedule = () => {
      if (cancelled) return
      const windowMs = inMatchRef.current ? 2_000 : autoQueueRef.current ? 3_000 : 5_000
      timer = setTimeout(() => {
        if (cancelled) return
        lastPollRef.current = Date.now()
        void refresh()
        schedule()
      }, windowMs)
    }

    lastPollRef.current = 0
    void refresh()
    schedule()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [identity, settings.autoRefresh, refresh])

  // WebSocket push: shared control transport. The P2P hook owns only the swarm
  // relay; lobby, match, PM, notification, and Babecock events use one socket.
  useEffect(() => {
    if (!identity) return
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = (force = false) => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refresh(force ? { force: true } : undefined)
      }, 200)
    }

    const unsubscribe = subscribeOrbitWebSocket(identity, (msg) => {
          try {
            if (msg.type === '__ws_reconnected') {
              // The socket was down, so anything pushed while it was away — a
              // notification, an invite, a fresh follower — never arrived. One
              // catch-up read per reconnect (no interval, no polling loop):
              // lobby state forced, plus the notification/invite list.
              void refreshNotifications()
              scheduleRefresh(true)
              return
            }
            if (msg.type === 'flash') {
              if (msg.action === 'new' && msg.flash && typeof msg.flash === 'object') {
                setFlash((prev) => (prev && prev.id === msg.flash.id ? prev : msg.flash as FlashEvent))
              }
              if (msg.action === 'like' && typeof msg.object_id === 'string') {
                setFlash((prev) => {
                  if (!prev || prev.id !== msg.object_id) return prev
                  return { ...prev, likes_count: Number(msg.likes_count || 0), liked_by_me: msg.liker_id === identity.orbitId }
                })
              }
              return
            }
            if (msg.type === 'babecock') {
              setBabecockVersion((v) => v + 1)
              return
            }
            if (msg.type === 'chat' && msg.message && typeof msg.match_id === 'string') {
              const chatMsg = msg.message as ChatMessage
              setMatchChats((prev) => {
                const list = prev[msg.match_id] || []
                if (list.some((m) => m.id === chatMsg.id)) return prev
                return { ...prev, [msg.match_id]: [...list.slice(-99), chatMsg] }
              })
            }
            if (msg.type === 'lobby-chat' && msg.action === 'new' && msg.message) {
              return
            }
            if (msg.type === 'pm' && msg.action === 'new' && msg.message) {
              // Real-time PM push: notify any mounted PM panel (sidebar or
              // mobile modal) so it refreshes threads/messages immediately.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orbit-pm-new', { detail: msg.message }))
              }
              return
            }
            if (msg.type === 'pm' && msg.action === 'edited' && msg.message) {
              // Real-time PM edit push
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orbit-pm-edited', { detail: msg.message }))
              }
              return
            }
            if (msg.type === 'pm' && msg.action === 'deleted_everyone' && msg.messageId) {
              // Real-time PM delete for everyone push
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orbit-pm-deleted-everyone', { detail: { messageId: msg.messageId, sender_id: msg.sender_id, recipient_id: msg.recipient_id } }))
              }
              return
            }
            if (msg.type === 'group' && msg.action === 'new' && msg.message && typeof msg.message === 'object') {
              // Real-time group-chat push: let the group thread layer append it.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orbit-group-new', { detail: msg.message }))
              }
              return
            }
            if (msg.type === 'domination' && msg.action && msg.from) {
              // Real-time PC Domination push: dispatch to DominationEffects component.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orbit-domination', { 
                  detail: { 
                    type: 'domination', 
                    action: msg.action, 
                    from: msg.from, 
                    payload: msg.payload || msg.message || {}, 
                    timestamp: msg.timestamp || new Date().toISOString()
                  } 
                }))
              }
              return
            }
            if (msg.type === 'feed' && msg.action === 'new' && msg.post && typeof msg.post === 'object') {
              // Real-time new-post push: let the feed layer prepend it.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orbit-feed-new', { detail: msg.post }))
              }
              return
            }
            if (msg.type === 'follow' && (msg.action === 'new' || msg.action === 'removed')) {
              // The server already broadcasts this (users.ts) but nothing
              // handled it, so a new follower only showed up in the profile
              // count on the next 60-120s roster poll.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('orbit-follow-event', {
                  detail: { follower_id: msg.follower_id, followee_id: msg.followee_id, action: msg.action },
                }))
              }
              return
            }
            if (msg.type === 'notification' && msg.action === 'new') {
              if (msg.notification && typeof msg.notification === 'object') {
                const incoming = msg.notification
                setNotifications((prev) => {
                  if (prev.some((item) => item.id === incoming.id)) return prev
                  return [incoming, ...prev].slice(0, 50)
                })
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('orbit-incoming-notification', { detail: incoming }))
                }
              }
              if (msg.invite && typeof msg.invite === 'object') {
                setInvites((prev) => prev.some((item) => item.id === msg.invite.id) ? prev : [msg.invite, ...prev])
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('orbit-incoming-notification', { detail: { type: 'match_invite', ...msg.invite } }))
                }
              }
              void refreshNotifications()
              return
            }
            if (msg.type === 'lobby') {
              if (msg.action === 'meta') {
                setLobbyNameState(typeof msg.lobby_name === 'string' ? msg.lobby_name : null)
              } else {
                scheduleRefresh()
              }
            }
            if (msg.type === 'match' && msg.match && typeof msg.match === 'object') {
              const ev = msg as MatchEvent
              const action = (ev as any).action as string | undefined
              // 'cancelled' → I quit; 'opponent_left' → opponent quit. In
              // either case the match is over: clear the live match panel
              // immediately so neither side waits for the phase timer to
              // expire before they can requeue. The pending refresh + the
              // opponent_left WS push settle the lobby roster afterwards.
              if (action === 'cancelled' || action === 'opponent_left') {
                setState((prev) => (prev?.match ? { ...prev, match: null } : prev))
                scheduleRefresh()
                return
              }
              // Guard against stale/out-of-order WS snapshots overwriting a
              // newer round: only accept a patch that is at least as advanced
              // as the state we already hold.
              const next = ev.match
              setState((prev) => {
                if (!prev) return prev
                if (quitClearedRef.current && next.id === quitClearedRef.current && Date.now() < quitClearedUntilRef.current) return prev
                const cur = prev.match
                if (cur && cur.id === next.id) {
                  const curRound = cur.round_seq || 1
                  const nextRound = next.round_seq || 1
                  const newerRound = nextRound > curRound
                  const sameRound = nextRound === curRound
                  const newerPhase =
                    sameRound && phaseOrder.indexOf(next.phase) > phaseOrder.indexOf(cur.phase)
                  if (!newerRound && !newerPhase) return prev
                }
                return { ...prev, match: next }
              })
              scheduleRefresh()
            }
          } catch {}
    })
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [identity, refresh, refreshNotifications])

  const pickCard = useCallback(
    async (matchId: string, cardId: string): Promise<boolean> => {
      if (!identity) return false
      const res = await orbitFetch(
        `/api/lobby/match/${matchId}/card`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_id: cardId }),
        },
        identity
      )
      if (res.ok) { refresh({ force: true }); return true }
      const error = await res.text().catch(() => '')
      logger.warn(`[useLobby] card play rejected (${res.status}): ${error}`)
      return false
    },
    [identity, refresh]
  )

  const decide = useCallback(
    async (matchId: string, decision: 'like' | 'reject' | 'boost'): Promise<LobbyDecisionResult | LobbyDecisionFailure | null> => {
      if (!identity) return null
      const res = await orbitFetch(
        `/api/lobby/match/${matchId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
        identity
      )
      if (res.ok) {
        const result: LobbyDecisionResult = await res.json()
        refresh()
        return result
      }
      let error: string | undefined
      try {
        const body = await res.json()
        if (body && typeof body.error === 'string') error = body.error
      } catch {}
      refresh()
      return { ok: false, status: res.status, error }
    },
    [identity, refresh]
  )

  const quitMatch = useCallback(
    async (matchId: string, _opts?: { alreadyEnded?: boolean }): Promise<boolean> => {
      if (!identity) return false
      setJoined(false)
      // Optimistically drop the match panel so "Return to Lobby" is instant;
      // the server quit + refresh below reconcile truth in the background.
      // The TTL window keeps WS suppression alive long enough to swallow the
      // otherwise-racy late `result` patch that kept popping the ended match
      // panel back up after the user clicked "Return to Lobby".
      // 30s covers the 20s result window + 10s buffer.
      quitClearedRef.current = matchId
      quitClearedUntilRef.current = Date.now() + 30_000
      setState((prev) => (prev?.match ? { ...prev, match: null } : prev))
      const res = await orbitFetch(`/api/lobby/match/${matchId}/quit`, { method: 'POST' }, identity)
      refresh({ force: true })
      return res.ok
    },
    [identity, refresh]
  )

  const uploadImage = useCallback(
    async (form: FormData): Promise<boolean> => {
      if (!identity) return false
      const res = await orbitFetch('/api/lobby/images', { method: 'POST', body: form }, identity)
      if (res.ok) {
        // Optimistic add: the server returns the created LobbyImage; prepend
        // it so the uploader sees the tile instantly. The next refresh
        // reuses the same id (LobbyPanel dedups on img.id) and reconciles
        // content_url from data:... to /api/lobby/images/:id/content without
        // a duplicate tile. Invalidate imagesSigRef so that refresh's data
        // (different signature) actually lands — otherwise the optimistic
        // state could shadow a server-side rejection.
        const img = await res.json().catch(() => null) as LobbyImage | null
        if (img && img.id) {
          setImages((prev) => (prev.some((x) => x.id === img.id) ? prev : [img, ...prev]))
          imagesSigRef.current = ''
        }
        refresh({ includeImages: true })
      }
      return res.ok
    },
    [identity, refresh]
  )

  const likeImage = useCallback(
    async (id: string): Promise<boolean> => {
      if (!identity) return false
      const res = await orbitFetch(`/api/lobby/images/${id}/like`, { method: 'POST' }, identity)
      if (res.ok) {
        refresh({ includeImages: true })
        return true
      }
      return false
    },
    [identity, refresh]
  )

  /** Fetch the (limited) list of users who liked a lobby image. */
  const getLikers = useCallback(
    async (id: string): Promise<string[]> => {
      if (!identity) return []
      const res = await orbitFetch(`/api/lobby/images/${id}/likers`, { method: 'GET' }, identity)
      if (!res.ok) return []
      const json = await res.json().catch(() => ({ likers: [] })) as { likers?: Array<{ display_name?: string | null }> }
      return (json.likers || []).map((l) => l.display_name || 'anon')
    },
    [identity]
  )

  /** Fetch paginated comments for a lobby image. */
  const getComments = useCallback(
    async (id: string): Promise<LobbyComment[]> => {
      if (!identity) return []
      const res = await orbitFetch(`/api/lobby/images/${id}/comments`, { method: 'GET' }, identity)
      if (!res.ok) return []
      return await res.json().catch(() => []) as LobbyComment[]
    },
    [identity]
  )

  /** Add a comment to a lobby image. Returns the created comment on success. */
  const addComment = useCallback(
    async (id: string, body: string): Promise<LobbyComment | null> => {
      if (!identity) return null
      const res = await orbitFetch(
        `/api/lobby/images/${id}/comments`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) },
        identity
      )
      if (!res.ok) return null
      return await res.json().catch(() => null) as LobbyComment | null
    },
    [identity]
  )

  /** Delete a lobby comment (own or admin). Returns true on success. */
  const deleteComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (!identity) return false
      const res = await orbitFetch(`/api/lobby/comments/${commentId}`, { method: 'DELETE' }, identity)
      return res.ok
    },
    [identity]
  )

  /** Report a lobby image. Returns server result (may include `hidden: true`). */
  const reportImage = useCallback(
    async (id: string, category: string, reason: string): Promise<{ hidden?: boolean } | null> => {
      if (!identity) return null
      const res = await orbitFetch(
        `/api/lobby/images/${id}/report`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, reason }) },
        identity
      )
      if (!res.ok) return null
      const result = await res.json().catch(() => null) as { hidden?: boolean } | null
      if (result?.hidden) refresh({ includeImages: true })
      return result
    },
    [identity, refresh]
  )

  /** Like an active flash popup — hits the normal like system, live count via WS. */
  const likeFlash = useCallback(
    async (id: string): Promise<boolean> => {
      if (!identity) return false
      const res = await orbitFetch(
        `/api/likes/${id}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'like' }) },
        identity
      )
      if (res.ok) {
        setFlash((prev) => (prev && prev.id === id ? { ...prev, liked_by_me: true } : prev))
        return true
      }
      return false
    },
    [identity]
  )

  const dismissFlash = useCallback(() => {
    setFlash(null)
  }, [])

  const submitSpecialCard = useCallback(async (cardId: string, matchId?: string) => {
    const targetId = matchId || activeSpecials[0]?.id
    if (!identity || !targetId) return false
    const res = await orbitFetch(`/api/lobby/special/${targetId}/card`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card_id: cardId }) }, identity)
    if (res.ok) { refresh({ includeSpecial: true }); return true }
    return false
  }, [identity, activeSpecials, refresh])

  const endSpecialMatch = useCallback(async (matchId?: string) => {
    const targetId = matchId || activeSpecials[0]?.id
    if (!identity || !targetId) return false
    setJoined(false)
    const res = await orbitFetch(`/api/lobby/special/${targetId}/end`, { method: 'POST' }, identity)
    if (res.ok) { refresh({ includeSpecial: true }); return true }
    return false
  }, [identity, activeSpecials, refresh])

  /** Upload a card privately (recipient = match opponent), without auto-playing it. */
  const uploadMatchCard = useCallback(
    async (match: TierMatch, file: File, name: string | null, onProgress?: (pct: number) => void): Promise<{ ok: boolean; cardId: string | null; name?: string | null; value?: number; error?: string }> => {
      if (!identity) return { ok: false, cardId: null, error: 'Not signed in' }
      const opponentId = match.user_a === identity.orbitId ? match.user_b : match.user_a
      try {
        onProgress?.(10)
        // Zero-media P2P path: seed + register (never raw binary, which 422s).
        const { forgeMediaLocally } = await import('../services/mediaForge')
        const forged = await forgeMediaLocally(file, identity, {
          caption: name || undefined,
          isPublic: false,
          recipients: opponentId,
        })
        onProgress?.(80)
        if (!forged?.id) return { ok: false, cardId: null, error: 'Upload failed' }
        const card = await createCardFromMedia(identity, forged.id, name)
        onProgress?.(100)
        return { ok: true, cardId: forged.id, name: card?.name ?? name, value: card?.value ?? 0 }
      } catch (err: any) {
        return { ok: false, cardId: null, error: err?.message || 'Upload failed' }
      }
    },
    [identity]
  )

  const decideSpecialMatch = useCallback(async (id: string, decision: 'like' | 'reject'): Promise<SpecialDecisionResult | { ok: false; status: number }> => {
    if (!identity) return { ok: false, status: 0 }
    const res = await orbitFetch(`/api/lobby/special/${id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }, identity)
    if (res.ok) {
      const body = await res.json()
      refresh({ includeSpecial: true })
      return { ok: true, ...body }
    }
    refresh({ includeSpecial: true })
    return { ok: false, status: res.status }
  }, [identity, refresh])

  const setLobbyName = useCallback(async (name: string | null): Promise<boolean> => {
    if (!identity) return false
    const res = await orbitFetch(
      '/api/lobby/meta',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || '' }),
      },
      identity
    )
    if (res.ok) {
      const body = await res.json()
      setLobbyNameState(body.lobby_name ?? null)
      return true
    }
    return false
  }, [identity])

  const loadMatchChat = useCallback(async (matchId: string): Promise<ChatMessage[]> => {
    if (!identity) return []
    try {
      const res = await orbitFetch(`/api/lobby/match/${matchId}/chat`, { method: 'GET' }, identity)
      if (!res.ok) return []
      const body = await res.json()
      const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : []
      setMatchChats((prev) => ({ ...prev, [matchId]: messages }))
      return messages
    } catch {
      return []
    }
  }, [identity])

  const sendMatchChat = useCallback(async (matchId: string, bodyText: string): Promise<boolean> => {
    if (!identity || !bodyText.trim()) return false
    const res = await orbitFetch(
      `/api/lobby/match/${matchId}/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: bodyText }),
      },
      identity
    )
    if (!res.ok) return false
    const body = await res.json().catch(() => null)
    if (body?.message) {
      const msg = body.message as ChatMessage
      setMatchChats((prev) => {
        const list = prev[matchId] || []
        if (list.some((m) => m.id === msg.id)) return prev
        return { ...prev, [matchId]: [...list.slice(-99), msg] }
      })
    }
    return true
  }, [identity])

  const respondToInvite = useCallback(async (inviteId: string, accept: boolean): Promise<boolean> => {
    if (!identity) return false
    const res = await orbitFetch(
      `/api/lobby/invites/${inviteId}/${accept ? 'accept' : 'decline'}`,
      { method: 'POST' },
      identity
    )
    if (res.ok) {
      refreshNotifications()
      if (accept) {
        // The accept immediately creates a match — force a lobby refresh so
        // the fresh duel surfaces.
        refresh({ force: true })
      }
      return true
    }
    return false
  }, [identity, refresh, refreshNotifications])

  const sendInvite = useCallback(async (inviteeId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!identity) return { ok: false, error: 'Not signed in' }
    const res = await orbitFetch(
      '/api/lobby/invites',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitee_id: inviteeId }),
      },
      identity
    )
    if (res.ok) {
      return { ok: true }
    }
    const body = await res.json().catch(() => null)
    return { ok: false, error: body?.error || 'Could not send the challenge' }
  }, [identity])

  const markNotificationsRead = useCallback(async (ids?: string[]) => {
    if (!identity) return
    const payload = ids && ids.length > 0 ? { ids } : {}
    await orbitFetch(
      '/api/notifications/read',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      identity
    )
    // Mark-all (no ids) clears everything; a targeted read only clears the
    // rows we were asked about, so the other badges survive.
    if (ids && ids.length > 0) {
      const hit = new Set(ids)
      setNotifications((prev) => {
        const next = prev.map((n) => (hit.has(n.id) ? { ...n, read: true } : n))
        // Recount per type from the rows themselves — deriving from the old
        // map meant a badge could disagree with the list it labels.
        const byType: Record<string, number> = {}
        let stillUnread = 0
        for (const n of next) {
          if (n.read) continue
          stillUnread += 1
          byType[n.type] = (byType[n.type] || 0) + 1
        }
        setUnreadByType(byType)
        setUnreadCount(stillUnread)
        return next
      })
      return
    }
    setUnreadCount(0)
    setUnreadByType({})
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [identity])

  return {
    state,
    images,
    joined,
    autoQueueEnabled,
    loading,
    lobbyName,
    onlineUsers,
    liveMatches: state?.active_matches || [],
    spectatingMatchId,
    spectatingSnapshot,
    join,
    leave,
    toggleAutoQueue,
    spectateMatch,
    closeSpectate,
    pickCard,
    decide,
    quitMatch,
    uploadImage,
    likeImage,
    getLikers,
    getComments,
    addComment,
    deleteComment,
    reportImage,
    specialMatches,
    activeSpecials,
    submitSpecialCard,
    uploadMatchCard,
    endSpecialMatch,
    decideSpecialMatch,
    setLobbyName,
    matchChats,
    loadMatchChat,
    sendMatchChat,
    refresh,
    flash,
    likeFlash,
    dismissFlash,
    babecockVersion,
    notifications,
    unreadCount,
    unreadByType,
    invites,
    refreshNotifications,
    respondToInvite,
    sendInvite,
    markNotificationsRead,
  }
}
