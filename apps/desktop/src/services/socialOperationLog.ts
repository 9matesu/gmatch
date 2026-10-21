"use client";

/**
 * Durable local operation log (roadmap L1, slice 1).
 *
 * Every accepted social mutation is appended here BEFORE any network call, so
 * a crash never loses a locally committed operation: on boot the replay
 * driver walks `listPendingOperations()` and retries each undelivered entry
 * idempotently (operationId is the dedupe key everywhere downstream).
 *
 * Contract notes (deliberate, see docs/LOCAL-FIRST-ROADMAP.md L1):
 * - Appends are immutable: re-appending an existing operationId is a no-op
 *   that returns the original entry and never rewrites it.
 * - Status only advances (committed -> sending -> delivered), so a crash
 *   between a remote ack and the local status write replays as a duplicate
 *   delivery, which downstream idempotence already absorbs.
 * - Storage failures THROW. A caller that swallows them is claiming local
 *   durability it does not have — the UI must treat a failed append as
 *   "not committed locally".
 * - The append and the in-memory/feed projection update are two stores; a
 *   crash between them is recovered by replay, which must apply by
 *   operationId idempotently (same rule as every other apply path).
 * - Entries are never silently dropped: at capacity the OLDEST DELIVERED
 *   entries are evicted first, then entries stuck in 'sending' past
 *   SENDING_EVICT_MS (already broadcast; actor heads are still never evicted,
 *   and authorization tolerates the resulting detectable gaps). Fresh
 *   undelivered entries are never evicted.
 */

export type OperationLogStatus = 'committed' | 'sending' | 'delivered'

export interface LoggedOperation {
  operationId: string
  actorId: string
  actorSequence: number
  createdAt: number
  /** The full signed operation record (shape-checked, not re-verified here). */
  record: Record<string, unknown>
  status: OperationLogStatus
  attempts: number
  updatedAt: number
}

export interface OperationLogBackend {
  put(entry: LoggedOperation): Promise<void>
  get(operationId: string): Promise<LoggedOperation | null>
  getAll(): Promise<LoggedOperation[]>
  delete(operationId: string): Promise<void>
}

export const MAX_LOG_ENTRIES = 512
export const MAX_RECORD_BYTES = 64 * 1024
/** Delivered entries linger this long so reconciliation can see them. */
export const DELIVERED_GRACE_MS = 5 * 60_000
/** A broadcast operation stuck in 'sending' this long is evictable: it was
 *  handed to the network repeatedly; keeping it forever would fill the log
 *  (broadcast has no delivery proof — see socialOpTransport). */
export const SENDING_EVICT_MS = 7 * 24 * 3600_000

const HEX64 = /^[0-9a-f]{64}$/
const STATUS_RANK: Record<OperationLogStatus, number> = { committed: 0, sending: 1, delivered: 2 }

/**
 * Process-wide revision of the durable log.
 *
 * Every instance reads through the same IndexedDB store, so a per-instance
 * cache would go stale the moment another instance writes. Reading is the hot
 * path — inbound replication validates each operation against its actor's
 * retained history, which used to mean one full store scan PER OPERATION
 * (O(n^2) for a sync wave). Instances therefore cache the entry list and key
 * the cache on this shared counter; any write from any instance invalidates
 * every cache in the process with one integer compare.
 */
let logRevision = 0

/** Revision the cached read is valid for (diagnostics/tests). */
export function currentOperationLogRevision(): number {
  return logRevision
}

/** Fired after a durable write so projections/UI can refresh. */
export const OPERATION_LOG_CHANGED_EVENT = 'gmatch:operation-log-changed'

function bumpLogRevision(): void {
  logRevision += 1
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try { window.dispatchEvent(new Event(OPERATION_LOG_CHANGED_EVENT)) } catch { /* no DOM */ }
  }
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** Highest-sequence entry per actor. Heads must never be pruned or evicted:
 *  the next chained write references them, and losing one forks the actor. */
function actorHeads(all: LoggedOperation[]): Map<string, LoggedOperation> {
  const heads = new Map<string, LoggedOperation>()
  for (const entry of all) {
    if (!isValidLogEntryShape(entry)) continue
    const current = heads.get(entry.actorId)
    if (!current || entry.actorSequence > current.actorSequence) heads.set(entry.actorId, entry)
  }
  return heads
}

function serializeSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export function isValidLogEntryShape(value: unknown): value is LoggedOperation {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  const { operationId, actorId, actorSequence, createdAt, record, status, attempts, updatedAt } = entry
  return typeof operationId === 'string' && HEX64.test(operationId) &&
    typeof actorId === 'string' && actorId.length > 0 && actorId.length <= 128 &&
    isSafeInt(actorSequence) && actorSequence >= 1 &&
    isSafeInt(createdAt) && createdAt >= 0 &&
    !!record && typeof record === 'object' && !Array.isArray(record) &&
    (status === 'committed' || status === 'sending' || status === 'delivered') &&
    isSafeInt(attempts) && attempts >= 0 &&
    isSafeInt(updatedAt) && updatedAt >= 0
}

