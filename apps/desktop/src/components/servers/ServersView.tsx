"use client";

// Servers view (plan T3/T4, docs/ADR-002-servers.md). A "server" is a full
// gMatch node; a courier only moves envelopes and directory rows. One page, one
// list, one row per server: the node on this machine, servers someone shared,
// and the admin's built-in "gmatch Node" all share the same row. A courier that
// hosts no world is infrastructure, not a destination, so it is not a row.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { Lock, Globe, ShieldCheck, RefreshCw, Pencil, Check, X, Search, Share2, ArrowLeft, ChevronRight, Plus, Trash2, Copy } from 'lucide-react'
import { generateIdentity } from '@orbit/crypto'
import { getCentralApiUrl, setCentralApiUrl } from '../../utils/central'
import { rememberKnownNodeHint } from '../../utils/peerNodes'
import { orbitFetch, getApiBaseUrl, isCourierApiUrl, LOCAL_NODE_BASE } from '../../utils/api'
import { normalizeServerUrl, isCurrentServerUrl } from '../../utils/serverUrl'
import { pickShareableHint } from '../../utils/serverAddress'
import { joinServer } from '../../utils/join-server'
import { switchClientWorld } from '../../utils/server-switch'
import { rememberPendingHost } from '../../utils/server-host-pending'
import { mergeDirectory, dedupeServers, serverKey, readDirectoryCache, writeDirectoryCache, isDroppedDirectoryRow, OFFICIAL_NODE_NAME } from './directoryMerge'
export { OFFICIAL_NODE_NAME }
import { readLabels, writeLabels, type LocalMeshLabel } from './meshLabels'
import { decodeNodeMask } from '../../utils/nodeMask'
import { buildNodeCode } from '../../utils/nodeShare'
import { PromptDialog } from '../PromptDialog'
import { Button, Checkbox, Input, Modal } from '../../ui/kit'
import { ContextMenu } from '../ui/ContextMenu'
import { AddWorldDialog } from './AddWorldDialog'
import { GroupsDialog } from './GroupsDialog'
import { WorldRow, WorldMenuItem, BROWSER_COLUMNS, formatRelativeTime } from './WorldRow'
import type { WorldRowState } from './WorldRow'
import { claimPendingHost } from '../../hooks/usePendingServerHost'
import { SERVER_MARKER_KEY } from '../../firstRun/onboardingState'
import { playPress } from '../../utils/sounds'
import { resolveMediaUrl } from '../../utils/media'
import { CentralAdminPanel } from './CentralAdminPanel'
import { subscribeApiBase } from '../../utils/api'
import type { PeerRoster } from '../../utils/peerRoster'
import type { User } from '@orbit/shared'
import {
  classes, CHROME, COLOR, DIALOG_WIDTH, FEEDBACK, GAP, ICON, LAYOUT, MONO,
  MOTION, PADDING, PADDING_SM, PADDING_X, PADDING_Y, PRESENCE, RADIUS,
  STATUS, TRACKING, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens'

/** SURFACE + TYPOGRAPHY chrome shared by this view's panels, banners and
 *  headers. Connectivity/join/delivery logic is untouched — only these names. */
const FORM_LABEL = classes('block', TYPE.body, COLOR.muted)
const FORM_INPUT = classes('mt-1')
const FORM_FIELD = classes('w-full', MONO)
/** One compact, single-line search shell — the chat search's py-1.5 height on
 *  the raised plate. No glass tier, no fixed height, no tall block. */
const SEARCH_SHELL = classes(
  CHROME.tile, 'flex items-center', GAP[1], PADDING_X[2.5], PADDING_Y[1.5], TYPE.body, COLOR.fg,
)

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
  /** How this node is reached from the LAN (the node's own report). */
  lanUrls?: string[]
  /** Host-only since 1.6.8: every node hosts a world. */
  mode?: string
}

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

