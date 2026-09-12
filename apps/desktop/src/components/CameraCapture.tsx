"use client";

import { useEffect, useRef, useState, useCallback } from 'react'

function canvasToFile(canvas: HTMLCanvasElement, filename: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Capture failed'))
        return
      }
      resolve(new File([blob], filename, { type: blob.type || 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  })
}

export function CameraCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (file: File) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [captured, setCaptured] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      setStarting(true)
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setPermissionDenied(true)
          setError('Camera not supported in this browser. Use the file upload instead.')
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
      } catch (err: any) {
        setPermissionDenied(true)
        setError(err?.name === 'NotAllowedError' ? 'Camera access denied.' : 'Could not start the camera.')
      } finally {
        if (!cancelled) setStarting(false)
      }
    }
    void start()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [stopStream, retryNonce])

  useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (video && stream && !error && !permissionDenied) {
      video.srcObject = stream
      void video.play().catch(() => {})
    }
  }, [starting, error, permissionDenied])

  const takePhoto = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 960
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setCaptured(dataUrl)
  }, [])

  const confirmShot = useCallback(async () => {
    if (!captured) return
    const canvas = document.createElement('canvas')
    const img = new Image()
    img.src = captured
    await new Promise((resolve) => {
      img.onload = resolve
    })
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    const file = await canvasToFile(canvas, `camera-${Date.now()}.jpg`)
    stopStream()
    onCapture(file)
  }, [captured, onCapture, stopStream])

  const retake = useCallback(() => {
    setCaptured(null)
  }, [])

  if (permissionDenied || error) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm text-retro-muted">{error || 'Camera unavailable.'}</div>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setPermissionDenied(false)
            setStarting(true)
            setRetryNonce((value) => value + 1)
          }}
          className="px-3 py-1.5 text-xs font-medium bg-retro-accent text-black hover:bg-retro-accent-hover rounded-lg cursor-pointer"
        >
          Retry Camera
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium bg-surface-canvas text-retro-muted border border-border-glass hover:text-retro-fg rounded-lg cursor-pointer"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {captured ? (
        <div className="space-y-3">
          <img src={captured} alt="Captured preview" className="w-full max-h-64 object-contain rounded-lg border border-border-glass bg-black" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={retake}
              className="px-3 py-1.5 text-xs font-medium bg-surface-canvas text-retro-muted border border-border-glass hover:text-retro-fg rounded-lg cursor-pointer"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={confirmShot}
              className="px-3 py-1.5 text-xs font-medium bg-retro-accent text-black hover:bg-retro-accent-hover rounded-lg cursor-pointer"
            >
              Use Photo
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium bg-surface-canvas text-retro-muted border border-border-glass hover:text-retro-fg rounded-lg cursor-pointer ml-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden border border-border-glass bg-black">
            <video ref={videoRef} playsInline muted className="w-full max-h-64 object-contain" />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <span className="text-xs text-retro-muted">Starting camera...</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={starting}
              onClick={takePhoto}
              className="px-3 py-1.5 text-xs font-medium bg-retro-accent text-black hover:bg-retro-accent-hover disabled:opacity-40 rounded-lg cursor-pointer"
            >
              Capture
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium bg-surface-canvas text-retro-muted border border-border-glass hover:text-retro-fg rounded-lg cursor-pointer ml-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
