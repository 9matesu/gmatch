"use client";

// Servers view (plan T3/T4, docs/ADR-002-servers.md). A "server" is a full
// gMatch node; the CENTRAL node only keeps a public directory of metadata.
// 2-column coupled layout: Left = current node dashboard (24h users, rooms, stats);
// Right = public directory browser (search, join, create).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Globe, UserPlus, ShieldCheck, RefreshCw, Pencil, Check, X, Search, ArrowDownUp, Share2, ArrowLeft, MessageSquare, Plus, Trash2, MoreVertical } from 'lucide-react'
import { generateIdentity } from '@orbit/crypto'
import { getCentralApiUrl, setCentralApiUrl } from '../../utils/central'
import { orbitFetch, getApiBaseUrl } from '../../utils/api'
import { normalizeServerUrl, isCurrentServerUrl } from '../../utils/serverUrl'
import { joinServer } from '../../utils/join-server'
import { rememberPendingHost } from '../../utils/server-host-pending'
import { mergeDirectory, readDirectoryCache, writeDirectoryCache } from './directoryMerge'
import { decodeNodeMask } from '../../utils/nodeMask'
import { buildNodeCode } from '../../utils/nodeShare'
import { PromptDialog } from '../PromptDialog'
import { claimPendingHost } from '../../hooks/usePendingServerHost'
import { SERVER_MARKER_KEY } from '../../firstRun/onboardingState'
import { playPress } from '../../utils/sounds'
import { resolveMediaUrl } from '../../utils/media'
import { CentralAdminPanel } from './CentralAdminPanel'
import type { User } from '@orbit/shared'

export interface DirectoryServer {
  id: string
  name: string
  description?: string
  owner_id: string
  password_required: number
  endpoint_hint?: string
  is_private?: number
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
}

export interface ServerNode {
  name: string
  description: string
  directoryId?: string | null
  isAdmin: boolean
}