const DIRECTORY_ID_KEY = 'gmatch.server.directoryId'
// Claim marker: this install has created (and therefore hosts) a server. The
// heartbeat replays this registration while in host mode; its presence also
// blocks a second Create (one server per install — use Rename instead).
const REG_KEY = 'gmatch.server.register'

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
    return `${online} online · ${total} members`
  }

  if (typeof s.online_count === 'number' && typeof s.user_count === 'number') {
    return `${s.online_count} online · ${s.user_count} members`
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
  p2pPeers = [],
  roster,
  onWorldSwitch,
}: {
  identity: Parameters<typeof orbitFetch>[2] | null
  toast: Toast
  onSelectUser?: (user: User) => void
  profilePics?: Record<string, string>
  onServerJoined?: (server: DirectoryServer) => void
  /** Fired when a switch commits, so the shell can show the world-switch
   *  loading screen and remount once the new node answers health. */
  onWorldSwitch?: (target: { name: string; url: string; worldId?: string }) => void
  /** Live P2P roster (signed presence beacons). Peers on OTHER nodes never
   *  appear in this node's dashboard, so without this the hub shows "nobody
   *  online" while the swarm is actually alive. */
  p2pPeers?: User[]
  /** THE one online roster. The dashboard's "Online (N)" reads this projection
   *  instead of re-counting a node snapshot that can disagree with the island. */
  roster?: PeerRoster
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
  type ServerBridgeState = { packaged: boolean; mode: 'host' | 'client'; url: string; lanUrls: string[]; nodeOwnerId?: string | null; pausedUrl?: string; pausedReason?: 'legacy' | 'unreachable' }
  const [hostState, setHostState] = useState<ServerBridgeState | null>(null)
  const [activeTab, setActiveTab] = useState<'browse' | 'hub'>('browse')
  const [deleteTarget, setDeleteTarget] = useState<DirectoryServer | null>(null)
  const [deletePasscode, setDeletePasscode] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // Right-click uses the ONE shared menu, fed by the same row actions.
  const [rowContext, setRowContext] = useState<{ at: { x: number; y: number }; actions: Array<{ label: string; icon?: React.ReactNode; danger?: boolean; run: () => void }> } | null>(null)
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


  // There is no built-in world any more: a fresh install runs its OWN node
  // (packaged sidecar) and finds others through the directory. The retired
  // Pages origin is a static release page, never a destination
  // (isCourierApiUrl guards the switch paths), so it is not listed as a row
  // either.


  // Mirror the connected server into the dev-proxy cookie so browser /api
  // traffic follows it. The Pages origin is a STATIC PAGE, not a data node
  // (it 404s every stateful route), so it is never written to
  // `gmatch.api.url` — doing so pointed the data API at it and 404'd every
  // lobby/feed poll, in dev and in the packaged app alike. A cookie left by
  // an older build is expired here too: the dev proxy honours it and would
  // keep answering 503.
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

    // Anonymous browser: public directory only — never touch node routes
    // (no ID yet, nothing to sign with).
    if (!identity) {
      if (!central) { setServers(readDirectoryCache(getApiBaseUrl())); setDirError(false); return }
      try {
        const res = await orbitFetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, null)
        if (res.ok) {
          const data = (await res.json()) as { servers: DirectoryServer[] }
          const merged = mergeDirectory(readDirectoryCache(getApiBaseUrl()), Array.isArray(data.servers) ? data.servers : [])
          writeDirectoryCache(merged, getApiBaseUrl())
          setServers(merged)
          setDirError(false)
        } else {
          setDirError(true)
        }
      } catch {
        setServers(readDirectoryCache(getApiBaseUrl()))
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
    let merged = readDirectoryCache(getApiBaseUrl())
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
    merged = merged.filter((s) => !isCourierApiUrl(s.endpoint_hint))
    // Every node the directory knows becomes a node we can read beacons from
    // (and drop sealed envelopes into) — the discovery path for peers that
    // live on another machine.
    for (const s of merged) rememberKnownNodeHint(s.endpoint_hint)
    writeDirectoryCache(merged, getApiBaseUrl())
    setServers(merged)
    setDirError(dirFailed)
  }, [identity, central])

  useEffect(() => { refreshRef.current = refresh }, [refresh])

  useEffect(() => {
    try {
      // Purge every non-destination from the cache at boot — synthetic rows,
      // stale listings past the 24h TTL and fake official/brand duplicates.
      // readDirectoryCache already filters; this writes the cleaned list back
      // so a stale mirror cannot keep resurrecting a row the filter hides.
      const cached = readDirectoryCache(getApiBaseUrl()).filter((s) => !isDroppedDirectoryRow(s))
      writeDirectoryCache(cached, getApiBaseUrl())
      if (localStorage.getItem(DIRECTORY_ID_KEY)?.startsWith('central-')) localStorage.removeItem(DIRECTORY_ID_KEY)
      const regRaw = localStorage.getItem(REG_KEY)
      if (regRaw) {
        try {
          const parsed = JSON.parse(regRaw)
          // Only an address nobody else can dial retires the claim: the old
          // auto-registration pointed at THIS machine's loopback sidecar (or
          // at the courier), so no friend could ever join it. A LAN address
          // is joinable and stays — otherwise the listing would silently die
          // on the next boot.
          if (isLocalHint(parsed.endpoint_hint) || isCourierApiUrl(parsed.endpoint_hint)) {
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
      })
      .catch(() => setServerMode(null))
  }, [])

  const saveCentral = () => {
    const raw = setupUrl.trim()
    // Empty means "no shared hub": the own node is the directory. That is the
    // gmatch 2.0 default — nothing hosted holds a row or a mailbox for this
    // install unless the user asks for a shared rendezvous point.
    if (!raw) {
      setCentralApiUrl('')
      setCentral('')
      setSetupError('')
      setSetupUrl('')
      toast('Directory disabled — this node is the directory.', 'info')
      void refresh()
      return
    }
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
    // Browser dev rides the Vite proxy: the base is relative, and the node it
    // proxies is the local sidecar. Without this the Servers tab would show no
    // row for the machine the app is actually talking to.
    if (isDev) return LOCAL_NODE_BASE
    return ''
  }, [getEffectiveServerUrl, apiBaseTick, central])

  const isOwnNode = (s: DirectoryServer) => s.id.startsWith('self:')

  /**
   * Is the node we are talking to OURS? A packaged client on a friend's node
   * must not render that node as "This computer" or swallow its directory row
   * as if the two addresses were the same machine. The bridge knows the mode;
   * a browser build has no bridge and rides this machine's dev node.
   */
  const weHostThisNode = useMemo(() => {
    if (serverMode) return serverMode === 'host'
    if (hostState) return hostState.mode === 'host'
    // Browser/dev has no bridge: the Vite proxy node is this machine, so the
    // legacy surface keeps its own-row. A PACKAGED client (`mode: 'client'`)
    // is the case that must never claim the friend's node as "This computer".
    return true
  }, [serverMode, hostState])

  /**
   * A node that hosts a world IS a server, whoever runs it — including the one
   * on this machine. It appears once, in its normal position in the list, keyed
   * by its address so it collapses with its own directory record instead of
   * being repeated as a separate current-world card.
   */
  const ownServer: DirectoryServer | null = useMemo(() => {
    if (!identity || !nodeUrl || !weHostThisNode) return null
    const dashUsers = Array.isArray(dash?.users) ? dash.users : []
    return {
      id: `self:${nodeUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()}`,
      // This install's own node is ALWAYS the canonical, official world — one
      // row, one name, whatever the host later renames the directory listing to.
      name: OFFICIAL_NODE_NAME,
      description: node?.description || serverDescription || '',
      owner_id: (identity as unknown as { orbitId?: string }).orbitId || '',
      password_required: 0,
      is_private: 0,
      endpoint_hint: nodeUrl,
      online_count: typeof dash?.online_count === 'number' ? dash.online_count : dashUsers.filter((u) => u.online).length,
      user_count: typeof dash?.members_total === 'number' ? dash.members_total : dashUsers.length,
      last_seen: new Date().toISOString(),
    }
  }, [identity, nodeUrl, node, dash, serverDescription, weHostThisNode])

  const visibleServers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return servers.filter((s) => {
      // Dead listings, synthetic rows and fake official/brand duplicates are
      // never destinations (the same predicate purges the cache at boot and
      // rejects fresh answers; this render check is defence in depth).
      if (isDroppedDirectoryRow(s)) return false
      // A blind courier is infrastructure, never a destination: a stale
      // directory mirror of it is never a row.
      if (isCourierApiUrl(s.endpoint_hint)) return false
      // A localhost row is a real destination only for the node on THIS machine;
      // someone else's localhost is not joinable from here.
      if (!mine(s) && isLocalHint(s.endpoint_hint)) return false
      if (!q) return true
      return `${s.name} ${s.description ?? ''} ${s.endpoint_hint ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q)
    })
  }, [servers, query, apiBaseTick, identity])

  // ONE list: the node on this machine plus every world the directory knows,
  // deduped by address. The committed server sorts first.
  const serverRows: DirectoryServer[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (s: DirectoryServer) =>
      !q || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q)
    const listed = dedupeServers([...visibleServers])
    // Every address that belongs to THIS machine (loopback + the node's own
    // LAN URLs). A directory row pointing at one of them is the same node the
    // synthetic own-row already represents — one machine, ONE row, never two.
    // The connected base only counts as "this machine" when we are hosting it;
    // a client connected to a friend's node must not swallow that friend's row.
    const selfHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
    const lanUrls = weHostThisNode ? [...(hostState?.lanUrls ?? []), ...(node?.lanUrls ?? [])] : []
    // Host mode with no measured LAN list: the bridge's own URL is still this
    // machine. Never the committed base — a client joined to a friend's node
    // must not swallow that friend's row. The friend's node reports ITS LAN
    // URLs on /node, so those must not enter the self-host set in client mode.
    if (weHostThisNode && !lanUrls.length && hostState?.mode === 'host' && hostState.url) lanUrls.push(hostState.url)
    for (const u of lanUrls) {
      if (!u) continue
      try { selfHosts.add(new URL(u).hostname.toLowerCase()) } catch { /* not a URL */ }
    }
    const hostOf = (hint?: string): string => {
      if (!hint) return ''
      try { return new URL(hint.includes('://') ? hint : `http://${hint}`).hostname.toLowerCase() } catch { return '' }
    }
    const deduped = ownServer
      ? listed.filter((s) => !selfHosts.has(hostOf(s.endpoint_hint)))
      : listed
    // The node on this machine IS a server even when the directory does not
    // list it. Its own directory record wins when there is one (that is the
    // name it registered under); the synthetic row is only the fallback.
    const ownListed = !!ownServer && matches(ownServer)
      && !deduped.some((s) => serverKey(s) === serverKey(ownServer))
    const rows = ownListed ? [...deduped, ownServer!] : deduped
    return rows.sort((a, b) => {
      // The connected world first, then by measured population.
      const rank = (s: DirectoryServer) => (isCurrent(s) ? 0 : 1)
      const ac = rank(a)
      const bc = rank(b)
      if (ac !== bc) return ac - bc
      return (b.online_count ?? -1) - (a.online_count ?? -1) || a.name.localeCompare(b.name)
    })
  }, [ownServer, visibleServers, query, apiBaseTick, hostState, node, nodeUrl, weHostThisNode])

  const currentServerTitle = useMemo(() => {
    const apiBase = getEffectiveServerUrl()
    // A courier is transport, not a world; the title says so instead of
    // pretending the directory is a place to play.
    if (isCourierApiUrl(apiBase)) return 'Courier'
    const matched = servers.find((s) => isCurrentServerUrl(apiBase, s.endpoint_hint || ''))
    if (matched?.name) return matched.name
    return serverName || 'Hub'
  }, [servers, serverName, getEffectiveServerUrl])

  /** No per-row type label: the official own node is marked by its logo +
   *  Verified chip, and every other row is just a hosted world (the norm). */
  const kindFor = (_s: DirectoryServer): WorldRowState['kind'] => undefined

  /** Secondary line: what a row is, plus what the directory actually told us.
   *  Never an address — that owns its own column — a transport, or a diagnostic. */
  const metaFor = (s: DirectoryServer, isCurrentServer: boolean): string => {
    const bits: string[] = []
    const desc = (s.description || '').trim()
    if (isOwnNode(s)) bits.push(serverMode === 'host' ? 'hosted on this computer' : 'this computer')
    else if (s.is_private && !desc) bits.push('private, join by code')
    if (desc) bits.push(desc.length > 72 ? `${desc.slice(0, 71)}…` : desc)
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
  /**
   * A row is "verified" only when its identity is proven: this install's own
   * node is always official/verified; any OTHER node earns the chip only by
   * carrying a signed directory entry (a real `owner_id` from the node's signed
   * `/api/servers`), never a pasted `mask:` code (empty owner) or a synthetic
   * row. An unproven row never shows verified.
   */
  const isVerifiedRow = (s: DirectoryServer): boolean => {
    if (isOwnNode(s)) return true
    if (s.id.startsWith('mask:')) return false
    return !!s.owner_id && s.owner_id.trim().length > 0
  }

  const rowStateFor = (
    s: DirectoryServer,
    opts: { connecting: boolean },
  ): WorldRowState => {
    const isCurrentServer = isCurrent(s)
    const base: WorldRowState = {
      counts: rowCounts(s, isCurrentServer, dash),
      meta: metaFor(s, isCurrentServer),
      kind: kindFor(s),
      verified: isVerifiedRow(s),
      official: isOwnNode(s),
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
      // One server per install: this machine already hosts its own node. A
      // browser build has no bridge to ask, but the node it talks to IS this
      // machine's — so the same guard applies there.
      if (claimedBefore && (st?.mode === 'host' || !st)) {
        toast(`This computer already hosts “${serverName || 'a server'}”. Rename it on the left instead.`, 'warning')
        return
      }
      const canHost = Boolean(window.gmatch?.serverSet && st?.packaged)
      // The addresses this node answers on. The bridge knows them; without it
      // the NODE knows them (it binds 0.0.0.0 and owns the port) and says so
      // on GET /api/servers/node.
      let lanUrls = st?.lanUrls ?? []
      if (!lanUrls.length) {
        try {
          const n = await orbitFetch('/api/servers/node', { method: 'GET' }, identity)
          if (n.ok) {
            const nj = (await n.json()) as ServerNode
            lanUrls = nj.lanUrls ?? []
          }
        } catch { /* node without the route */ }
      }
      const hintFinal = hint.trim() || pickShareableHint(lanUrls)
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
      // Browser/dev build without the desktop bridge: the node on this machine
      // IS the world — list it so other players can find and join it.
      if (!central && !getApiBaseUrl()) { toast('No node to list this server on. Hosting runs in the desktop app.', 'warning'); return }
      // Claim marker first: even if the request below dies, the heartbeat
      // replays this registration once the directory answers again.
      try {
        localStorage.setItem(REG_KEY, JSON.stringify({
          name: trimmed, description: desc, endpoint_hint: hintFinal, password_required: needsPassword, private: isPrivate,
        }))
      } catch { /* session-only */ }
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

  // A committed client switch is a world change: raise the shell's loading
  // screen so the app remounts into the new world's data once its node answers.
  const announceSwitch = (s: DirectoryServer) => {
    const raw = (s.endpoint_hint || '').trim()
    const url = normalizeServerUrl(raw) || normalizeServerUrl(`http://${raw}`) || raw
    if (url) onWorldSwitch?.({ name: s.name, url })
  }

  // Switch = join another node, or hop back to this machine's own host node.
  const switchTo = async (s: DirectoryServer) => {
    if (connectingId) return
    setConnectingId(s.id)
    try {
      if (!mine(s)) {
        const out = await joinServer(s, toast, askPassword, identity)
        if (out === 'connected') {
          onServerJoined?.(s)
          announceSwitch(s)
        }
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
    // A blind courier is transport status, not a world — there is no data
    // base to join (pointing data traffic at it 404s by design).
    if (isCourierApiUrl(s.endpoint_hint)) {
      toast('That is the courier (directory + mail), not a world. Pick a server.', 'info')
      return
    }
    if (s.id === 'central-p2p') {
      toast('The relay is transport, not a world. Pick a server below.', 'info')
      return
    }
    setConnectingId(s.id)
    try {
      if (
        s.id === 'central-p2p' ||
        s.id === 'central-node' ||
        (s.endpoint_hint && s.endpoint_hint === central)
      ) {
        const rawTarget = s.endpoint_hint || central
        const target = normalizeServerUrl(rawTarget) || normalizeServerUrl('http://' + rawTarget) || rawTarget
        if (!window.gmatch?.serverSet) {
          // Browser dev has no in-app commit: a full reload applies the base,
          // so the persistence must be written BEFORE it (the only path that
          // may write before a probe).
          setCentralApiUrl(target)
          setCentral(target)
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
        // Packaged bridge path: probe-then-commit in-app. Writing the marker,
        // override or cookie HERE would snapshot the new world as "previous"
        // inside switchClientWorld — a refused serverSet then restored the new
        // pointer instead of the old one, so the next launch dialed a world
        // that had never accepted us. switchClientWorld is the only writer.
        const out = await switchClientWorld(
          { name: s.name, endpointHint: target, passwordRequired: s.password_required === 1 },
          { toast, identity: identity as unknown as { orbitId: string } | null, askPassword },
        )
        if (out === 'switched') {
          setCentralApiUrl(target)
          setCentral(target)
          toast(`Connected to ${s.name}.`, 'success')
          onServerJoined?.(s)
          // A committed switch is a world change: the shell raises the loading
          // screen and remounts once this world's node answers health.
          onWorldSwitch?.({ name: s.name, url: target })
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
      const out = await joinServer(s, toast, askPassword, identity)
      if (out === 'connected') {
        onServerJoined?.(s)
        announceSwitch(s)
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
    writeDirectoryCache(mergeDirectory(readDirectoryCache(getApiBaseUrl()), [serverObj]), getApiBaseUrl())
    const res = await joinServer(serverObj, toast, askPassword, identity)
    if (res === 'connected') {
      onServerJoined?.(serverObj)
      announceSwitch(serverObj)
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
      const cached = readDirectoryCache(getApiBaseUrl()).filter((item) => item.id !== s.id)
      writeDirectoryCache(cached, getApiBaseUrl())
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
  const onlineUsers = useMemo(() => {
    const roster = allUsers.filter((u) => u.online)
    // P2P peers (other nodes) join the roster: deduped by id, dashboard rows win.
    const seen = new Set(roster.map((u) => u.id))
    const swarm = p2pPeers.filter((p) => p.online !== false && p.id !== identity?.orbitId && !seen.has(p.id))
    return [...roster, ...swarm]
  }, [allUsers, p2pPeers, identity?.orbitId])
  const offlineUsers = useMemo(() => allUsers.filter((u) => !u.online), [allUsers])

  const handleUserClick = (u: DashboardUser | User) => {
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

    // ONE list of actions drives both the ⋯ popover and the right-click menu.
    // They can never drift because there is only one definition.
    type RowAction = { label: string; icon?: ReactNode; title?: string; danger?: boolean; run: () => void }
    const rowActions: RowAction[] = []
    if (isCurrentServer && identity) rowActions.push({
      label: 'Open dashboard', icon: <Globe className="w-3 h-3" />, title: 'Members, invites and settings',
      run: () => { playPress(700); setOpenMenuId(null); setActiveTab('hub') },
    })
    if (isCurrentServer && node?.isAdmin) rowActions.push({
      label: 'Server settings', icon: <Pencil className="w-3 h-3" />, title: 'Server settings',
      run: () => { openEditor(); setOpenMenuId(null); setActiveTab('hub') },
    })
    if (isCurrentServer && serverMode === 'host') rowActions.push({
      label: 'Copy share code', icon: <Share2 className="w-3 h-3" />, title: 'Copy node code',
      run: () => {
        setOpenMenuId(null)
        playPress(820)
        void window.gmatch?.serverState?.()
          .then((st) => void shareServer(st?.lanUrls?.[0] || '', serverName))
          .catch(() => void shareServer('', serverName))
      },
    })
    if (!isCurrentServer && s.endpoint_hint) rowActions.push({
      label: 'Copy server code', icon: <Share2 className="w-3 h-3" />, title: 'Copy node code',
      run: () => { playPress(820); void shareServer(s.endpoint_hint || '', s.name); setOpenMenuId(null) },
    })
    if (isMyServer && !isCurrentServer) rowActions.push({
      label: s.is_private ? 'Make public' : 'Make private', icon: <Lock className="w-3 h-3" />,
      run: () => { playPress(740); void setPrivate(s, !s.is_private); setOpenMenuId(null) },
    })
    if (isMyServer && !isCurrentServer) rowActions.push({
      label: 'unregister', icon: <Trash2 className="w-3 h-3" />,
      run: () => { void unregister(s); setOpenMenuId(null) },
    })
    if (!isCurrentServer && !isMyServer) rowActions.push({
      label: 'Delete / Forget', icon: <Trash2 className="w-3 h-3" />, danger: true,
      run: () => { setDeleteTarget(s); setDeleteError(''); setDeletePasscode(''); setOpenMenuId(null) },
    })

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
        menuItems={rowActions.map((a, i) => (
          <WorldMenuItem key={`${a.label}-${i}`} icon={a.icon} label={a.label} title={a.title} danger={a.danger} onClick={a.run} />
        ))}
        onContextMenu={(e) => {
          if (rowActions.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          setOpenMenuId(null)
          setRowContext({ at: { x: e.clientX, y: e.clientY }, actions: rowActions })
        }}
      />
    )
  }

  /** The host form — handed to the Add server dialog so hosting has one door. */
  const hostForm = identity ? (
    <div className="space-y-3">
      <p className={classes(TYPE.body, COLOR.muted)}>
        This machine becomes the server: you are logged into it (and off the node
        you were connected to) automatically, and you are its admin. Friends join
        from the address below.
      </p>
      <div className={classes('grid grid-cols-1 sm:grid-cols-2', GAP[3])}>
        <label className={FORM_LABEL}>
          Server name
          <Input aria-label="Server name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            className={FORM_INPUT} />
        </label>
        <label className={FORM_LABEL}>
          Advanced address override (optional)
          <Input aria-label="Address hint" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} placeholder=""
            className={classes(FORM_INPUT, FORM_FIELD)} />
        </label>
      </div>
      {(() => {
        const preview = buildNodeCode(hint.trim() || pickShareableHint(hostState?.lanUrls ?? node?.lanUrls ?? []), name.trim())
        return preview ? (
          <div data-testid="create-handle-preview" className={classes(
            'flex items-center justify-between', CHROME.tile,
            PADDING_X[3], PADDING_Y[2], GAP[2], TYPE.caption, MONO, COLOR.muted,
          )}>
            <span className="min-w-0 truncate">{preview.slice(0, 28)}…</span>
            <Button variant="link" size="sm" onClick={() => void navigator.clipboard.writeText(preview)}>Copy code</Button>
          </div>
        ) : <p className={classes(TYPE.body, COLOR.muted)}>Type a name to get your share code.</p>
      })()}
      <label className={FORM_LABEL}>
        Description (public)
        <Input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
          className={FORM_INPUT} />
      </label>
      <label className={classes('flex items-center cursor-pointer py-0.5', GAP[2], TYPE.body, COLOR.muted)}>
        <Checkbox checked={needsPassword} onChange={(e) => setNeedsPassword(e.target.checked)} />
        Ask visitors for a join password
      </label>
      <label className={classes('flex items-center cursor-pointer py-0.5', GAP[2], TYPE.body, COLOR.muted)}>
        <Checkbox aria-label="Private server" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Private. Hide from the public browser (friends join with your code)
      </label>
      {needsPassword && (
        <Input
          type="password"
          aria-label="Server join password"
          value={serverPassword}
          onChange={(e) => setServerPassword(e.target.value)}
          placeholder="At least 4 characters"
          maxLength={64}
          className={FORM_FIELD}
        />
      )}
      <div className={classes('flex pt-1', GAP[2])}>
        <Button variant="primary" size="sm" disabled={!name.trim() || busy} onClick={() => void create()}>
          {busy ? '…' : 'Create'}
        </Button>
        <Button variant="ghost" size="sm" onClick={closeCreateForm}>Cancel</Button>
      </div>
    </div>
  ) : undefined

  return (
    <div className={classes(
      'h-full min-h-0 flex-1 overflow-hidden flex flex-col items-center',
      MOTION.keyframe.fadeIn, PADDING[2],
    )}>
      {/* One narrow column on the page background: no card wrapping the list. */}
      <div className="flex flex-col h-full min-h-0 flex-1 w-full max-w-[720px] overflow-hidden">
        {/* One page header: one title, one primary action, a quiet search. */}
        <div className={classes(CHROME.barHeader, 'border-0 border-b rounded-none', GAP[2])}>
          <div className="min-w-0 shrink-0">
            <h1 className={classes(TYPE.sub, WEIGHT.bold, COLOR.fg, 'leading-tight truncate text-balance')}>
              {activeTab === 'hub' ? 'Hub' : 'Servers'}
            </h1>
            {activeTab === 'hub' && (
              <p className={classes(TYPE.caption, COLOR.muted, 'truncate')}>Members, invites and settings</p>
            )}
            {activeTab === 'browse' && (
              <p className={classes(TYPE.caption, COLOR.muted, 'truncate')}>
                Each server is its own world — separate posts, members and media.
              </p>
            )}
          </div>

          {activeTab === 'browse' && (
            <div className={classes(SEARCH_SHELL, 'ml-1 min-w-0 max-w-[13rem] flex-1')}>
              <Search className={classes(ICON.sm, COLOR.muted)} aria-hidden />
              <Input
                bare
                aria-label="Search servers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search servers…"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className={classes(CHROME.iconButton, 'shrink-0')}
                >
                  <X className={ICON.sm} />
                </button>
              )}
            </div>
          )}

          <div className={classes('ml-auto flex items-center shrink-0', GAP[1.5])}>
            {/* Directory: the central address, the dev switch and the admin door
                live together, out of the way of the everyday action. */}
            <div className="relative">
              <button
                type="button"
                data-menu-trigger
                aria-expanded={showCentralPopover}
                onClick={() => { playPress(760); setShowCentralPopover((v) => !v) }}
                aria-label="Directory options"
                className={classes('flex size-8 items-center justify-center', CHROME.iconButton)}
                title={central ? `Directory: ${central.replace(/^https?:\/\//, '')}` : 'Directory'}
              >
                <Globe className={ICON.md} />
              </button>

              {showCentralPopover && (
                <div
                  data-menu-content
                  className={classes(
                    'absolute right-0 top-full mt-2 w-72 z-[var(--z-dropdown)] space-y-2.5',
                    CHROME.popover, MOTION.keyframe.fadeIn,
                  )}
                >
                  <div className={classes('flex items-center justify-between border-b', COLOR.edgeSubtle, 'pb-1.5')}>
                    <span className={CHROME.headerTitle}>Directory</span>
                    <button
                      type="button"
                      onClick={() => setShowCentralPopover(false)}
                      aria-label="Close directory menu"
                      className={CHROME.iconButton}
                    >
                      <X className={ICON.sm} />
                    </button>
                  </div>
                  <p className={classes(TYPE.caption, COLOR.muted)}>
                    Empty means your own node is the directory. Set one only if
                    you want a shared rendezvous point.
                  </p>
                  <div className={classes('flex items-center', GAP[1.5])}>
                    <Input
                      aria-label="Central node URL"
                      value={setupUrl || (central || '')}
                      onChange={(e) => setSetupUrl(e.target.value)}
                      placeholder="http://192.168.1.10:8790"
                      className={classes('flex-1', MONO)}
                    />
                    <Button variant="primary" size="sm" onClick={() => { saveCentral(); setShowCentralPopover(false); }}>
                      Save
                    </Button>
                  </div>
                  {setupError && <p role="alert" className={classes(TYPE.caption, STATUS.danger)}>{setupError}</p>}
                  {isDev && (
                    <div className={classes('pt-1 border-t flex items-center justify-between', COLOR.edgeSubtle)}>
                      <span className={classes(TYPE.caption, COLOR.muted, MONO)}>Dev switch:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCentralApiUrl('http://127.0.0.1:8790')
                          setCentral('http://127.0.0.1:8790')
                          toast('Switched to local 8790', 'info')
                          void refresh()
                        }}
                        className={classes(
                          PADDING_X[1.5], 'py-0.5', RADIUS.chip, TYPE.caption, MONO, 'cursor-pointer',
                          central === 'http://127.0.0.1:8790'
                            ? classes(COLOR.accentBg, COLOR.onAccent, WEIGHT.bold)
                            : classes(COLOR.glassW20, COLOR.muted, COLOR.hoverFg),
                        )}
                      >
                        local:8790
                      </button>
                    </div>
                  )}
                  {central && !isCourierApiUrl(central) && (
                    <button
                      type="button"
                      onClick={() => { setShowCentralPopover(false); playPress(760); setShowAdmin((v) => !v) }}
                      aria-label="Central admin panel"
                      className={classes(
                        'w-full pt-2 border-t text-left cursor-pointer', COLOR.edgeSubtle,
                        GAP[2], TYPE.body, COLOR.muted, COLOR.hoverFg, TRANSITION.micro,
                      )}
                    >
                      <ShieldCheck className={ICON.sm} /> Central admin panel
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
              className={classes(CHROME.iconButton, 'flex size-8 items-center justify-center')}
            >
              <RefreshCw className={classes(ICON.sm, refreshing ? 'animate-spin' : '')} />
            </button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => { playPress(880); setAddWorldOpen(true) }}
              aria-label="Add server"
              title="Join with a code, or host a server on this computer"
              className={GAP[1]}
            >
              <Plus className={ICON.sm} /> Add server
            </Button>
          </div>
        </div>

        {activeTab === 'hub' && identity ? (
          <aside className={classes(
            'flex flex-col min-h-0 h-full overflow-y-auto styled-scrollbar mx-auto max-w-4xl',
            LAYOUT.full, PADDING[4], PADDING_SM[6], 'space-y-4',
          )} aria-label="Current server hub">
            {/* Top Navigation */}
            <div className={classes('flex items-center justify-between pb-2 border-b', COLOR.edge)}>
              <button
                type="button"
                onClick={() => { playPress(700); setActiveTab('browse'); }}
                className={classes(
                  'flex items-center cursor-pointer', GAP[1.5], TYPE.body, WEIGHT.bold,
                  COLOR.muted, COLOR.hoverFg, TRANSITION.micro,
                )}
              >
                <ArrowLeft className={ICON.sm} /> Back to Server Browser
              </button>
              {central && (
                <Button variant="ghost" size="sm" onClick={() => { playPress(760); setShowAdmin((v) => !v) }}>
                  Central Panel
                </Button>
              )}
            </div>

            {/* Current Node Hero */}
            <section className={classes(CHROME.statTile, 'space-y-3')} aria-label="Server dashboard">
              <div className={classes('flex flex-wrap items-start justify-between', GAP[3])}>
                <div className={classes('flex min-w-0 items-center', GAP[3])}>
                  <div className="min-w-0">
                    <div className={classes('flex items-center', GAP[2])}>
                      <h2 className={classes('truncate text-balance', TYPE.display, WEIGHT.heading, TRACKING.tighter, COLOR.fg)}>{currentServerTitle || serverName || 'gmatch'}</h2>
                      {serverMode && (
                        <span className={classes(
                          PADDING_X[2], 'py-0.5', RADIUS.chip, MONO, 'uppercase', TRACKING.wider,
                          COLOR.interactive, 'border', COLOR.edgeSubtle, TYPE.caption, COLOR.muted,
                        )}>
                          {serverMode}
                        </span>
                      )}
                      {node?.isAdmin && (
                        <span
                          className={classes(
                            PADDING_X[2], 'py-0.5', RADIUS.chip, 'border uppercase', TRACKING.wider,
                            TYPE.caption, STATUS.warning, STATUS.warningEdge, STATUS.warningBg,
                          )}
                          title="You administer this server"
                        >
                          Admin
                        </span>
                      )}
                    </div>
                    <p className={classes(TYPE.body, COLOR.muted, 'mt-1')}>
                      {dash ? `${dash.members_total} members · ${dash.posts_24h} posts/24h` : (serverDescription || 'Connected')}
                    </p>
                    {/* The one line that says WHERE this world lives and that
                        it is actually reachable — copied with one click. */}
                    {(() => {
                      const addr = serverMode === 'client'
                        ? hostState?.url || ''
                        : (hostState?.lanUrls?.[0] || hostState?.url || '')
                      if (!addr) return null
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(addr)
                            toast('Address copied — send it to a friend', 'success')
                          }}
                          title="Copy address"
                          className={classes(
                            'mt-1 inline-flex items-center cursor-pointer', GAP[1.5],
                            TYPE.caption, MONO, COLOR.muted, COLOR.hoverFg, TRANSITION.micro,
                          )}
                        >
                          <span className={classes('size-1.5 shrink-0', RADIUS.pill, PRESENCE.currentDot)} aria-hidden />
                          <span className="truncate max-w-[280px]">{addr}</span>
                          <Copy className={classes(ICON.sm, 'shrink-0')} aria-hidden />
                        </button>
                      )
                    })()}
                  </div>
                </div>

                <div className={classes('flex shrink-0 items-center', GAP[1])}>
                  {serverMode === 'client' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { playPress(620); void leave(); }}
                      className={classes(STATUS.dangerSoft, STATUS.dangerHoverBg, GAP[1])}
                    >
                      <ArrowLeft className={ICON.sm} /> Leave
                    </Button>
                  )}
                  {serverMode === 'host' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        playPress(820);
                        void window.gmatch?.serverState?.()
                          .then((st) => void shareServer(st?.lanUrls?.[0] || '', serverName))
                          .catch(() => void shareServer('', serverName));
                      }}
                      className={GAP[1]}
                    >
                      <Share2 className={ICON.sm} /> Share
                    </Button>
                  )}
                  {node?.isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditor()}
                      aria-expanded={editingServer}
                      title="Server settings"
                      className={GAP[1]}
                    >
                      <Pencil className={ICON.sm} /> Settings
                    </Button>
                  )}
                </div>
              </div>

              {/* Inline Editor — one aligned grid, one field recipe. */}
              {editingServer && (
                <div className={classes(CHROME.tile, 'space-y-3', PADDING[3])}>
                  <div className={classes('grid grid-cols-1 sm:grid-cols-2', GAP[3])}>
                    <label className={FORM_LABEL}>
                      Server name
                      <Input
                        aria-label="Current server name"
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        maxLength={60}
                        className={FORM_INPUT}
                      />
                    </label>
                    <label className={FORM_LABEL}>
                      Description
                      <Input
                        aria-label="Current server description"
                        value={serverDescription}
                        onChange={(e) => setServerDescription(e.target.value)}
                        maxLength={200}
                        className={FORM_INPUT}
                      />
                    </label>
                  </div>
                  <label className={FORM_LABEL}>
                    Tags (comma-separated, shown in the browser)
                    <Input
                      aria-label="Current server tags"
                      value={hubTags}
                      onChange={(e) => setHubTags(e.target.value)}
                      maxLength={260}
                      placeholder="chill, movies, late-night"
                      className={FORM_INPUT}
                    />
                  </label>
                  <label className={classes('flex items-center cursor-pointer', GAP[2], TYPE.body, COLOR.muted)}>
                    <Checkbox checked={hubPrivate} onChange={(e) => setHubPrivate(e.target.checked)} />
                    Private. Hide from the public browser (friends join with your code)
                  </label>
                  <label className={FORM_LABEL}>
                    New join password (empty keeps the current one)
                    <Input
                      type="password"
                      aria-label="New server join password"
                      value={hubNewPassword}
                      onChange={(e) => { setHubNewPassword(e.target.value); if (e.target.value) setHubRemovePassword(false) }}
                      placeholder="At least 4 characters"
                      maxLength={64}
                      className={FORM_INPUT}
                    />
                  </label>
                  <label className={classes('flex items-center cursor-pointer', GAP[2], TYPE.body, COLOR.muted)}>
                    <Checkbox
                      aria-label="Remove join password"
                      checked={hubRemovePassword}
                      disabled={hubNewPassword.trim().length > 0}
                      onChange={(e) => setHubRemovePassword(e.target.checked)}
                    />
                    Remove the join password
                  </label>
                  <div className={classes('flex', GAP[2], 'pt-1')}>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!serverName.trim() || renaming}
                      onClick={() => void saveServerSettings()}
                      className={GAP[1]}
                    >
                      <Check className={ICON.sm} /> Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingServer(false)
                        setServerName(node?.name || dash?.name || 'gmatch')
                        setServerDescription(node?.description || '')
                        setHubNewPassword('')
                        setHubRemovePassword(false)
                        setHubTags((node && Array.isArray(node.tags) ? node.tags : []).join(', '))
                      }}
                      className={GAP[1]}
                    >
                      <X className={ICON.sm} /> Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* Active & Offline Server Members — one tile recipe for both. */}
            <section className={classes(CHROME.statTile, 'space-y-4 overflow-y-auto max-h-[60vh]')} aria-label="Server members">
              {/* Online Section */}
              <div className="space-y-2">
                <div className={classes('flex items-center justify-between pb-1.5 border-b', COLOR.edge)}>
                  <div className={classes('flex items-center', GAP[2])}>
                    <span className={classes('size-2 shrink-0', RADIUS.pill, PRESENCE.currentDot)} />
                    <span className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'uppercase', TRACKING.wider, MONO)}>
                      Online ({roster
                        ? roster.countOnline((identity as unknown as { orbitId?: string } | null)?.orbitId)
                        : typeof dash?.online_count === 'number' ? Math.max(dash.online_count, onlineUsers.length) : onlineUsers.length})
                    </span>
                  </div>
                </div>

                {onlineUsers.length === 0 ? (
                  <div className={classes(TYPE.body, COLOR.muted, 'py-3 text-center')}>
                    No members online right now
                  </div>
                ) : (
                  <div className={classes('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3', GAP[2])}>
                    {onlineUsers.map((u) => {
                      const initial = (u.display_name || u.id || '?').charAt(0).toUpperCase()
                      return (
                        <button
                          type="button"
                          key={u.id}
                          onClick={() => handleUserClick(u)}
                          className={classes(
                            CHROME.tile, 'group flex items-center justify-between cursor-pointer',
                            GAP[2], PADDING[3], COLOR.hoverEdgeStrong, COLOR.hoverW10, TRANSITION.micro,
                          )}
                        >
                          <div className={classes('flex items-center min-w-0', GAP[2.5])}>
                            <div className={classes(
                              'relative size-8 overflow-hidden border shrink-0 flex items-center justify-center',
                              RADIUS.pill, COLOR.surfaceRaised, COLOR.edgeSubtle,
                              TYPE.body, WEIGHT.bold, COLOR.muted,
                            )}>
                              {u.pfp_url ? (
                                <img src={resolveMediaUrl(u.pfp_url)} alt="" className="size-full object-cover" />
                              ) : (
                                <span>{initial}</span>
                              )}
                              <span
                                className={classes(
                                  'absolute bottom-0 right-0 size-2 ring-1 ring-retro-bg',
                                  RADIUS.pill, PRESENCE.currentDot,
                                )}
                                aria-label="online"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className={classes(
                                TYPE.body, WEIGHT.bold, COLOR.fg, 'truncate',
                                COLOR.hoverAccent, TRANSITION.micro,
                              )}>
                                {u.display_name || u.id}
                              </div>
                              <div className={classes(TYPE.caption, MONO, PRESENCE.currentText, 'truncate')}>
                                active now
                              </div>
                            </div>
                          </div>
                          <span className={classes(
                            'flex items-center', GAP[0.5], TYPE.caption, COLOR.muted,
                            'opacity-0 group-hover:opacity-100 transition-opacity',
                          )}>
                            Profile <ChevronRight className={ICON.sm} aria-hidden />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Offline Section */}
              <div className={classes('space-y-2 pt-2')}>
                <div className={classes('flex items-center justify-between pb-1.5 border-b', COLOR.edge)}>
                  <div className={classes('flex items-center', GAP[2])}>
                    <span className={classes('size-2 shrink-0', RADIUS.pill, PRESENCE.idleDot)} />
                    <span className={classes(TYPE.body, WEIGHT.bold, COLOR.muted, 'uppercase', TRACKING.wider, MONO)}>
                      Offline ({offlineUsers.length})
                    </span>
                  </div>
                </div>

                {offlineUsers.length === 0 ? (
                  <div className={classes(TYPE.body, COLOR.muted, 'py-3 text-center')}>
                    No offline members recorded
                  </div>
                ) : (
                  <div className={classes('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3', GAP[2])}>
                    {offlineUsers.map((u) => {
                      const initial = (u.display_name || u.id || '?').charAt(0).toUpperCase()
                      return (
                        <button
                          type="button"
                          key={u.id}
                          onClick={() => handleUserClick(u)}
                          className={classes(
                            CHROME.tile, 'group flex items-center justify-between cursor-pointer',
                            GAP[2], PADDING[3], COLOR.hoverEdgeStrong, COLOR.hoverW10, TRANSITION.micro,
                            'opacity-85 hover:opacity-100',
                          )}
                        >
                          <div className={classes('flex items-center min-w-0', GAP[2.5])}>
                            <div className={classes(
                              'relative size-8 overflow-hidden border shrink-0 flex items-center justify-center',
                              RADIUS.pill, COLOR.surfaceRaised, COLOR.edgeSubtle,
                              TYPE.body, WEIGHT.bold, COLOR.muted,
                            )}>
                              {u.pfp_url ? (
                                <img src={resolveMediaUrl(u.pfp_url)} alt="" className="size-full object-cover" />
                              ) : (
                                <span>{initial}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className={classes(
                                TYPE.body, WEIGHT.bold, COLOR.fgSoft, 'truncate',
                                COLOR.hoverAccent, TRANSITION.micro,
                              )}>
                                {u.display_name || u.id}
                              </div>
                              <div className={classes(TYPE.caption, MONO, COLOR.muted, 'truncate')}>
                                {formatRelativeTime(u.last_seen)}
                              </div>
                            </div>
                          </div>
                          <span className={classes(
                            'flex items-center', GAP[0.5], TYPE.caption, COLOR.muted,
                            'opacity-0 group-hover:opacity-100 transition-opacity',
                          )}>
                            Profile <ChevronRight className={ICON.sm} aria-hidden />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          </aside>
        ) : (
          /* BROWSE SERVERS VIEW */
          <section className="relative flex flex-col min-h-0 h-full overflow-hidden" aria-label="Server directory">
            {!identity && (
              <div className={classes(
                COLOR.interactiveSoft, 'border-b shrink-0', COLOR.edgeSubtle,
                PADDING_X[3], PADDING_Y[1.5], TYPE.body, COLOR.muted,
              )}>
                No account yet. One is created for you on the server you pick.
              </div>
            )}

            {/* ONE list: every server this client knows, the current one first.
                A solid backing (not glass): a world list is data you read, and
                the rows sit on it with clear contrast. */}
            <div className={classes(
              'flex-1 min-h-0 overflow-y-auto styled-scrollbar', PADDING_X[4], PADDING_Y[1.5],
              COLOR.canvas,
            )}>
              {/* A failed directory request never erases servers we already know. */}
              {dirError && serverRows.length > 0 && (
                <div role="status" className={classes(
                  CHROME.tile, 'mb-2', GAP[2], TYPE.caption, PADDING_X[3], PADDING_Y[1.5],
                )}>
                  <span className="min-w-0 flex-1 truncate">
                    Directory unreachable. Showing the last known servers.
                  </span>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className={classes(CHROME.dangerLink, 'shrink-0 underline')}
                  >
                    Retry
                  </button>
                </div>
              )}

              {serverRows.length === 0 && (
                <div className={classes('flex flex-col items-center', PADDING[4], 'text-center', GAP[1.5])}>
                  <p className={classes(TYPE.sub, WEIGHT.semibold, COLOR.fg)}>
                    {dirError ? 'Directory unavailable' : query ? 'No servers match' : 'No servers yet'}
                  </p>
                  <p className={classes('max-w-sm', TYPE.caption, COLOR.muted)}>
                    {dirError
                      ? `Could not reach ${central || 'the directory'} and nothing is cached for this session.`
                      : query
                        ? <>Nothing matches &ldquo;{query}&rdquo;.</>
                        : 'Join one with a code, or host your own on this computer.'}
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      if (dirError) void refresh()
                      else if (query) setQuery('')
                      else { playPress(880); setAddWorldOpen(true) }
                    }}
                    className={classes('mt-1', GAP[1])}
                  >
                    {dirError ? <RefreshCw className={ICON.sm} /> : !query ? <Plus className={ICON.sm} /> : null}
                    {dirError ? 'Retry' : query ? 'Show all servers' : 'Add server'}
                  </Button>
                </div>
              )}

              {serverRows.length > 0 && (
                <>
                  {/* Technical column strip: the same slots every row uses.
                      Ping is named because the browser owns the column, not
                      because the node measures latency — a row shows a dash. */}
                  <div
                    aria-hidden
                    className={classes(
                      'flex shrink-0 items-center', GAP[2], PADDING_X[3], PADDING_Y[1.5],
                      'border-b', COLOR.edgeSubtle, TYPE.caption, TRACKING.wider,
                      COLOR.muted, 'uppercase',
                    )}
                  >
                    <span className={BROWSER_COLUMNS.server}>Server</span>
                    <span className={BROWSER_COLUMNS.address}>Address</span>
                    <span className={BROWSER_COLUMNS.players}>Players</span>
                    <span className={BROWSER_COLUMNS.ping}>Ping</span>
                    <span className={BROWSER_COLUMNS.actions}>Action</span>
                  </div>
                  <ul className="dense-list divide-y divide-edge-subtle" aria-label="Servers" onKeyDown={onRowListKeyDown}>
                    {serverRows.map((s) => renderRow(s))}
                  </ul>
                </>
              )}
              {rowContext && (
                <ContextMenu
                  x={rowContext.at.x}
                  y={rowContext.at.y}
                  title="Server"
                  items={rowContext.actions.map((a) => ({
                    label: a.label, icon: a.icon, danger: a.danger, onSelect: a.run,
                  }))}
                  onDismiss={() => setRowContext(null)}
                />
              )}

              {/* Device-local labels are not servers and never join the list;
                  they stay behind one quiet, secondary door. */}
              <div className={classes('mt-3 border-t pt-2 pb-1', COLOR.edgeSubtle)}>
                <button
                  type="button"
                  onClick={() => { playPress(700); setGroupsOpen(true) }}
                  className={classes(TYPE.caption, COLOR.muted, COLOR.hoverFg, 'cursor-pointer', TRANSITION.micro)}
                >
                  Local groups{labels.length ? ` (${labels.length})` : ''}
                </button>
                <span className={classes('ml-1.5', TYPE.caption, COLOR.faint)}>· device-only labels, not servers</span>
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
              <Modal title="Delete server" onClose={closeDeleteDialog} maxWidth={DIALOG_WIDTH.md}>
                <div className="space-y-3">
                  <p className={classes(TYPE.body, COLOR.muted, MONO, 'truncate')}>{deleteTarget.name}</p>

                  <div className={classes(TYPE.body, COLOR.muted, 'space-y-2')}>
                    <p className={FEEDBACK.description}>
                      {mine(deleteTarget)
                        ? 'You own this server. Unregister it from the directory, or just forget it here.'
                        : 'You do not own this server. Enter the Central Admin Passcode to delete it from the directory, or forget it here.'}
                    </p>

                    {!mine(deleteTarget) && (
                      <div className="space-y-1.5">
                        <label htmlFor="central-admin-passcode" className={classes('block', TYPE.caption, WEIGHT.semibold, COLOR.fg)}>
                          Central Admin Passcode
                        </label>
                        <Input
                          id="central-admin-passcode"
                          type="password"
                          aria-label="Central admin passcode"
                          value={deletePasscode}
                          onChange={(e) => setDeletePasscode(e.target.value)}
                          placeholder="Enter central passcode (e.g. 1984)"
                          className={MONO}
                        />
                        <p className={classes(TYPE.caption, COLOR.muted)}>
                          Required when deleting a server created by another identity, or while unauthenticated.
                        </p>
                      </div>
                    )}

                    {deleteError && (
                      <p role="alert" className={classes(
                        TYPE.body, STATUS.danger, STATUS.dangerBg, STATUS.dangerEdge,
                        PADDING[2], RADIUS.control, MONO,
                      )}>
                        {deleteError}
                      </p>
                    )}
                  </div>

                  <div className={classes(
                    'flex flex-wrap items-center justify-between', GAP[2], 'pt-2 border-t', COLOR.edgeSubtle,
                  )}>
                    <Button variant="ghost" size="sm" onClick={() => forgetLocalServer(deleteTarget)}>
                      Forget from local list
                    </Button>

                    <div className={classes('flex items-center', GAP[2])}>
                      <Button variant="ghost" size="sm" onClick={closeDeleteDialog}>Cancel</Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deleting}
                        onClick={() => void handleDeleteConfirm()}
                      >
                        {deleting ? 'Deleting…' : (mine(deleteTarget) ? 'Unregister & Delete' : 'Permanently Delete')}
                      </Button>
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
