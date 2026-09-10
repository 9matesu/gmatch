"use client";

import { useState, useEffect, useRef, useCallback } from 'react'
import { orbitFetch } from '../utils/api'
import { playChime } from '../utils/sounds'
import type { OrbitIdentity } from '@orbit/crypto'
import type { OrbitObject } from '@orbit/shared'

export function IdleOverlay({ items, identity, onExit }: {
  items: OrbitObject[]
  identity: OrbitIdentity
  onExit: () => void
}) {
  const [slideIndex, setSlideIndex] = useState(0)
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const exiting = useRef(false)

  const imageItems = items.filter(i => i.mime_type !== 'text/url')

  async function fetchWithConcurrencyLimit(items: typeof imageItems, limit: number): Promise<Map<string, string>> {
    const urls = new Map<string, string>()
    const queue = [...items]
    async function worker() {
      while (queue.length > 0) {
        const item = queue.shift()
        if (!item) continue
        try {
          const res = await orbitFetch(`/api/objects/${item.id}`, {}, identity)
          if (!res.ok) continue
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          urls.set(item.id, url)
        } catch {}
      }
    }
    const workers = Array.from({ length: limit }, () => worker())
    await Promise.all(workers)
    return urls
  }

  useEffect(() => {
    if (imageItems.length === 0) return
    let cancelled = false
    let urls: Map<string, string> | null = null
    fetchWithConcurrencyLimit(imageItems, 3).then((u) => {
      if (cancelled) {
        for (const b of u.values()) URL.revokeObjectURL(b)
        return
      }
      urls = u
      setImageUrls(u)
      setLoaded(true)
    })
    // Slideshow blobs are session-only: revoke on unmount (perf checkup).
    return () => {
      cancelled = true
      if (urls) for (const b of urls.values()) URL.revokeObjectURL(b)
    }
  }, [imageItems.length > 0 ? imageItems.map(i => i.id).join(',') : 'empty', identity])

  useEffect(() => {
    if (imageItems.length === 0) return
    const interval = setInterval(() => {
      setSlideIndex(prev => (prev + 1) % imageItems.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [imageItems.length])

  const handleInteract = useCallback(() => {
    if (exiting.current) return
    exiting.current = true
    playChime()
    onExit()
  }, [onExit])

  useEffect(() => {
    const handler = () => handleInteract()
    window.addEventListener('mousedown', handler, { once: true })
    window.addEventListener('keydown', handler, { once: true })
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', handler)
    }
  }, [handleInteract])

  const currentItem = imageItems[slideIndex]
  const currentUrl = currentItem ? imageUrls.get(currentItem.id) : null

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center overflow-hidden cursor-pointer" onClick={handleInteract}>
      {loaded && currentUrl ? (
        <>
          <img
            key={currentItem?.id}
            src={currentUrl}
            alt=""
            className="max-w-[95vw] max-h-[90vh] object-contain animate-fadeIn"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="absolute bottom-6 text-[10px] text-retro-muted font-sans">
            Click anywhere or press any key to return
          </div>
        </>
      ) : (
        <div className="text-center space-y-4">
          <div className="text-6xl animate-pulse">◇</div>
          <p className="text-retro-muted text-xs font-sans">
            {imageItems.length === 0 ? 'No images to display' : 'Loading slideshow...'}
          </p>
          <p className="text-[10px] text-retro-muted font-sans">
            Click anywhere or press any key to return
          </p>
        </div>
      )}
    </div>
  )
}
