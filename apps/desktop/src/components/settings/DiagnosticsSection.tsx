"use client";
/**
 * Settings > Preferences: diagnostics + repairs for tech-savvy users.
 *
 * Every button is a REAL mechanism (health probe, bridge IPC, roster re-pull,
 * cache clear, sidecar respawn) and reports what actually happened. Nothing is
 * invented: a failed probe says it failed, and an unavailable bridge says so.
 * All side effects are injected so the component can be exercised in tests.
 */
import { useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import {
  ActivityIcon as Activity,
  ArrowsClockwise,
  Lightning,
  Trash,
  UsersThree,
} from '@phosphor-icons/react';
import { getApiBaseUrl, orbitFetch } from '../../utils/api';
import { fetchPresenceRoster } from '../../services/courierPresence';
import { clearImageCache, imageCacheStats } from '../../services/imageCache';
import { metricsSnapshot, type MetricsSnapshot } from '../../utils/metrics';

export interface HealthInfo {
  ok: boolean
  status: number | null
  body: Record<string, unknown> | null
  error?: string
}

export interface ServerInfo {
  packaged: boolean
  mode: 'host' | 'client'
  url: string
  lanUrls?: string[]
  pausedUrl?: string
  pausedReason?: string
}

export interface DiagnosticsSummary {
  at: number
  base: string
  server: ServerInfo | null
  health: HealthInfo
  peers: number | null
  metrics: MetricsSnapshot | null
}

/** Every external effect the panel needs, injectable for tests. */
export interface DiagnosticsDeps {
  getApiBase: () => string
  readServer: () => Promise<ServerInfo | null>
  probe: (url: string) => Promise<{ ok: boolean; status?: number; error?: string }>
  reconnect: (base: string) => Promise<{ mode: 'host' | 'client'; url: string; status?: number }>
  repullRoster: () => Promise<{ peers: number | null; via: string }>
  clearCache: () => Promise<{ files: number; bytes: number }>
  restartSidecar: () => Promise<{ ok: boolean; error?: string }>
  health: (base: string) => Promise<HealthInfo>
  countPeers: () => Promise<number | null>
  metrics: () => MetricsSnapshot | null
  logDev: (summary: DiagnosticsSummary) => void
}

type ActionKey = 'reconnect' | 'roster' | 'cache' | 'sidecar' | 'diagnose'
type ActionStatus = 'idle' | 'running' | 'ok' | 'error'
interface ActionResult { status: ActionStatus; message: string }
interface WorkResult { message: string; status?: 'ok' | 'error'; summary?: DiagnosticsSummary }

const IDLE: ActionResult = { status: 'idle', message: '' }

function failure(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  return String(e)
}

function trimBase(url: string): string {
  return (url || '').trim().replace(/\/+$/, '')
}

function healthLabel(health: HealthInfo): string {
  if (health.error) return health.error
  if (health.status === null) return 'no HTTP answer'
  const status = health.body && typeof health.body.status === 'string' ? ` (${health.body.status})` : ''
  return `HTTP ${health.status}${status}`
}

/**
 * Dev-only structured console dump. `enabled` defaults to the Vite DEV flag;
 * tests pass it explicitly so the grouping itself is verifiable.
 */
export function defaultDiagnosticsLog(summary: DiagnosticsSummary, enabled = import.meta.env.DEV): void {
  if (!enabled || typeof console === 'undefined') return
  const group = typeof console.groupCollapsed === 'function' ? console.groupCollapsed : console.group
  group.call(console, `gmatch diagnostics · ${new Date(summary.at).toISOString()}`)
  console.log('node', { base: summary.base, server: summary.server })
  console.log('health', summary.health)
  console.log('peers', summary.peers)
  console.log('metrics', summary.metrics)
  console.groupEnd?.()
}

/** Bridge-backed defaults. Browser/dev builds honestly report missing IPC. */
function makeDefaultDeps(identity: OrbitIdentity | null): DiagnosticsDeps {
  const probe = async (url: string): Promise<{ ok: boolean; status?: number; error?: string }> => {
    const g = window.gmatch
    if (!g?.serverProbe) {
      // Browser dev: there is no main-process probe, but the node is reachable
      // through the Vite proxy, so a direct health fetch is still real.
      try {
        const res = await fetch(`${trimBase(url)}/api/health`, { signal: AbortSignal.timeout(2500) })
        return { ok: res.ok, status: res.status }
      } catch (e) {
        return { ok: false, error: failure(e) }
      }
    }
    try {
      return await g.serverProbe(url)
    } catch (e) {
      return { ok: false, error: failure(e) }
    }
  }

  const readServer = async (): Promise<ServerInfo | null> => {
    const read = window.gmatch?.serverState
    if (!read) return null
    try {
      return (await read()) as ServerInfo
    } catch {
      return null
    }
  }

  const countPeers = async (): Promise<number | null> => {
    try {
      const res = await orbitFetch(
        '/api/users/online',
        { signal: AbortSignal.timeout(2500) },
        identity,
      )
      if (res.ok) {
        const data = await res.json() as { users?: unknown }
        if (Array.isArray(data?.users)) return data.users.length
      }
    } catch {
      /* courier/full-node mismatch or offline — try presence below */
    }
    try {
      // Bound the mailbox read: a dead node must not leave Diagnose spinning.
      const boundedFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(2500) })) as unknown as typeof globalThis.fetch
      const users = await fetchPresenceRoster(identity?.orbitId || undefined, boundedFetch)
      return Array.isArray(users) ? users.length : null
    } catch {
      return null
    }
  }

  const health = async (base: string): Promise<HealthInfo> => {
    try {
      const res = await fetch(`${trimBase(base)}/api/health`, { signal: AbortSignal.timeout(3000) })
      const text = await res.text()
      let body: Record<string, unknown> | null = null
      try {
        body = text ? JSON.parse(text) as Record<string, unknown> : null
      } catch {
        body = { note: 'non-JSON health body', preview: text.slice(0, 120) }
      }
      return { ok: res.ok, status: res.status, body }
    } catch (e) {
      return { ok: false, status: null, body: null, error: failure(e) }
    }
  }

  return {
    getApiBase: getApiBaseUrl,
    readServer,
    probe,
    health,
    countPeers,
    metrics: () => window.__gmatchMetrics?.snapshot() ?? metricsSnapshot(),
    logDev: (summary) => defaultDiagnosticsLog(summary),
    reconnect: async (base) => {
      const set = window.gmatch?.serverSet
      if (!set) throw new Error('Desktop app required to change the node')
      const server = await readServer()
      const client = server?.mode === 'client'
      const saved = client ? (server?.url || server?.pausedUrl || '') : ''
      const target = saved || trimBase(base)
      const checked = await probe(target)
      if (!checked.ok) {
        throw new Error(`Health probe failed for ${target || 'this node'}: ${checked.error || checked.status || 'no answer'}`)
      }
      const applied = await set({ mode: saved ? 'client' : 'host', url: saved })
      if (!applied.ok) throw new Error(applied.error || 'The node refused the change')
      return { mode: saved ? 'client' : 'host', url: target, status: checked.status }
    },
    repullRoster: async () => {
      const peers = await countPeers()
      // useP2P re-pulls the live roster on this event (its foreground burst).
      // The fetch above is the honest answer we can report; the event makes the
      // visible roster refresh through the app's own path.
      if (typeof document !== 'undefined') document.dispatchEvent(new Event('visibilitychange'))
      if (peers === null) throw new Error('Roster did not answer (node and presence mailboxes unavailable)')
      return { peers, via: 'online roster / presence' }
    },
    clearCache: async () => {
      const before = await imageCacheStats()
      const after = window.gmatch?.clearCache
        ? await window.gmatch.clearCache()
        : await clearImageCache()
      return { files: Math.max(0, before.files - after.files), bytes: Math.max(0, before.bytes - after.bytes) }
    },
    restartSidecar: async () => {
      const restart = window.gmatch?.restartSidecar
      if (!restart) throw new Error('Desktop app required to restart the local node')
      const res = await restart()
      if (!res.ok) throw new Error(res.error || 'The local node did not come back')
      return res
    },
  }
}

