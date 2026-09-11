"use client";

import { useState, useRef } from 'react'
import { CameraCapture } from './CameraCapture'
import { DropZone } from './DropZone'
import { orbitFetch } from '../utils/api'
import type { OrbitIdentity } from '@orbit/crypto'
import type { FlashEvent } from '@orbit/shared'
import { userFacingResponse, userFacingError } from '../utils/userError'
import { Zap, X } from 'lucide-react'

export function FlashModal({
  identity,
  onClose,
  onFired,
  toast,
}: {
  identity: OrbitIdentity
  onClose: () => void
  onFired?: (flash: FlashEvent | null) => void
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void
}) {
  const [mode, setMode] = useState<'camera' | 'upload'>('camera')
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [hasFile, setHasFile] = useState(false)
  const fileRef = useRef<File | null>(null)

  const fire = async (file: File | null, url: string | null) => {
    if (sending) return
    setSending(true)
    try {
      const form = new FormData()
      if (file) form.append('image', file)
      if (url) form.append('url', url)
      const res = await orbitFetch('/api/flash', { method: 'POST', body: form }, identity)
      if (res.ok) {
        const data = await res.json().catch(() => null)
        toast('Flash sent to everyone online!', 'success')
        onFired?.(data?.flash || null)
        onClose()
      } else {
        toast(userFacingResponse(res, 'Could not send the flash. Please try again.'), 'error')
      }
    } catch (err: unknown) {
      toast(userFacingError(err, { fallback: 'Could not send the flash. Please try again.' }), 'error')
    } finally {
      setSending(false)
    }
  }

  const handleFile = (files: FileList | File[]) => {
    const file = Array.from(files)[0]
    if (!file) return
    fileRef.current = file
    setHasFile(true)
    const reader = new FileReader()
    reader.onload = () => setPreview(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  const handleCameraFile = (file: File) => handleFile([file])

  const handleUrl = (url: string) => {
    fileRef.current = null
    setHasFile(false)
    setPreview(url)
  }

  const submit = () => {
    if (fileRef.current) return void fire(fileRef.current, null)
    if (preview && (preview.startsWith('http://') || preview.startsWith('https://'))) return void fire(null, preview)
    return void fire(fileRef.current, null)
  }

  return (
    <div className="fixed inset-0 z-[var(--z-toast)] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-orbit-fade-in" onClick={onClose}>
      <div
        className="bg-retro-panel border-2 border-yellow-500 rounded-xl max-w-md w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-glass bg-retro-bg/90">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 fill-current" />
            <div>
              <h2 className="text-sm font-black text-retro-fg uppercase tracking-widest">FIRE A FLASH DROP</h2>
              <p className="text-[10px] text-retro-muted font-sans">Your photo pops up on every online screen for 5 seconds</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold text-retro-muted hover:text-retro-fg px-2.5 py-1 border border-border-glass rounded hover:border-retro-fg transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 p-2.5 border-b border-border-glass bg-retro-bg text-[10px] font-bold">
          {(['camera', 'upload'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setPreview(null)
                fileRef.current = null
                setHasFile(false)
              }}
              className={`px-3 py-1 rounded transition-colors uppercase cursor-pointer ${
                mode === m ? 'bg-retro-accent text-black font-black' : 'text-retro-muted hover:text-retro-fg'
              }`}
            >
              {m === 'camera' ? '📷 Camera' : '📁 Upload'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 styled-scrollbar">
          {mode === 'camera' ? (
            <CameraCapture onCapture={handleCameraFile} onCancel={() => setMode('upload')} />
          ) : (
            <>
              <DropZone onFiles={handleFile} onPasteUrl={handleUrl} compact={false} accept="image/jpeg, image/png, image/webp, image/avif, image/gif" multiple={false}>
                <div className="space-y-1.5">
                  <p className="text-sm text-retro-muted">Drop an image, click to browse, or paste a link</p>
                  <p className="text-[10px] text-retro-muted/60">JPG, PNG, WebP, GIF</p>
                </div>
              </DropZone>
              {preview && (
                <img src={preview} alt="Preview" className="w-full max-h-56 object-contain rounded-lg border border-border-glass bg-black" />
              )}
            </>
          )}
        </div>

        <div className="p-3.5 border-t border-border-glass bg-retro-bg/90 flex items-center gap-2">
          <button
            type="button"
            disabled={sending || (!hasFile && !preview)}
            onClick={submit}
            className="flex-1 px-3 py-2 text-[10px] font-black tracking-wider bg-yellow-500 text-black hover:bg-yellow-400 disabled:opacity-40 rounded cursor-pointer uppercase transition-colors"
          >
            {sending ? 'Firing...' : 'Fire flash'}
          </button>
        </div>
      </div>
    </div>
  )
}
