"use client";

import { useState, useCallback, useRef, useEffect } from 'react'
import { orbitFetch } from '../utils/api'
import { CameraCapture } from './CameraCapture'
import { DropZone } from './DropZone'
import { contentHash } from '../utils/media'
import { useCropper } from '../hooks/useCropper'
import { isCropableImage } from './CropModal'
import { forgeMediaLocally } from '../services/mediaForge'
import { UploadCloud, Camera, Link as LinkIcon, X, Check, Loader2, ImagePlus } from 'lucide-react'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
  encryptionPubHex?: string
  encryptionPrivHex?: string
}

export interface AttachmentResult {
  id: string
  url: string
  isVideo: boolean
}

interface AttachmentUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (attachment: AttachmentResult) => void
  identity: IdentityLike | null
  title?: string
  recipientId?: string
  recipients?: string[]
  /**
   * Files handed in from outside the modal (the chat composer's paste
   * handler). They are ingested exactly like a drop/browse: cropped, previewed
   * and uploaded on submit, so there is one upload path and one set of
   * validation rules rather than a second copy for pasted images.
   */
  initialFiles?: File[]
  /**
   * A pasted image LINK. Switches the modal to URL mode with the link
   * prefilled, so the player confirms before anything is fetched.
   */
  initialUrl?: string
}