const ACTIONS: {
  key: ActionKey
  label: string
  button: string
  busy: string
  description: string
  icon: ComponentType<{ className?: string }>
}[] = [
  {
    key: 'diagnose',
    label: 'Diagnose',
    button: 'Diagnose',
    busy: 'Reading…',
    description: 'Read /api/health, session metrics and the online peer count. Changes nothing.',
    icon: Activity,
  },
  {
    key: 'reconnect',
    label: 'Reconnect node',
    button: 'Reconnect',
    busy: 'Checking…',
    description: 'Health-probe the saved node, then write the host/client pointer. Applies on next launch.',
    icon: ArrowsClockwise,
  },
  {
    key: 'roster',
    label: 'Re-pull roster',
    button: 'Re-pull roster',
    busy: 'Pulling…',
    description: 'Ask the node (or presence mailboxes) who is online and trigger the app’s foreground refresh.',
    icon: UsersThree,
  },
  {
    key: 'cache',
    label: 'Clear media cache',
    button: 'Clear cache',
    busy: 'Clearing…',
    description: 'Delete this device’s encrypted picture cache. Keepsakes and the media vault are untouched.',
    icon: Trash,
  },
  {
    key: 'sidecar',
    label: 'Restart sidecar',
    button: 'Restart sidecar',
    busy: 'Restarting…',
    description: 'Stop and respawn the bundled local API, then health-probe it. Host mode only.',
    icon: Lightning,
  },
]

