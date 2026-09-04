"use client";

import type { ContentManifest } from '@orbit/crypto';

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
}

export interface EncryptedChunk {
  cid: string
  ciphertext: ArrayBuffer
  nonceHex: string
  offset: number
  size: number
}

export interface EncryptedContentRecord {
  id: string
  manifest: ContentManifest
  chunks: EncryptedChunk[]
  creatorId: string
  createdAt: number
  isPinned: boolean
  lastAccessedAt: number
}

export interface DecryptedContent {
  id: string
  plaintext: Uint8Array
  mimeType: string
  caption?: string
  tags?: string[]
}

const DB_NAME = 'orbit-gallery'
const DB_VERSION = 2
const STORE_OBJECTS = 'objects'
const STORE_CHUNKS = 'encrypted_chunks'
const STORE_MANIFESTS = 'manifests'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('IndexedDB not available in SSR'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
        db.createObjectStore(STORE_OBJECTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'cid' })
        chunkStore.createIndex('manifestId', 'manifestId', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_MANIFESTS)) {
        db.createObjectStore(STORE_MANIFESTS, { keyPath: 'id' })
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

export async function deleteObject(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OBJECTS, 'readwrite')
    tx.objectStore(STORE_OBJECTS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
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

export async function saveEncryptedContent(record: EncryptedContentRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MANIFESTS, STORE_CHUNKS], 'readwrite')
    const manifestStore = tx.objectStore(STORE_MANIFESTS)
    const chunkStore = tx.objectStore(STORE_CHUNKS)
    
    manifestStore.put({
      id: record.id,
      manifest: record.manifest,
      creatorId: record.creatorId,
      createdAt: record.createdAt,
      isPinned: record.isPinned,
      lastAccessedAt: record.lastAccessedAt,
    })
    
    for (const chunk of record.chunks) {
      chunkStore.put({
        ...chunk,
        manifestId: record.id,
      })
    }
    
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getEncryptedContent(id: string): Promise<EncryptedContentRecord | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MANIFESTS, STORE_CHUNKS], 'readonly')
      const manifestStore = tx.objectStore(STORE_MANIFESTS)
      const chunkStore = tx.objectStore(STORE_CHUNKS)
      const index = chunkStore.index('manifestId')
      
      const manifestReq = manifestStore.get(id)
      manifestReq.onsuccess = () => {
        const manifestRecord = manifestReq.result
        if (!manifestRecord) {
          resolve(null)
          return
        }
        
        const chunksReq = index.getAll(id)
        chunksReq.onsuccess = () => {
          resolve({
            id: manifestRecord.id,
            manifest: manifestRecord.manifest,
            chunks: chunksReq.result || [],
            creatorId: manifestRecord.creatorId,
            createdAt: manifestRecord.createdAt,
            isPinned: manifestRecord.isPinned,
            lastAccessedAt: manifestRecord.lastAccessedAt,
          })
        }
        chunksReq.onerror = () => reject(chunksReq.error)
      }
      manifestReq.onerror = () => reject(manifestReq.error)
    })
  } catch {
    return null
  }
}

export async function getChunkByCid(cid: string): Promise<EncryptedChunk | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly')
      const req = tx.objectStore(STORE_CHUNKS).get(cid)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function saveChunk(chunk: EncryptedChunk & { manifestId: string }): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite')
    tx.objectStore(STORE_CHUNKS).put(chunk)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteEncryptedContent(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MANIFESTS, STORE_CHUNKS], 'readwrite')
    const manifestStore = tx.objectStore(STORE_MANIFESTS)
    const chunkStore = tx.objectStore(STORE_CHUNKS)
    const index = chunkStore.index('manifestId')
    
    manifestStore.delete(id)
    
    const chunksReq = index.openCursor(IDBKeyRange.only(id))
    chunksReq.onsuccess = () => {
      const cursor = chunksReq.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAllEncryptedContent(): Promise<EncryptedContentRecord[]> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MANIFESTS, 'readonly')
      const req = tx.objectStore(STORE_MANIFESTS).getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function updateContentPinStatus(id: string, isPinned: boolean): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MANIFESTS, 'readwrite')
    const store = tx.objectStore(STORE_MANIFESTS)
    const req = store.get(id)
    req.onsuccess = () => {
      const record = req.result
      if (record) {
        record.isPinned = isPinned
        store.put(record)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function touchContentAccess(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MANIFESTS, 'readwrite')
    const store = tx.objectStore(STORE_MANIFESTS)
    const req = store.get(id)
    req.onsuccess = () => {
      const record = req.result
      if (record) {
        record.lastAccessedAt = Date.now()
        store.put(record)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getStorageStats(): Promise<{
  totalChunks: number
  totalContent: number
  pinnedContent: number
  totalBytes: number
}> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MANIFESTS, STORE_CHUNKS], 'readonly')
      const manifestStore = tx.objectStore(STORE_MANIFESTS)
      const chunkStore = tx.objectStore(STORE_CHUNKS)
      
      let totalChunks = 0
      let totalContent = 0
      let pinnedContent = 0
      let totalBytes = 0
      
      const manifestReq = manifestStore.openCursor()
      manifestReq.onsuccess = () => {
        const cursor = manifestReq.result
        if (cursor) {
          totalContent++
          if (cursor.value.isPinned) pinnedContent++
          cursor.continue()
        }
      }
      
      const chunkReq = chunkStore.openCursor()
      chunkReq.onsuccess = () => {
        const cursor = chunkReq.result
        if (cursor) {
          totalChunks++
          totalBytes += (cursor.value.ciphertext?.byteLength || 0)
          cursor.continue()
        }
      }
      
      tx.oncomplete = () => resolve({ totalChunks, totalContent, pinnedContent, totalBytes })
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    return { totalChunks: 0, totalContent: 0, pinnedContent: 0, totalBytes: 0 }
  }
}