export function AttachmentUploadModal({
  isOpen,
  onClose,
  onSuccess,
  identity,
  title = 'Attach Image or Video',
  recipientId,
  recipients,
  initialFiles,
  initialUrl,
}: AttachmentUploadModalProps) {
  const [mode, setMode] = useState<'camera' | 'upload' | 'url'>('upload')
  const [urlInput, setUrlInput] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [hasFile, setHasFile] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<File | null>(null)
  const { crop, cropper } = useCropper()

  useEffect(() => {
    if (!isOpen) {
      setMode('upload')
      setPreview(null)
      setUrlInput('')
      fileRef.current = null
      setHasFile(false)
      setError(null)
    }
  }, [isOpen])

  // (the paste-ingest effect lives below handleFile/handleUrl, which it calls)

  const handleFile = useCallback(async (files: FileList | File[]) => {
    let file = Array.from(files)[0]
    if (!file) return
    if (isCropableImage(file)) {
      const res = await crop(file, { aspect: 'free', title: 'Crop attachment' })
      if (!res) return
      if (res.file) file = res.file
    }
    fileRef.current = file
    setHasFile(true)
    setError(null)
    setUrlInput('')
    if (file.type.startsWith('video/')) {
      try { setPreview(URL.createObjectURL(file)) } catch { setPreview(null) }
    } else {
      const reader = new FileReader()
      reader.onload = () => setPreview(typeof reader.result === 'string' ? reader.result : null)
      reader.readAsDataURL(file)
    }
  }, [crop])

  const handleCameraFile = useCallback((file: File) => handleFile([file]), [handleFile])

  const handleUrl = useCallback((url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    setUrlInput(trimmed)
    setError(null)
    if (trimmed.startsWith('data:')) {
      try {
        const [meta, b64] = trimmed.split(',')
        const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], `attachment-${Date.now()}.jpg`, { type: mime })
        fileRef.current = file
        setHasFile(true)
        setPreview(trimmed)
        return
      } catch { }
    }
    fileRef.current = null
    setHasFile(false)
    setPreview(trimmed)
  }, [])

  // A pasted image LINK: open in URL mode with it prefilled, so the player
  // confirms before anything is fetched. A file paste wins — they copied
  // pixels, not a page.
  useEffect(() => {
    if (!isOpen || !initialUrl || initialFiles?.length) return
    setMode('url')
    handleUrl(initialUrl)
  }, [isOpen, initialUrl, handleUrl])

  // Files arriving from the composer's paste handler: ingest them as if they
  // had been dropped in, so a pasted image is croppable and previewable
  // exactly like a browsed one. The batch is keyed by name+size, so handing in
  // the same file twice does not re-ingest it; the File[] identity itself is
  // deliberately not a dep (a fresh array each parent render would loop).
  const initialKey = initialFiles?.length ? initialFiles.map((f) => `${f.name}:${f.size}`).join('|') : ''
  useEffect(() => {
    if (!isOpen || !initialFiles || initialFiles.length === 0) return
    void handleFile(initialFiles)
  }, [isOpen, initialKey, handleFile])

  const submit = useCallback(async () => {
    if (uploading || !identity) return
    const file = fileRef.current
    const link = urlInput.trim() || (preview && (preview.startsWith('http://') || preview.startsWith('https://')) ? preview : null)
    if (!file && !link && !preview) return

    setUploading(true)
    setError(null)
    try {
      const recipientList = recipients || (recipientId ? [recipientId] : [])
      const recipientStr = recipientList.length > 0 ? recipientList.join(',') : undefined

      if (file || (preview && preview.startsWith('data:'))) {
        let payloadFile = file
        if (!payloadFile && preview && preview.startsWith('data:')) {
          const [meta, b64] = preview.split(',')
          const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
          payloadFile = new File([bytes], `attachment-${Date.now()}.jpg`, { type: mime })
        }
        if (payloadFile) {
          // Zero-media P2P path: seed into swarm + register metadata (no 422).
          const forged = await forgeMediaLocally(payloadFile, identity, {
            isPublic: false,
            isChat: true,
            recipients: recipientStr,
          })
          onSuccess({
            id: forged.id,
            url: `/api/objects/${forged.id}`,
            isVideo: payloadFile.type.startsWith('video/') || link?.includes('.mp4') || link?.includes('.webm') || false
          })
          onClose()
          return
        }
      }

      const form = new FormData()
      if (file) {
        form.append('image', file, file.name || `attachment-${Date.now()}.jpg`)
      } else if (link) {
        form.append('url', link)
      } else if (preview && preview.startsWith('data:')) {
        const [meta, b64] = preview.split(',')
        const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        const f = new File([bytes], `attachment-${Date.now()}.jpg`, { type: mime })
        form.append('image', f)
      }

      form.append('content_hash', await contentHash(file || new File([], '')))
      form.append('is_story', 'false')
      form.append('is_chat', 'true')

      if (recipientList.length > 0) {
        form.append('recipients', recipientList.join(','))
      }

      const res = await orbitFetch('/api/objects', { method: 'POST', body: form }, identity)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`)
      if (!data?.id) throw new Error('Upload succeeded without an attachment id')
      onSuccess({
        id: data.id,
        url: `/api/objects/${data.id}`,
        isVideo: file?.type.startsWith('video/') || link?.includes('.mp4') || link?.includes('.webm') || false
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [identity, onClose, onSuccess, preview, urlInput, uploading])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[var(--z-lightbox)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-raised border border-border-glass rounded-xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4 p-5">
        <div className="flex items-center justify-between border-b border-border-glass pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600">
              <ImagePlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-retro-fg uppercase tracking-wider">{title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-body p-1 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Selectors */}
        <div className="flex bg-surface-interactive p-1 rounded-xl border border-border-glass text-xs font-bold">
          {(['upload', 'url', 'camera'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setPreview(null)
                setUrlInput('')
                fileRef.current = null
                setHasFile(false)
              }}
              className={`flex-1 py-1.5 rounded-lg transition-all uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1.5 ${mode === m ? 'bg-surface-raised text-retro-fg shadow-xs font-black' : 'text-retro-muted hover:text-retro-body'
                }`}>
              {m === 'upload' && <UploadCloud className="w-3.5 h-3.5" />}
              {m === 'url' && <LinkIcon className="w-3.5 h-3.5" />}
              {m === 'camera' && <Camera className="w-3.5 h-3.5" />}
              <span>{m}</span>
            </button>
          ))}
        </div>

        {/* Mode Input Content */}
        <div className="space-y-3">
          {mode === 'camera' ? (
            <>
              <CameraCapture onCapture={handleCameraFile} onCancel={() => setMode('upload')} />
              {hasFile && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800">
                  <Check className="w-4 h-4" />
                  <span>Snapshot captured & ready to attach.</span>
                  <button
                    type="button"
                    onClick={() => { fileRef.current = null; setHasFile(false); setPreview(null) }}
                    className="ml-auto text-retro-muted hover:text-red-500 underline cursor-pointer"
                  >
                    Discard
                  </button>
                </div>
              )}
            </>
          ) : mode === 'url' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => handleUrl(e.target.value)}
                  placeholder="Paste image or video link (e.g. https://...)"
                  className="flex-1 bg-surface-interactive border border-border-glass rounded-xl px-3 py-2 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-black"
                />
              </div>
              {urlInput && (
                <div className="p-3 rounded-xl border border-border-glass bg-surface-raised text-xs text-retro-body flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-cyan-600 shrink-0" />
                  <span className="truncate">URL ready. Will be fetched and stored on submit</span>
                </div>
              )}
            </div>
          ) : (
            <>
              <DropZone onFiles={handleFile} onPasteUrl={handleUrl} compact={false} accept="image/jpeg, image/png, image/webp, image/avif, image/gif, video/mp4, video/webm, video/quicktime, video/ogg, video/*" multiple={false}>
                <div className="space-y-1 text-center py-2">
                  <p className="text-xs text-retro-body font-bold">Drop an image/video or click to browse</p>
                  <p className="text-[10px] text-retro-muted">JPG, PNG, WebP, GIF, MP4, WebM (up to 50MB)</p>
                </div>
              </DropZone>
              {preview && (
                preview.startsWith('data:video') || preview.startsWith('blob:') ? (
                  <video src={preview} controls className="w-full max-h-52 object-contain rounded-xl border border-border-glass bg-black" />
                ) : preview.startsWith('http://') || preview.startsWith('https://') ? (
                  <div className="w-full text-center py-3 rounded-xl border border-border-glass bg-surface-raised text-xs text-retro-body flex items-center justify-center gap-2">
                    <LinkIcon className="w-3.5 h-3.5 text-cyan-600" />
                    <span>Link ready to submit</span>
                  </div>
                ) : (
                  <img src={preview} alt="Preview" className="w-full max-h-52 object-contain rounded-xl border border-border-glass bg-black" />
                )
              )}
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="pt-2 border-t border-border-glass flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-retro-muted hover:text-retro-fg border border-border-glass rounded-xl cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={uploading || (!hasFile && !urlInput.trim() && !preview)}
            onClick={submit}
            className="px-5 py-2 bg-black hover:bg-surface-elevated text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>{uploading ? 'Uploading…' : 'Attach'}</span>
          </button>
        </div>
      </div>
      {cropper}
    </div>
  )
}