export interface AppendResult {
  outcome: 'appended' | 'duplicate'
  entry: LoggedOperation
}

export class SocialOperationLog {
  private readonly maxEntries: number
  /** Entry-list cache, valid only for `logRevision` (see bumpLogRevision). */
  private cachedEntries: { revision: number; entries: LoggedOperation[] } | null = null

  constructor(
    private readonly backend: OperationLogBackend,
    options: { maxEntries?: number } = {},
  ) {
    this.maxEntries = options.maxEntries ?? MAX_LOG_ENTRIES
  }

  /**
   * Every valid entry, cached until any instance writes. The returned array is
   * shared: callers must treat it as read-only (all public readers copy or
   * filter into a new array).
   */
  private async allEntries(): Promise<LoggedOperation[]> {
    if (this.cachedEntries && this.cachedEntries.revision === logRevision) {
      return this.cachedEntries.entries
    }
    const entries = (await this.backend.getAll()).filter(isValidLogEntryShape)
    this.cachedEntries = { revision: logRevision, entries }
    return entries
  }

  async append(input: {
    operationId: string
    actorId: string
    actorSequence: number
    createdAt: number
    record: Record<string, unknown>
  }): Promise<AppendResult> {
    if (!HEX64.test(input.operationId)) throw new Error('invalid operation id')
    const size = serializeSize(input.record)
    if (size > MAX_RECORD_BYTES) throw new Error('operation record too large for the durable log')
    const existing = await this.backend.get(input.operationId)
    if (existing) return { outcome: 'duplicate', entry: existing }
    const now = Date.now()
    const entry: LoggedOperation = {
      ...input,
      status: 'committed',
      attempts: 0,
      updatedAt: now,
    }
    if (!isValidLogEntryShape(entry)) throw new Error('invalid log entry')
    // Capacity: evict oldest delivered first, then long-stuck 'sending'
    // entries (already broadcast); never evict fresh pending work, actor
    // chain heads, or anything else.
    const all = await this.allEntries()
    if (all.length >= this.maxEntries) {
      const now = Date.now()
      const protectedIds = new Set([...actorHeads(all).values()].map((head) => head.operationId))
      const evictable = all
        .filter((candidate) => !protectedIds.has(candidate.operationId) && (
          candidate.status === 'delivered' ||
          (candidate.status === 'sending' && now - candidate.updatedAt > SENDING_EVICT_MS)
        ))
        .sort((a, b) => a.updatedAt - b.updatedAt)
      let room = all.length
      const limit = this.maxEntries - 1
      for (const victim of evictable) {
        if (room <= limit) break
        await this.backend.delete(victim.operationId)
        bumpLogRevision()
        room -= 1
      }
      if (room > limit) throw new Error('operation log is full of undelivered entries')
    }
    await this.backend.put(entry)
    bumpLogRevision()
    return { outcome: 'appended', entry }
  }

  /** One entry (status/attempts included) or null — ack/validation reads. */
  async getEntry(operationId: string): Promise<LoggedOperation | null> {
    if (!HEX64.test(operationId)) return null
    return this.backend.get(operationId)
  }

  /** Every valid entry, unordered — feed projection input. The array is a
   *  copy, so callers may sort it. */
  async listAllOperations(): Promise<LoggedOperation[]> {
    return [...await this.allEntries()]
  }

  /** Fast duplicate check for inbound transports (append is still the
   *  authoritative dedupe — this is the cheap pre-check). */
  async hasOperation(operationId: string): Promise<boolean> {
    return !!(await this.backend.get(operationId))
  }

  /** Monotonic status advance; returns false on a rejected downgrade/no-op. */
  async advanceStatus(operationId: string, status: OperationLogStatus): Promise<boolean> {
    const entry = await this.backend.get(operationId)
    if (!entry) return false
    if (STATUS_RANK[status] <= STATUS_RANK[entry.status]) return false
    const updated = { ...entry, status, updatedAt: Date.now() }
    if (!isValidLogEntryShape(updated)) throw new Error('corrupted log entry')
    await this.backend.put(updated)
    bumpLogRevision()
    return true
  }

  /** Record one delivery attempt (retry backoff reads this on replay). */
  async bumpAttempts(operationId: string): Promise<boolean> {
    const entry = await this.backend.get(operationId)
    if (!entry) return false
    const updated = { ...entry, attempts: entry.attempts + 1, updatedAt: Date.now() }
    await this.backend.put(updated)
    bumpLogRevision()
    return true
  }

  /** Undelivered entries, oldest first — the boot/reconnect replay order. */
  async listPendingOperations(): Promise<LoggedOperation[]> {
    const all = await this.allEntries()
    return all
      .filter((entry) => entry.status !== 'delivered')
      .sort((a, b) => a.createdAt - b.createdAt || (a.operationId < b.operationId ? -1 : 1))
  }

  /** One actor's entries, highest sequence first (chain head first). */
  async listOperationsByActor(actorId: string): Promise<LoggedOperation[]> {
    const all = await this.allEntries()
    return all
      .filter((entry) => entry.actorId === actorId)
      .sort((a, b) => b.actorSequence - a.actorSequence)
  }

