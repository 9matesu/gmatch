import { useEffect } from 'react'
import { orbitFetch } from '../utils/api'
import { usePresence, type PresenceSubjectLike } from '../game/presenceStore'

/**
 * ONE presence poll for the whole app.
 *
 * Every surface that wants presence used to run its own setInterval against
 * /api/servers/dashboard. Mount the chat list and the servers screen together
 * and the same endpoint was being hit several times a minute, and each poller
 * kept its own copy of the answer — which is the root of consumers disagreeing
 * about who is online.
 *
 * This is reference-counted: the interval only exists while at least one
 * consumer is mounted, and the last consumer to unmount tears it down. A
 * change of identity restarts the poll against the new node.
 *
 * Cadence: 30s. isUserOnline's freshness window is 60s, so two missed polls
 * can elapse before a genuine departure shows up; that is the intended
 * trade-off and it matches the cadence the chat list already used.
 */
const POLL_MS = 30_000

type Identity = Parameters<typeof orbitFetch>[2]

let consumers = 0
let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false
let currentIdentity: Identity | null = null

async function poll(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    // The dashboard answers without an identity too, and it must: the chat
    // header shows the server's online/24h counts before the local identity has
    // finished loading. Passing null is correct here, not a degraded path.
    const res = await orbitFetch('/api/servers/dashboard', { method: 'GET' }, currentIdentity)
    if (!res.ok) return
    const d = (await res.json()) as {
      users?: PresenceSubjectLike[]
      online_count?: number
      active_24h_count?: number
    }
    if (!Array.isArray(d?.users)) return
    usePresence.getState().ingest(
      d.users,
      typeof d.online_count === 'number' && typeof d.active_24h_count === 'number'
        ? { online: d.online_count, active: d.active_24h_count }
        : null,
    )
  } catch {
    // Offline or the node is down. Presence decays on its own; never throw.
  } finally {
    inFlight = false
  }
}

function start(): void {
  if (timer) return
  void poll()
  timer = setInterval(() => void poll(), POLL_MS)
}

function stop(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

/**
 * Subscribe to the shared presence feed. Mounting this hook is also the
 * request to keep polling.
 */
export function usePresencePoll(identity: Identity | null): void {
  useEffect(() => {
    consumers += 1
    return () => {
      consumers -= 1
      if (consumers === 0) stop()
    }
  }, [])

  useEffect(() => {
    // A new identity means a (possibly) different node, so the previous
    // answer is stale — repoll immediately.
    const changed = currentIdentity !== identity
    currentIdentity = identity
    if (changed) void poll()
    start()
  }, [identity])
}

/** Test hook: drop all poll state. */
export function __resetPresencePollForTests(): void {
  stop()
  consumers = 0
  inFlight = false
  currentIdentity = null
}
