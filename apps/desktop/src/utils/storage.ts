"use client";

export interface StoredObject {
  id: string
  name: string
  mime_type: string
  size_bytes: number
  owner_id: string
  sender_pubkey: string
  sender_enc_pubkey: string
  created_at: string
  data: ArrayBuffer
  /**
   * Provider link for a row whose media lives somewhere else (a peer's
   * `content_url`, a vault address, `/api/objects/<id>`). Kept SEPARATE from
   * `data`: an announcement describes an object, it does not carry its bytes.
   * Legacy rows instead wrote that URL string into `data` — see
   * `utils/objectDescriptor.ts` for the idempotent recovery.
   */
  source_url?: string | null
  /**
   * Whether the row's `owner_id` was proven rather than merely claimed. The
   * swarm envelope proves the SENDER; a claim that contradicts it is stored
   * unverified so it can never render under someone else's name.
   */
  owner_verified?: boolean | null
  /** Media-kind flags when known at write time (forge/receive). Absent for
   * legacy rows; gallery rebuilds must treat absent flags as unknown, never
   * as "private card-eligible". */
  is_public?: number | null
  is_story?: number | null
  is_chat?: number | null
  is_avatar?: number | null
  caption?: string | null
  post_caption?: string | null
  tags?: string[] | string | null
  location?: string | null
  author_name?: string | null
  author_avatar?: string | null
  comments?: unknown[] | null
  likes_count?: number | null
  like_count?: number | null
  comment_count?: number | null
  post_group?: string | null
}

const DB_NAME = 'orbit-gallery'
const DB_VERSION = 3
const STORE_OBJECTS = 'objects'
const STORE_RECEIPTS = 'swarm_receipts'

/**
 * The encrypted-chunk stores are LEGACY: nothing writes them any more (the
 * only writer was the file-encryption helper, which is gone). The schema
 * stays so an existing database still opens — the rows are inert.
 */
const LEGACY_STORE_CHUNKS = 'encrypted_chunks'
const LEGACY_STORE_MANIFESTS = 'manifests'

/** Signed durable-replication receipts recorded by the swarm seeder side
 *  (p2pSwarm). Historical evidence — freshness was enforced at accept time;
 *  `confirmedAt` is when this node accepted the receipt.
 *  `holders` lists the DISTINCT identities that durably hold this object
 *  (each accepted receipt's receiverId); one identity is never counted
 *  twice, and the list is bounded to `MAX_HOLDERS_PER_OBJECT`. Optional for
 *  rows written before holding-holder bookkeeping existed (legacy rows read
 *  back as a one-element list). */
export interface StoredSwarmReceiptHolder {
  receiverId: string
  confirmedAt: number
}

export interface StoredSwarmReceipt {
  objectCid: string
  receipt: Record<string, unknown>
  confirmedAt: number
  holders?: StoredSwarmReceiptHolder[]
}

/** Receipt store bound: matches the in-memory cap in p2pSwarm. */
export const MAX_STORED_RECEIPTS = 256

/** Distinct custody holders remembered per object (matches the in-session
 *  bound in p2pSwarm). */
export const MAX_HOLDERS_PER_OBJECT = 8

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('IndexedDB not available in SSR'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
        db.createObjectStore(STORE_OBJECTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(LEGACY_STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(LEGACY_STORE_CHUNKS, { keyPath: 'cid' })
        chunkStore.createIndex('manifestId', 'manifestId', { unique: false })
      }
      if (!db.objectStoreNames.contains(LEGACY_STORE_MANIFESTS)) {
        db.createObjectStore(LEGACY_STORE_MANIFESTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_RECEIPTS)) {
        db.createObjectStore(STORE_RECEIPTS, { keyPath: 'objectCid' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveObject(obj: StoredObject): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OBJECTS, 'readwrite')
    tx.objectStore(STORE_OBJECTS).put(obj)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getObject(id: string): Promise<StoredObject | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OBJECTS, 'readonly')
      const req = tx.objectStore(STORE_OBJECTS).get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function getAllObjects(): Promise<StoredObject[]> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OBJECTS, 'readonly')
      const req = tx.objectStore(STORE_OBJECTS).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export function selectObjectsForSwarm(objects: StoredObject[], maxBytes: number): StoredObject[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return []
  const selected: StoredObject[] = []
  let used = 0
  for (const object of objects) {
    const data = object?.data
    if (!object?.id || !data || typeof data.byteLength !== 'number' || data.byteLength === 0) continue
    const size = data.byteLength
    if (size > maxBytes - used) continue
    selected.push(object)
    used += size
  }
  return selected
}

/** Read a bounded, stable set of persisted objects for swarm rehydration. */
export async function getObjectsForSwarm(maxBytes: number): Promise<StoredObject[]> {
  return selectObjectsForSwarm(await getAllObjects(), maxBytes)
}

export async function deleteObject(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OBJECTS, 'readwrite')
    tx.objectStore(STORE_OBJECTS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Record one accepted replication receipt (latest per object wins; the
 *  store is capped at MAX_STORED_RECEIPTS by dropping the oldest). */
export async function saveSwarmReceipt(entry: StoredSwarmReceipt): Promise<void> {
  const db = await openDB()
  try {
    const existing = await new Promise<StoredSwarmReceipt[]>((resolve, reject) => {
      const tx = db.transaction(STORE_RECEIPTS, 'readonly')
      const req = tx.objectStore(STORE_RECEIPTS).getAll()
      req.onsuccess = () => resolve((req.result as StoredSwarmReceipt[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    if (existing.length >= MAX_STORED_RECEIPTS) {
      const oldest = [...existing].sort((a, b) => a.confirmedAt - b.confirmedAt)[0]
      if (oldest && oldest.objectCid !== entry.objectCid) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_RECEIPTS, 'readwrite')
          tx.objectStore(STORE_RECEIPTS).delete(oldest.objectCid)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      }
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RECEIPTS, 'readwrite')
      tx.objectStore(STORE_RECEIPTS).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** All persisted receipts, newest first. Empty when IndexedDB is unavailable. */
export async function getAllSwarmReceipts(): Promise<StoredSwarmReceipt[]> {
  try {
    const db = await openDB()
    try {
      return await new Promise<StoredSwarmReceipt[]>((resolve, reject) => {
        const tx = db.transaction(STORE_RECEIPTS, 'readonly')
        const req = tx.objectStore(STORE_RECEIPTS).getAll()
        req.onsuccess = () =>
          resolve(((req.result as StoredSwarmReceipt[]) ?? []).sort((a, b) => b.confirmedAt - a.confirmedAt))
        req.onerror = () => reject(req.error)
      })
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

export async function clearObjects(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OBJECTS, 'readwrite')
      tx.objectStore(STORE_OBJECTS).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {}
}