export interface ServerRoomPreview {
  id: string
  name: string
  membersCount?: number
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

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'recently'
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function ServersView({
  identity,
  toast,
  showRooms = false,
  onOpenRooms,
  onSelectUser,
  profilePics = {},
  rooms = [],
  onOpenRoom,
  onServerJoined,
}: {
  identity: Parameters<typeof orbitFetch>[2] | null
  toast: Toast
  showRooms?: boolean
  onOpenRooms?: () => void
  onSelectUser?: (user: User) => void
  profilePics?: Record<string, string>
  rooms?: ServerRoomPreview[]
  onOpenRoom?: (roomId: string) => void
  onServerJoined?: (server: DirectoryServer) => void
}) {
  const [central, setCentral] = useState(() => getCentralApiUrl())
  const [servers, setServers] = useState<DirectoryServer[]>([])
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [node, setNode] = useState<ServerNode | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hint, setHint] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [serverPassword, setServerPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirError, setDirError] = useState(false)
  const [setupUrl, setSetupUrl] = useState('')
  const [setupError, setSetupError] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'name' | 'online'>('recent')
  const [passwordOnly, setPasswordOnly] = useState(false)
  const [editingServer, setEditingServer] = useState(false)
  const [serverName, setServerName] = useState('gmatch')
  const [serverDescription, setServerDescription] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [serverMode, setServerMode] = useState<'host' | 'client' | null>(null)
  type ServerBridgeState = { packaged: boolean; mode: 'host' | 'client'; url: string; lanUrls: string[]; adminPin?: string }
  const [hostState, setHostState] = useState<ServerBridgeState | null>(null)
  const [pinToDismiss, setPinToDismiss] = useState('')
  const [userTab, setUserTab] = useState<'online' | 'all24h'>('online')
  const [activeTab, setActiveTab] = useState<'browse' | 'hub'>('browse')
  const [deleteTarget, setDeleteTarget] = useState<DirectoryServer | null>(null)
  const [deletePasscode, setDeletePasscode] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showCentralPopover, setShowCentralPopover] = useState(false)
  // Collapsible filter band (the chatroom idiom): the search/sort row eats a
  // full strip above the list and is only needed while narrowing. Persisted so
  // the choice survives a reload.
  const [filtersCollapsed, setFiltersCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('gmatch.servers.filters_collapsed_v1') === '1' } catch { return false }
  })
  const toggleFilters = () => {
    setFiltersCollapsed((v) => {
      const next = !v
      try { localStorage.setItem('gmatch.servers.filters_collapsed_v1', next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }

  useEffect(() => {
    if (!openMenuId && !showCentralPopover) return
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target && !target.closest('[data-menu-trigger]') && !target.closest('[data-menu-content]')) {
        setOpenMenuId(null)
        setShowCentralPopover(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [openMenuId, showCentralPopover])

  // Join prompts (Electron has no window.prompt): one pending resolver ref,
  // one dialog kind at a time (password during join, or the paste-code modal).
  const pendingAsk = useRef<((v: string | null) => void) | null>(null)
  const [askPasswordFor, setAskPasswordFor] = useState<string | null>(null)
  const [codeAskOpen, setCodeAskOpen] = useState(false)

  const isDev = Boolean(import.meta.env.DEV) ||
    (typeof window !== 'undefined' &&
      (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'))

  const isLocalHost = (url: string) => url.includes('127.0.0.1') || url.includes('localhost')

  const centralServer = useMemo((): DirectoryServer => ({
    id: 'central-node',
    name: isLocalHost(central) ? 'Central Node (Local)' : 'gMatch Central',
    description: isLocalHost(central)
      ? 'Local dev node (127.0.0.1:8790)'
      : 'Official central network directory & public node',
    owner_id: 'central',
    endpoint_hint: central,
    password_required: 0,
    is_private: 0,
    user_count: dash?.members_total ?? null,
    online_count: dash?.users ? dash.users.filter((u) => u.online).length : null,
    last_seen: new Date().toISOString(),
  }), [central, dash])

  const refresh = useCallback(async () => {
    // Anonymous browser: public directory only — never touch node routes
    // (no ID yet, nothing to sign with).
    if (!identity) {
      if (!central) { setServers(readDirectoryCache()); setDirError(false); return }
      try {
        const res = await fetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' })
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
      if (d.ok) {
        const dj = (await d.json()) as Dashboard
        if (Array.isArray(dj?.users)) {
          setDash(dj)
          if (typeof dj?.name === 'string' && dj.name.trim()) setServerName(dj.name.trim())
        }
      }
    } catch { /* node without dashboard route. Fine */ }

    try {
      const n = await orbitFetch('/api/servers/node', { method: 'GET' }, identity)
      if (n.ok) {
        const nj = (await n.json()) as ServerNode
        if (typeof nj?.name === 'string') {
          setNode(nj)
          setServerName(nj.name)
          setServerDescription(nj.description || '')
        }
      }
    } catch { /* old nodes have no /node yet */ }

    if (!central) { setServers(readDirectoryCache()); setDirError(false); return }
    try {
      // cache-bust: orbitFetch dedups/caches GETs; the list must be fresh
      const res = await orbitFetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, identity)
      if (res.ok) {
        const data = (await res.json()) as { servers: DirectoryServer[] }
        // Wave 2 (D2): the hub's list merges into the local gossip cache so
        // the directory survives the central node going down later.
        let merged = mergeDirectory(readDirectoryCache(), Array.isArray(data.servers) ? data.servers : [])
        // Wave 2 (D2): gossip — when we're ON another node, ask it too. Its
        // directory (plus what it learned) seeds ours, so nodes are reachable
        // without the hub. Best-effort: an old node 404s and we move on.
        if (central && central.replace(/\/+$/, '').toLowerCase() !== getApiBaseUrl().replace(/\/+$/, '').toLowerCase()) {
          try {
            const r2 = await orbitFetch(`${getApiBaseUrl()}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, identity)
            if (r2.ok) {
              const d2 = (await r2.json()) as { servers?: DirectoryServer[] }
              if (Array.isArray(d2.servers)) merged = mergeDirectory(merged, d2.servers)
            }
          } catch { /* node offline or legacy. Cache stays as-is */ }
        }
        writeDirectoryCache(merged)
        setServers(merged)
        setDirError(false)
      } else {
        setDirError(true)
      }
    } catch {
      // Configured central is unreachable: fall back to gossiped nodes, and
      // surface it rather than fake "none online".
      setServers(readDirectoryCache())
      setDirError(true)
    }
  }, [identity, central])

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

  const visibleServers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const centralNorm = (central || '').trim().replace(/\/+$/, '').toLowerCase()
    return servers
      .filter((s) => {
        if (s.id === 'central-node') return false
        if (s.name.trim().toLowerCase() === 'gmatch') return false
        if (s.endpoint_hint?.includes('127.0.0.1:8790') || s.endpoint_hint?.includes('localhost:8790')) return false
        if (s.endpoint_hint && normalizeServerUrl(s.endpoint_hint)?.toLowerCase() === centralNorm) return false
        return true
      })
      .filter((s) => !passwordOnly || s.password_required)
      .filter((s) => !q || `${s.name} ${s.description ?? ''} ${s.endpoint_hint ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name)
        if (sort === 'online') return (b.online_count ?? -1) - (a.online_count ?? -1)
        return String(b.last_seen ?? '').localeCompare(String(a.last_seen ?? ''))
      })
  }, [servers, query, sort, passwordOnly, central])

  const closeCreateForm = () => {
    setShowCreate(false); setName(''); setDescription(''); setHint(''); setNeedsPassword(false); setIsPrivate(false); setServerPassword('')
  }

  // Best-effort: list the (public) registration on the central directory.
  // Returns the created row (or null). The host heartbeat replays the saved
  // registration every 15min, so a dead directory here self-heals later.
  const registerDirectory = async (
    n: string, d: string, h: string, pwRequired: boolean, isPrivate: boolean,
  ): Promise<DirectoryServer | null> => {
    if (!central || !identity) return null
    try {
      const res = await orbitFetch(`${central}/api/servers`, {
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
      if (!central) { toast('Configure a central node to list a server here. Hosting runs in the desktop app.', 'warning'); return }
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

  const mine = (s: DirectoryServer) => !!identity && s.owner_id === (identity as unknown as { orbitId: string }).orbitId

  const isCurrent = (s: DirectoryServer) => isCurrentServerUrl(getApiBaseUrl(), s.endpoint_hint || '')

  // Switch = join another node, or hop back to this machine's own host node.
  const switchTo = async (s: DirectoryServer) => {
    if (!mine(s)) { void joinServer(s, toast, askPassword); return }
    if (!window.gmatch?.serverSet) return
    const res = await window.gmatch.serverSet({ mode: 'host', url: '' })
    if (res.ok) { toast('Switching to your own server. The app restarts.', 'success'); window.gmatch.serverRelaunch?.() }
    else toast(res.error || 'Could not switch servers', 'error')
  }

  const renameServer = async () => {
    if (!identity) return
    const trimmed = serverName.trim()
    if (!trimmed || renaming) return
    setRenaming(true)
    try {
      const res = await orbitFetch('/api/servers/node', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description: serverDescription.trim() }),
      }, identity)
      const body = (await res.json().catch(() => ({}))) as { error?: string; server?: ServerNode }
      if (!res.ok) { toast(body.error || 'Could not rename this server', 'error'); return }
      if (body.server) {
        setNode(body.server)
        setServerName(body.server.name)
        setServerDescription(body.server.description || '')
      }
      setEditingServer(false)

      let directoryId = body.server?.directoryId || node?.directoryId || ''
      try { directoryId ||= localStorage.getItem(DIRECTORY_ID_KEY) || '' } catch { /* session-only */ }
      if (central) {
        if (!directoryId) {
          const ownServer = servers.find((s) => mine(s))
          directoryId = ownServer?.id || ''
        }
        if (directoryId) {
          try {
            const dirRes = await orbitFetch(`${central}/api/servers/${directoryId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: trimmed, description: serverDescription.trim() }),
            }, identity)
            if (dirRes.ok) localStorage.setItem(DIRECTORY_ID_KEY, directoryId)
            else toast('Server renamed here, but the directory didn\'t update.', 'warning')
          } catch {
            toast('Server renamed here. The directory is offline.', 'warning')
          }
        }
      }
      toast('Server renamed', 'success')
      void refresh()
    } catch {
      toast('Couldn\'t reach the server.', 'error')
    } finally {
      setRenaming(false)
    }
  }

  const askPassword = (name: string) =>
    new Promise<string | null>((resolve) => { pendingAsk.current = resolve; setAskPasswordFor(name) })

  const connectToCentral = async () => {
    if (!central) return
    const target = normalizeServerUrl(central) || normalizeServerUrl('http://' + central) || central
    try {
      localStorage.setItem(SERVER_MARKER_KEY, target)
      localStorage.setItem('gmatch.api.url', target)
    } catch { /* private mode */ }
    if (!window.gmatch?.serverSet) {
      toast(`Connected to ${centralServer.name}.`, 'success')
      onServerJoined?.(centralServer)
      return
    }
    const res = await window.gmatch.serverSet({ mode: 'client', url: target })
    if (!res.ok) { toast(res.error || 'Could not switch servers', 'error'); return }
    toast(`Switching to ${centralServer.name}. The app restarts.`, 'success')
    window.gmatch.serverRelaunch?.()
  }

  const join = async (s: DirectoryServer) => {
    if (s.id === 'central-node' || (s.endpoint_hint && s.endpoint_hint === central)) {
      await connectToCentral()
      return
    }
    if (!window.gmatch?.serverSet) {
      const url = s.endpoint_hint
      if (!url) { toast('This server has no address to join (owner is offline?)', 'warning'); return }
      const target = normalizeServerUrl(url) || normalizeServerUrl('http://' + url) || url
      try {
        localStorage.setItem(SERVER_MARKER_KEY, target)
        localStorage.setItem('gmatch.api.url', target)
      } catch { /* private mode */ }
      toast(`Connected to ${s.name}.`, 'success')
      onServerJoined?.(s)
      return
    }
    void joinServer(s, toast, askPassword)
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
  const joinByCode = async (entered: string) => {
    const coord = decodeNodeMask(entered)
    if (!coord) { toast('That is not a valid node code.', 'error'); return }
    const host = coord.port ? `${coord.host}:${coord.port}` : coord.host
    // Persist before the relaunch kills the process.
    const serverObj = { id: `mask:${host}`, name: coord.name, owner_id: '', password_required: 0, endpoint_hint: host }
    writeDirectoryCache(mergeDirectory(readDirectoryCache(), [serverObj]))
    const res = await joinServer(serverObj, toast, askPassword)
    if (res === 'connected') {
      onServerJoined?.(serverObj)
    }
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
  const displayedUsers = userTab === 'online' ? onlineUsers : allUsers

  const handleUserClick = (u: DashboardUser) => {
    if (!onSelectUser) return
    playPress(700)
    onSelectUser({
      id: u.id,
      display_name: u.display_name,
      pfp_url: u.pfp_url || profilePics[u.id],
    } as User)
  }

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

      {/* Unified dashboard — Discord-style framed container, narrow column */}
      <div className="glass-card flex flex-col h-full min-h-0 flex-1 w-full max-w-[680px] overflow-hidden rounded-lg border border-border-glass bg-surface-canvas">
        {/* Discord-style Unified Top Bar */}
        <div className="h-9 px-2 border-b border-border-glass bg-surface-raised flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {identity && (
              <div className="flex items-center gap-0.5 bg-surface-canvas p-0.5 rounded-md border border-border-glass shrink-0">
                <button
                  type="button"
                  onClick={() => { playPress(750); setActiveTab('browse'); }}
                  className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                    activeTab === 'browse'
                      ? 'bg-retro-accent text-retro-accent-text'
                      : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8'
                  }`}
                >
                  Browse ({visibleServers.length})
                </button>
                <button
                  type="button"
                  onClick={() => { playPress(750); setActiveTab('hub'); }}
                  className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                    activeTab === 'hub'
                      ? 'bg-retro-accent text-retro-accent-text'
                      : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8'
                  }`}
                >
                  <span>Hub</span>
                  {dash ? <span className="text-[10px] font-mono opacity-80">({dash.members_total})</span> : null}
                </button>
              </div>
            )}

            {identity && (
              <div
                className="hidden lg:flex items-center gap-1 px-1.5 py-px rounded-md bg-surface-interactive border border-border-subtle text-[10px] font-mono text-retro-muted truncate"
                title={dash ? `${dash.members_total} members · ${dash.posts_24h} posts/24h` : (serverDescription || 'Connected')}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-retro-online shrink-0" />
                <span className="text-retro-fg font-semibold truncate max-w-[100px]">{serverName || 'gmatch'}</span>
                {node?.isAdmin && <span className="text-amber-300 font-bold text-[10px]">ADMIN</span>}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-auto">
            {/* Central Directory Selector */}
            <div className="relative">
              <button
                type="button"
                data-menu-trigger
                onClick={() => setShowCentralPopover((v) => !v)}
                aria-label="Change central node address"
                className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors cursor-pointer"
                title={central ? `Directory: ${central.replace(/^https?:\/\//, '')} (change)` : 'Change central node address'}
              >
                <Globe className="w-3.5 h-3.5" />
              </button>

              {/* Central Node Popover */}
              {showCentralPopover && (
                <div
                  data-menu-content
                  className="absolute right-0 top-full mt-2 w-72 bg-surface-raised border border-border-glass rounded-lg p-3 shadow-xl z-30 space-y-2.5 animate-orbit-fade-in"
                >
                  <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
                    <span className="text-xs font-bold text-retro-fg">Central Directory Node</span>
                    <button
                      type="button"
                      onClick={() => setShowCentralPopover(false)}
                      className="text-retro-muted hover:text-retro-fg p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-retro-muted">
                    Central directory address where servers register and publish metadata.
                  </p>
                  <div className="flex items-center gap-1.5">
                    <input
                      aria-label="Central node URL"
                      value={setupUrl || (central || '')}
                      onChange={(e) => setSetupUrl(e.target.value)}
                      placeholder="https://gmatch.fly.dev"
                      className="w-full px-2.5 py-1 text-xs font-mono bg-surface-canvas border border-border-glass rounded-md text-retro-fg placeholder:text-retro-muted focus:outline-none focus:border-retro-accent"
                    />
                    <button
                      type="button"
                      onClick={() => { saveCentral(); setShowCentralPopover(false); }}
                      className="px-2.5 py-1 text-xs font-semibold bg-retro-accent text-retro-accent-text rounded-md hover:bg-retro-accent-hover transition-colors shrink-0 cursor-pointer active:scale-[0.98]"
                    >
                      Save
                    </button>
                  </div>
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
                              ? 'bg-retro-accent text-white font-bold'
                              : 'bg-glass-w10 text-retro-muted hover:text-retro-fg'
                          }`}
                        >
                          local:8790
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCentralApiUrl('https://gmatch.fly.dev')
                            setCentral('https://gmatch.fly.dev')
                            toast('Switched to fly.dev', 'info')
                            void refresh()
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                            central === 'https://gmatch.fly.dev'
                              ? 'bg-retro-accent text-white font-bold'
                              : 'bg-glass-w10 text-retro-muted hover:text-retro-fg'
                          }`}
                        >
                          fly.dev
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {central && (
              <button
                type="button"
                onClick={() => { playPress(760); setShowAdmin((v) => !v) }}
                aria-expanded={showAdmin}
                aria-label="Central admin"
                title="Central admin"
                className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer transition-colors active:scale-[0.98]"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => { playPress(700); setCodeAskOpen(true) }}
              aria-label="Paste node code"
              title="Paste node code"
              className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer transition-colors active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {identity && (
              <button
                type="button"
                onClick={() => { playPress(880); setShowCreate((v) => !v) }}
                aria-expanded={showCreate}
                aria-label="Create server"
                title="Create server"
                className="h-6 px-2 rounded-md bg-retro-accent hover:bg-retro-accent-hover text-retro-accent-text text-xs font-bold cursor-pointer flex items-center gap-1 transition-colors active:scale-[0.98]"
              >
                <Plus className="w-3 h-3" /> Create
              </button>
            )}
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
                  onClick={() => { playPress(760); setShowAdmin((v) => !v); }}
                  className="glass-action px-2.5 py-1 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer"
                >
                  Central Admin
                </button>
              )}
            </div>

            {/* Current Node Hero */}
           <section className="glass-inset p-4 sm:p-5 space-y-3" aria-label="Server dashboard">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-lg font-bold text-retro-fg">{serverName || 'gmatch'}</h2>
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

                <div className="flex shrink-0 items-center gap-2">
                  {serverMode === 'client' && (
                    <button
                      type="button"
                      onClick={() => { playPress(620); void leave(); }}
                      className="glass-action glass-action-danger h-8 px-3 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Leave
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
                      className="glass-action h-8 px-3 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1"
                    >
                      <Share2 className="w-3.5 h-3.5" /> Share
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { playPress(780); setServerName(serverName); setEditingServer((v) => !v); }}
                    aria-expanded={editingServer}
                    title="Rename server"
                    className="glass-action h-8 px-3 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Rename
                  </button>
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
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!serverName.trim() || renaming}
                      onClick={() => void renameServer()}
                      className="glass-action glass-action-primary h-8 px-3 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" /> Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingServer(false); setServerName(node?.name || dash?.name || 'gmatch'); setServerDescription(node?.description || ''); }}
                      className="glass-action h-8 px-2.5 rounded-lg text-xs text-retro-muted cursor-pointer flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Connected Chat Rooms Preview */}
            {showRooms && (
             <section className="glass-inset p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-retro-fg flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-retro-accent" /> Active Rooms
                  </span>
                  {onOpenRooms && (
                    <button
                      type="button"
                      onClick={() => { playPress(720); onOpenRooms(); }}
                      className="text-[10px] text-retro-muted hover:text-retro-fg transition-colors cursor-pointer"
                    >
                      View all ({rooms.length}) →
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rooms.length === 0 ? (
                    <span className="text-xs text-retro-muted py-1">No group rooms open yet.</span>
                  ) : (
                    rooms.slice(0, 8).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          playPress(720);
                          if (onOpenRoom) onOpenRoom(r.id);
                          else if (onOpenRooms) onOpenRooms();
                        }}
                        className="bg-surface-interactive/60 border border-border-subtle hover:border-border-strong px-2.5 py-1 rounded-lg text-xs font-medium text-retro-fg cursor-pointer transition-colors flex items-center gap-1"
                      >
                        <span>#{r.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            )}

            {/* Active Members & 24h Activity List */}
           <section className="glass-inset p-4 space-y-3" aria-label="Server members">
              <div className="flex items-center justify-between pb-2 border-b border-border-glass">
                <div className="flex items-center gap-1 bg-surface-interactive/60 border border-border-subtle p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setUserTab('online')}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${
                      userTab === 'online' ? 'bg-retro-accent text-retro-accent-text shadow-xs' : 'text-retro-muted hover:text-retro-fg'
                    }`}
                  >
                    Online ({onlineUsers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUserTab('all24h')}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${
                      userTab === 'all24h' ? 'bg-retro-accent text-retro-accent-text shadow-xs' : 'text-retro-muted hover:text-retro-fg'
                    }`}
                  >
                    Last 24h ({allUsers.length})
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {displayedUsers.length === 0 ? (
                  <div className="col-span-full text-xs text-retro-muted py-6 text-center italic">
                    {userTab === 'online' ? 'No other members online right now' : 'No active members in the last 24 hours'}
                  </div>
                ) : (
                  displayedUsers.map((u) => {
                    const initial = (u.display_name || u.id || '?').charAt(0).toUpperCase();
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
                            {u.online && (
                              <span
                                className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-retro-online ring-1 ring-black"
                                aria-label="online"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-retro-fg truncate group-hover:text-retro-accent transition-colors">
                              {u.display_name || u.id}
                            </div>
                            <div className="text-[10px] text-retro-muted truncate font-mono">
                              {u.online ? 'active now' : formatRelativeTime(u.last_seen)}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] text-retro-muted opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                          profile →
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </aside>
        ) : (
          /* BROWSE SERVERS VIEW */
          <main className="flex flex-col min-h-0 h-full overflow-hidden" aria-label="Server directory">
            {!identity && (
              <div className="px-3 py-1.5 bg-surface-interactive/60 border-b border-border-subtle text-xs text-retro-muted shrink-0">
                No account yet. One is created for you on the server you pick.
              </div>
            )}

            {/* Sub-Bar: Title & Filter Controls */}
            <div className="h-8 px-2 border-b border-border-subtle bg-surface-canvas flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <h1 className="text-xs font-bold text-retro-fg uppercase tracking-wider whitespace-nowrap">
                  Server browser ({visibleServers.length})
                </h1>
                <button
                  type="button"
                  onClick={() => { playPress(720); toggleFilters() }}
                  aria-expanded={!filtersCollapsed}
                  aria-label={filtersCollapsed ? 'Show filters' : 'Hide filters'}
                  className="text-[10px] font-bold text-retro-muted hover:text-retro-fg cursor-pointer transition-colors px-1 py-px rounded hover:bg-glass-w8"
                >
                  {filtersCollapsed ? '⌃' : '⌄'}
                </button>
              </div>

              {!filtersCollapsed && (
                <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                  <div className="glass-field w-36 sm:w-48 flex items-center gap-1 px-2 h-6 text-xs shrink-0">
                    <Search className="w-3 h-3 text-retro-muted shrink-0" />
                    <input
                      aria-label="Search servers"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search…"
                      className="w-full bg-transparent text-retro-fg outline-none placeholder:text-retro-muted text-xs"
                    />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-retro-muted shrink-0">
                    <ArrowDownUp className="w-3 h-3" />
                    <select
                      aria-label="Sort servers"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as 'recent' | 'name' | 'online')}
                      className="glass-field px-1 h-6 text-xs font-medium"
                    >
                      <option value="recent">Recent</option>
                      <option value="name">Name</option>
                      <option value="online">Online</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPasswordOnly((v) => !v)}
                    aria-pressed={passwordOnly}
                    aria-label="Password only"
                    title="Password only"
                    className={`h-6 w-6 rounded-md cursor-pointer flex items-center justify-center active:scale-[0.98] transition-colors shrink-0 ${passwordOnly ? 'glass-nav-active text-amber-200' : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8'}`}
                  >
                    <Lock className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    aria-label="Refresh servers"
                    className="h-6 w-6 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 flex items-center justify-center cursor-pointer transition-colors shrink-0 active:scale-[0.98]"
                    title="Refresh"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Scrollable Directory Content */}
            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar px-2 py-2 space-y-1.5">
              {/* Create-server drawer */}
              {showCreate && (
                <div className="glass-panel p-3.5 space-y-2 shrink-0 rounded-lg border border-border-glass">
                  <div className="flex items-center justify-between pb-1 border-b border-border-subtle">
                    <span className="text-xs font-bold text-retro-fg">Create a server. Hosted on this computer</span>
                    <button
                      type="button"
                      onClick={closeCreateForm}
                      className="text-retro-muted hover:text-retro-fg p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-retro-muted">
                    This machine becomes the server: you are logged into it (and off
                    the node you were connected to) automatically, and you are its
                    admin. Friends join from the address below.
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
                    <input type="checkbox" checked={needsPassword} onChange={(e) => setNeedsPassword(e.target.checked)} />
                    Ask visitors for a join password
                  </label>
                  <label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer pt-0.5">
                    <input type="checkbox" aria-label="Private server" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
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
              )}

              {/* Directory Setup / Not configured notice */}
              {!central || setupUrl ? (
                <div className="glass-inset p-4 space-y-2">
                  <p className="text-xs text-retro-muted">
                    No central node is configured, so there is no public server
                    network to discover or list yours on. Creating a server still
                    works: it is hosted right here on this computer &mdash; add a
                    central address below to also list it for explorers.
                  </p>
                  <label className="block text-xs text-retro-muted">
                    Central node URL
                    <input
                      aria-label="Central node URL"
                      value={setupUrl}
                      onChange={(e) => setSetupUrl(e.target.value)}
                      placeholder="https://central.example"
                      maxLength={120}
                      className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs font-mono"
                    />
                  </label>
                  {setupError && <p role="alert" className="text-xs text-rose-400">{setupError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveCentral()}
                      disabled={!setupUrl.trim()}
                      className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSetupUrl(''); setSetupError('') }}
                      className="glass-action px-3 py-1.5 rounded-lg text-xs text-retro-muted cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Directory Content List */}
              <div className="min-h-0 pr-px">
                  {dirError ? (
                    <div className="glass-inset p-3 text-xs text-retro-muted space-y-2">
                      <p>
                        Could not reach the central directory at <span className="font-mono">{central}</span>.
                        It may be offline, or the address is wrong.
                      </p>
                      <button
                        type="button"
                        onClick={() => void refresh()}
                        className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" /> Retry
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {/* Pinned Official Node Row */}
                      {central && !passwordOnly && (!query || `${centralServer.name} ${centralServer.description}`.toLowerCase().includes(query.toLowerCase())) && (
                        <div
                          key="central-node"
                          className="group relative flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-border-glass bg-glass-w5 hover:border-border-strong transition-colors duration-150"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-surface-interactive border border-border-subtle text-retro-fg flex items-center justify-center shrink-0">
                              <Globe className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 min-w-0">
                                <h3 className="text-xs font-bold text-retro-fg truncate">{centralServer.name}</h3>
                                <span className="text-[10px] px-1 py-px rounded font-mono uppercase tracking-wider text-retro-fg border border-border-glass bg-glass-w8 shrink-0">
                                  Official
                                </span>
                              </div>
                              <p className="text-[10px] text-retro-muted truncate max-w-[320px]">
                                {centralServer.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center justify-end gap-2">
                            <div className="hidden sm:flex items-center gap-1 text-[10px] text-retro-muted font-mono tabular-nums">
                              <span className="inline-flex items-center gap-1 text-retro-online">
                                <span className="w-1.5 h-1.5 rounded-full bg-retro-online" />
                                <span>{typeof centralServer.online_count === 'number' ? `${centralServer.online_count}` : '–'}</span>
                              </span>
                              {typeof centralServer.user_count === 'number' && (
                                <span>· {centralServer.user_count}</span>
                              )}
                            </div>

                            {isCurrent(centralServer) && identity ? (
                              <span className="h-6 px-2 rounded-md text-xs font-semibold text-retro-muted bg-surface-canvas border border-border-subtle flex items-center justify-center cursor-default">
                                Connected
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void join(centralServer)}
                                className="flex items-center gap-1 px-1 py-0.5 rounded text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors duration-150 cursor-pointer"
                              >
                                <UserPlus className="w-3 h-3" /> Connect
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <ul className="divide-y divide-border-subtle rounded-lg border border-border-glass bg-surface-canvas overflow-hidden">
                        {visibleServers.length === 0 && (
                          <li className="p-6 text-xs text-retro-muted text-center flex flex-col items-center justify-center gap-1.5">
                            <Globe className="w-5 h-5 text-retro-muted/40" />
                            <p className="font-semibold text-retro-fg">
                              {servers.length === 0 ? 'No public servers online' : 'No servers match your search filters'}
                            </p>
                            <p className="max-w-sm text-[10px] text-retro-muted">
                              {servers.length === 0
                                ? 'A server appears here while its host is running gMatch.'
                                : 'Try clearing your search query or password filter.'}
                            </p>
                            {servers.length > 0 && (query || passwordOnly) && (
                              <button
                                type="button"
                                onClick={() => { setQuery(''); setPasswordOnly(false); }}
                                className="mt-1 h-6 px-2 rounded-md text-xs font-medium border border-border-glass bg-glass-w8 hover:bg-glass-w12 text-retro-fg cursor-pointer transition-colors active:scale-[0.98]"
                              >
                                Clear filters
                              </button>
                            )}
                          </li>
                        )}

                        {visibleServers.map((s) => {
                          const isMenuOpen = openMenuId === s.id
                          const isMyServer = mine(s)
                          const isCurrentServer = isCurrent(s)

                          return (
                            <li
                              key={s.id}
                              className="group relative flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-glass-w5 transition-colors duration-150"
                            >
                              <div className="flex min-w-0 items-center gap-2 flex-1">
                                <div className="w-6 h-6 rounded-md bg-surface-interactive border border-border-subtle text-retro-fg flex items-center justify-center text-[10px] font-mono font-bold shrink-0">
                                  {s.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <h3 className="text-xs font-bold text-retro-fg truncate">{s.name}</h3>
                                    {!!s.password_required && (
                                      <span className="p-0.5 rounded bg-surface-interactive text-amber-300 border border-border-glass shrink-0" title="Password required">
                                        <Lock className="w-3 h-3" aria-label="password required" />
                                      </span>
                                    )}
                                    {isMyServer && (
                                      <span className="text-[10px] px-1 py-px rounded font-mono uppercase tracking-wider bg-glass-w10 text-retro-fg border border-border-glass shrink-0">
                                        Yours
                                      </span>
                                    )}
                                    {!!s.is_private && (
                                      <span className="text-[10px] px-1 py-px rounded font-mono uppercase tracking-wider text-retro-muted border border-border-subtle bg-surface-interactive shrink-0">
                                        Private
                                      </span>
                                    )}
                                    <span className="hidden sm:inline text-[10px] text-retro-muted font-mono truncate">
                                      {formatRelativeTime(s.last_seen)}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-retro-muted truncate max-w-[320px]">
                                    {s.description || 'No description.'}
                                  </p>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center justify-end gap-2">
                                <div className="hidden sm:flex items-center font-mono text-[10px] text-retro-muted tabular-nums">
                                  {(typeof s.online_count === 'number' || typeof s.user_count === 'number') ? (
                                    <span className="inline-flex items-center gap-1">
                                      {typeof s.online_count === 'number' && (
                                        <>
                                          <span className={`w-1.5 h-1.5 rounded-full ${s.online_count > 0 ? 'bg-retro-online' : 'bg-retro-muted'}`} />
                                          <span>{s.online_count}</span>
                                        </>
                                      )}
                                      {typeof s.user_count === 'number' && (
                                        <span>· {s.user_count}</span>
                                      )}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="flex items-center gap-1">
                                  {isMyServer ? (
                                    !isCurrentServer ? (
                                      <button
                                        type="button"
                                        onClick={() => { playPress(620); void switchTo(s); }}
                                        className="flex items-center gap-1 px-1 py-0.5 rounded text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors duration-150 cursor-pointer"
                                      >
                                        <ArrowLeft className="w-3 h-3" /> Switch
                                      </button>
                                    ) : (
                                      <span className="h-6 px-2 rounded-md text-xs font-medium text-retro-muted bg-surface-canvas border border-border-subtle flex items-center justify-center cursor-default">
                                        Connected
                                      </span>
                                    )
                                  ) : isCurrentServer && identity ? (
                                    <span className="h-6 px-2 rounded-md text-xs font-semibold text-retro-muted bg-surface-canvas border border-border-subtle flex items-center justify-center cursor-default">
                                      Connected
                                    </span>
                                  ) : (
                                      <button
                                        type="button"
                                        onClick={() => void join(s)}
                                        className="flex items-center gap-1 px-1 py-0.5 rounded text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 transition-colors duration-150 cursor-pointer"
                                      >
                                        <UserPlus className="w-3 h-3" /> {!identity ? 'Enter' : 'Join'}
                                      </button>
                                  )}

                                  <div className="relative">
                                    <button
                                      type="button"
                                      data-menu-trigger
                                      onClick={() => setOpenMenuId((cur) => (cur === s.id ? null : s.id))}
                                      aria-label={`More actions for ${s.name}`}
                                      className="h-6 w-6 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w8 flex items-center justify-center cursor-pointer transition-colors duration-150"
                                      title="More actions"
                                    >
                                      <MoreVertical className="w-3.5 h-3.5" />
                                    </button>

                                    {isMenuOpen && (
                                      <div
                                        data-menu-content
                                        className="absolute right-0 top-full mt-1 w-44 bg-surface-raised border border-border-glass rounded-lg py-1 shadow-lg z-20 space-y-0.5 animate-orbit-fade-in"
                                      >
                                        {isMyServer && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => { playPress(780); setServerName(s.name); setEditingServer(true); setOpenMenuId(null); }}
                                              title="Rename this server"
                                              className="w-full px-3 py-1.5 text-xs text-left text-retro-fg hover:bg-glass-w8 flex items-center gap-2 cursor-pointer"
                                            >
                                              <Pencil className="w-3.5 h-3.5 text-retro-muted" /> rename
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => { playPress(740); void setPrivate(s, !s.is_private); setOpenMenuId(null); }}
                                              className="w-full px-3 py-1.5 text-xs text-left text-retro-fg hover:bg-glass-w8 flex items-center gap-2 cursor-pointer"
                                            >
                                              <Lock className="w-3.5 h-3.5 text-retro-muted" /> {s.is_private ? 'Make public' : 'Make private'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => { void unregister(s); setOpenMenuId(null); }}
                                              className="w-full px-3 py-1.5 text-xs text-left text-retro-fg hover:bg-glass-w8 flex items-center gap-2 cursor-pointer"
                                            >
                                              unregister
                                            </button>
                                          </>
                                        )}
                                        {s.endpoint_hint && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              playPress(820);
                                              void shareServer(s.endpoint_hint || '', s.name);
                                              setOpenMenuId(null);
                                            }}
                                            title="Copy node code"
                                            aria-label={`Copy code for ${s.name}`}
                                            className="w-full px-3 py-1.5 text-xs text-left text-retro-fg hover:bg-glass-w8 flex items-center gap-2 cursor-pointer"
                                          >
                                            <Share2 className="w-3.5 h-3.5 text-retro-muted" /> Copy Server Code
                                          </button>
                                        )}
                                        {s.id !== 'central-node' && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setDeleteTarget(s);
                                              setDeleteError('');
                                              setDeletePasscode('');
                                              setOpenMenuId(null);
                                            }}
                                            className="w-full px-3 py-1.5 text-xs text-left text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer border-t border-border-subtle mt-0.5"
                                          >
                                            <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Delete / Forget
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-[10px] text-retro-muted shrink-0 pt-1">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-retro-muted" /> Private: directory mirrors only metadata. Never private content.
                  </span>
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
      {codeAskOpen && (
        <PromptDialog
          title="Node code"
          description="Paste the gmatch://node/ code your friend copied from their Servers tab."
          submitLabel="Connect"
          onSubmit={(v) => { setCodeAskOpen(false); void joinByCode(v) }}
          onCancel={() => setCodeAskOpen(false)}
        />
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-orbit-fade-in">
          <div className="w-full max-w-md bg-surface-raised border border-border-glass rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-retro-fg">Delete Server</h3>
                  <p className="text-xs text-retro-muted font-mono truncate max-w-[240px]">{deleteTarget.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeletePasscode(''); setDeleteError('') }}
                className="text-retro-muted hover:text-retro-fg p-1 rounded-lg hover:bg-glass-w8 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-retro-muted space-y-2">
              <p>
                {mine(deleteTarget)
                  ? 'You are the owner of this server. You can unregister it from the central directory or remove it from your local list.'
                  : 'You do not own this server. You can enter the Central Admin Passcode to permanently delete it from the directory, or forget it from your local view.'}
              </p>

              {!mine(deleteTarget) && (
                <div className="space-y-1.5 pt-1">
                  <label className="block text-[10px] font-semibold text-retro-fg">
                    Central Admin Passcode
                  </label>
                  <input
                    type="password"
                    value={deletePasscode}
                    onChange={(e) => setDeletePasscode(e.target.value)}
                    placeholder="Enter central passcode (e.g. 1984)"
                    className="w-full px-3 py-2 rounded-xl bg-surface-canvas border border-border-glass text-xs font-mono text-retro-fg placeholder:text-retro-muted focus:outline-none focus:border-retro-accent"
                  />
                  <p className="text-[10px] text-retro-muted">
                    Required if deleting a server created by another identity or when unauthenticated.
                  </p>
                </div>
              )}

              {deleteError && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2 rounded-lg font-mono">
                  {deleteError}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => forgetLocalServer(deleteTarget)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-retro-muted hover:text-retro-fg hover:bg-glass-w8 border border-border-subtle transition-colors cursor-pointer"
              >
                Forget from local list
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setDeleteTarget(null); setDeletePasscode(''); setDeleteError('') }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-retro-muted hover:text-retro-fg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDeleteConfirm()}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {deleting ? 'Deleting...' : (mine(deleteTarget) ? 'Unregister & Delete' : 'Permanently Delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
            </div>
          </main>
        )}
      </div>
    </div>
  )
}
