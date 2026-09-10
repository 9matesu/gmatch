"use client";

// Central-node master admin over the public server directory (plan §5).
// Self-gating: it fetches the admin dashboard and renders NOTHING unless the
// central node authorizes this caller (ADMIN_PIN holder → Users.is_admin).
// Only ever hits the CENTRAL node's /api/servers/admin/* endpoints.
import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, EyeOff, Eye, Trash2, RefreshCw } from 'lucide-react'
import { orbitFetch } from '../../utils/api'
import { playPress } from '../../utils/sounds'

interface DirRow {
  id: string
  name: string
  description?: string
  owner_id: string
  endpoint_hint?: string
  password_required?: number
  hidden?: number
  blocked?: number
  master_note?: string | null
  last_seen?: string
}
interface Totals { total: number; online: number; stale: number; hidden: number; blocked: number }

type Identity = Parameters<typeof orbitFetch>[2]
type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

export function CentralAdminPanel({ central, identity, toast }: { central: string; identity: Identity; toast: Toast }) {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [rows, setRows] = useState<DirRow[]>([])
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const dash = await orbitFetch(`${central}/api/servers/admin/dashboard`, { method: 'GET' }, identity)
      if (!dash.ok) { setAuthorized(false); setTotals(null); setRows([]); return }
      setAuthorized(true)
      setTotals(((await dash.json()) as { totals: Totals }).totals)
      const dir = await orbitFetch(`${central}/api/servers/admin/directory`, { method: 'GET' }, identity)
      if (dir.ok) {
        const data = (await dir.json()) as { servers: DirRow[] }
        setRows(Array.isArray(data.servers) ? data.servers : [])
      }
    } catch {
      /* transient — keep last view */
    } finally {
      setLoading(false)
    }
  }, [central, identity])

  useEffect(() => { void load() }, [load])

  const patch = async (row: DirRow, body: Record<string, unknown>, label: string) => {
    if (busyId) return
    setBusyId(row.id)
    try {
      const raw = JSON.stringify(body)
      const res = await orbitFetch(`${central}/api/servers/admin/directory/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: raw,
      }, identity)
      if (res.ok) { toast(label, 'success'); await load() }
      else toast('Update failed', 'error')
    } catch { toast('Network error', 'error') } finally { setBusyId(null) }
  }

  const remove = async (row: DirRow) => {
    if (busyId) return
    if (!window.confirm(`Force-unregister "${row.name}" from the directory?`)) return
    setBusyId(row.id)
    try {
      const res = await orbitFetch(`${central}/api/servers/admin/directory/${row.id}`, { method: 'DELETE' }, identity)
      if (res.ok) { toast('Unregistered', 'success'); await load() }
      else toast('Only the central master can unregister', 'error')
    } catch { toast('Network error', 'error') } finally { setBusyId(null) }
  }

  if (!authorized) return null

  return (
    <section className="space-y-2" aria-label="Central admin">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-medium text-retro-fg">Central admin</span>
        <button
          type="button"
          onClick={() => { playPress(700); void load() }}
          className="glass-action ml-auto px-3 py-1.5 rounded-lg text-retro-muted hover:text-retro-fg text-[11px] font-bold cursor-pointer flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {totals && (
        <div className="flex flex-wrap gap-1.5 text-[11px] font-mono text-retro-muted">
          <span className="glass-inset px-2 py-1 rounded-full">total {totals.total}</span>
          <span className="glass-inset px-2 py-1 rounded-full">online {totals.online}</span>
          <span className="glass-inset px-2 py-1 rounded-full">stale {totals.stale}</span>
          <span className="glass-inset px-2 py-1 rounded-full">hidden {totals.hidden}</span>
          <span className="glass-inset px-2 py-1 rounded-full">blocked {totals.blocked}</span>
        </div>
      )}

      <ul className="space-y-2">
        {loading && rows.length === 0 && <li className="text-[11px] text-retro-muted">Loading directory…</li>}
        {!loading && rows.length === 0 && <li className="text-[11px] text-retro-muted">Directory is empty.</li>}
        {rows.map((row) => (
          <li key={row.id} className={`glass-card p-3 flex items-start gap-3 ${row.hidden ? 'opacity-60' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-retro-fg truncate">{row.name}</span>
                {!!row.hidden && <span className="text-[9px] px-1.5 py-0.5 rounded-full glass-inset text-retro-muted font-mono">HIDDEN</span>}
                {!!row.blocked && <span className="text-[9px] px-1.5 py-0.5 rounded-full glass-action-danger font-mono">BLOCKED</span>}
              </div>
              <p className="text-[10px] font-mono text-retro-muted mt-0.5 truncate">{row.endpoint_hint || 'no address'} · {row.id.slice(0, 8)}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => void patch(row, { hidden: !row.hidden }, row.hidden ? 'Unhidden' : 'Hidden from public')}
                title={row.hidden ? 'Show in public directory' : 'Hide from public directory'}
                className="glass-action p-1.5 rounded-lg text-retro-muted hover:text-retro-fg disabled:opacity-40 cursor-pointer"
              >
                {row.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => void remove(row)}
                title="Force-unregister from directory"
                className="glass-action glass-action-danger p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
