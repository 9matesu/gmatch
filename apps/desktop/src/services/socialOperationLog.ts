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
 *   entries are evicted first; undelivered entries are never evicted.
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

const HEX64 = /^[0-9a-f]{64}$/
const STATUS_RANK: Record<OperationLogStatus, number> = { committed: 0, sending: 1, delivered: 2 }

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
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
  constructor(private readonly backend: OperationLogBackend) {}

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
    // Capacity: evict oldest delivered first; never evict undelivered work.
    const all = await this.backend.getAll()
    if (all.length >= MAX_LOG_ENTRIES) {
      const evictable = all
        .filter((candidate) => candidate.status === 'delivered')
        .sort((a, b) => a.updatedAt - b.updatedAt)
      let room = all.length
      const limit = MAX_LOG_ENTRIES - 1
      for (const victim of evictable) {
        if (room <= limit) break
        await this.backend.delete(victim.operationId)
        room -= 1
      }
      if (room > limit) throw new Error('operation log is full of undelivered entries')
    }
    await this.backend.put(entry)
    return { outcome: 'appended', entry }
  }

  /** Monotonic status advance; returns false on a rejected downgrade/no-op. */
  async advanceStatus(operationId: string, status: OperationLogStatus): Promise<boolean> {
    const entry = await this.backend.get(operationId)
    if (!entry) return false
    if (STATUS_RANK[status] <= STATUS_RANK[entry.status]) return false
    const updated = { ...entry, status, updatedAt: Date.now() }
    if (!isValidLogEntryShape(updated)) throw new Error('corrupted log entry')
    await this.backend.put(updated)
    return true
  }

  /** Record one delivery attempt (retry backoff reads this on replay). */
  async bumpAttempts(operationId: string): Promise<boolean> {
    const entry = await this.backend.get(operationId)
    if (!entry) return false
    const updated = { ...entry, attempts: entry.attempts + 1, updatedAt: Date.now() }
    await this.backend.put(updated)
    return true
  }

  /** Undelivered entries, oldest first — the boot/reconnect replay order. */
  async listPendingOperations(): Promise<LoggedOperation[]> {
    const all = await this.backend.getAll()
    return all
      .filter((entry) => isValidLogEntryShape(entry) && entry.status !== 'delivered')
      .sort((a, b) => a.createdAt - b.createdAt || (a.operationId < b.operationId ? -1 : 1))
  }

  /** Drop delivered entries past the grace window; undelivered are never dropped. */
  async prune(now = Date.now()): Promise<number> {
    const all = await this.backend.getAll()
    let removed = 0
    for (const entry of all) {
      if (entry.status === 'delivered' && now - entry.updatedAt > DELIVERED_GRACE_MS) {
        await this.backend.delete(entry.operationId)
        removed += 1
      }
    }
    return removed
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
