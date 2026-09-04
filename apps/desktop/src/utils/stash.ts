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

function createThumbnail(file: File, maxDim = 200): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const cleanup = () => { try { URL.revokeObjectURL(url) } catch {} }

    if (file.type.startsWith('video/')) {
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'metadata'
      video.src = url
      const done = (dataUrl: string) => { cleanup(); resolve(dataUrl) }
      video.onloadeddata = () => {
        try {
          const scale = Math.min(maxDim / (video.videoWidth || 1), maxDim / (video.videoHeight || 1), 1)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale))
          canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * scale))
          const ctx = canvas.getContext('2d')
          if (!ctx) return done('')
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          done(canvas.toDataURL('image/jpeg', 0.6))
        } catch {
          done('')
        }
      }
      video.onerror = () => done('')
      setTimeout(() => done(''), 4000)
      return
    }

    const img = new Image()
    img.onload = () => {
      cleanup()
      const canvas = document.createElement('canvas')
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1)
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(''); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL(file.type || 'image/jpeg', 0.6))
    }
    img.onerror = () => { cleanup(); resolve('') }
    img.src = url
  })
}

export async function addToStash(file: File): Promise<StashEntry> {
  const [buffer, dataUrl] = await Promise.all([
    file.arrayBuffer(),
    createThumbnail(file),
  ])
  const entry: StashEntry = {
    id: crypto.randomUUID(),
    name: file.name,
    data: buffer,
    dataUrl,
    mimeType: file.type || 'image/jpeg',
    size: file.size,
    addedAt: Date.now(),
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.add(entry)
    req.onsuccess = () => resolve(entry)
    req.onerror = () => reject(req.error)
  })
}

export async function removeFromStash(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(id)
    req.onsuccess = () => resolve()
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

export async function getStashFile(id: string): Promise<File | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => {
      const entry: StashEntry | undefined = req.result
      if (!entry) return resolve(null)
      const blob = new Blob([entry.data], { type: entry.mimeType })
      resolve(new File([blob], entry.name, { type: entry.mimeType }))
    }
    req.onerror = () => reject(req.error)
  })
}

export function formatStashSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
