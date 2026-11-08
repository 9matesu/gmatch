export interface StashEntry {
  id: string
  name: string
  data: ArrayBuffer
  dataUrl: string
  mimeType: string
  size: number
  addedAt: number
}

const DB_NAME = 'goonmatch'
const STORE_NAME = 'stash'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getAllStash(): Promise<StashEntry[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

/**
 * Insert a stash entry by value (used when restoring a config backup). Returns
 * false if an entry with the same id already exists so restores never clobber
 * newer local stash items.
 */
export async function addStashEntry(entry: StashEntry): Promise<boolean> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const existingReq = store.get(entry.id)
    existingReq.onsuccess = () => {
      if (existingReq.result) {
        resolve(false)
        return
      }
      const addReq = store.add(entry)
      addReq.onsuccess = () => resolve(true)
      addReq.onerror = () => reject(addReq.error)
    }
    existingReq.onerror = () => reject(existingReq.error)
  })
}
