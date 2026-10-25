"use client";

// Servers view (plan T3/T4, docs/ADR-002-servers.md). A "server" is a full
// gMatch node; a courier only moves envelopes and directory rows. One page, one
// list, one row per server: the node on this machine, servers someone shared,
// and the admin's built-in "gmatch Node" all share the same row. A courier that
// hosts no world is infrastructure, not a destination, so it is not a row.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Lock, Globe, ShieldCheck, RefreshCw, Pencil, Check, X, Search, Share2, ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { generateIdentity } from '@orbit/crypto'
import { getCentralApiUrl, setCentralApiUrl } from '../../utils/central'
import { rememberKnownNodeHint } from '../../utils/peerNodes'
import { orbitFetch, getApiBaseUrl, isCourierApiUrl } from '../../utils/api'
import { normalizeServerUrl, isCurrentServerUrl } from '../../utils/serverUrl'
import { joinServer } from '../../utils/join-server'
import { switchClientWorld } from '../../utils/server-switch'
import { rememberPendingHost } from '../../utils/server-host-pending'
import { mergeDirectory, dedupeServers, serverKey, readDirectoryCache, writeDirectoryCache } from './directoryMerge'
import { readLabels, writeLabels, type LocalMeshLabel } from './meshLabels'
import { decodeNodeMask } from '../../utils/nodeMask'
import { buildNodeCode } from '../../utils/nodeShare'
import { PromptDialog } from '../PromptDialog'
import { Modal } from '../Modal'
import { AddWorldDialog } from './AddWorldDialog'
import { GroupsDialog } from './GroupsDialog'
import { WorldRow, WorldMenuItem, formatDomain, formatRelativeTime } from './WorldRow'
import type { WorldRowState } from './WorldRow'
import { claimPendingHost } from '../../hooks/usePendingServerHost'
import { SERVER_MARKER_KEY } from '../../firstRun/onboardingState'
import { playPress } from '../../utils/sounds'
import { resolveMediaUrl } from '../../utils/media'
import { CentralAdminPanel } from './CentralAdminPanel'
import { subscribeApiBase } from '../../utils/api'
import type { User } from '@orbit/shared'

export interface DirectoryServer {
  id: string
  name: string
  description?: string
  owner_id: string
  password_required: number
  endpoint_hint?: string
  is_private?: number
  tags?: string[]
  user_count?: number | null
  online_count?: number | null
  last_seen?: string
}

export interface DashboardUser {
  id: string
  display_name?: string
  pfp_url?: string
  last_seen?: string | null
  online: boolean
}

export interface Dashboard {
  name?: string
  users: DashboardUser[]
  posts_24h: number
  members_total: number
  online_count?: number
  active_24h_count?: number
}

export interface ServerNode {
  name: string
  description: string
  directoryId?: string | null
  tags?: string[]
  isAdmin: boolean
}

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

const DIRECTORY_ID_KEY = 'gmatch.server.directoryId'
// Claim marker: this install has created (and therefore hosts) a server. The
// heartbeat replays this registration while in host mode; its presence also
// blocks a second Create (one server per install — use Rename instead).
const REG_KEY = 'gmatch.server.register'
// One-shot marker: the host-mode admin has seen their minted passcode. The
// PIN itself comes from serverState().adminPin (electron/admin-pin.cjs).
const PIN_SEEN_KEY = 'gmatch.server.pinSeen'

/** The host's local display name, best-effort (private mode returns ''). */
function localDisplayName(): string {
  try { return (localStorage.getItem('orbit_display_name') || '').trim().slice(0, 40) } catch { return '' }
}

/** Comma-separated tag input → clamped lowercase slug list (≤10 × 24 chars). */
export function parseServerTags(input: string): string[] {
  const seen = new Set<string>()
  for (const raw of input.split(',')) {
    const tag = raw.trim().toLowerCase()
    if (!/^[a-z0-9-]{1,24}$/.test(tag) || seen.has(tag)) continue
    seen.add(tag)
    if (seen.size >= 10) break
  }
  return [...seen]
}

/**
 * True when an endpoint hint points back at this machine. Parsed by hand on
 * purpose: `new URL('192.168.0.9:8790')` has no scheme, so the parser silently
 * falls back to localhost and would label a LAN address as loopback.
 */
function isLocalHint(hint?: string | null): boolean {
  if (!hint?.trim()) return false
  const host = hint.trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split('/')[0]
    .replace(/^\[|\]$/g, '')
    .split(':')[0]
    .toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0'
}

/**
 * Live counts for a row — or null when nothing real backs a number. The old
 * version printed "— / —" and "0 / N", which read as facts about a world
 * nobody had measured.
 */
function rowCounts(
  s: DirectoryServer,
  isCurrentServer: boolean,
  dash: Dashboard | null,
): string | null {
  if (isCurrentServer && dash) {
    const online = typeof dash.online_count === 'number'
      ? dash.online_count
      : (Array.isArray(dash.users) ? dash.users.filter((u) => u.online).length : 0)
    const total = typeof dash.members_total === 'number'
      ? dash.members_total
      : (Array.isArray(dash.users) ? dash.users.length : 0)
    return `${online} / ${total}`
  }

  if (typeof s.online_count === 'number' && typeof s.user_count === 'number') {
    return `${s.online_count} / ${s.user_count}`
  }
  if (typeof s.online_count === 'number') return `${s.online_count} online`
  if (typeof s.user_count === 'number') return `${s.user_count} members`
  return null
}