  /**
   * The next (actorSequence, previousOperationId) slot for a new chained
   * write. Reads the actor's retained head; sequence gaps from pruning are
   * fine, but two retained entries at the same max sequence is a fork and
   * refuses to chain further writes onto it.
   */
  async nextActorSlot(actorId: string): Promise<{ actorSequence: number; previousOperationId: string | null }> {
    const ops = await this.listOperationsByActor(actorId)
    if (ops.length === 0) return { actorSequence: 1, previousOperationId: null }
    const head = ops[0]
    if (ops.filter((entry) => entry.actorSequence === head.actorSequence).length > 1) {
      throw new Error(`operation log contains a sequence fork for actor ${actorId}`)
    }
    return { actorSequence: head.actorSequence + 1, previousOperationId: head.operationId }
  }

  /** Drop delivered entries past the grace window; undelivered entries and
   *  actor chain heads are never dropped (a missing head forks the actor). */
  async prune(now = Date.now()): Promise<number> {
    const all = await this.allEntries()
    const protectedIds = new Set([...actorHeads(all).values()].map((head) => head.operationId))
    let removed = 0
    for (const entry of all) {
      if (entry.status === 'delivered' && now - entry.updatedAt > DELIVERED_GRACE_MS && !protectedIds.has(entry.operationId)) {
        await this.backend.delete(entry.operationId)
        bumpLogRevision()
        removed += 1
      }
    }
    return removed
  }

  /**
   * Replay driver: walk every pending entry once, oldest first, and try to
   * deliver it. Called on boot, on reconnect, and after each publish.
   *
   * Recovery contract for every crash boundary:
   * - crash before append        -> entry never existed, nothing to lose;
   * - crash after append         -> next flush sees status 'committed';
   * - crash mid-send             -> status stuck at 'sending', which is still
   *                                 pending, so the next flush retries it;
   * - crash after remote ack but
   *   before the local status
   *   update                     -> the retry re-delivers; downstream applies
   *                                 by operationId, so the duplicate is a no-op.
   *
   * `deliver` returning true means durably accepted remotely (or already
   * present there — same verdict). False/throw means retry later; the entry
   * stays pending with attempts bumped.
   */
  async flushPendingOperations(deliver: (entry: LoggedOperation) => Promise<boolean>): Promise<{ delivered: number; retried: number }> {
    const summary = { delivered: 0, retried: 0 }
    const pending = await this.listPendingOperations()
    for (const entry of pending) {
      await this.advanceStatus(entry.operationId, 'sending')
      await this.bumpAttempts(entry.operationId)
      let ok = false
      try {
        ok = await deliver(entry)
      } catch {
        ok = false
      }
      if (ok) {
        await this.advanceStatus(entry.operationId, 'delivered')
        summary.delivered += 1
      } else {
        summary.retried += 1
      }
    }
    return summary
  }
}

// ---- IndexedDB backend (renderer; mirrors utils/storage.ts patterns) ----

const DB_NAME = 'gmatch-operation-log'
const DB_VERSION = 1
const STORE = 'operations'

function openLogDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'operationId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('failed to open operation log'))
  })
}

export function createIndexedDbOperationLogBackend(): OperationLogBackend {
  return {
    async put(entry) {
      const db = await openLogDB()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite')
          tx.objectStore(STORE).put(entry)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('operation log write failed'))
          tx.onabort = () => reject(tx.error ?? new Error('operation log write aborted'))
        })
      } finally {
        db.close()
      }
    },
    async get(operationId) {
      const db = await openLogDB()
      try {
        return await new Promise<LoggedOperation | null>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly')
          const request = tx.objectStore(STORE).get(operationId)
          request.onsuccess = () => resolve((request.result as LoggedOperation | undefined) ?? null)
          request.onerror = () => reject(request.error ?? new Error('operation log read failed'))
        })
      } finally {
        db.close()
      }
    },
    async getAll() {
      const db = await openLogDB()
      try {
        return await new Promise<LoggedOperation[]>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly')
          const request = tx.objectStore(STORE).getAll()
          request.onsuccess = () => resolve((request.result as LoggedOperation[]) ?? [])
          request.onerror = () => reject(request.error ?? new Error('operation log read failed'))
        })
      } finally {
        db.close()
      }
    },
    async delete(operationId) {
      const db = await openLogDB()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite')
          tx.objectStore(STORE).delete(operationId)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('operation log delete failed'))
          tx.onabort = () => reject(tx.error ?? new Error('operation log delete aborted'))
        })
      } finally {
        db.close()
      }
    },
  }
}

/**
 * One log instance per renderer process.
 *
 * Three call sites (mediaForge's publish, useP2P's transport, the feed
 * projection) previously built their own instance over the same store. The
 * revision-keyed cache keeps concurrent instances coherent, but sharing one is
 * cheaper and makes "the log" a single object to reason about.
 */
let sharedLog: SocialOperationLog | null = null

export function sharedSocialOperationLog(): SocialOperationLog {
  if (!sharedLog) sharedLog = new SocialOperationLog(createIndexedDbOperationLogBackend())
  return sharedLog
}
