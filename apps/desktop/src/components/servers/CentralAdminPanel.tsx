"use client";

// Central-node master admin over the public server directory (plan §5).
// Self-gating: it fetches the admin dashboard and renders NOTHING unless the
// central node authorizes this caller (ADMIN_PIN holder → Users.is_admin).
// Only ever hits the CENTRAL node's /api/servers/admin/* endpoints.
//
// Chrome is tokenized: the warning role owns both tints, the monospace number
// role owns counts/ids, and every card/badge/button reads ui/tokens.
import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, EyeOff, Eye, Trash2, RefreshCw } from 'lucide-react'
import { orbitFetch } from '../../utils/api'
import { playPress } from '../../utils/sounds'

import { generateIdentity } from '@orbit/crypto'
import { Button, Input } from '../../ui/kit'
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, PADDING, PADDING_X, PADDING_Y,
  RADIUS, STATUS, TYPE, WEIGHT,
} from '../../ui/tokens'

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

const statChip = classes(CHROME.badge, PADDING_X[2], PADDING_Y[1])
const smallBadge = classes(PADDING_X[1.5], 'py-0.5', RADIUS.pill, TYPE.caption, MONO)

export function CentralAdminPanel({ central, identity, toast }: { central: string; identity?: Identity | null; toast: Toast }) {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [rows, setRows] = useState<DirRow[]>([])
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!identity) {
        setAuthorized(false)
        setTotals(null)
        setRows([])
        return
      }
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
    } catch { toast('Couldn\'t reach the server.', 'error') } finally { setBusyId(null) }
  }

  const remove = async (row: DirRow) => {
    if (busyId) return
    if (!window.confirm(`Force-unregister "${row.name}" from the directory?`)) return
    setBusyId(row.id)
    try {
      const res = await orbitFetch(`${central}/api/servers/admin/directory/${row.id}`, { method: 'DELETE' }, identity)
      if (res.ok) { toast('Server unregistered.', 'success'); await load() }
      else toast('Only the central master can unregister', 'error')
    } catch { toast('Couldn\'t reach the server.', 'error') } finally { setBusyId(null) }
  }

  const [unlockPin, setUnlockPin] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!unlockPin.trim() || unlocking) return
    setUnlocking(true)
    try {
      let activeIdentity = identity
      if (!activeIdentity) {
        const created = generateIdentity()
        try {
          localStorage.setItem('orbit_identity', JSON.stringify(created))
          localStorage.setItem('orbit_display_name', 'DevAdmin')
          window.dispatchEvent(new CustomEvent('orbit-identity-changed', { detail: created }))
        } catch { /* private mode */ }
        activeIdentity = created
      }
      const res = await orbitFetch(`${central}/api/admin/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: unlockPin.trim() }),
      }, activeIdentity)
      if (res.ok) {
        toast('Central admin unlocked', 'success')
        setUnlockPin('')
        await load()
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error || 'Invalid secret passcode', 'error')
      }
    } catch {
      toast('Failed to reach central node', 'error')
    } finally {
      setUnlocking(false)
    }
  }

  if (!authorized) {
    const isDev = Boolean(import.meta.env.DEV) ||
      (typeof window !== 'undefined' &&
        (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'))

    return (
      <div className={classes(CHROME.tile, 'space-y-2.5', PADDING[3])} aria-label="Central admin login">
        <div className={classes('flex items-center', GAP[2])}>
          <ShieldCheck className={classes(ICON.md, STATUS.warning)} />
          <span className={classes(TYPE.body, WEIGHT.medium, COLOR.fg)}>Central Node Authentication</span>
        </div>
        <p className={classes(TYPE.body, COLOR.muted)}>
          Authenticate with the central node passcode to manage the directory.
        </p>
        {isDev && (
          <div className={classes(
            'flex items-center justify-between border',
            STATUS.warningBg, STATUS.warningEdgeSoft, STATUS.warning,
            PADDING_X[2.5], PADDING_Y[1.5], RADIUS.chip, TYPE.body,
          )}>
            <span>Dev mode: default passcode is <code className={classes(MONO, WEIGHT.bold, COLOR.interactive, PADDING_X[1], 'py-0.5', RADIUS.chip)}>admin</code></span>
            <button
              type="button"
              onClick={() => setUnlockPin('admin')}
              className={classes(TYPE.caption, WEIGHT.bold, 'underline cursor-pointer ml-2 shrink-0', COLOR.hoverFg)}
            >
              Use admin
            </button>
          </div>
        )}
        <form onSubmit={handleUnlock} className={classes('flex items-center', GAP[2])}>
          <Input
            type="password"
            value={unlockPin}
            onChange={(e) => setUnlockPin(e.target.value)}
            placeholder="Central admin passcode"
            className={classes('flex-1', MONO)}
          />
          <Button type="submit" variant="primary" size="sm" disabled={unlocking || !unlockPin.trim()}>
            {unlocking ? 'Verifying…' : 'Unlock'}
          </Button>
        </form>
      </div>
    )
  }

  return (
    <section className="space-y-2" aria-label="Central admin">
      <div className={classes('flex items-center', GAP[2])}>
        <ShieldCheck className={classes(ICON.md, STATUS.warning)} />
        <span className={classes(TYPE.body, WEIGHT.medium, COLOR.fg)}>Central admin</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { playPress(700); void load() }}
          className={classes('ml-auto', GAP[1])}
        >
          <RefreshCw className={ICON.sm} /> Refresh
        </Button>
      </div>

      {totals && (
        <div className={classes('flex flex-wrap', GAP[1.5], TYPE.body, MONO, COLOR.muted)}>
          <span className={statChip}>total {totals.total}</span>
          <span className={statChip}>online {totals.online}</span>
          <span className={statChip}>stale {totals.stale}</span>
          <span className={statChip}>hidden {totals.hidden}</span>
          <span className={statChip}>blocked {totals.blocked}</span>
        </div>
      )}

      <ul className="space-y-2">
        {loading && rows.length === 0 && <li className={classes(TYPE.body, COLOR.muted)}>Loading directory…</li>}
        {!loading && rows.length === 0 && <li className={classes(TYPE.body, COLOR.muted)}>Directory is empty.</li>}
        {rows.map((row) => (
          <li key={row.id} className={classes(CHROME.tile, 'flex items-start', PADDING[3], GAP[3], row.hidden ? 'opacity-60' : '')}>
            <div className="min-w-0 flex-1">
              <div className={classes('flex items-center', GAP[2])}>
                <span className={classes('truncate', TYPE.body, WEIGHT.medium, COLOR.fg)}>{row.name}</span>
                {!!row.hidden && <span className={classes(smallBadge, COLOR.glassW8, COLOR.muted)}>HIDDEN</span>}
                {!!row.blocked && <span className={classes(smallBadge, STATUS.dangerBg, STATUS.dangerEdge, STATUS.danger)}>BLOCKED</span>}
              </div>
              <p className={classes('mt-0.5 truncate', TYPE.caption, MONO, COLOR.muted)}>{row.endpoint_hint || 'no address'} · {row.id.slice(0, 8)}</p>
            </div>
            <div className={classes('flex items-center shrink-0', GAP[1])}>
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId === row.id}
                onClick={() => void patch(row, { hidden: !row.hidden }, row.hidden ? 'Unhidden' : 'Hidden from public')}
                title={row.hidden ? 'Show in public directory' : 'Hide from public directory'}
                aria-label={row.hidden ? 'Show in public directory' : 'Hide from public directory'}
              >
                {row.hidden ? <Eye className={ICON.sm} /> : <EyeOff className={ICON.sm} />}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busyId === row.id}
                onClick={() => void remove(row)}
                title="Force-unregister from directory"
                aria-label={`Force-unregister ${row.name} from directory`}
              >
                <Trash2 className={ICON.sm} />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