export function DiagnosticsSection({
  identity,
  deps: injected,
}: {
  identity?: OrbitIdentity | null
  deps?: Partial<DiagnosticsDeps>
}) {
  // `injected` is read through a ref so the memo depends only on `identity`:
  // a caller passing a fresh object literal every render must not rebuild the
  // computed deps (and so every action's function identity) on each render.
  // Shortcut: injected deps are fixed until identity changes — upgrade when a
  // caller needs to swap deps mid-session.
  const injectedRef = useRef(injected)
  injectedRef.current = injected
  const deps = useMemo<DiagnosticsDeps>(
    () => ({ ...makeDefaultDeps(identity ?? null), ...injectedRef.current }),
    [identity],
  )
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const [results, setResults] = useState<Record<ActionKey, ActionResult>>({
    reconnect: IDLE, roster: IDLE, cache: IDLE, sidecar: IDLE, diagnose: IDLE,
  })
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null)

  const run = async (key: ActionKey, work: () => Promise<WorkResult>) => {
    if (busy) return
    setBusy(key)
    setResults((r) => ({ ...r, [key]: { status: 'running', message: 'Working…' } }))
    try {
      const out = await work()
      setResults((r) => ({ ...r, [key]: { status: out.status ?? 'ok', message: out.message } }))
      if (out.summary) {
        setSummary(out.summary)
        deps.logDev(out.summary)
      }
    } catch (e) {
      setResults((r) => ({ ...r, [key]: { status: 'error', message: failure(e) } }))
    } finally {
      setBusy(null)
    }
  }

  const diagnose = async (): Promise<WorkResult> => {
    const [server, base, health, peers, metrics] = await Promise.all([
      deps.readServer(),
      Promise.resolve(deps.getApiBase()),
      deps.health(deps.getApiBase()),
      deps.countPeers(),
      Promise.resolve(deps.metrics()),
    ])
    const report: DiagnosticsSummary = { at: Date.now(), base, server, health, peers, metrics }
    const counters = metrics?.counters
    const metricBits = counters
      ? `media ${counters['media.hit'] ?? 0} hit / ${counters['media.miss'] ?? 0} miss · swarm ${counters['swarm.ask'] ?? 0} asks · ${counters['http.404'] ?? 0} 404s`
      : 'metrics unavailable'
    return {
      status: health.ok ? 'ok' : 'error',
      message: `${healthLabel(health)} · ${peers ?? 'unknown'} peers · ${metricBits}`,
      summary: report,
    }
  }

  return (
    <div className="p-4 bg-glass-w5 border border-edge rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs font-medium uppercase tracking-wider text-retro-muted">
          Diagnostics &amp; fixes
        </span>
        <Activity className="w-4 h-4 text-retro-fg" />
      </div>
      <p className="text-xs text-retro-body">
        Real checks and repairs for this install. Every result below is what the
        mechanism actually reported — a failure says so.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ACTIONS.map((action) => {
          const result = results[action.key]
          const Icon = action.icon
          return (
            <div key={action.key} className="rounded-md border border-edge bg-glass-w5 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-retro-fg">{action.label}</span>
                <Icon className="w-3.5 h-3.5 text-retro-muted" />
              </div>
              <p className="text-2xs text-retro-muted leading-relaxed">{action.description}</p>
              <button
                type="button"
                onClick={() => void run(action.key, () => {
                  switch (action.key) {
                    case 'diagnose': return diagnose()
                    case 'reconnect': return deps.reconnect(deps.getApiBase())
                      .then((r) => ({ message: `Node pointer set: ${r.mode} → ${r.url || 'this machine'}${r.status ? ` (HTTP ${r.status})` : ''}. Relaunch to apply.` }))
                    case 'roster': return deps.repullRoster()
                      .then((r) => ({ message: `Roster re-pulled: ${r.peers ?? 0} peers via ${r.via}.` }))
                    case 'cache': return deps.clearCache()
                      .then((r) => ({ message: r.files > 0
                        ? `Cache cleared: ${r.files} pictures, ${(r.bytes / 1048576).toFixed(1)} MB freed.`
                        : 'Picture cache is already empty.' }))
                    case 'sidecar': return deps.restartSidecar()
                      .then(() => ({ message: 'Local API restarted and answered /api/health.' }))
                    default: return Promise.resolve({ message: 'Unknown action.' })
                  }
                })}
                disabled={busy !== null}
                className="px-2.5 py-1.5 bg-glass-w8 hover:bg-glass-w12 disabled:opacity-50 disabled:cursor-not-allowed border border-edge rounded-md text-xs font-medium text-retro-fg cursor-pointer"
              >
                {busy === action.key ? action.busy : action.button}
              </button>
              {result.status !== 'idle' && (
                <p
                  role="status"
                  aria-live="polite"
                  className={`text-2xs leading-relaxed break-words ${result.status === 'error'
                    ? 'text-retro-error'
                    : result.status === 'ok' ? 'text-success-fg' : 'text-retro-muted'}`}
                >
                  {result.status === 'running' ? 'Working…' : result.message}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Dev prints a console group instead; the raw dump is for non-dev. */}
      {summary && !import.meta.env.DEV && (
        <div className="space-y-1.5">
          <div className="text-2xs font-medium uppercase tracking-wider text-retro-muted">
            Last diagnosis (raw)
          </div>
          <pre className="max-h-40 overflow-auto rounded-md border border-edge bg-surface-raised p-3 text-2xs font-mono text-retro-muted whitespace-pre-wrap">
            {JSON.stringify(summary, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
