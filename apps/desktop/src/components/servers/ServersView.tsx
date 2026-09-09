"use client";

// Servers view (plan T3/T4, docs/ADR-002-servers.md). A "server" is a full
// gMatch node; the CENTRAL node only keeps a public directory of metadata.
// This tab: dashboard of the node you're on + discover/register/join others.
// Privacy: endpoint hints are fetched signed; the directory never sees content.

import { useCallback, useEffect, useState } from 'react'
import { Server, Lock, Globe, Radio, UserPlus, ShieldCheck } from 'lucide-react'
import { getCentralApiUrl, hasCentral } from '../../utils/central'
import { orbitFetch } from '../../utils/api'
import { normalizeServerUrl } from '../../utils/serverUrl'
import { rememberJoin } from '../../utils/server-join'
import { playPress } from '../../utils/sounds'

interface DirectoryServer {
  id: string
  name: string
  description?: string
  owner_id: string
  password_required: number
  endpoint_hint?: string
  last_seen?: string
}

interface Dashboard {
  name?: string
  users: Array<{ id: string; display_name?: string; online: boolean }>
  posts_24h: number
  members_total: number
}

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

export function ServersView({ identity, toast }: { identity: Parameters<typeof orbitFetch>[2]; toast: Toast }) {
  const central = getCentralApiUrl()
  const [servers, setServers] = useState<DirectoryServer[]>([])
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hint, setHint] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      // cache-bust: orbitFetch dedups/caches GETs; the list must be fresh
      const res = await orbitFetch(`${central}/api/servers?_ts=${Date.now()}`, { method: 'GET' }, identity)
      if (res.ok) {
        const data = (await res.json()) as { servers: DirectoryServer[] }
        setServers(Array.isArray(data.servers) ? data.servers : [])
      }
    } catch { /* offline — keep last list */ }
    try {
      // dashboard of the node the client is actually pointed at
      const d = await orbitFetch('/api/servers/dashboard', { method: 'GET' }, identity)
      if (d.ok) setDash((await d.json()) as Dashboard)
    } catch { /* node without directory routes — fine */ }
  }, [identity])

  useEffect(() => { void refresh() }, [refresh])

  if (!hasCentral()) {
    return (
      <div className="p-6 max-w-lg mx-auto space-y-2 animate-orbit-fade-in">
        <h2 className="text-sm font-semibold text-retro-fg">Servers</h2>
        <p className="text-xs text-retro-muted">
          No central node configured, so there is nothing to discover yet.
          Ask your administrator for the central address (Settings → Server),
          or share your LAN address directly — your friends connect through
          Settings → Server too.
        </p>
      </div>
    )
  }

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
    if (res.ok) { toast('Unregistered', 'success'); void refresh() }
    else toast('Only the owner can unregister a server', 'error')
  }

  const mine = (s: DirectoryServer) => s.owner_id === (identity as unknown as { orbitId: string }).orbitId

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 animate-orbit-fade-in">
      {/* current-node dashboard */}
      <section className="p-4 bg-surface-interactive border border-retro-border rounded-lg space-y-3" aria-label="Server dashboard">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-retro-accent" />
          <span className="text-xs font-medium text-retro-fg">This server</span>
          {dash && (
            <span className="ml-auto text-[10px] font-mono text-retro-muted">
              {dash.members_total} members · {dash.posts_24h} posts/24h
            </span>
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
          <span className="text-xs font-medium text-retro-fg">Server network</span>
          <button
            type="button"
            onClick={() => { playPress(880); setShowCreate((v) => !v) }}
            className="ml-auto px-2 py-1 rounded bg-retro-accent text-black text-[11px] font-bold cursor-pointer"
            aria-expanded={showCreate}
          >
            + Create server
          </button>
        </div>

        {showCreate && (
          <div className="p-4 bg-surface-raised border border-border-glass rounded-lg space-y-2">
            <label className="block text-[11px] text-retro-muted">
              Server name
              <input aria-label="Server name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                className="mt-1 w-full bg-surface-interactive border border-border-glass px-2 py-1.5 text-xs text-retro-fg rounded outline-none focus:border-retro-accent/60" />
            </label>
            <label className="block text-[11px] text-retro-muted">
              Description (public)
              <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
                className="mt-1 w-full bg-surface-interactive border border-border-glass px-2 py-1.5 text-xs text-retro-fg rounded outline-none focus:border-retro-accent/60" />
            </label>
            <label className="block text-[11px] text-retro-muted">
              Address friends use (optional — LAN or public origin)
              <input aria-label="Address hint" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={120} placeholder="192.168.0.42:8790 or https://world.example"
                className="mt-1 w-full bg-surface-interactive border border-border-glass px-2 py-1.5 text-xs text-retro-fg rounded outline-none font-mono focus:border-retro-accent/60" />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-retro-muted cursor-pointer">
              <input type="checkbox" checked={needsPassword} onChange={(e) => setNeedsPassword(e.target.checked)} />
              Ask visitors for a password (you set it on your own server under Settings → Server)
            </label>
            <p className="text-[10px] text-retro-muted">
              Only this public metadata goes to the central directory. All game/social data stays on YOUR machine —
              you are the admin and you are bound by the same Terms and Privacy Policy (they apply to every server).
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={!name.trim() || busy} onClick={() => void create()}
                className="px-3 py-1.5 rounded bg-retro-accent text-black text-xs font-bold disabled:opacity-40 cursor-pointer">
                {busy ? '…' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded text-xs text-retro-muted hover:text-retro-fg cursor-pointer">Cancel</button>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {servers.length === 0 && (
            <li className="p-3 text-[11px] text-retro-muted border border-dashed border-retro-border rounded-lg">
              No other servers online right now. A server appears here while its host (or any player holding it) is running gMatch.
            </li>
          )}
          {servers.map((s) => (
            <li key={s.id} className="p-3 bg-surface-interactive border border-retro-border rounded-lg flex items-start gap-3">
              <Globe className="w-4 h-4 text-retro-muted mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-retro-fg truncate">{s.name}</span>
                  {!!s.password_required && <Lock className="w-3 h-3 text-amber-400 shrink-0" aria-label="password required" />}
                  {mine(s) && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 font-mono">YOURS · ADMIN</span>}
                </div>
                {s.description && <p className="text-[11px] text-retro-muted truncate">{s.description}</p>}
                <p className="text-[10px] font-mono text-retro-muted mt-0.5">{s.endpoint_hint || 'no address published'}</p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {mine(s) ? (
                  <button type="button" onClick={() => void unregister(s)} className="px-2 py-1 rounded text-[10px] text-retro-muted hover:text-rose-400 cursor-pointer">unregister</button>
                ) : (
                  <button type="button" onClick={() => void join(s)} className="px-2.5 py-1 rounded bg-sky-500/15 text-sky-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:bg-sky-500/25">
                    <UserPlus className="w-3 h-3" /> Join
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-retro-muted flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3" />
          Private servers stay private: the directory only mirrors name, description and address — never content.
        </p>
      </section>
    </div>
  )
}