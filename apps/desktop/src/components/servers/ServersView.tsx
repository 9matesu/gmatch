"use client";

// Servers view (plan T3/T4, docs/ADR-002-servers.md). A "server" is a full
// gMatch node; the CENTRAL node only keeps a public directory of metadata.
// This tab: dashboard of the node you're on + discover/register/join others.
// Privacy: endpoint hints are fetched signed; the directory never sees content.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Server, Lock, Globe, Radio, UserPlus, ShieldCheck, RefreshCw, Pencil, Check, X, Users, Search, ArrowDownUp, ArrowLeft } from 'lucide-react'
import { getCentralApiUrl, setCentralApiUrl } from '../../utils/central'
import { orbitFetch } from '../../utils/api'
import { normalizeServerUrl } from '../../utils/serverUrl'
import { rememberJoin } from '../../utils/server-join'
import { playPress } from '../../utils/sounds'
import { CentralAdminPanel } from './CentralAdminPanel'

interface DirectoryServer {
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

interface Dashboard {
  name?: string
  users: Array<{ id: string; display_name?: string; online: boolean }>
  posts_24h: number
  members_total: number
}

interface ServerNode {
  name: string
  description: string
  directoryId?: string | null
  isAdmin: boolean
}

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

const DIRECTORY_ID_KEY = 'gmatch.server.directoryId'

export function ServersView({
  identity,
  toast,
  showRooms = false,
  onOpenRooms,
}: {
  identity: Parameters<typeof orbitFetch>[2]
  toast: Toast
  showRooms?: boolean
  onOpenRooms?: () => void
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

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const res = await orbitFetch(`${central}/api/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          endpoint_hint: hint.trim(),
          password_required: needsPassword,
        }),
      }, identity)
       if (res.ok) {
        // remember the (public) registration so the host heartbeat can replay it
        try {
          const created = await res.json()
          if (typeof created?.server?.id === 'string') localStorage.setItem(DIRECTORY_ID_KEY, created.server.id)
          localStorage.setItem('gmatch.server.register', JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            endpoint_hint: hint.trim(),
            password_required: needsPassword,
          }))
        } catch { /* session-only */ }
        toast('Server registered — it is listed for signed-in explorers', 'success')
        setShowCreate(false); setName(''); setDescription(''); setHint(''); setNeedsPassword(false)
        await refresh()
      } else {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        toast(e.error || 'Could not register server', 'error')
      }
    } catch {
      toast('Network error', 'error')
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
            else toast('Server renamed locally; directory update failed', 'warning')
          } catch {
            toast('Server renamed locally; directory is offline', 'warning')
          }
        }
      }
      toast('Server renamed', 'success')
      void refresh()
    } catch {
      toast('Network error', 'error')
    } finally {
      setRenaming(false)
    }
  }

  const join = async (s: DirectoryServer) => {
    const url = s.endpoint_hint
    if (!url) { toast('This server has no address to join (owner is offline?)', 'warning'); return }
    if (!window.gmatch?.serverSet) { toast('Joining servers works in the desktop app', 'warning'); return }
    let password: string | undefined
    if (s.password_required) {
      const entered = window.prompt(`"${s.name}" is password-protected. Enter the password:`)
      if (entered === null) return
      password = entered
    }
    // hand the password to the post-restart boot (one-shot, local only)
    const target = normalizeServerUrl(url) || normalizeServerUrl('http://' + url) || url
    if (password !== undefined) rememberJoin({ url: target, password })
    const res = await window.gmatch.serverSet({ mode: 'client', url: target })
    if (res.ok) {
      toast(`Switching to ${s.name} — the app restarts`, 'success')
      window.gmatch.serverRelaunch?.()
    } else {
      toast(res.error || 'Could not switch servers', 'error')
    }
  }

  const leave = async () => {
    if (!window.gmatch?.serverSet) return
    const res = await window.gmatch.serverSet({ mode: 'host', url: '' })
    if (res.ok) { toast('Returning to your own server — the app restarts', 'success'); window.gmatch.serverRelaunch?.() }
  }

  const unregister = async (s: DirectoryServer) => {
    if (!window.confirm(`Unregister "${s.name}" from the directory?`)) return
    const res = await orbitFetch(`${central}/api/servers/${s.id}`, { method: 'DELETE' }, identity)
    if (res.ok) {
      try { if (localStorage.getItem(DIRECTORY_ID_KEY) === s.id) localStorage.removeItem(DIRECTORY_ID_KEY) } catch { /* session-only */ }
      toast('Unregistered', 'success'); void refresh()
    }
    else toast('Only the owner can unregister a server', 'error')
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 animate-orbit-fade-in">
      {/* current-node dashboard */}
      <section className="glass-card p-4 space-y-3" aria-label="Server dashboard">
        <div className="flex flex-wrap items-center gap-2">
          <Radio className="w-4 h-4 text-retro-accent shrink-0" />
          <span className="text-xs font-medium text-retro-fg">This server</span>
          {dash && (
            <span className="ml-auto text-[10px] font-mono text-retro-muted">
              {dash.members_total} members · {dash.posts_24h} posts/24h
            </span>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-retro-fg">{serverName || 'gmatch'}</h2>
              {serverDescription && <p className="truncate text-[11px] text-retro-muted">{serverDescription}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {serverMode === 'client' && (
                <button
                  type="button"
                  onClick={() => { playPress(620); void leave() }}
                  className="glass-action glass-action-danger h-9 px-3 rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Leave
                </button>
              )}
              {showRooms && onOpenRooms && (
                <button
                  type="button"
                  onClick={() => { playPress(720); onOpenRooms() }}
                  className="glass-action h-9 px-3 rounded-lg text-[11px] font-bold cursor-pointer flex items-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5" /> Rooms
                </button>
              )}
              <button
                type="button"
                onClick={() => { playPress(780); setServerName(serverName); setEditingServer((v) => !v) }}
                aria-expanded={editingServer}
                className="glass-action h-9 px-3 rounded-lg text-[11px] font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" /> Rename
              </button>
            </div>
          </div>
          {editingServer && (
            <div className="glass-inset space-y-2 p-3">
              <label className="block text-[11px] text-retro-muted">
                Server name
                <input
                  aria-label="Current server name"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  maxLength={60}
                  className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
                />
              </label>
              <label className="block text-[11px] text-retro-muted">
                Description
                <input
                  aria-label="Current server description"
                  value={serverDescription}
                  onChange={(e) => setServerDescription(e.target.value)}
                  maxLength={200}
                  className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!serverName.trim() || renaming}
                  onClick={() => void renameServer()}
                  className="glass-action glass-action-primary h-9 px-3 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" /> Save name
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingServer(false); setServerName(node?.name || dash?.name || 'gmatch'); setServerDescription(node?.description || '') }}
                  className="glass-action h-9 px-3 rounded-lg text-xs text-retro-muted cursor-pointer flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {dash ? (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto" aria-label="User list">
            {dash.users.length === 0 && <li className="text-[11px] text-retro-muted col-span-full">No other users here yet.</li>}
            {dash.users.map((u) => (
              <li key={u.id} className="flex items-center gap-1.5 text-[11px] text-retro-fg truncate">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${u.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} aria-hidden />
                <span className="truncate">{u.display_name || u.id}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-retro-muted">Loading…</p>
        )}
      </section>

      {/* directory */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-retro-muted" />
          <span className="text-xs font-medium text-retro-fg">Central directory</span>
          {central && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => { playPress(760); setShowAdmin((v) => !v) }}
                aria-expanded={showAdmin}
                className="glass-action px-3 py-1.5 rounded-lg text-[11px] font-bold text-retro-muted hover:text-retro-fg cursor-pointer"
              >
                Central admin
              </button>
              <button
                type="button"
                onClick={() => { playPress(880); setShowCreate((v) => !v) }}
                aria-expanded={showCreate}
                className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
              >
                + Create server
              </button>
            </div>
          )}
        </div>

        {!central ? (
          <div className="glass-card p-4 space-y-2">
            <p className="text-[11px] text-retro-muted">
              No central node is configured yet, so there is no server network to
              discover. Your own server still works above &mdash; point it at a
              central address to list yours and explore others.
            </p>
            <label className="block text-[11px] text-retro-muted">
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
            {setupError && <p role="alert" className="text-[11px] text-rose-400">{setupError}</p>}
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

        {showCreate && (
          <div className="glass-card p-4 space-y-2">
            <label className="block text-[11px] text-retro-muted">
              Server name
              <input aria-label="Server name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs" />
            </label>
            <label className="block text-[11px] text-retro-muted">
              Description (public)
              <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
                className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs" />
            </label>
            <label className="block text-[11px] text-retro-muted">
              Address friends use (optional — LAN or public origin)
              <input aria-label="Address hint" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} placeholder="192.168.0.42:8790 or https://world.example"
                className="glass-field mt-1 w-full px-2.5 py-1.5 text-xs font-mono" />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-retro-muted cursor-pointer">
              <input type="checkbox" checked={needsPassword} onChange={(e) => setNeedsPassword(e.target.checked)} />
              Ask visitors for a password (set it under Settings → Server → "Open server")
            </label>
            <p className="text-[10px] text-retro-muted">
              Only this public metadata goes to the central directory. All game/social data stays on YOUR machine —
              you are the admin and you are bound by the same Terms and Privacy Policy (they apply to every server).
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={!name.trim() || busy} onClick={() => void create()}
                className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer">
                {busy ? '…' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="glass-action px-3 py-1.5 rounded-lg text-xs text-retro-muted cursor-pointer">Cancel</button>
            </div>
          </div>
        )}

        <div className="glass-card flex flex-wrap items-center gap-2 p-2">
            <div className="glass-field min-w-[180px] flex-1 flex items-center gap-2 px-2.5 py-1.5 text-xs">
              <Search className="w-3.5 h-3.5 text-retro-muted shrink-0" />
              <input
                aria-label="Search servers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search servers…"
                className="w-full bg-transparent text-retro-fg outline-none placeholder:text-retro-muted"
              />
            </div>
            <label className="flex items-center gap-2 text-[11px] text-retro-muted">
              <ArrowDownUp className="w-3.5 h-3.5" /> Sort
              <select
                aria-label="Sort servers"
                value={sort}
                onChange={(e) => setSort(e.target.value as 'recent' | 'name' | 'online')}
                className="glass-field px-2 py-1 text-[11px]"
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
              className={`glass-action h-9 px-3 rounded-lg text-[11px] font-bold cursor-pointer ${passwordOnly ? 'text-amber-200 border-amber-300/35 bg-amber-500/10' : 'text-retro-muted hover:text-retro-fg'}`}
            >
              Password only
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="glass-action h-9 px-3 rounded-lg text-[11px] font-bold text-retro-muted hover:text-retro-fg cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {dirError ? (
          <div className="glass-card p-3 text-[11px] text-retro-muted space-y-2">
            <p>
              Could not reach the central directory at <span className="font-mono">{central}</span>.
              It may be offline, or the address is wrong.
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
          {visibleServers.length === 0 && (
            <li className="glass-inset p-3 text-[11px] text-retro-muted">
              {servers.length === 0
                ? 'No other servers online right now. A server appears here while its host (or any player holding it) is running gMatch.'
                : 'No servers match your browser filters.'}
            </li>
          )}
          {visibleServers.map((s) => (
            <li key={s.id} className="glass-card p-3 flex items-start gap-3">
              <Globe className="w-4 h-4 text-retro-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-retro-fg truncate">{s.name}</span>
                  {!!s.password_required && <Lock className="w-3 h-3 text-amber-400 shrink-0" aria-label="password required" />}
                  {mine(s) && <span className="text-[9px] px-1.5 py-0.5 rounded-full glass-inset text-retro-fg font-mono">YOURS · ADMIN</span>}
                </div>
                {s.description && <p className="text-[11px] text-retro-muted truncate">{s.description}</p>}
                <p className="text-[10px] font-mono text-retro-muted mt-0.5">{s.endpoint_hint || 'no address published'}</p>
                {(typeof s.online_count === 'number' || typeof s.user_count === 'number') && (
                  <p className="text-[10px] text-retro-fg mt-1 flex items-center gap-1.5 font-mono">
                    <Users className="w-3 h-3 text-retro-muted" />
                    <span className="text-emerald-400">{s.online_count ?? 0}</span>
                    <span className="text-retro-muted">online · {s.user_count ?? '?'} members</span>
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {mine(s) ? (
                  <button type="button" onClick={() => void unregister(s)} className="glass-action glass-action-danger px-2.5 py-1.5 rounded-lg text-[10px] cursor-pointer">unregister</button>
                ) : (
                  <button type="button" onClick={() => void join(s)} className="glass-action glass-action-primary px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer">
                    <UserPlus className="w-3 h-3" /> Join
                  </button>
                )}
              </div>
            </li>
          ))}
          </ul>
        )}
        <p className="text-[10px] text-retro-muted flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3" />
          Private servers stay private: the directory only mirrors name, description and address — never content.
        </p>

        {/* Central master admin — self-hides unless this caller is the central ADMIN_PIN holder. */}
        {showAdmin && <CentralAdminPanel central={central} identity={identity} toast={toast} />}
          </>
        )}
      </section>
    </div>
  )
}