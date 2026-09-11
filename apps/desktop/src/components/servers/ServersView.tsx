"use client";

// Servers view (plan T3/T4, docs/ADR-002-servers.md). A "server" is a full
// gMatch node; the CENTRAL node only keeps a public directory of metadata.
// 2-column coupled layout: Left = current node dashboard (24h users, rooms, stats);
// Right = public directory browser (search, join, create).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lock, Globe, UserPlus, ShieldCheck, RefreshCw, Pencil, Check, X, Search, ArrowDownUp, ArrowLeft, Clock, MessageSquare, Plus } from 'lucide-react'
import { getCentralApiUrl, setCentralApiUrl } from '../../utils/central'
import { orbitFetch } from '../../utils/api'
import { normalizeServerUrl } from '../../utils/serverUrl'
import { joinServer } from '../../utils/join-server'
import { rememberPendingHost } from '../../utils/server-host-pending'
import { claimPendingHost } from '../../hooks/usePendingServerHost'
import { playPress } from '../../utils/sounds'
import { CentralAdminPanel } from './CentralAdminPanel'
import type { User } from '@orbit/shared'

export interface DirectoryServer {
  id: string
  name: string
  description?: string
  owner_id: string
  password_required: number
  endpoint_hint?: string
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
}: {
  identity: Parameters<typeof orbitFetch>[2]
  toast: Toast
  showRooms?: boolean
  onOpenRooms?: () => void
  onSelectUser?: (user: User) => void
  profilePics?: Record<string, string>
  rooms?: ServerRoomPreview[]
  onOpenRoom?: (roomId: string) => void
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
  const [userTab, setUserTab] = useState<'online' | 'all24h'>('online')

  const refresh = useCallback(async () => {
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
    } catch { /* node without dashboard route — fine */ }

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

    if (!central) { setServers([]); setDirError(false); return }
    try {
      // cache-bust: orbitFetch dedups/caches GETs; the list must be fresh
      const res = await orbitFetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, identity)
      if (res.ok) {
        const data = (await res.json()) as { servers: DirectoryServer[] }
        setServers(Array.isArray(data.servers) ? data.servers : [])
        setDirError(false)
      } else {
        setDirError(true)
      }
    } catch {
      // Configured central is unreachable: surface it rather than fake "none online".
      setDirError(true)
    }
  }, [identity, central])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    window.gmatch?.serverState?.()
      .then((s) => setServerMode(s?.mode ?? null))
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
    return servers
      .filter((s) => !passwordOnly || s.password_required)
      .filter((s) => !q || `${s.name} ${s.description ?? ''} ${s.endpoint_hint ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name)
        if (sort === 'online') return (b.online_count ?? -1) - (a.online_count ?? -1)
        return String(b.last_seen ?? '').localeCompare(String(a.last_seen ?? ''))
      })
  }, [servers, query, sort, passwordOnly])

  const closeCreateForm = () => {
    setShowCreate(false); setName(''); setDescription(''); setHint(''); setNeedsPassword(false); setServerPassword('')
  }

  // Best-effort: list the (public) registration on the central directory.
  // Returns the created row (or null). The host heartbeat replays the saved
  // registration every 15min, so a dead directory here self-heals later.
  const registerDirectory = async (
    n: string, d: string, h: string, pwRequired: boolean,
  ): Promise<DirectoryServer | null> => {
    if (!central) return null
    try {
      const res = await orbitFetch(`${central}/api/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, description: d, endpoint_hint: h, password_required: pwRequired }),
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
            name: trimmed, description: desc, endpoint_hint: hintFinal, password_required: needsPassword,
          }))
        } catch { /* session-only */ }
        const listed = await registerDirectory(trimmed, desc, hintFinal, needsPassword)
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
      const listed = await registerDirectory(trimmed, desc, hintFinal, needsPassword)
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

  const mine = (s: DirectoryServer) => s.owner_id === (identity as unknown as { orbitId: string }).orbitId

  const renameServer = async () => {
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

  const join = async (s: DirectoryServer) => { void joinServer(s, toast) }

  const leave = async () => {
    if (!window.gmatch?.serverSet) return
    const res = await window.gmatch.serverSet({ mode: 'host', url: '' })
    if (res.ok) { toast('Returning to your own server. The app restarts.', 'success'); window.gmatch.serverRelaunch?.() }
  }

  const unregister = async (s: DirectoryServer) => {
    if (!window.confirm(`Unregister "${s.name}" from the directory?`)) return
    const res = await orbitFetch(`${central}/api/servers/${s.id}`, { method: 'DELETE' }, identity)
    if (res.ok) {
      try { if (localStorage.getItem(DIRECTORY_ID_KEY) === s.id) localStorage.removeItem(DIRECTORY_ID_KEY) } catch { /* session-only */ }
      toast('Server unregistered.', 'success'); void refresh()
    }
    else toast('Only the owner can unregister a server', 'error')
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
    <div className="h-full min-h-0 flex-1 overflow-hidden p-2 sm:p-4 animate-orbit-fade-in flex flex-col">
      {/* Unified dashboard: one continuous glass-surface, internal dividers, no floating cards */}
      <div className="glass-surface grid grid-cols-1 lg:grid-cols-[minmax(320px,34%)_1fr] gap-0 h-full min-h-0 flex-1 overflow-hidden rounded-xl">
        {/* LEFT COLUMN: Current Server & Member activity (24h) */}
        <aside className="flex flex-col min-h-0 h-full overflow-hidden lg:border-r lg:border-border-subtle" aria-label="Current server hub">
          {/* Current Node Hero */}
          <section className="p-3.5 space-y-3 shrink-0 border-b border-border-subtle" aria-label="Server dashboard">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="truncate text-base font-bold text-retro-fg leading-tight">{serverName || 'gmatch'}</h2>
                    {serverMode && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded font-mono uppercase tracking-wider glass-inset text-retro-muted border-border-subtle">
                        {serverMode}
                      </span>
                    )}
                    {node?.isAdmin && (
                      <span
                        className="text-[10px] px-1.5 py-0.2 rounded font-mono uppercase tracking-wider text-amber-200 border border-amber-400/30 bg-amber-400/10"
                        title="You administer this server"
                      >
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-retro-muted mt-0.5">
                    {dash ? `${dash.members_total} members · ${dash.posts_24h} posts/24h` : (serverDescription || 'Connected')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {serverMode === 'client' && (
                  <button
                    type="button"
                    onClick={() => { playPress(620); void leave() }}
                    className="glass-action glass-action-danger h-8 px-2.5 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Leave
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { playPress(780); setServerName(serverName); setEditingServer((v) => !v) }}
                  aria-expanded={editingServer}
                  title="Rename server"
                  className="glass-action h-8 px-2.5 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" /> Rename
                </button>
              </div>
            </div>

            {/* Inline Editor */}
            {editingServer && (
              <div className="glass-inset space-y-2 p-2.5 rounded-lg">
                <label className="block text-xs text-retro-muted">
                  Server name
                  <input
                    aria-label="Current server name"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    maxLength={60}
                    className="glass-field mt-1 w-full px-2.5 py-1 text-xs"
                  />
                </label>
                <label className="block text-xs text-retro-muted">
                  Description
                  <input
                    aria-label="Current server description"
                    value={serverDescription}
                    onChange={(e) => setServerDescription(e.target.value)}
                    maxLength={200}
                    className="glass-field mt-1 w-full px-2.5 py-1 text-xs"
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
                    onClick={() => { setEditingServer(false); setServerName(node?.name || dash?.name || 'gmatch'); setServerDescription(node?.description || '') }}
                    className="glass-action h-8 px-2.5 rounded-lg text-xs text-retro-muted cursor-pointer flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Connected Chat Rooms Preview (if courier mode is active) */}
          {showRooms && (
            <section className="p-3 space-y-2 shrink-0 border-b border-border-subtle">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-retro-fg flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-retro-accent" /> Active Rooms
                </span>
                {onOpenRooms && (
                  <button
                    type="button"
                    onClick={() => { playPress(720); onOpenRooms() }}
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
                  rooms.slice(0, 4).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        playPress(720)
                        if (onOpenRoom) onOpenRoom(r.id)
                        else if (onOpenRooms) onOpenRooms()
                      }}
                      className="glass-inset px-2 py-1 rounded-md text-xs font-medium text-retro-fg hover:border-retro-accent cursor-pointer transition-colors flex items-center gap-1"
                    >
                      <span>#{r.name}</span>
                    </button>
                  ))
                )}
              </div>
            </section>
          )}

          {/* Active Members & 24h Activity List */}
          <section className="flex-1 min-h-0 flex flex-col p-3 overflow-hidden" aria-label="Server members">
            <div className="flex items-center justify-between pb-2 border-b border-border-subtle shrink-0">
              <div className="flex items-center gap-1 glass-inset p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setUserTab('online')}
                  className={`px-2 py-1 rounded-md text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${
                    userTab === 'online' ? 'glass-nav-active text-retro-fg shadow-sm' : 'text-retro-muted hover:text-retro-fg'
                  }`}
                >
                  Online ({onlineUsers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setUserTab('all24h')}
                  className={`px-2 py-1 rounded-md text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${
                    userTab === 'all24h' ? 'glass-nav-active text-retro-fg shadow-sm' : 'text-retro-muted hover:text-retro-fg'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  Last 24h ({allUsers.length})
                </button>
              </div>
              <span className="text-[10px] text-retro-muted font-mono">{allUsers.length} total</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar pt-2 space-y-1.5 pr-0.5" aria-label="User list">
              {displayedUsers.length === 0 ? (
                <div className="text-center py-8 text-xs text-retro-muted">
                  {userTab === 'online' ? 'Nobody is active right this second.' : 'No other users seen in the past 24 hours.'}
                </div>
              ) : (
                displayedUsers.map((u) => {
                  const avatar = u.pfp_url || profilePics[u.id]
                  return (
                    <div
                      key={u.id}
                      onClick={() => handleUserClick(u)}
                      className="group flex items-center justify-between gap-2 p-1.5 rounded-lg glass-inset hover:border-border-strong transition-all cursor-pointer"
                      title={`${u.display_name || u.id} — click to view profile`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="relative w-7 h-7 rounded-full overflow-hidden glass-inset border-border-subtle shrink-0 flex items-center justify-center text-[10px] font-bold text-retro-muted">
                          {avatar ? (
                            <img src={avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span>{(u.display_name || u.id).slice(0, 2).toUpperCase()}</span>
                          )}
                          <span
                            className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-black ${
                              u.online ? 'bg-emerald-400' : 'bg-glass-w20'
                            }`}
                            aria-hidden
                          />
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
                  )
                })
              )}
            </div>
          </section>
        </aside>

        {/* RIGHT COLUMN: Public Directory Browser */}
        <main className="flex flex-col min-h-0 h-full gap-2 overflow-hidden p-3.5 sm:pl-0" aria-label="Server directory">
          {/* Header & Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 pb-2 border-b border-border-subtle">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-4 h-4 text-retro-accent shrink-0" />
              <h3 className="text-sm font-bold text-retro-fg truncate">
                Central directory
              </h3>
              {central && (
                <span className="text-[10px] font-mono text-retro-muted truncate max-w-[180px]">
                  ({central.replace(/^https?:\/\//, '')})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              {central && (
                <button
                  type="button"
                  onClick={() => { playPress(760); setShowAdmin((v) => !v) }}
                  aria-expanded={showAdmin}
                  className="glass-action h-8 px-2.5 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer"
                >
                  Central admin
                </button>
              )}
              <button
                type="button"
                onClick={() => { playPress(880); setShowCreate((v) => !v) }}
                aria-expanded={showCreate}
                className="glass-action glass-action-primary h-8 px-3 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Create server
              </button>
            </div>
          </div>

          {/* Create-server drawer — always available: hosting is local, the
              directory listing (central) is optional. */}
          {showCreate && (
            <div className="glass-panel p-3.5 space-y-2 shrink-0 rounded-xl border-retro-accent/40">
              <div className="flex items-center justify-between pb-1 border-b border-border-subtle">
                <span className="text-xs font-bold text-retro-fg">Create a server — hosted on this computer</span>
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
                  Address friends use (optional — LAN or origin)
                  <input aria-label="Address hint" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} placeholder="192.168.0.42:8790"
                    className="glass-field mt-0.5 w-full px-2.5 py-1 text-xs font-mono" />
                </label>
              </div>
              <label className="block text-xs text-retro-muted">
                Description (public)
                <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
                  className="glass-field mt-0.5 w-full px-2.5 py-1 text-xs" />
              </label>
              <label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer pt-0.5">
                <input type="checkbox" checked={needsPassword} onChange={(e) => setNeedsPassword(e.target.checked)} />
                Ask visitors for a join password
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
          {!central ? (
            <div className="glass-inset p-4 space-y-2 rounded-xl">
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
          ) : (
            <>
              {/* Search, Filter & Sort Toolbar */}
              <div className="glass-toolbar flex flex-wrap items-center gap-2 p-1.5 shrink-0">
                <div className="glass-field min-w-[160px] flex-1 flex items-center gap-1.5 px-2.5 py-1 text-xs">
                  <Search className="w-3.5 h-3.5 text-retro-muted shrink-0" />
                  <input
                    aria-label="Search servers"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search public servers…"
                    className="w-full bg-transparent text-retro-fg outline-none placeholder:text-retro-muted text-xs"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-retro-muted">
                  <ArrowDownUp className="w-3 h-3" />
                  <select
                    aria-label="Sort servers"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as 'recent' | 'name' | 'online')}
                    className="glass-field px-2 py-1 text-xs font-medium"
                  >
                    <option value="recent">Recent</option>
                    <option value="name">Name</option>
                    <option value="online">Most online</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setPasswordOnly((v) => !v)}
                  aria-pressed={passwordOnly}
                  className={`glass-action h-8 px-2.5 rounded-lg text-xs font-bold cursor-pointer ${passwordOnly ? 'glass-nav-active text-amber-200' : 'text-retro-muted hover:text-retro-fg'}`}
                >
                  Password only
                </button>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="glass-action h-8 px-2.5 rounded-lg text-xs font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {/* Directory Content List */}
              <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar pr-0.5">
                {dirError ? (
                  <div className="glass-inset p-3 text-xs text-retro-muted space-y-2 rounded-xl">
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
                  <ul className="space-y-1.5">
                    {visibleServers.length === 0 && (
                      <li className="glass-inset p-4 text-xs text-retro-muted text-center rounded-xl">
                        {servers.length === 0
                          ? 'No other servers online right now. A server appears here while its host is running gMatch.'
                          : 'No servers match your search filters.'}
                      </li>
                    )}
                    {visibleServers.map((s) => (
                      <li key={s.id} className="glass-inset p-2.5 flex items-start gap-2.5 rounded-xl hover:border-border-strong transition-colors">
                        <div className="p-1.5 rounded-lg glass-panel shrink-0 text-retro-accent">
                          <Globe className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-retro-fg truncate">{s.name}</span>
                            {!!s.password_required && (
                              <Lock className="w-3 h-3 text-amber-400 shrink-0" aria-label="password required" />
                            )}
                            {mine(s) && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono uppercase tracking-wider glass-inset text-retro-accent border border-retro-accent/30">
                                YOURS · ADMIN
                              </span>
                            )}
                          </div>
                          {s.description && (
                            <p className="text-xs text-retro-muted truncate mt-0.5">{s.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-retro-muted font-mono">
                            <span>{s.endpoint_hint || 'no address published'}</span>
                            {(typeof s.online_count === 'number' || typeof s.user_count === 'number') && (
                              <span className="text-retro-fg">
                                <strong>{s.online_count ?? 0}</strong> online · {s.user_count ?? '?'} members
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0 self-center">
                          {mine(s) ? (
                            <button
                              type="button"
                              onClick={() => void unregister(s)}
                              className="glass-action glass-action-danger px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer"
                            >
                              unregister
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void join(s)}
                              className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <UserPlus className="w-3 h-3" /> Join
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between text-[10px] text-retro-muted shrink-0 pt-1">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-retro-muted" /> Private: directory mirrors only metadata — never private content.
                </span>
              </div>

              {/* Central master admin drawer */}
              {showAdmin && <CentralAdminPanel central={central} identity={identity} toast={toast} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
