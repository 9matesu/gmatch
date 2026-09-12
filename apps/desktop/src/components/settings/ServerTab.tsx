"use client";

// Server tab (client/host topology): show what this install is —
// HOST (bundled server, shareable LAN addresses) or CLIENT (connected to a
// friend's server) — and let the user switch. Dev builds see read-only info.
import { useEffect, useState } from 'react'
import { Server, Wifi } from 'lucide-react'
import { playPress } from '../../utils/sounds'
import { isServerUrl, normalizeServerUrl } from '../../utils/serverUrl'
import { maskedServerUrl } from '../../utils/ipMask'
import { ServerPasswordSection } from './ServerPasswordSection'
import { SnapshotSection } from './SnapshotSection'
import { useIdentity } from '../../hooks/useIdentity'

type State = { packaged: boolean; mode: 'host' | 'client'; url: string; lanUrls: string[]; adminPin?: string }

export function ServerTab({ toast }: { toast?: (msg: string, type?: string) => void }) {
  const { identity } = useIdentity()
  const [state, setState] = useState<State | null>(null)
  const [clientUrl, setClientUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [restartPending, setRestartPending] = useState(false)

  useEffect(() => {
    window.gmatch?.serverState?.().then((s) => {
      setState(s)
      if (s?.mode === 'client') setClientUrl(s.url)
    }).catch(() => setState(null))
  }, [])

  if (!state) {
    return (
      <div className="p-4 text-xs text-retro-muted">
        Server info unavailable (browser dev mode?).
      </div>
    )
  }

  const save = async (mode: 'host' | 'client', url: string) => {
    if (!window.gmatch?.serverSet) return
    setSaving(true)
    const res = await window.gmatch.serverSet({ mode, url })
    setSaving(false)
    if (!res.ok) { toast?.(res.error || 'Could not save.'); return }
    toast?.(mode === 'host' ? 'Now hosting. Restart to apply.' : 'Connecting to a friend. Restart to apply.', 'success')
    if (window.gmatch.serverRelaunch && state.packaged) {
      setRestartPending(true)
    }
  }

  return (
    <div className="space-y-4 animate-orbit-fade-in">
      {state.mode === 'host' && identity && (
        <>
          <ServerPasswordSection identity={identity as never} isHost toast={(m, t) => toast?.(m, t)} />
          <SnapshotSection identity={identity as never} isHost toast={(m, t) => toast?.(m, t)} />
        </>
      )}
      <div className="glass-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-retro-accent" />
          <span className="text-xs font-medium text-retro-fg">
            {state.mode === 'host' ? 'This computer hosts the server' : 'Connected to a friend’s server'}
          </span>
          <span className={`glass-inset ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono ${state.mode === 'host' ? 'text-emerald-200' : 'text-retro-fg'}`}>
            {state.mode.toUpperCase()}
          </span>
        </div>
        <p className="text-xs text-retro-muted font-mono break-all">{maskedServerUrl(state.url)}</p>
        {state.mode === 'host' && state.adminPin && (
          <p className="text-xs text-retro-muted">
            Admin passcode (this node only):{' '}
            <button
              type="button"
              title="Copy passcode"
              onClick={() => { navigator.clipboard?.writeText(state.adminPin!); toast?.('Passcode copied', 'success') }}
              className="font-mono text-amber-200 hover:text-amber-100 cursor-pointer"
            >
              {state.adminPin}
            </button>
          </p>
        )}
        {state.packaged && (
          <p className="text-xs text-retro-muted">
            {state.mode === 'host'
              ? 'Enter one of these addresses into your friend’s Settings → Server to join your world. Click a row to copy the real address.'
              : 'All social data lives on the server you connected to. Switch back to Host anytime.'}
          </p>
        )}
        {state.mode === 'host' && state.lanUrls.length > 0 && (
          <div className="space-y-1 pt-1">
            {state.lanUrls.map((u) => (
              <button
                key={u}
                type="button"
                className="block w-full text-left font-mono text-xs text-retro-fg hover:text-retro-accent cursor-pointer"
                onClick={() => { void navigator.clipboard.writeText(u); toast?.('Address copied', 'success') }}
                title="Copy address"
              >
                <Wifi className="inline w-3 h-3 mr-1.5" />{maskedServerUrl(u)}
              </button>
            ))}
          </div>
        )}
      </div>

      {state.packaged && (
        <div className="p-4 bg-surface-interactive border border-border-glass rounded-lg space-y-3">
          <div className="text-xs font-medium text-retro-fg">Connect to a friend instead</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={clientUrl}
              onChange={(e) => setClientUrl(e.target.value)}
              placeholder="http://192.168.0.42:8790"
              aria-label="Friend server address"
              className="glass-field flex-1 px-3 py-2 text-xs font-mono"
            />
            <button
              type="button"
              disabled={saving || !isServerUrl(clientUrl)}
              onClick={() => { playPress(880); void save('client', normalizeServerUrl(clientUrl)!) }}
              className="glass-action glass-action-primary px-3 py-2 rounded-lg text-xs font-bold cursor-pointer"
            >
              Connect
            </button>
          </div>
          {state.mode === 'client' && (
            <button
              type="button"
              disabled={saving}
              onClick={() => { playPress(700); void save('host', '') }}
              className="text-xs text-retro-muted hover:text-retro-fg underline cursor-pointer"
            >
              Stop connecting and host my own server again
            </button>
          )}
        </div>
      )}

      {restartPending && (
        <div className="glass-panel p-3 flex items-center gap-3">
          <p className="text-xs text-retro-fg">Saved. Restart now to switch servers.</p>
          <button
            type="button"
            onClick={() => window.gmatch?.serverRelaunch?.()}
            className="ml-auto rounded-lg bg-retro-accent px-3 py-1.5 text-xs font-bold text-black hover:bg-retro-fg cursor-pointer"
          >
            Restart now
          </button>
          <button
            type="button"
            onClick={() => setRestartPending(false)}
            className="rounded-lg border border-border-glass px-3 py-1.5 text-xs text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            Later
          </button>
        </div>
      )}
    </div>
  )
}
