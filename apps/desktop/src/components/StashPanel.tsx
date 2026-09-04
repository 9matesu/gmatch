"use client";

import { useState, useEffect, useCallback, useRef } from 'react'
import { getAllStash, addToStash, removeFromStash, getStashFile, formatStashSize } from '../utils/stash'
import type { StashEntry } from '../utils/stash'
import { logger } from '../utils/logger';

export function StashPanel({
  onSendFile,
}: {
  onSendFile: (file: File) => void
}) {
  const [entries, setEntries] = useState<StashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const all = await getAllStash()
      setEntries(all.sort((a, b) => b.addedAt - a.addedAt))
    } catch (err) {
      logger.error('Failed to load stash:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleFolderPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setImporting(true)
    const mediaFiles = Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    let count = 0

    for (const file of mediaFiles) {
      try {
        await addToStash(file)
        count++
      } catch (err) {
        logger.error('Failed to stash', file.name, err)
      }
    }

    setImporting(false)
    if (e.target) e.target.value = ''
    await load()
  }

  const handleDelete = async (id: string) => {
    await removeFromStash(id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  const handleSend = async (id: string) => {
    const file = await getStashFile(id)
    if (file) onSendFile(file)
  }

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={importing}
            className="bg-retro-accent hover:bg-retro-fg hover:text-retro-bg text-white text-xs font-bold px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {importing ? 'Importing...' : 'Load Folder'}
          </button>
          <input
            ref={folderInputRef}
            type="file"
            {...{ webkitdirectory: 'true' }}
            multiple
            accept="image/*,video/mp4,video/webm,video/quicktime,video/ogg"
            onChange={handleFolderPick}
            className="hidden"
          />
          <span className="text-[10px] text-retro-muted">
            {entries.length} image{entries.length !== 1 ? 's' : ''}
            {entries.length > 0 && ` (${formatStashSize(totalSize)})`}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square bg-retro-bg border border-retro-border animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-retro-muted text-xs border border-dashed border-retro-border bg-retro-bg">
          No images stashed yet. Click &quot;Load Folder&quot; to add images for quick sending.
        </div>
      ) : (
        <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3">
          {entries.map(entry => (
            <div
              key={entry.id}
              className="bg-retro-bg border border-retro-border overflow-hidden group relative"
            >
              <div className="aspect-square overflow-hidden bg-black">
                {entry.dataUrl ? (
                  entry.mimeType.startsWith('video/') ? (
                    <div className="relative w-full h-full">
                      <img src={entry.dataUrl} alt={entry.name} className="w-full h-full object-cover" />
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/80 text-white text-[8px] font-bold rounded font-mono">VIDEO</span>
                    </div>
                  ) : (
                    <img src={entry.dataUrl} alt={entry.name} className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-retro-muted text-[10px]">
                    No preview
                  </div>
                )}
              </div>
              <div className="p-2 text-[10px]">
                <div className="truncate text-retro-fg" title={entry.name}>
                  {entry.name}
                </div>
                <div className="text-retro-muted">{formatStashSize(entry.size)}</div>
              </div>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleSend(entry.id)}
                  className="bg-retro-accent hover:bg-retro-fg hover:text-retro-bg text-white text-[9px] font-bold px-2 py-1 transition-colors"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(entry.id)}
                  className="bg-retro-error text-white text-[9px] font-bold px-2 py-1 transition-colors"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
