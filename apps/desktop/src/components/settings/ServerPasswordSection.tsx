"use client";

// Host-side server password (plan T5.3): the admin of THIS node sets/clears
// the join password. Stored only on the node (scrypt hash in SystemMeta);
// the central directory just mirrors the "password required" badge.

import { useCallback, useEffect, useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import { orbitFetch } from '../../utils/api'
import { playPress } from '../../utils/sounds'

export function ServerPasswordSection({
  identity,
  isHost,
  toast,
}: {
  identity: Parameters<typeof orbitFetch>[2]
  isHost: boolean
  toast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await orbitFetch('/api/server/password-status', { method: 'GET' }, identity)
      if (res.ok) setEnabled(Boolean((await res.json() as { enabled?: boolean }).enabled))
    } catch { /* offline */ }
  }, [identity])

  useEffect(() => { void refresh() }, [refresh])

  if (!isHost) return null

  const submit = async (clear = false) => {
    if (busy) return
    setBusy(true)
    try {
      const body = clear ? '' : JSON.stringify({ password: value })
      const res = await orbitFetch('/api/server/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }, identity)
      if (res.ok) {
        const data = (await res.json()) as { enabled?: boolean }
        setEnabled(Boolean(data.enabled))
        setValue('')
        toast(data.enabled ? 'A password is now required to join' : 'Server password cleared', 'success')
      } else {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        toast(e.error || 'Could not change the password', 'error')
      }
    } catch {
      toast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        {enabled ? <Lock className="w-4 h-4 text-amber-400" /> : <Unlock className="w-4 h-4 text-retro-muted" />}
        <span className="text-xs font-medium text-retro-fg">
          {enabled ? 'Password required to join' : 'Open server (no password)'}
        </span>
      </div>
      <p className="text-[11px] text-retro-muted">
        New players must enter this password once; existing members keep access. The password never leaves your machine — only its hash is stored.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          aria-label="Server password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={enabled ? 'New password…' : 'Choose a password…'}
          minLength={4}
          maxLength={128}
          className="flex-1 min-w-0 bg-surface-raised border border-border-glass px-3 py-2 text-xs text-retro-fg rounded-lg outline-none focus:border-retro-accent/60"
        />
        <button
          type="button"
          disabled={busy || value.trim().length < 4}
          onClick={() => { playPress(880); void submit(false) }}
          className="px-3 py-2 rounded-lg bg-retro-accent text-black text-xs font-bold disabled:opacity-40 cursor-pointer"
        >
          Set password
        </button>
        {enabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { playPress(600); void submit(true) }}
            className="px-3 py-2 rounded-lg text-xs text-retro-muted hover:text-rose-400 border border-border-glass cursor-pointer"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}