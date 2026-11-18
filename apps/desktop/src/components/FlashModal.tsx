"use client";

import { useState, useRef } from 'react'
import { CameraCapture } from './CameraCapture'
import { DropZone } from './DropZone'
import { orbitFetch } from '../utils/api'
import type { OrbitIdentity } from '@orbit/crypto'
import type { FlashEvent } from '@orbit/shared'
import { userFacingResponse, userFacingError } from '../utils/userError'
import { Modal, Tabs, Button, Caption } from '../ui/kit'

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
        toast('Flash sent to everyone online.', 'success')
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
    <Modal title="Fire a flash" onClose={onClose} maxWidth="max-w-md">
      <Caption>Your photo pops up on every online screen for 5 seconds</Caption>

      <Tabs
        tabs={[{ id: 'camera' as const, label: 'Camera' }, { id: 'upload' as const, label: 'Upload' }]}
        value={mode}
        onChange={(m) => {
          setMode(m)
          setPreview(null)
          fileRef.current = null
          setHasFile(false)
        }}
      />

      {mode === 'camera' ? (
        <CameraCapture onCapture={handleCameraFile} onCancel={() => setMode('upload')} />
      ) : (
        <>
          <DropZone onFiles={handleFile} onPasteUrl={handleUrl} compact={false} accept="image/jpeg, image/png, image/webp, image/avif, image/gif" multiple={false}>
            <div className="space-y-1.5">
              <p className="text-sm text-retro-muted">Drop an image, click to browse, or paste a link</p>
              <p className="text-2xs text-retro-muted/60">JPG, PNG, WebP, GIF</p>
            </div>
          </DropZone>
          {preview && (
            <img src={preview} alt="Preview" className="w-full max-h-56 object-contain rounded-lg border border-border-glass bg-retro-bg" />
          )}
        </>
      )}

      <div className="pt-2 border-t border-border-glass">
        <Button
          variant="primary"
          className="w-full"
          disabled={sending || (!hasFile && !preview)}
          onClick={submit}
        >
          {sending ? 'Firing…' : 'Fire flash'}
        </Button>
      </div>
    </Modal>
  )
}
