import { describe, expect, it, vi } from 'vitest'
import { SocialOperationLog, OPERATION_LOG_CHANGED_EVENT } from './socialOperationLog'
import { broadcastPendingOperations } from './socialOpTransport'
import { wireOperationBroadcast, BROADCAST_COALESCE_MS } from './socialOpBroadcast'

/**
 * A post made while a peer is ALREADY online must reach the network. The
 * transport used to wave only on boot and on peer-online, so the operation sat
 * at `committed` until one of the two reconnected.
 *
 * These tests pin the two rules that make the commit-triggered wave safe:
 * it only ever sends entries never handed out (so its own writes cannot make
 * it loop), and a burst of writes collapses into one wave.
 */

type Entry = Omit<Parameters<SocialOperationLog['append']>[0], 'record'> & { record: Record<string, unknown> }

function memoryBackend() {
  const store = new Map<string, Entry>()
  return {
    store,
    async put(entry: Entry) { store.set(entry.operationId, entry) },
    async get(id: string) { return (store.get(id) ?? null) as never },
    async getAll() { return [...store.values()] as never },
    async delete(id: string) { store.delete(id) },
  }
}

function op(n: number, overrides: Partial<Entry> = {}): Entry {
  return {
    operationId: String(n).repeat(64).slice(0, 64),
    actorId: 'a'.repeat(64),
    actorSequence: n,
    createdAt: 1_700_000_000_000 + n,
    record: { type: 'post.create', operationId: String(n).repeat(64).slice(0, 64) },
    ...overrides,
  }
}

/** A timer we drive by hand, so the test never waits on wall-clock time. */
function manualSchedule() {
  const queued: Array<() => void> = []
  const cancelled: number[] = []
  return {
    queued,
    cancelled,
    schedule: (run: () => void, delayMs: number) => {
      expect(delayMs).toBe(BROADCAST_COALESCE_MS)
      const index = queued.push(run) - 1
      return () => { cancelled.push(index) }
    },
  }
}

describe('an operation appended now is handed to the network now (L4 delivery)', () => {
  it('sends only entries never handed to the network', async () => {
    const log = new SocialOperationLog(memoryBackend())
    await log.append(op(1))
    await log.append(op(2))
    // Simulates an earlier boot wave: already handed out, retried on the next
    // boot/peer-online wave — never by the append-triggered one.
    await log.advanceStatus(op(1).operationId, 'sending')

    const sent: string[] = []
    await broadcastPendingOperations(log, (operation) => {
      sent.push(String((operation as { operationId: string }).operationId))
    }, { onlyUnsent: true })

    expect(sent).toEqual([op(2).operationId])
  })

  it('keeps selecting every undelivered entry for the boot/reconnect wave', async () => {
    const log = new SocialOperationLog(memoryBackend())
    await log.append(op(1))
    await log.append(op(2))
    await log.advanceStatus(op(1).operationId, 'sending')

    const sent: string[] = []
    await broadcastPendingOperations(log, (operation) => {
      sent.push(String((operation as { operationId: string }).operationId))
    })

    expect(sent).toEqual([op(1).operationId, op(2).operationId])
  })

  it('broadcasts a freshly appended operation once, coalescing the burst', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const target = new EventTarget()
    const timers = manualSchedule()
    const sent: string[] = []

    const teardown = wireOperationBroadcast({
      log,
      sendOperation: (operation) => { sent.push(String((operation as { operationId: string }).operationId)) },
      target,
      schedule: timers.schedule,
    })

    // Nothing is sent before a write: an idle log costs nothing.
    expect(timers.queued).toHaveLength(0)

    await log.append(op(1))
    target.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))
    await log.append(op(2))
    target.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))

    // Two writes, ONE scheduled wave.
    expect(timers.queued).toHaveLength(1)

    timers.queued[0]()
    await vi.waitFor(() => expect(sent).toEqual([op(1).operationId, op(2).operationId]))

    teardown()
  })

  it('sends nothing on a re-announcement and can be torn down', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const target = new EventTarget()
    const timers = manualSchedule()
    const sent: string[] = []
    const teardown = wireOperationBroadcast({
      log,
      sendOperation: (operation) => { sent.push(String((operation as { operationId: string }).operationId)) },
      target,
      schedule: timers.schedule,
    })

    await log.append(op(1))
    target.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))
    timers.queued[0]()
    await vi.waitFor(() => expect(sent).toEqual([op(1).operationId]))

    // The wave's own writes announce again; the entry is `sending` now, so the
    // follow-up wave sends nothing rather than re-sending on its own event.
    target.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))
    expect(timers.queued).toHaveLength(2)
    timers.queued[1]()
    await Promise.resolve()
    expect(sent).toEqual([op(1).operationId])

    teardown()
    target.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))
    expect(timers.queued).toHaveLength(2)
  })

  it('does nothing when a scheduled wave is cancelled by teardown', async () => {
    const log = new SocialOperationLog(memoryBackend())
    const target = new EventTarget()
    const timers = manualSchedule()
    const sent: string[] = []
    const teardown = wireOperationBroadcast({
      log,
      sendOperation: (operation) => { sent.push(String((operation as { operationId: string }).operationId)) },
      target,
      schedule: timers.schedule,
    })

    await log.append(op(1))
    target.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT))
    expect(timers.queued).toHaveLength(1)

    teardown()
    expect(timers.cancelled).toEqual([0])
    timers.queued[0]()
    await Promise.resolve()
    expect(sent).toEqual([])
  })

  it('survives without an event target (SSR / tests)', () => {
    const log = new SocialOperationLog(memoryBackend())
    expect(() => wireOperationBroadcast({ log, sendOperation: () => {}, target: null })()).not.toThrow()
  })
})