export function ServersView({
  identity,
  toast,
  onSelectUser,
  profilePics = {},
  onServerJoined,
}: {
  identity: Parameters<typeof orbitFetch>[2] | null
  toast: Toast
  onSelectUser?: (user: User) => void
  profilePics?: Record<string, string>
  onServerJoined?: (server: DirectoryServer) => void
}) {
  const [central, setCentral] = useState(() => getCentralApiUrl())
  const [servers, setServers] = useState<DirectoryServer[]>([])
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [node, setNode] = useState<ServerNode | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hint, setHint] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [serverPassword, setServerPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirError, setDirError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [setupUrl, setSetupUrl] = useState('')
  const [setupError, setSetupError] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const [query, setQuery] = useState('')
  const [editingServer, setEditingServer] = useState(false)
  const [serverName, setServerName] = useState('gmatch')
  const [serverDescription, setServerDescription] = useState('')
  const [hubPrivate, setHubPrivate] = useState(false)
  const [hubNewPassword, setHubNewPassword] = useState('')
  const [hubRemovePassword, setHubRemovePassword] = useState(false)
  const [hubTags, setHubTags] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [serverMode, setServerMode] = useState<'host' | 'client' | null>(null)
  type ServerBridgeState = { packaged: boolean; mode: 'host' | 'client'; url: string; lanUrls: string[]; adminPin?: string }
  const [hostState, setHostState] = useState<ServerBridgeState | null>(null)
  const [pinToDismiss, setPinToDismiss] = useState('')
  const [activeTab, setActiveTab] = useState<'browse' | 'hub'>('browse')
  const [deleteTarget, setDeleteTarget] = useState<DirectoryServer | null>(null)
  const [deletePasscode, setDeletePasscode] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // Device-local mesh labels: UI grouping only, never a network or authority.
  const [labels, setLabels] = useState<LocalMeshLabel[]>(() => readLabels())
  const saveLabels = (next: LocalMeshLabel[]) => { setLabels(next); writeLabels(next) }
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [showCentralPopover, setShowCentralPopover] = useState(false)

  useEffect(() => {
    if (!openMenuId && !showCentralPopover) return
    const closeMenus = () => { setOpenMenuId(null); setShowCentralPopover(false) }
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target && !target.closest('[data-menu-trigger]') && !target.closest('[data-menu-content]')) {
        closeMenus()
      }
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenus() }
    window.addEventListener('mousedown', handleOutside)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('keydown', handleKey)
    }
  }, [openMenuId, showCentralPopover])

  // Join prompts (Electron has no window.prompt): one pending resolver ref,
  // one dialog kind at a time (password during join, or the paste-code modal).
  const pendingAsk = useRef<((v: string | null) => void) | null>(null)
  const [askPasswordFor, setAskPasswordFor] = useState<string | null>(null)
  const [addWorldOpen, setAddWorldOpen] = useState(false)

  const isDev = Boolean(import.meta.env.DEV) ||
    (typeof window !== 'undefined' &&
      (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'))

  const isLocalHost = (url: string) => url.includes('127.0.0.1') || url.includes('localhost')

  // The Render deployment is a blind courier: recognised and refused as a
  // data destination. It stays a directory only.
  const RENDER_COURIER_URL = 'https://gmatch-wcz1.onrender.com'
  // The public world: a full node every install can join without knowing
  // anyone. It is probed like any other server and is never assumed online.
  const PUBLIC_WORLD_URL = 'https://gmatch.fly.dev'
  const GM_CENTRAL_URL = PUBLIC_WORLD_URL
  const isDecommissioned = (hint?: string | null): boolean => {
    if (!hint) return false
    return hint.trim().toLowerCase().includes('onrender.com')
  }

  const [publicProbe, setPublicProbe] = useState<{ online: boolean; total: number | null }>({ online: false, total: null })

  // Built-in admin row: the node the maintainer runs. Always offered,
  // joinable in one click, drawn as offline until its own health probe answers.
  const publicServer: DirectoryServer = useMemo(() => ({
    id: 'public-world',
    name: 'gmatch Node',
    description: 'Shared node — meet players from anywhere',
    owner_id: 'public-world',
    endpoint_hint: PUBLIC_WORLD_URL,
    password_required: 0,
    is_private: 0,
    online_count: null,
    user_count: publicProbe.total,
    last_seen: publicProbe.online ? new Date().toISOString() : undefined,
  }), [publicProbe])


  // Mirror the connected server into the dev-proxy cookie so browser /api
  // traffic follows it. A courier is a DIRECTORY, not a data node (it 404s
  // every stateful route), so it is never written to `gmatch.api.url` — doing
  // so pointed the data API at the courier and 404'd every lobby/feed poll,
  // in dev and in the packaged app alike. A cookie left by an older build is
  // expired here too: the dev proxy honours it and would keep answering 503.
  useEffect(() => {
    try {
      if (typeof document !== 'undefined' && document.cookie.includes('gmatch_server_url=')) {
        const raw = document.cookie.split(';').map((c) => c.trim())
          .find((c) => c.startsWith('gmatch_server_url='))
        const value = raw ? decodeURIComponent(raw.slice('gmatch_server_url='.length)) : ''
        if (isCourierApiUrl(value)) {
          document.cookie = 'gmatch_server_url=; path=/; max-age=0'
        }
      }
      const stored = localStorage.getItem('gmatch.api.url')
      if (stored?.trim() && !isCourierApiUrl(stored)) {
        localStorage.setItem(SERVER_MARKER_KEY, stored)
        if (typeof document !== 'undefined' && !document.cookie.includes('gmatch_server_url=')) {
          document.cookie = `gmatch_server_url=${encodeURIComponent(stored)}; path=/; max-age=31536000`
        }
      }
    } catch { /* private mode */ }
  }, [])

  const refresh = useCallback(async () => {
    // Stale-run guard: a world switch mid-refresh must not let the previous
    // server's dashboard/node overwrite the new world's state.
    const runBase = getApiBaseUrl()
    const switchedAway = () => getApiBaseUrl() !== runBase

    // Built-in admin node: its own liveness probe, independent of any hub.
    const probePublic = async () => {
      try {
        const health = await fetch(`${PUBLIC_WORLD_URL}/api/health`, {
          signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(4000) : undefined,
        }).catch(() => null)
        setPublicProbe({ online: Boolean(health?.ok), total: null })
      } catch {
        setPublicProbe({ online: false, total: null })
      }
    }
    void probePublic()

    // Anonymous browser: public directory only — never touch node routes
    // (no ID yet, nothing to sign with).
    if (!identity) {
      if (!central) { setServers(readDirectoryCache()); setDirError(false); return }
      try {
        const res = await orbitFetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, null)
        if (res.ok) {
          const data = (await res.json()) as { servers: DirectoryServer[] }
          const merged = mergeDirectory(readDirectoryCache(), Array.isArray(data.servers) ? data.servers : [])
          writeDirectoryCache(merged)
          setServers(merged)
          setDirError(false)
        } else {
          setDirError(true)
        }
      } catch {
        setServers(readDirectoryCache())
        setDirError(true)
      }
      return
    }
    // Local node dashboard — always available, even with no central (plan §4).
    try {
      const d = await orbitFetch('/api/servers/dashboard', { method: 'GET' }, identity)
      let dj: Dashboard | null = null
      if (d.ok) {
        dj = (await d.json()) as Dashboard
      }
      if (switchedAway()) return

      // Also query /api/users to populate all server members including offline members
      const uRes = await orbitFetch('/api/users?limit=100', { method: 'GET' }, identity).catch(() => null)
      if (uRes && uRes.ok) {
        const uList = await uRes.json().catch(() => null)
        const rawUsers: Array<{ id: string; display_name?: string; pfp_url?: string; last_seen?: string | null; online?: boolean }> =
          Array.isArray(uList) ? uList : (Array.isArray(uList?.users) ? uList.users : [])
        if (rawUsers.length > 0) {
          const userMap = new Map<string, DashboardUser>()
          if (dj && Array.isArray(dj.users)) {
            for (const u of dj.users) userMap.set(u.id, u)
          }
          for (const ru of rawUsers) {
            if (!userMap.has(ru.id)) {
              userMap.set(ru.id, {
                id: ru.id,
                display_name: ru.display_name?.trim() || undefined,
                pfp_url: ru.pfp_url || undefined,
                last_seen: ru.last_seen,
                online: Boolean(ru.online),
              })
            }
          }
          const mergedUsers = Array.from(userMap.values())
          if (!dj) {
            dj = { users: mergedUsers, posts_24h: 0, members_total: mergedUsers.length }
          } else {
            dj.users = mergedUsers
          }
        }
      }

      if (dj && Array.isArray(dj.users)) {
        setDash(dj)
        if (typeof dj?.name === 'string' && dj.name.trim()) setServerName(dj.name.trim())
      }
    } catch { /* node without dashboard route. Fine */ }

    try {
      const n = await orbitFetch('/api/servers/node', { method: 'GET' }, identity)
      if (switchedAway()) return
      if (n.ok) {
        const nj = (await n.json()) as ServerNode
        if (typeof nj?.name === 'string') {
          setNode(nj)
          setServerName(nj.name)
          setServerDescription(nj.description || '')
        }
      }
    } catch { /* old nodes have no /node yet */ }

    // The directory is PER NODE: the node we are on lists the servers it
    // knows (its own registration plus everything gossiped into it). A
    // configured hub is an EXTRA source, never the only one — there is no
    // built-in hub left to depend on.
    let merged = readDirectoryCache()
    let dirFailed = false
    try {
      // cache-bust: orbitFetch dedups/caches GETs; the list must be fresh
      const res = await orbitFetch(`/api/servers?_ts=${Date.now()}`, { method: 'GET' }, identity)
      if (res.ok) {
        const data = (await res.json()) as { servers: DirectoryServer[] }
        merged = mergeDirectory(merged, Array.isArray(data.servers) ? data.servers : [])
      } else {
        dirFailed = true
      }
    } catch {
      // Our own node is unreachable: keep the gossiped cache and say so
      // rather than fake an empty directory.
      dirFailed = true
    }
    if (central && central.replace(/\/+$/, '').toLowerCase() !== getApiBaseUrl().replace(/\/+$/, '').toLowerCase()) {
      try {
        const r2 = await orbitFetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, identity)
        if (r2.ok) {
          const d2 = (await r2.json()) as { servers?: DirectoryServer[] }
          if (Array.isArray(d2.servers)) merged = mergeDirectory(merged, d2.servers)
        }
      } catch { /* hub offline; the node's own list stands */ }
    }
    // A decommissioned deployment is never a destination.
    merged = merged.filter((s) => !isDecommissioned(s.endpoint_hint))
    // Every node the directory knows becomes a node we can read beacons from
    // (and drop sealed envelopes into) — the discovery path for peers that
    // live on another machine.
    for (const s of merged) rememberKnownNodeHint(s.endpoint_hint)
    writeDirectoryCache(merged)
    setServers(merged)
    setDirError(dirFailed)
  }, [identity, central])

  useEffect(() => { refreshRef.current = refresh }, [refresh])

  useEffect(() => {
    try {
      const cached = readDirectoryCache().filter(
        (s) => s.name.trim().toLowerCase() !== 'gmatch' && !s.endpoint_hint?.includes('8790') && s.id !== 'central-node'
      )
      writeDirectoryCache(cached)
      if (localStorage.getItem(DIRECTORY_ID_KEY) === 'central-node') localStorage.removeItem(DIRECTORY_ID_KEY)
      const regRaw = localStorage.getItem(REG_KEY)
      if (regRaw) {
        try {
          const parsed = JSON.parse(regRaw)
          if (parsed.name?.trim().toLowerCase() === 'gmatch' || parsed.endpoint_hint?.includes('8790')) {
            localStorage.removeItem(REG_KEY)
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    void refresh()
    // Auto-refresh the dashboard/directory on the same 30s cadence as the
    // chat player list so online counts track players joining/leaving.
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refresh()
    }, 30_000)
    return () => clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    window.gmatch?.serverState?.()
      .then((s) => {
        setServerMode(s?.mode ?? null)
        setHostState(s ?? null)
        let seen = false
        try { seen = Boolean(localStorage.getItem(PIN_SEEN_KEY)) } catch { /* private mode */ }
        if (!seen && s?.mode === 'host' && s?.adminPin) setPinToDismiss(s.adminPin)
      })
      .catch(() => setServerMode(null))
  }, [])

  const saveCentral = () => {
    const raw = setupUrl.trim()
    if (!raw) { setSetupError('Enter your central node address.'); return }
    const normalized = normalizeServerUrl(raw) || normalizeServerUrl(`http://${raw}`)
    if (!normalized) {
      setSetupError('That does not look like an http(s) address (e.g. https://central.example).')
      return
    }
    setCentralApiUrl(normalized)
    setCentral(normalized)
    setSetupError('')
    setSetupUrl('')
    toast('Central node saved', 'success')
  }

  const getEffectiveServerUrl = useCallback((): string => {
    try {
      const stored = localStorage.getItem('gmatch.api.url') || localStorage.getItem(SERVER_MARKER_KEY)
      if (stored?.trim()) return stored.trim()
    } catch { /* private mode */ }
    return getApiBaseUrl()
  }, [])

  // Bumped on every committed world switch so current-markers recompute
  // from storage immediately (memos below depend on it).
  const [apiBaseTick, setApiBaseTick] = useState(0)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => subscribeApiBase(() => {
    setApiBaseTick((t) => t + 1)
    void refreshRef.current()
  }), [])

  const isCurrent = useCallback((s: DirectoryServer) => {
    const base = getEffectiveServerUrl()
    return isCurrentServerUrl(base, s.endpoint_hint || '')
  }, [getEffectiveServerUrl, apiBaseTick])

  const mine = (s: DirectoryServer) => !!identity && s.owner_id === (identity as unknown as { orbitId: string }).orbitId

  /** Address of the node this client is talking to. Browser dev rides the Vite
   *  proxy, so the proxy's target (the configured node) is the honest answer;
   *  a courier is never a server we own. */
  const nodeUrl = useMemo(() => {
    const base = getEffectiveServerUrl()
    if (base && !isCourierApiUrl(base)) return base
    if (isDev && isLocalHost(central)) return central
    return ''
  }, [getEffectiveServerUrl, apiBaseTick, central])

  const isOwnNode = (s: DirectoryServer) => s.id.startsWith('self:')

  /**
   * A node that hosts a world IS a server, whoever runs it — including the one
   * on this machine. It appears once, in its normal position in the list, keyed
   * by its address so it collapses with its own directory record instead of
   * being repeated as a separate current-world card.
   */
  const ownServer: DirectoryServer | null = useMemo(() => {
    if (!identity || !nodeUrl) return null
    const dashUsers = Array.isArray(dash?.users) ? dash.users : []
    return {
      id: `self:${nodeUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()}`,
      name: (serverName || node?.name || dash?.name || '').trim() || 'This computer',
      description: node?.description || serverDescription || '',
      owner_id: (identity as unknown as { orbitId?: string }).orbitId || '',
      password_required: 0,
      is_private: 0,
      endpoint_hint: nodeUrl,
      online_count: typeof dash?.online_count === 'number' ? dash.online_count : dashUsers.filter((u) => u.online).length,
      user_count: typeof dash?.members_total === 'number' ? dash.members_total : dashUsers.length,
      last_seen: new Date().toISOString(),
    }
  }, [identity, nodeUrl, serverName, node, dash, serverDescription])

  const visibleServers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const p2pNorm = RENDER_COURIER_URL.trim().replace(/\/+$/, '').toLowerCase()
    const centralNorm = GM_CENTRAL_URL.trim().replace(/\/+$/, '').toLowerCase()
    return servers.filter((s) => {
      if (s.id === 'central-node' || s.id === 'central-p2p' || s.id === 'central-local') return false
      if (s.name.trim().toLowerCase() === 'gmatch') return false
      const hintNorm = s.endpoint_hint ? (normalizeServerUrl(s.endpoint_hint)?.toLowerCase() || '') : ''
      // The courier is infrastructure, never a destination, and the admin node
      // is drawn from its own row; a stale directory mirror of either is never a
      // second destination.
      if (hintNorm && (hintNorm === p2pNorm || hintNorm === centralNorm)) return false
      // A localhost row is a real destination only for the node on THIS machine;
      // someone else's localhost is not joinable from here.
      if (!mine(s) && isLocalHint(s.endpoint_hint)) return false
      if (!q) return true
      return `${s.name} ${s.description ?? ''} ${s.endpoint_hint ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q)
    })
  }, [servers, query, apiBaseTick, identity])

  // ONE list. The node on this machine, shared destinations and the admin's
  // gmatch Node share the same row, deduped by address. The committed server
  // sorts first.
  const serverRows: DirectoryServer[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (s: DirectoryServer) =>
      !q || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q)
    const listed = dedupeServers([
      ...visibleServers,
      ...(matches(publicServer) ? [publicServer] : []),
    ])
    // The node on this machine IS a server even when the directory does not
    // list it. Its own directory record wins when there is one (that is the
    // name it registered under); the synthetic row is only the fallback.
    const ownListed = !!ownServer && matches(ownServer)
      && !listed.some((s) => serverKey(s) === serverKey(ownServer))
    const rows = ownListed ? [...listed, ownServer!] : listed
    return rows.sort((a, b) => {
      // The connected world first, then the built-in public world: it is the
      // one destination a fresh install can join without knowing anyone.
      const rank = (s: DirectoryServer) => (isCurrent(s) ? 0 : s.id === 'public-world' ? 1 : 2)
      const ac = rank(a)
      const bc = rank(b)
      if (ac !== bc) return ac - bc
      return (b.online_count ?? -1) - (a.online_count ?? -1) || a.name.localeCompare(b.name)
    })
  }, [ownServer, visibleServers, publicServer, query, apiBaseTick])

  const currentServerTitle = useMemo(() => {
    const apiBase = getEffectiveServerUrl()
    // The onrender node is a directory courier (transport), not a world.
    if (isCurrentServerUrl(apiBase, RENDER_COURIER_URL) || apiBase.includes('onrender.com')) {
      return 'gMatch Courier'
    }
    if (isCurrentServerUrl(apiBase, GM_CENTRAL_URL) || apiBase.includes('fly.dev')) {
      return 'gmatch Node'
    }
    const matched = servers.find((s) => isCurrentServerUrl(apiBase, s.endpoint_hint || ''))
    if (matched?.name) return matched.name
    return serverName || 'Hub'
  }, [servers, serverName, getEffectiveServerUrl])

  /** One quiet type label, and only when it helps: a world running on this
   *  machine. Everything else is just hosted, which is the norm and needs no
   *  label. */
  const kindFor = (s: DirectoryServer): WorldRowState['kind'] => {
    if (isOwnNode(s)) return 'P2P'
    return undefined
  }

  /** Secondary line: what a row is, plus what the directory actually told us.
   *  Never an address, a transport, or a diagnostic. */
  const metaFor = (s: DirectoryServer, isCurrentServer: boolean): string => {
    const bits: string[] = []
    const desc = (s.description || '').trim()
    if (isOwnNode(s)) bits.push(serverMode === 'host' ? 'hosted on this computer' : 'this computer')
    else if (s.is_private && !desc) bits.push('private, join by code')
    if (desc) bits.push(desc.length > 72 ? `${desc.slice(0, 71)}…` : desc)
    else if (!isOwnNode(s)) {
      const domain = formatDomain(s.endpoint_hint)
      if (domain) bits.push(domain)
    }
    if (!isCurrentServer && !isOwnNode(s) && s.last_seen) {
      bits.push(`listed ${formatRelativeTime(s.last_seen)}`)
    }
    return bits.join(' · ')
  }

  /**
   * The one place that names a row's state. Status vocabulary: Current ·
   * Connecting · Unavailable — and a row never claims reachability it has not
   * measured (visibility in the directory is not a connection).
   */
  const rowStateFor = (
    s: DirectoryServer,
    opts: { connecting: boolean },
  ): WorldRowState => {
    const isCurrentServer = isCurrent(s)
    const base: WorldRowState = {
      counts: rowCounts(s, isCurrentServer, dash),
      meta: metaFor(s, isCurrentServer),
      kind: kindFor(s),
    }
    if (opts.connecting) return { ...base, status: 'Connecting' }
    if (isCurrentServer) return { ...base, status: 'Current' }
    if (!s.endpoint_hint) return { ...base, status: 'Unavailable' }
    return base
  }

  const closeCreateForm = () => {
    setAddWorldOpen(false); setName(''); setDescription(''); setHint(''); setNeedsPassword(false); setIsPrivate(false); setServerPassword('')
  }

  // Snapshot the connected node's current settings into the Hub editor.
  // Only the connected node is node-editable; other owned rows are
  // directory-editable (privacy/unregister) until you switch to them.
  const openEditor = () => {
    playPress(780)
    const ownRow = servers.find((s) => mine(s) && isCurrent(s))
    setHubPrivate(Boolean(ownRow?.is_private))
    try {
      const raw = localStorage.getItem(REG_KEY)
      if (raw && typeof JSON.parse(raw)?.private === 'boolean') setHubPrivate(Boolean(JSON.parse(raw).private))
    } catch { /* session-only */ }
    setHubTags((node && Array.isArray(node.tags) ? node.tags : []).join(', '))
    setHubNewPassword('')
    setHubRemovePassword(false)
    setEditingServer(true)
  }

  // Best-effort: list the (public) registration in a directory. The
  // configured hub when there is one, otherwise OUR OWN node — a node
  // always has a directory, so listing never needs a third party.
  // Returns the created row (or null). The host heartbeat replays the saved
  // registration every 15min, so a dead directory here self-heals later.
  const registerDirectory = async (
    n: string, d: string, h: string, pwRequired: boolean, isPrivate: boolean,
  ): Promise<DirectoryServer | null> => {
    const directory = central || getApiBaseUrl()
    if (!directory || !identity) return null
    try {
      const res = await orbitFetch(`${directory}/api/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, description: d, endpoint_hint: h, password_required: pwRequired, private: isPrivate, owner_name: localDisplayName() || undefined }),
      }, identity)
      if (res.ok) {
        const created = (await res.json().catch(() => ({}))) as { server?: DirectoryServer }
        const id = typeof created?.server?.id === 'string' ? created.server.id : ''
        if (id) { try { localStorage.setItem(DIRECTORY_ID_KEY, id) } catch { /* session-only */ } }
        return created?.server ?? null
      }
      const e = (await res.json().catch(() => ({}))) as { error?: string }
      toast(e.error || 'Could not register with the directory', 'warning')
    } catch {
      toast('Directory offline. Your server gets listed once it answers.', 'warning')
    }
    return null
  }

  // Create = host locally, on this install. The bundled node becomes the new
  // server, the app signs into it (identity auto-provisions its first user,
  // who is admin) and the old central/friend connection is dropped. A client
  // has to restart into host mode first, so the claim rides a one-shot
  // handoff; an unclaimed host claims immediately.
  const create = async () => {
    if (!identity) return
    const trimmed = name.trim()
    if (!trimmed || busy) return
    const desc = description.trim()
    const pw = needsPassword ? serverPassword.trim() : ''
    if (needsPassword && pw.length < 4) { toast('Pick a join password of at least 4 characters (or leave it unchecked)', 'warning'); return }
    setBusy(true)
    try {
      const st = await window.gmatch?.serverState?.().catch(() => null)
      let claimedBefore = false
      try { claimedBefore = Boolean(localStorage.getItem(REG_KEY)) } catch { /* session-only */ }
      // One server per install: this machine already hosts its own node.
      if (claimedBefore && st?.mode === 'host') {
        toast(`This computer already hosts “${serverName || 'a server'}”. Rename it on the left instead.`, 'warning')
        return
      }
      const canHost = Boolean(window.gmatch?.serverSet && st?.packaged)
      const hintFinal = hint.trim() || (canHost ? st?.lanUrls?.[0] ?? '' : '')
      if (canHost) {
        // Claim marker first: even if every request below dies, the heartbeat
        // will replay the registration once the host is reachable again.
        try {
          localStorage.setItem(REG_KEY, JSON.stringify({
            name: trimmed, description: desc, endpoint_hint: hintFinal, password_required: needsPassword, private: isPrivate,
          }))
        } catch { /* session-only */ }
        const listed = await registerDirectory(trimmed, desc, hintFinal, needsPassword, isPrivate)
        rememberPendingHost({ name: trimmed, description: desc, password: pw || undefined, directoryId: listed?.id })
        if (st?.mode === 'client') {
          const res = await window.gmatch!.serverSet!({ mode: 'host', url: '' })
          if (!res.ok) { toast(res.error || 'Could not switch to hosting your own server', 'error'); return }
          closeCreateForm()
          toast(`Creating “${trimmed}”. The app restarts logged into your own server.`, 'success')
          window.gmatch!.serverRelaunch?.()
          return
        }
        // Already hosting an unclaimed node (1.0 default): claim it now.
        closeCreateForm()
        const out = await claimPendingHost(identity, toast)
        if (out === 'retry') toast('Local server is still starting. The claim retries on its own.', 'warning')
        await refresh()
        return
      }
      // Browser/dev build without the desktop bridge: directory-only listing;
      // hosting your own node needs the packaged app.
      if (!central && !getApiBaseUrl()) { toast('No node to list this server on. Hosting runs in the desktop app.', 'warning'); return }
      const listed = await registerDirectory(trimmed, desc, hintFinal, needsPassword, isPrivate)
      if (listed) {
        toast('Server registered. Signed-in users can see it in the directory.', 'success')
        closeCreateForm()
        await refresh()
      }
    } catch {
      toast('Couldn\'t reach the server.', 'error')
    } finally {
      setBusy(false)
    }
  }

  // Switch = join another node, or hop back to this machine's own host node.
  const switchTo = async (s: DirectoryServer) => {
    if (connectingId) return
    setConnectingId(s.id)
    try {
      if (!mine(s)) {
        const out = await joinServer(s, toast, askPassword)
        if (out === 'connected') onServerJoined?.(s)
        if (out !== 'relaunching') setConnectingId(null)
        return
      }
      if (!window.gmatch?.serverSet) {
        setConnectingId(null)
        return
      }
      const res = await window.gmatch.serverSet({ mode: 'host', url: '' })
      if (res.ok) {
        toast('Switching to your own server. The app restarts.', 'success')
        window.gmatch.serverRelaunch?.()
      } else {
        toast(res.error || 'Could not switch servers', 'error')
        setConnectingId(null)
      }
    } catch {
      setConnectingId(null)
    }
  }

  // One settings save for the connected node (host admin): name, description,
  // tags, privacy and join password. Node PATCH owns name/description/tags,
  // the node password route owns the secret, the central directory mirrors
  // the public mirrors (name/description/private/password_required/tags).
  const saveServerSettings = async () => {
    if (!identity) return
    const trimmed = serverName.trim()
    const desc = serverDescription.trim()
    const tags = parseServerTags(hubTags)
    if (!trimmed || renaming) return
    setRenaming(true)
    try {
      const res = await orbitFetch('/api/servers/node', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: desc, tags }),
      }, identity)
      const body = (await res.json().catch(() => ({}))) as { error?: string; server?: ServerNode }
      if (!res.ok) { toast(body.error || 'Could not save these settings', 'error'); return }
      if (body.server) {
        setNode(body.server)
        setServerName(body.server.name)
        setServerDescription(body.server.description || '')
      }
      setEditingServer(false)

      // Join password: untouched when the field is empty; a value sets it,
      // the checkbox clears it. The directory only mirrors the flag.
      let passwordRequired: boolean | null = null
      const newPw = hubNewPassword.trim()
      if (newPw) {
        if (newPw.length < 4) { toast('Pick a join password of at least 4 characters (or leave it empty)', 'warning'); return }
        const pwRes = await orbitFetch('/api/server/password', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newPw }),
        }, identity)
        if (!pwRes.ok) { toast('Password was not updated.', 'warning') } else passwordRequired = true
      } else if (hubRemovePassword) {
        const pwRes = await orbitFetch('/api/server/password', { method: 'POST' }, identity)
        if (!pwRes.ok) { toast('Password was not removed.', 'warning') } else passwordRequired = false
      }
      setHubNewPassword('')
      setHubRemovePassword(false)

      let directoryId = body.server?.directoryId || node?.directoryId || ''
      try { directoryId ||= localStorage.getItem(DIRECTORY_ID_KEY) || '' } catch { /* session-only */ }
      if (central) {
        if (!directoryId) {
          const ownServer = servers.find((s) => mine(s))
          directoryId = ownServer?.id || ''
        }
        if (directoryId) {
          try {
            const dirPatch: Record<string, unknown> = {
              name: trimmed, description: desc, private: hubPrivate, tags,
            }
            if (passwordRequired !== null) dirPatch.password_required = passwordRequired
            const dirRes = await orbitFetch(`${central}/api/servers/${directoryId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(dirPatch),
            }, identity)
            if (dirRes.ok) {
              localStorage.setItem(DIRECTORY_ID_KEY, directoryId)
              try {
                const raw = localStorage.getItem(REG_KEY)
                if (raw) localStorage.setItem(REG_KEY, JSON.stringify({ ...JSON.parse(raw), private: hubPrivate }))
              } catch { /* session-only */ }
              // Name change shows in the browser immediately, no refetch wait.
              setServers((prev) => prev.map((s) => (s.id === directoryId
                ? { ...s, name: trimmed, description: desc, is_private: hubPrivate ? 1 : 0, tags,
                    ...(passwordRequired !== null ? { password_required: passwordRequired ? 1 : 0 } : {}) }
                : s)))
            } else toast('Settings saved here, but the directory didn\'t update.', 'warning')
          } catch {
            toast('Settings saved here. The directory is offline.', 'warning')
          }
        }
      }
      toast('Server settings saved', 'success')
      void refresh()
    } catch {
      toast('Couldn\'t reach the server.', 'error')
    } finally {
      setRenaming(false)
    }
  }

  const askPassword = (name: string) =>
    new Promise<string | null>((resolve) => { pendingAsk.current = resolve; setAskPasswordFor(name) })


  const join = async (s: DirectoryServer) => {
    if (connectingId) return
    if (isDecommissioned(s.endpoint_hint)) {
      toast('That deployment was decommissioned — pick a node that is running.', 'warning')
      return
    }
    // The courier row is transport status, not a world — there is no data
    // base to join (pointing data traffic at it 404s by design).
    if (s.id === 'central-p2p') {
      toast('Central relay is transport, not a world. Pick a server below.', 'info')
      return
    }
    setConnectingId(s.id)
    try {
      if (
        s.id === 'central-p2p' ||
        s.id === 'central-node' ||
        (s.endpoint_hint && (
          s.endpoint_hint === central ||
          isDecommissioned(s.endpoint_hint)
        ))
      ) {
        const rawTarget = s.endpoint_hint || central
        const target = normalizeServerUrl(rawTarget) || normalizeServerUrl('http://' + rawTarget) || rawTarget
        setCentralApiUrl(target)
        setCentral(target)
        try {
          localStorage.setItem(SERVER_MARKER_KEY, target)
          localStorage.setItem('gmatch.api.url', target)
          if (typeof document !== 'undefined') {
            document.cookie = `gmatch_server_url=${encodeURIComponent(target)}; path=/; max-age=31536000`
          }
        } catch { /* private mode */ }
        if (!window.gmatch?.serverSet) {
          toast(`Connected to ${s.name}.`, 'success')
          onServerJoined?.(s)
          if (!onServerJoined && typeof window !== 'undefined' && import.meta.env.MODE !== 'test') {
            window.location.reload()
          } else {
            setConnectingId(null)
          }
          return
        }
        // Packaged bridge path: probe-then-commit in-app. serverSet persists
        // the selection for future restarts, but nothing relaunches — the
        // base-change event re-dials transports and refreshes server state.
        const out = await switchClientWorld(
          { name: s.name, endpointHint: target, passwordRequired: s.password_required === 1 },
          { toast, identity: identity as unknown as { orbitId: string } | null, askPassword },
        )
        if (out === 'switched') {
          toast(`Connected to ${s.name}.`, 'success')
          onServerJoined?.(s)
          void refresh()
        }
        setConnectingId(null)
        return
      }
      if (!window.gmatch?.serverSet) {
        const url = s.endpoint_hint
        if (!url) {
          toast('This server has no address to join (owner is offline?)', 'warning')
          setConnectingId(null)
          return
        }
        const target = normalizeServerUrl(url) || normalizeServerUrl('http://' + url) || url
        try {
          localStorage.setItem(SERVER_MARKER_KEY, target)
          localStorage.setItem('gmatch.api.url', target)
          if (typeof document !== 'undefined') {
            document.cookie = `gmatch_server_url=${encodeURIComponent(target)}; path=/; max-age=31536000`
          }
        } catch { /* private mode */ }
        toast(`Connected to ${s.name}.`, 'success')
        onServerJoined?.(s)
        if (!onServerJoined && typeof window !== 'undefined' && import.meta.env.MODE !== 'test') {
          window.location.reload()
        } else {
          setConnectingId(null)
        }
        return
      }
      const out = await joinServer(s, toast, askPassword)
      if (out === 'connected' && onServerJoined) {
        onServerJoined(s)
      }
      if (out !== 'relaunching') {
        setConnectingId(null)
      }
    } catch {
      setConnectingId(null)
    }
  }

  // Copy the gmatch://node/ code a friend pastes into "Node code" here.
  // The clipboard carries the code alone (the paste-side decoder is strict).
  const shareServer = async (address: string, name: string) => {
    const code = buildNodeCode(address, name)
    if (!code) { toast('No shareable address yet. Check Settings, Server.', 'warning'); return }
    try {
      await navigator.clipboard.writeText(code)
      toast('Server code copied. Send it to your friends.', 'success')
    } catch {
      toast('Could not reach the clipboard.', 'error')
    }
  }

  // Wave 2 (D2): out-of-band join — paste a gmatch://node/ code shared by the
  // host directly (no hub coordination needed to reach a node).
  const joinByCode = async (entered: string): Promise<boolean> => {
    const coord = decodeNodeMask(entered)
    // Bad code never leaves the dialog: the field owns that error.
    if (!coord) return false
    const host = coord.port ? `${coord.host}:${coord.port}` : coord.host
    // Persist before the relaunch kills the process.
    const serverObj = { id: `mask:${host}`, name: coord.name, owner_id: '', password_required: 0, endpoint_hint: host }
    writeDirectoryCache(mergeDirectory(readDirectoryCache(), [serverObj]))
    const res = await joinServer(serverObj, toast, askPassword)
    if (res === 'connected') {
      onServerJoined?.(serverObj)
    }
    return true
  }

  const leave = async () => {
    if (!window.gmatch?.serverSet) return
    const res = await window.gmatch.serverSet({ mode: 'host', url: '' })
    if (res.ok) { toast('Returning to your own server. The app restarts.', 'success'); window.gmatch.serverRelaunch?.() }
  }

  const unregister = async (s: DirectoryServer) => {
    if (!identity) return
    if (!window.confirm(`Unregister "${s.name}" from the directory?`)) return
    const res = await orbitFetch(`${central}/api/servers/${s.id}`, { method: 'DELETE' }, identity)
    if (res.ok) {
      try { if (localStorage.getItem(DIRECTORY_ID_KEY) === s.id) localStorage.removeItem(DIRECTORY_ID_KEY) } catch { /* session-only */ }
      // Un-stick the create cycle: the claim marker must die with the row, or
      // create() refuses forever ("This computer already hosts").
      try {
        const raw = localStorage.getItem(REG_KEY)
        const myDirectoryId = localStorage.getItem(DIRECTORY_ID_KEY) || ''
        if (raw && (!myDirectoryId || s.id === myDirectoryId)) localStorage.removeItem(REG_KEY)
      } catch { /* session-only */ }
      toast('Server unregistered.', 'success'); void refresh()
    }
    else toast('Only the owner can unregister a server', 'error')
  }

  const forgetLocalServer = (s: DirectoryServer) => {
    try {
      const cached = readDirectoryCache().filter((item) => item.id !== s.id)
      writeDirectoryCache(cached)
      setServers((prev) => prev.filter((item) => item.id !== s.id))
      if (localStorage.getItem(DIRECTORY_ID_KEY) === s.id) localStorage.removeItem(DIRECTORY_ID_KEY)
      const raw = localStorage.getItem(REG_KEY)
      if (raw) {
        const myDirectoryId = localStorage.getItem(DIRECTORY_ID_KEY) || ''
        if (!myDirectoryId || s.id === myDirectoryId) localStorage.removeItem(REG_KEY)
      }
      toast(`Removed "${s.name}" from local list.`, 'info')
    } catch { /* session-only */ }
    setDeleteTarget(null)
    setDeletePasscode('')
    setDeleteError('')
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')

    try {
      // 1. Owner unregister directly
      if (mine(deleteTarget)) {
        const res = await orbitFetch(`${central}/api/servers/${deleteTarget.id}`, { method: 'DELETE' }, identity)
        if (res.ok) {
          forgetLocalServer(deleteTarget)
          toast('Server unregistered.', 'success')
          void refresh()
          return
        }
      }

      // 2. Passcode provided: verify with /api/admin/verify-pin
      if (deletePasscode.trim()) {
        let activeIdentity = identity
        if (!activeIdentity) {
          activeIdentity = generateIdentity()
        }
        const verifyRes = await orbitFetch(
          `${central}/api/admin/verify-pin`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: deletePasscode.trim() }),
          },
          activeIdentity,
        )
        if (!verifyRes.ok) {
          const errData = (await verifyRes.json().catch(() => ({}))) as { error?: string }
          setDeleteError(errData.error || 'Incorrect admin passcode.')
          setDeleting(false)
          return
        }

        // Delete from central directory using admin endpoint
        const delRes = await orbitFetch(
          `${central}/api/servers/admin/directory/${deleteTarget.id}`,
          { method: 'DELETE' },
          activeIdentity,
        )
        if (delRes.ok) {
          forgetLocalServer(deleteTarget)
          toast('Server permanently deleted from directory', 'success')
          void refresh()
          return
        } else {
          const errData = (await delRes.json().catch(() => ({}))) as { error?: string }
          setDeleteError(errData.error || 'Failed to delete server from directory.')
          setDeleting(false)
          return
        }
      }

      // 3. Already node admin
      if (node?.isAdmin) {
        const delRes = await orbitFetch(
          `${central}/api/servers/admin/directory/${deleteTarget.id}`,
          { method: 'DELETE' },
          identity,
        )
        if (delRes.ok) {
          forgetLocalServer(deleteTarget)
          toast('Server permanently deleted from directory', 'success')
          void refresh()
          return
        }
      }

      setDeleteError('Enter the Central Admin Passcode to permanently delete this server.')
    } catch (e) {
      setDeleteError((e as Error)?.message || 'Failed to delete server')
    } finally {
      setDeleting(false)
    }
  }

  const setPrivate = async (s: DirectoryServer, v: boolean) => {
    if (!identity || !central) return
    const res = await orbitFetch(`${central}/api/servers/${s.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ private: v }),
    }, identity)
    if (!res.ok) { toast('Could not change privacy for this server', 'error'); return }
    try {
      const raw = localStorage.getItem(REG_KEY)
      if (raw) localStorage.setItem(REG_KEY, JSON.stringify({ ...JSON.parse(raw), private: v }))
    } catch { /* session-only */ }
    toast(v ? 'Server is private. Reachable only via your code.' : 'Server is public again.', 'success')
    void refresh()
  }

  const allUsers = dash?.users || []
  const onlineUsers = useMemo(() => allUsers.filter((u) => u.online), [allUsers])
  const offlineUsers = useMemo(() => allUsers.filter((u) => !u.online), [allUsers])

  const handleUserClick = (u: DashboardUser) => {
    if (!onSelectUser) return
    playPress(700)
    onSelectUser({
      id: u.id,
      display_name: u.display_name,
      pfp_url: u.pfp_url || profilePics[u.id],
    } as User)
  }

  /** Shared ArrowUp/Down navigation inside a row list. */
  const onRowListKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-world-row-focus]'))
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    const next = e.key === 'ArrowDown'
      ? items[idx + 1] ?? items[0]
      : items[idx - 1] ?? items[items.length - 1]
    next?.focus()
  }

  const closeDeleteDialog = () => {
    setDeleteTarget(null)
    setDeletePasscode('')
    setDeleteError('')
  }

  /**
   * One row for every server, so anatomy and states cannot drift. The row owns
   * layout; the menu lives here because it needs this view's handlers. Clicking
   * a row joins/switches; the active row is inert and never reconnects.
   */
  const renderRow = (s: DirectoryServer) => {
    const isMenuOpen = openMenuId === s.id
    const isMyServer = mine(s)
    const isCurrentServer = isCurrent(s)
    const isOwn = isOwnNode(s)
    const state = rowStateFor(s, { connecting: connectingId === s.id })

    return (
      <WorldRow
        key={s.id}
        server={s}
        state={state}
        menuOpen={isMenuOpen}
        onMenuToggle={() => setOpenMenuId((cur) => (cur === s.id ? null : s.id))}
        // Unavailable is a measured state, and a row in it is not offered as
        // ready to connect. Whatever path remains lives in the row menu.
        joinDisabled={!!connectingId || state.status === 'Unavailable'}
        onJoin={() => { playPress(620); if (isMyServer || isOwn) void switchTo(s); else void join(s) }}
        menuItems={
          <>
            {isCurrentServer && identity && (
              <WorldMenuItem
                icon={<Globe className="w-3 h-3" />}
                label="Open dashboard"
                title="Members, invites and settings"
                onClick={() => { playPress(700); setOpenMenuId(null); setActiveTab('hub') }}
              />
            )}
            {isCurrentServer && node?.isAdmin && (
              <WorldMenuItem
                icon={<Pencil className="w-3 h-3" />}
                label="Server settings"
                title="Server settings"
                onClick={() => { openEditor(); setOpenMenuId(null); setActiveTab('hub') }}
              />
            )}
            {isCurrentServer && serverMode === 'host' && (
              <WorldMenuItem
                icon={<Share2 className="w-3 h-3" />}
                label="Copy share code"
                title="Copy node code"
                onClick={() => {
                  setOpenMenuId(null)
                  playPress(820)
                  void window.gmatch?.serverState?.()
                    .then((st) => void shareServer(st?.lanUrls?.[0] || '', serverName))
                    .catch(() => void shareServer('', serverName))
                }}
              />
            )}
            {!isCurrentServer && s.endpoint_hint && (
              <WorldMenuItem
                icon={<Share2 className="w-3 h-3" />}
                label="Copy server code"
                title="Copy node code"
                onClick={() => { playPress(820); void shareServer(s.endpoint_hint || '', s.name); setOpenMenuId(null) }}
              />
            )}
            {isMyServer && !isCurrentServer && (
              <WorldMenuItem
                icon={<Lock className="w-3 h-3" />}
                label={s.is_private ? 'Make public' : 'Make private'}
                onClick={() => { playPress(740); void setPrivate(s, !s.is_private); setOpenMenuId(null) }}
              />
            )}
            {isMyServer && !isCurrentServer && (
              <WorldMenuItem
                icon={<Trash2 className="w-3 h-3" />}
                label="unregister"
                onClick={() => { void unregister(s); setOpenMenuId(null) }}
              />
            )}
            {!isCurrentServer && !isMyServer && (
              <WorldMenuItem
                icon={<Trash2 className="w-3 h-3" />}
                label="Delete / Forget"
                danger
                onClick={() => { setDeleteTarget(s); setDeleteError(''); setDeletePasscode(''); setOpenMenuId(null) }}
              />
            )}
          </>
        }
      />
    )
  }

  /** The host form — handed to the Add server dialog so hosting has one door. */
  const hostForm = identity ? (
    <div className="space-y-2">
      <p className="text-xs text-retro-muted">
        This machine becomes the server: you are logged into it (and off the node
        you were connected to) automatically, and you are its admin. Friends join
        from the address below.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block text-xs text-retro-muted">
          Server name
          <input aria-label="Server name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            className="glass-field mt-0.5 w-full px-2.5 py-1 text-xs" />
        </label>
        <label className="block text-xs text-retro-muted">
          Advanced address override (optional)
          <input aria-label="Address hint" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} placeholder=""
            className="glass-field mt-0.5 w-full px-2.5 py-1 text-xs font-mono" />
        </label>
      </div>
      {(() => {
        const preview = buildNodeCode(hint.trim() || hostState?.lanUrls?.[0] || '', name.trim())
        return preview ? (
          <div data-testid="create-handle-preview" className="flex items-center gap-2 text-xs font-mono text-retro-muted">
            <span className="truncate max-w-[240px]">{preview.slice(0, 28)}…</span>
            <button type="button" onClick={() => void navigator.clipboard.writeText(preview)}
              className="glass-action px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer">Copy code</button>
          </div>
        ) : <p className="text-xs text-retro-muted">Type a name to get your share code.</p>
      })()}
      <label className="block text-xs text-retro-muted">
        Description (public)
        <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
          className="glass-field mt-0.5 w-full px-2.5 py-1 text-xs" />
      </label>
      <label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer pt-0.5">
        <input type="checkbox" className="w-4 h-4 accent-retro-accent cursor-pointer" checked={needsPassword} onChange={(e) => setNeedsPassword(e.target.checked)} />
        Ask visitors for a join password
      </label>
      <label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer pt-0.5">
        <input type="checkbox" className="w-4 h-4 accent-retro-accent cursor-pointer" aria-label="Private server" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Private. Hide from the public browser (friends join with your code)
      </label>
      {needsPassword && (
        <input
          type="password"
          aria-label="Server join password"
          value={serverPassword}
          onChange={(e) => setServerPassword(e.target.value)}
          placeholder="At least 4 characters"
          maxLength={64}
          className="glass-field w-full px-2.5 py-1 text-xs"
        />
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" disabled={!name.trim() || busy} onClick={() => void create()}
          className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer">
          {busy ? '…' : 'Create'}
        </button>
        <button type="button" onClick={closeCreateForm} className="glass-action px-3 py-1.5 rounded-lg text-xs text-retro-muted cursor-pointer">Cancel</button>
      </div>
    </div>
  ) : undefined

  return (
    <div className="h-full min-h-0 flex-1 overflow-hidden p-2 animate-orbit-fade-in flex flex-col items-center">
      {/* First-login admin passcode */}
      {serverMode === 'host' && node?.isAdmin && pinToDismiss && (
        <div role="alert" data-testid="admin-pin-banner" className="mb-2 bg-surface-interactive/90 border border-amber-400/40 p-3 rounded-lg space-y-1.5 shrink-0 shadow-lg">
          <p className="text-xs text-retro-fg font-bold">You are the admin of this server</p>
          <p className="text-xs text-retro-muted">
            Your admin passcode (unlocks the console. Store it somewhere safe):{' '}
            <button
              type="button"
              className="font-mono text-amber-200 hover:text-amber-100 cursor-pointer"
              onClick={() => { void navigator.clipboard.writeText(pinToDismiss); toast('Passcode copied', 'success'); }}
            >
              {pinToDismiss}
            </button>
          </p>
          <button
            type="button"
            onClick={() => { try { localStorage.setItem(PIN_SEEN_KEY, '1'); } catch { /* session-only */ } setPinToDismiss(''); }}
            className="glass-action glass-action-primary px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer"
          >
            Got it
          </button>
        </div>
      )}

      {/* One narrow column on the page background: no card wrapping the list. */}
      <div className="flex flex-col h-full min-h-0 flex-1 w-full max-w-[720px] overflow-hidden">
        {/* One page header: one title, one primary action, a quiet search. */}
        <div className="glass-toolbar border-0 border-b border-border-glass rounded-none px-4 py-2.5 flex items-center gap-2 shrink-0">
          <div className="min-w-0 shrink-0">
            <h1 className="text-sm font-bold text-retro-fg leading-tight truncate">
              {activeTab === 'hub' ? 'Hub' : 'Servers'}
            </h1>
            {activeTab === 'hub' && (
              <p className="text-[10px] text-retro-muted truncate">Members, invites and settings</p>
            )}
          </div>

          {activeTab === 'browse' && (
            <div className="glass-field ml-1 flex min-w-0 max-w-[13rem] flex-1 items-center gap-1 px-2 h-7 text-xs">
              <Search className="w-3 h-3 text-retro-muted shrink-0" />
              <input
                aria-label="Search servers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search servers…"
                className="w-full bg-transparent text-retro-fg outline-none placeholder:text-retro-muted text-xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="text-retro-muted hover:text-retro-fg cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {/* Directory: the central address, the dev switch and the admin door
                live together, out of the way of the everyday action. */}
            <div className="relative">
              <button
                type="button"
                data-menu-trigger
                aria-expanded={showCentralPopover}
                onClick={() => { playPress(760); setShowCentralPopover((v) => !v) }}
                aria-label="Directory options"
                className="p-2 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer"
                title={central ? `Directory: ${central.replace(/^https?:\/\//, '')}` : 'Directory'}
              >
                <Globe className="w-4 h-4" />
              </button>

              {showCentralPopover && (
                <div
                  data-menu-content
                  className="absolute right-0 top-full mt-2 w-72 bg-surface-raised border border-border-glass rounded-lg p-3 shadow-xl z-[var(--z-dropdown)] space-y-2.5 animate-orbit-fade-in"
                >
                  <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
                    <span className="text-xs font-bold text-retro-fg">Directory</span>
                    <button
                      type="button"
                      onClick={() => setShowCentralPopover(false)}
                      aria-label="Close directory menu"
                      className="text-retro-muted hover:text-retro-fg p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-retro-muted">
                    Optional: a node that publishes a server directory for others. Empty means your own node
                    is the directory.
                  </p>
                  <div className="flex items-center gap-1.5">
                    <input
                      aria-label="Central node URL"
                      value={setupUrl || (central || '')}
                      onChange={(e) => setSetupUrl(e.target.value)}
                      placeholder="http://192.168.1.10:8790"
                      className="glass-field w-full px-2.5 py-1 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => { saveCentral(); setShowCentralPopover(false); }}
                      className="glass-action glass-action-primary px-2.5 py-1 text-xs font-bold rounded-lg shrink-0 cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                  {setupError && <p role="alert" className="text-[10px] text-retro-error">{setupError}</p>}
                  {isDev && (
                    <div className="pt-1 border-t border-border-subtle flex items-center justify-between">
                      <span className="text-[10px] text-retro-muted font-mono">Dev switch:</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setCentralApiUrl('http://127.0.0.1:8790')
                            setCentral('http://127.0.0.1:8790')
                            toast('Switched to local 8790', 'info')
                            void refresh()
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                            central === 'http://127.0.0.1:8790'
                              ? 'bg-retro-accent text-retro-accent-text font-bold'
                              : 'bg-glass-w10 text-retro-muted hover:text-retro-fg'
                          }`}
                        >
                          local:8790
                        </button>
                      </div>
                    </div>
                  )}
                  {central && (
                    <button
                      type="button"
                      onClick={() => { setShowCentralPopover(false); playPress(760); setShowAdmin((v) => !v) }}
                      aria-label="Central admin panel"
                      className="w-full pt-2 border-t border-border-subtle flex items-center gap-2 text-xs text-retro-muted hover:text-retro-fg cursor-pointer transition-colors text-left"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" /> Central admin panel
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => { playPress(700); setRefreshing(true); void refresh().finally(() => setRefreshing(false)) }}
              disabled={refreshing}
              aria-label="Refresh servers"
              aria-busy={refreshing || undefined}
              title="Refresh"
              className="p-2 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => { playPress(880); setAddWorldOpen(true) }}
              aria-label="Add server"
              title="Join with a code, or host a server on this computer"
              className="glass-action glass-action-primary flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3 h-3" /> Add server
            </button>
          </div>
        </div>

        {activeTab === 'hub' && identity ? (
          <aside className="flex flex-col min-h-0 h-full overflow-y-auto styled-scrollbar p-4 sm:p-6 space-y-4 max-w-4xl w-full mx-auto" aria-label="Current server hub">
            {/* Top Navigation */}
            <div className="flex items-center justify-between pb-2 border-b border-border-glass">
              <button
                type="button"
                onClick={() => { playPress(700); setActiveTab('browse'); }}
                className="flex items-center gap-1.5 text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Server Browser
              </button>
              {central && (
                <button
                  type="button"
                  onClick={() => { playPress(760); setShowAdmin((v) => !v) }}
                  className="px-1.5 py-1 rounded-md text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer"
                >
                  Central Panel
                </button>
              )}
            </div>

            {/* Current Node Hero */}
           <section className="glass-inset p-4 sm:p-5 space-y-3" aria-label="Server dashboard">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-lg font-bold text-retro-fg">{currentServerTitle || serverName || 'gmatch'}</h2>
                      {serverMode && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-wider bg-surface-interactive border border-border-subtle text-retro-muted">
                          {serverMode}
                        </span>
                      )}
                      {node?.isAdmin && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded font-mono uppercase tracking-wider text-amber-200 border border-amber-400/30 bg-amber-400/10"
                          title="You administer this server"
                        >
                          Admin
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-retro-muted mt-1">
                      {dash ? `${dash.members_total} members · ${dash.posts_24h} posts/24h` : (serverDescription || 'Connected')}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {serverMode === 'client' && (
                    <button
                      type="button"
                      onClick={() => { playPress(620); void leave(); }}
                      className="flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-semibold text-retro-error/80 hover:text-retro-error hover:bg-retro-error/10 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" /> Leave
                    </button>
                  )}
                  {serverMode === 'host' && (
                    <button
                      type="button"
                      onClick={() => {
                        playPress(820);
                        void window.gmatch?.serverState?.()
                          .then((st) => void shareServer(st?.lanUrls?.[0] || '', serverName))
                          .catch(() => void shareServer('', serverName));
                      }}
                      className="flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer"
                    >
                      <Share2 className="w-3 h-3" /> Share
                    </button>
                  )}
                  {node?.isAdmin && (
                    <button
                      type="button"
                      onClick={() => openEditor()}
                      aria-expanded={editingServer}
                      title="Server settings"
                      className="flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" /> Settings
                    </button>
                  )}
                </div>
              </div>

              {/* Inline Editor */}
              {editingServer && (
                <div className="bg-surface-interactive/60 border border-border-glass space-y-2 p-3 rounded-xl">
                  <label className="block text-xs text-retro-muted">
                    Server name
                    <input
                      aria-label="Current server name"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      maxLength={60}
                      className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
                    />
                  </label>
                  <label className="block text-xs text-retro-muted">
                    Description
                    <input
                      aria-label="Current server description"
                      value={serverDescription}
                      onChange={(e) => setServerDescription(e.target.value)}
                      maxLength={200}
                      className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
                    />
                  </label>
                  <label className="block text-xs text-retro-muted">
                    Tags (comma-separated, shown in the browser)
                    <input
                      aria-label="Current server tags"
                      value={hubTags}
                      onChange={(e) => setHubTags(e.target.value)}
                      maxLength={260}
                      placeholder="chill, movies, late-night"
                      className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer">
                    <input type="checkbox" checked={hubPrivate} onChange={(e) => setHubPrivate(e.target.checked)} />
                    Private. Hide from the public browser (friends join with your code)
                  </label>
                  <label className="block text-xs text-retro-muted">
                    New join password (empty keeps the current one)
                    <input
                      type="password"
                      aria-label="New server join password"
                      value={hubNewPassword}
                      onChange={(e) => { setHubNewPassword(e.target.value); if (e.target.value) setHubRemovePassword(false) }}
                      placeholder="At least 4 characters"
                      maxLength={64}
                      className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label="Remove join password"
                      checked={hubRemovePassword}
                      disabled={hubNewPassword.trim().length > 0}
                      onChange={(e) => setHubRemovePassword(e.target.checked)}
                    />
                    Remove the join password
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!serverName.trim() || renaming}
                      onClick={() => void saveServerSettings()}
                      className="glass-action glass-action-primary h-8 px-3 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" /> Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingServer(false)
                        setServerName(node?.name || dash?.name || 'gmatch')
                        setServerDescription(node?.description || '')
                        setHubNewPassword('')
                        setHubRemovePassword(false)
                        setHubTags((node && Array.isArray(node.tags) ? node.tags : []).join(', '))
                      }}
                      className="glass-action h-8 px-2.5 rounded-lg text-xs text-retro-muted cursor-pointer flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Active & Offline Server Members */}
            <section className="glass-inset p-4 space-y-4 overflow-y-auto max-h-[60vh]" aria-label="Server members">
              {/* Online Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-border-glass">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-retro-online shrink-0" />
                    <span className="text-xs font-bold text-retro-fg uppercase tracking-wider font-mono">
                      Online ({typeof dash?.online_count === 'number' ? Math.max(dash.online_count, onlineUsers.length) : onlineUsers.length})
                    </span>
                  </div>
                </div>

                {onlineUsers.length === 0 ? (
                  <div className="text-xs text-retro-muted py-3 text-center italic">
                    No members online right now
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {onlineUsers.map((u) => {
                      const initial = (u.display_name || u.id || '?').charAt(0).toUpperCase()
                      return (
                        <div
                          key={u.id}
                          onClick={() => handleUserClick(u)}
                          className="group flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-interactive/40 border border-border-subtle hover:border-border-strong hover:bg-surface-interactive transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="relative w-8 h-8 rounded-full overflow-hidden bg-surface-raised border border-border-subtle shrink-0 flex items-center justify-center text-xs font-bold text-retro-muted">
                              {u.pfp_url ? (
                                <img src={resolveMediaUrl(u.pfp_url)} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span>{initial}</span>
                              )}
                              <span
                                className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-retro-online ring-1 ring-black"
                                aria-label="online"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-retro-fg truncate group-hover:text-retro-accent transition-colors">
                                {u.display_name || u.id}
                              </div>
                              <div className="text-[10px] text-retro-online truncate font-mono">
                                active now
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] text-retro-muted opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                            profile →
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Offline Section */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-border-glass">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-retro-muted/40 shrink-0" />
                    <span className="text-xs font-bold text-retro-muted uppercase tracking-wider font-mono">
                      Offline ({offlineUsers.length})
                    </span>
                  </div>
                </div>

                {offlineUsers.length === 0 ? (
                  <div className="text-xs text-retro-muted py-3 text-center italic">
                    No offline members recorded
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {offlineUsers.map((u) => {
                      const initial = (u.display_name || u.id || '?').charAt(0).toUpperCase()
                      return (
                        <div
                          key={u.id}
                          onClick={() => handleUserClick(u)}
                          className="group flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface-interactive/20 border border-border-subtle/50 hover:border-border-strong hover:bg-surface-interactive/60 transition-colors cursor-pointer opacity-85 hover:opacity-100"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="relative w-8 h-8 rounded-full overflow-hidden bg-surface-raised border border-border-subtle shrink-0 flex items-center justify-center text-xs font-bold text-retro-muted opacity-75">
                              {u.pfp_url ? (
                                <img src={resolveMediaUrl(u.pfp_url)} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span>{initial}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-retro-fg/90 truncate group-hover:text-retro-accent transition-colors">
                                {u.display_name || u.id}
                              </div>
                              <div className="text-[10px] text-retro-muted truncate font-mono">
                                {formatRelativeTime(u.last_seen)}
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] text-retro-muted opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                            profile →
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          </aside>
        ) : (
          /* BROWSE SERVERS VIEW */
          <section className="flex flex-col min-h-0 h-full overflow-hidden" aria-label="Server directory">
            {!identity && (
              <div className="px-3 py-1.5 bg-surface-interactive/60 border-b border-border-subtle text-xs text-retro-muted shrink-0">
                No account yet. One is created for you on the server you pick.
              </div>
            )}

            {/* ONE list: every server this client knows, the current one first. */}
            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar px-4 py-2">
              {/* A failed directory request never erases servers we already know. */}
              {dirError && serverRows.length > 0 && (
                <div role="status" className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-border-glass bg-glass-w5 text-[10px] text-retro-muted">
                  <span className="min-w-0 flex-1 truncate">
                    Directory unreachable. Showing the last known servers.
                  </span>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="shrink-0 text-retro-fg hover:text-retro-accent underline cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {serverRows.length === 0 && (
                <div className="px-4 py-10 text-center flex flex-col items-center gap-1.5">
                  <p className="text-sm font-semibold text-retro-fg">
                    {dirError ? 'Directory unavailable' : query ? 'No servers match' : 'No servers yet'}
                  </p>
                  <p className="max-w-sm text-[10px] text-retro-muted">
                    {dirError
                      ? `Could not reach ${central || 'the directory'} and nothing is cached for this session.`
                      : query
                        ? <>Nothing matches &ldquo;{query}&rdquo;.</>
                        : 'Join one with a code, or host your own on this computer.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (dirError) void refresh()
                      else if (query) setQuery('')
                      else { playPress(880); setAddWorldOpen(true) }
                    }}
                    className="glass-action glass-action-primary mt-1 h-7 px-2.5 rounded-md text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    {dirError ? <RefreshCw className="w-3 h-3" /> : !query ? <Plus className="w-3 h-3" /> : null}
                    {dirError ? 'Retry' : query ? 'Show all servers' : 'Add server'}
                  </button>
                </div>
              )}

              {serverRows.length > 0 && (
                <ul className="divide-y divide-border-subtle" aria-label="Servers" onKeyDown={onRowListKeyDown}>
                  {serverRows.map((s) => renderRow(s))}
                </ul>
              )}

              {/* Device-local labels are not servers and never join the list;
                  they stay behind one quiet, secondary door. */}
              <div className="mt-3 border-t border-border-subtle pt-2 pb-1">
                <button
                  type="button"
                  onClick={() => { playPress(700); setGroupsOpen(true) }}
                  className="text-[10px] text-retro-muted hover:text-retro-fg cursor-pointer transition-colors"
                >
                  Local groups{labels.length ? ` (${labels.length})` : ''}
                </button>
                <span className="ml-1.5 text-[10px] text-retro-muted/70">· device-only labels, not servers</span>
              </div>
            </div>

            {/* Central master admin drawer */}
            {showAdmin && <CentralAdminPanel central={central} identity={identity} toast={toast} />}

      {askPasswordFor !== null && (
        <PromptDialog
          title="Server password"
          description={`${askPasswordFor} is password-protected. Enter the password the host gave you.`}
          submitLabel="Join"
          onSubmit={(v) => { pendingAsk.current?.(v); pendingAsk.current = null; setAskPasswordFor(null) }}
          onCancel={() => { pendingAsk.current?.(null); pendingAsk.current = null; setAskPasswordFor(null) }}
        />
      )}
      <AddWorldDialog
        open={addWorldOpen}
        onClose={() => setAddWorldOpen(false)}
        onJoinCode={(code) => joinByCode(code)}
        hostForm={hostForm}
      />
      <GroupsDialog
        open={groupsOpen}
        labels={labels}
        ownerId={(identity as { orbitId?: string } | null)?.orbitId}
        onClose={() => setGroupsOpen(false)}
        onSave={(next) => saveLabels(next)}
      />
      {deleteTarget && (
        <Modal title="Delete server" onClose={closeDeleteDialog} maxWidth="max-w-md">
          <div className="space-y-4">
            <p className="text-xs text-retro-muted font-mono truncate">{deleteTarget.name}</p>

            <div className="text-xs text-retro-muted space-y-2">
              <p>
                {mine(deleteTarget)
                  ? 'You own this server. Unregister it from the directory, or just forget it here.'
                  : 'You do not own this server. Enter the Central Admin Passcode to delete it from the directory, or forget it here.'}
              </p>

              {!mine(deleteTarget) && (
                <div className="space-y-1.5 pt-1">
                  <label className="block text-[10px] font-semibold text-retro-fg">
                    Central Admin Passcode
                  </label>
                  <input
                    type="password"
                    aria-label="Central admin passcode"
                    value={deletePasscode}
                    onChange={(e) => setDeletePasscode(e.target.value)}
                    placeholder="Enter central passcode (e.g. 1984)"
                    className="glass-field w-full px-3 py-2 text-xs font-mono"
                  />
                  <p className="text-[10px] text-retro-muted">
                    Required when deleting a server created by another identity, or while unauthenticated.
                  </p>
                </div>
              )}

              {deleteError && (
                <p role="alert" className="text-xs text-retro-error bg-retro-error/10 border border-retro-error/20 p-2 rounded-lg font-mono">
                  {deleteError}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => forgetLocalServer(deleteTarget)}
                className="glass-action px-3 py-1.5 rounded-lg text-xs font-semibold text-retro-muted cursor-pointer"
              >
                Forget from local list
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  className="glass-action px-3 py-1.5 rounded-lg text-xs font-semibold text-retro-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDeleteConfirm()}
                  className="glass-action glass-action-danger px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5"
                >
                  {deleting ? 'Deleting…' : (mine(deleteTarget) ? 'Unregister & Delete' : 'Permanently Delete')}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
          </section>
        )}
      </div>
    </div>
  )
}
