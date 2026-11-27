"use client";

// The world-switch loading screen. A switch is a real transition between two
// isolated ecosystems, so the old world stays on screen under this veil until
// the NEW node actually answers — and not before. There is no fake progress:
// the wait is a real health poll, and a node that never answers returns to the
// list with the real reason instead of hanging on "Connecting…".
//
// Success = the node answered /api/health with db_ready AND (when we know the
// expected world id) that world id. Only then does the caller remount.
import { useEffect, useRef, useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { worldGlyph, worldTileStyle } from './worldIdentity'
import { worldKeyFromAddress } from '../../utils/serverWorlds'
import {
  classes, COLOR, GAP, ICON, MOTION, PADDING, RADIUS, SHADOW, STATUS, TYPE, WEIGHT,
} from '../../ui/tokens'

export interface WorldSwitchTarget {
  /** Display name of the world being entered. */
  name: string
  /** Node base to poll (http(s)://host[:port]). */
  url: string
  /** Expected world id; when set, health must echo it before we settle. */
  worldId?: string
}

interface HealthBody {
  db_ready?: boolean
  world_id?: string | null
}

export function WorldSwitchOverlay({
  target,
  onSettled,
  onFail,
  intervalMs = 500,
  timeoutMs = 15000,
  fetchImpl,
}: {
  target: WorldSwitchTarget
  onSettled: () => void
  onFail: (reason: string) => void
  intervalMs?: number
  timeoutMs?: number
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
}) {
  const [error, setError] = useState<string | null>(null)
  // One settle/fail per mount, however the timers race.
  const done = useRef(false)
  const settledRef = useRef(onSettled)
  const failedRef = useRef(onFail)
  settledRef.current = onSettled
  failedRef.current = onFail

  useEffect(() => {
    done.current = false
    setError(null)
    const doFetch = fetchImpl || globalThis.fetch
    const base = target.url.replace(/\/+$/, '')
    const deadline = Date.now() + timeoutMs
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const finish = (ok: boolean, reason?: string) => {
      if (cancelled || done.current) return
      done.current = true
      if (ok) settledRef.current()
      else {
        setError(reason || 'This world did not answer in time.')
        failedRef.current(reason || 'This world did not answer in time.')
      }
    }

    const poll = async () => {
      // Every attempt is bounded: a hung connection (a half-started node
      // holding the socket) must not stall the loop until the deadline.
      const controller = new AbortController()
      const attemptTimer = setTimeout(() => controller.abort(), 4000)
      try {
        const res = await doFetch(`${base}/api/health`, { method: 'GET', signal: controller.signal })
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as HealthBody
          const ready = body?.db_ready === true
          const worldOk = !target.worldId || body?.world_id === target.worldId
          if (ready && worldOk) { finish(true); return }
        }
      } catch {
        /* not up yet (or this attempt timed out) — keep waiting until the deadline */
      } finally {
        clearTimeout(attemptTimer)
      }
      if (cancelled || done.current) return
      if (Date.now() >= deadline) {
        finish(false, `"${target.name}" did not come online. Check the address and try again.`)
        return
      }
      timer = setTimeout(poll, intervalMs)
    }
    void poll()

    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [target.url, target.worldId, target.name, intervalMs, timeoutMs, fetchImpl])

  const key = target.worldId || worldKeyFromAddress(target.url) || target.name

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="world-switch-overlay"
      className={classes(
        'fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center',
        COLOR.canvasVeil, 'backdrop-blur-md', GAP[3], PADDING[4],
      )}
    >
      <span
        className={classes(
          'flex size-20 items-center justify-center border shadow-xl',
          RADIUS.panel, TYPE.display, WEIGHT.bold, COLOR.fgSoft, SHADOW.large,
          error ? '' : MOTION.keyframe.pop,
        )}
        style={worldTileStyle(key)}
        aria-hidden
      >
        {worldGlyph(target.name)}
      </span>
      <p className={classes(TYPE.sub, WEIGHT.bold, COLOR.fg)}>
        Entering <span className={COLOR.accent}>{target.name}</span>
      </p>
      {error ? (
        <p className={classes('flex items-center max-w-sm text-center', GAP[2], TYPE.caption, STATUS.danger)}>
          <TriangleAlert className={ICON.sm} aria-hidden />
          {error}
        </p>
      ) : (
        <div className={classes('flex items-center', GAP[2], TYPE.caption, COLOR.muted)}>
          <Loader2 className={classes(ICON.sm, 'animate-spin')} aria-hidden />
          Waiting for this world&rsquo;s node
        </div>
      )}
    </div>
  )
}