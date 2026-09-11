"use client";

// Admin snapshot export/import (plan T6): JSON handoff of the node's world so
// a server survives its host going away for good. Admin-only; the central
// directory never sees these files.

import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { orbitFetch } from '../../utils/api'
import { playPress } from '../../utils/sounds'

export function SnapshotSection({
  identity,
  isHost,
  toast,
}: {
  identity: Parameters<typeof orbitFetch>[2]
  isHost: boolean
  toast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void
}) {
  const [busy, setBusy] = useState(false)

  if (!isHost) return null

  const exportSnapshot = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await orbitFetch('/api/snapshot', { method: 'GET' }, identity)
      if (!res.ok) {
        toast(res.status === 403 ? 'Admin only' : 'Export failed', 'error')
        return
      }
      const text = JSON.stringify(await res.json(), null, 2)
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `gmatch-snapshot-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Snapshot exported — keep the file safe', 'success')
    } catch {
      toast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  const importSnapshot = async (file: File) => {
    if (busy) return
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      toast('That file is not valid JSON', 'error')
      return
    }
    if (!window.confirm('Importing OVERWRITES matching rows on this server (users, posts, economy…). Continue?')) return
    setBusy(true)
    try {
      const body = JSON.stringify(parsed)
      const res = await orbitFetch('/api/snapshot/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }, identity)
      if (res.ok) {
        const data = (await res.json()) as { restored?: Record<string, number> }
        const total = Object.values(data.restored || {}).reduce((a, b) => a + b, 0)
        toast(`Snapshot imported — ${total} rows restored`, 'success')
      } else {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        toast(e.error || 'Import failed', 'error')
      }
    } catch {
      toast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-2">
      <div className="text-xs font-medium text-retro-fg">Server snapshot (admin)</div>
      <p className="text-xs text-retro-muted">
        Back up or hand over this server's world (posts, economy, chats) as a single JSON file.
        Only you, the host, can export it — and it never passes through the central directory.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => { playPress(880); void exportSnapshot() }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-raised border border-border-glass text-xs text-retro-fg hover:border-retro-accent/60 disabled:opacity-40 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" /> Export snapshot
        </button>
        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-raised border border-border-glass text-xs text-retro-fg hover:border-retro-accent/60 cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> Import…
          <input
            type="file"
            accept="application/json"
            aria-label="Snapshot file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importSnapshot(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
    </div>
  )
}