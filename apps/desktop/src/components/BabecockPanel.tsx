"use client";

import { useState, useEffect, useRef, useCallback } from 'react'
import { type BabecockRound, type BabecockEntry, type BabecockInvite, type User } from '@orbit/shared'
import { orbitFetch } from '../utils/api'
import { ObjectImage } from './ObjectImage'
import { resolveMediaUrl } from '../utils/media'
import { useToast } from './Toast'
import { userFacingError } from '../utils/userError'
import { DropZone } from './DropZone'
import { CameraCapture } from './CameraCapture'
import { forgeMediaLocally } from '../services/mediaForge'
import {
  Flame, Link as LinkIcon, Clock,
  Sparkles, Check, X, Move,   Mail,
  ChevronDown, ChevronRight,  Layers, ZoomIn, Share2, ImagePlus
} from 'lucide-react'
import { logger } from '../utils/logger'
import { Button, Card, CardHeader, Modal, Tabs, Title } from '../ui/kit'

/**
 * Lays out n entries in a near-square grid that always fills every cell.
 * The last row stretches its cells (via grid-column spans) so no blank
 * cells are left, e.g. 2 -> 2x1, 3 -> 2x2 (last spans both), 5 -> 3x2.
 */
function computeCollageGrid(n: number): { cols: number; rows: number; spanFor: (pos: number) => number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, n))))
  const rows = Math.max(1, Math.ceil(n / cols))
  const lastStart = (rows - 1) * cols
  const last = n - lastStart
  const base = Math.floor(cols / last)
  const extra = cols % last
  return {
    cols,
    rows,
    spanFor: (pos: number) => {
      if (pos < lastStart) return 1
      const j = pos - lastStart
      return base + (j < extra ? 1 : 0)
    },
  }
}

export function BabecockPanel({
  identity,
  users,
  onOpenProfile,
  babecockVersion,
}: {
  identity?: { orbitId: string; publicKeyHex: string; privateKeyHex: string; encryptionPubHex?: string; encryptionPrivHex?: string } | null
  users?: User[]
  onOpenProfile?: (userId: string) => void
  babecockVersion?: number
}) {
  const { toast } = useToast()
  const selfId = identity?.orbitId || null
  const [round, setRound] = useState<BabecockRound | null>(null)
  const [gallery, setGallery] = useState<BabecockRound[]>([])
  const [invites, setInvites] = useState<BabecockInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'start' | 'join' | null>(null)
  const [mode, setMode] = useState<'camera' | 'upload' | 'url'>('upload')
  const [urlInput, setUrlInput] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [hasFile, setHasFile] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sendingInvite, setSendingInvite] = useState<string | null>(null)
  const [invitePickerOpen, setInvitePickerOpen] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(true)
  const [liveOpen, setLiveOpen] = useState(true)
  const [viewLayout, setViewLayout] = useState<'collage' | 'strip'>('collage')
  const [orderedEntries, setOrderedEntries] = useState<BabecockEntry[]>([])
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [expandedRound, setExpandedRound] = useState<BabecockRound | null>(null)
  const [postingToFeed, setPostingToFeed] = useState(false)
  const fileRef = useRef<File | null>(null)
  const extraFilesRef = useRef<File[]>([])

  const [addingImages, setAddingImages] = useState(false)

  const addMoreImages = async () => {
    if (!identity || !round || addingImages) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif'
    input.multiple = true
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : []
      if (files.length === 0) return
      setAddingImages(true)
      try {
        const form = new FormData()
        for (const file of files) {
          form.append('image', file)
        }
        const res = await orbitFetch(`/api/babecock/round/${round.id}/entries`, { method: 'POST', body: form }, identity)
        if (res.ok) {
          const data = await res.json()
          setRound(data.round || null)
          toast(`Added ${files.length} image${files.length > 1 ? 's' : ''}`, 'success')
        } else {
          const data = await res.json().catch(() => null)
          toast(data?.error || 'Failed to add images', 'error')
        }
      } catch (err: any) {
        toast(userFacingError(err, { fallback: 'Could not add the images.' }), 'error')
      } finally {
        setAddingImages(false)
      }
    }
    input.click()
  }

  const refresh = useCallback(async () => {
    if (!identity) return
    try {
      const [curRes, galRes, invRes] = await Promise.all([
        orbitFetch(`/api/babecock/current?_t=${Date.now()}`, { method: 'GET' }, identity),
        orbitFetch(`/api/babecock/gallery?_t=${Date.now()}`, { method: 'GET' }, identity),
        orbitFetch(`/api/babecock/invites?_t=${Date.now()}`, { method: 'GET' }, identity),
      ])
      if (curRes.ok) {
        const data = await curRes.json()
        setRound(data.round || null)
      }
      if (galRes.ok) {
        const data = await galRes.json()
        setGallery(data.rounds || [])
      }
      if (invRes.ok) {
        const data = await invRes.json()
        setInvites(data.invites || [])
      }
    } catch (err) {
      logger.warn('[babecock] refresh failed:', err)
    } finally {
      setLoading(false)
    }
  }, [identity])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      setNow(Date.now())
      // The 3-fetch refresh is network+DB; skip while hidden (clock stays).
      if (!document.hidden) void refresh()
    }, 4000)
    return () => clearInterval(timer)
  }, [refresh, babecockVersion])

  // Sync ordered entries when round updates
  useEffect(() => {
    if (round?.entries) {
      setOrderedEntries(round.entries)
    } else {
      setOrderedEntries([])
    }
  }, [round])

  useEffect(() => {
    let seen = false
    try {
      seen = localStorage.getItem('orbit_babecock_tutorial_seen') === '1'
    } catch { }
    if (!seen) {
      setShowTutorial(true)
    }
  }, [])

  const closeTutorial = () => {
    setShowTutorial(false)
    try {
      localStorage.setItem('orbit_babecock_tutorial_seen', '1')
    } catch { }
  }

  const openModal = (which: 'start' | 'join') => {
    setModal(which)
    setMode('upload')
    setPreview(null)
    setUrlInput('')
    fileRef.current = null
    extraFilesRef.current = []
    setHasFile(false)
  }

  const handleFile = (files: FileList | File[]) => {
    const fileList = Array.from(files)
    if (fileList.length === 0) return
    fileRef.current = fileList[0]
    extraFilesRef.current = fileList.slice(1)
    setHasFile(true)
    setUrlInput('')
    const file = fileList[0]
    if (file.type.startsWith('video/')) {
      try { setPreview(URL.createObjectURL(file)) } catch { setPreview(null) }
    } else {
      const reader = new FileReader()
      reader.onload = () => setPreview(typeof reader.result === 'string' ? reader.result : null)
      reader.readAsDataURL(file)
    }
  }

  const handleCameraFile = (file: File) => handleFile([file])

  const handleUrl = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    setUrlInput(trimmed)
    if (trimmed.startsWith('data:')) {
      try {
        const [meta, b64] = trimmed.split(',')
        const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], `babecock-paste-${Date.now()}.jpg`, { type: mime })
        fileRef.current = file
        setHasFile(true)
        setPreview(trimmed)
        return
      } catch { }
    }
    fileRef.current = null
    setHasFile(false)
    setPreview(trimmed)
  }

  const submit = async () => {
    if (submitting) return
    const files = fileRef.current ? [fileRef.current, ...extraFilesRef.current] : []
    const link = urlInput.trim() || (preview && (preview.startsWith('http://') || preview.startsWith('https://')) ? preview : null)
    if (files.length === 0 && !link && !preview) {
      toast('Please upload a file or enter an image URL', 'error')
      return
    }
    setSubmitting(true)
    try {
      const form = new FormData()
      const files = fileRef.current ? [fileRef.current, ...extraFilesRef.current] : []
      if (files.length > 0) {
        for (const file of files) {
          form.append('image', file, file.name || `babecock-${Date.now()}.jpg`)
        }
      } else if (link) {
        form.append('url', link)
      } else if (preview && preview.startsWith('data:')) {
        const [meta, b64] = preview.split(',')
        const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        const f = new File([bytes], `babecock-${Date.now()}.jpg`, { type: mime })
        form.append('image', f)
      }

      const endpoint = modal === 'start' ? '/api/babecock/start' : `/api/babecock/${round?.id || ''}/join`
      const res = await orbitFetch(endpoint, { method: 'POST', body: form }, identity!)
      if (res.ok) {
        const data = await res.json()
        setRound(data.round || null)
        toast(modal === 'start' ? 'Babecock round started. Challengers can now join' : 'You joined the round!', 'success')
        setModal(null)
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error || 'Action failed', 'error')
        if (res.status === 409 && modal === 'start') {
          void refresh()
        }
      }
    } catch (err: any) {
      toast(userFacingError(err, { fallback: 'That action did not go through.' }), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const secsLeft = round ? Math.max(0, Math.floor(((round.phase_deadline || 0) - now) / 1000)) : 0
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const sendInvite = async (inviteeId: string) => {
    if (!round || !identity) return
    setSendingInvite(inviteeId)
    try {
      const res = await orbitFetch(`/api/babecock/${round.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitee_id: inviteeId }),
      }, identity)
      if (res.ok) {
        toast('Invite sent.', 'success')
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error || 'Invite failed', 'error')
      }
    } catch {
      toast('Invite failed. Try again.', 'error')
    } finally {
      setSendingInvite(null)
      setInvitePickerOpen(false)
    }
  }

  const dismissInvite = async (inviteId: string) => {
    if (!identity) return
    try {
      const res = await orbitFetch(`/api/babecock/invites/${inviteId}/decline`, { method: 'POST' }, identity)
      if (res.ok) {
        setInvites((prev) => prev.filter((i) => i.id !== inviteId))
      }
    } catch { }
  }

  // Promote a finished round's OP picture to the caller's public feed.
  const postRoundToFeed = async (round: BabecockRound) => {
    if (!identity || postingToFeed) return
    const placedEntries = round.entries.filter((e) => e.mime_type?.startsWith('image/'))
    if (placedEntries.length === 0) {
      toast('No images to post', 'error')
      return
    }
    setPostingToFeed(true)
    try {
      const n = placedEntries.length
      const { cols, rows, spanFor } = computeCollageGrid(n)
      const cellSize = 400
      const canvas = document.createElement('canvas')
      canvas.width = cols * cellSize
      canvas.height = rows * cellSize
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        toast('Canvas not available', 'error')
        setPostingToFeed(false)
        return
      }
      ctx.fillStyle = '#0b0e14'  // canvas raster (exempt: computed, not a class)
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const loadImage = async (entry: BabecockEntry): Promise<HTMLImageElement | null> => {
        const mediaUrl = resolveMediaUrl(entry.content_url)
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        return new Promise((resolve) => {
          img.onload = () => resolve(img)
          img.onerror = () => resolve(null)
          if (mediaUrl.startsWith('data:') || mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
            img.src = mediaUrl
          } else {
            orbitFetch(mediaUrl, { method: 'GET' }, identity).then(async (res) => {
              if (res.ok) {
                const blob = await res.blob()
                img.src = URL.createObjectURL(blob)
              } else {
                resolve(null)
              }
            }).catch(() => resolve(null))
          }
        })
      }

      const images = await Promise.all(placedEntries.map(loadImage))
      const lastStart = (rows - 1) * cols
      const lastRowX: number[] = []
      let accX = 0
      for (let j = 0; j < n - lastStart; j++) {
        lastRowX[j] = accX
        accX += spanFor(lastStart + j) * cellSize
      }
      for (let i = 0; i < n; i++) {
        const img = images[i]
        if (!img) continue
        const row = Math.floor(i / cols)
        const x = row === rows - 1 ? lastRowX[i - lastStart] : (i % cols) * cellSize
        const w = row === rows - 1 ? spanFor(i) * cellSize : cellSize
        const y = row * cellSize
        const imgAspect = img.width / img.height
        const cellAspect = w / cellSize
        let drawWidth: number, drawHeight: number, drawX: number, drawY: number
        if (imgAspect > cellAspect) {
          drawHeight = cellSize
          drawWidth = cellSize * imgAspect
          drawX = x - (drawWidth - w) / 2
          drawY = y
        } else {
          drawWidth = w
          drawHeight = w / imgAspect
          drawX = x
          drawY = y - (drawHeight - cellSize) / 2
        }
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight)
      }
      // Blob URLs existed only to feed the canvas — release them now.
      for (const img of images) if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) {
        toast('Failed to compose image', 'error')
        setPostingToFeed(false)
        return
      }
      const file = new File([blob], `babecock-${round.id.slice(0, 8)}.jpg`, { type: 'image/jpeg' })
      // Zero-media P2P path: seed + register (never raw binary, which 422s).
      const forged = await forgeMediaLocally(file, identity, {
        caption: `Babecock grid by ${round.host_name || 'Anonymous'}`,
        tags: 'babecock',
        isPublic: true,
      })
      if (forged?.id) {
        toast('Posted to your feed.', 'success')
      } else {
        toast('Failed to post to feed', 'error')
      }
    } catch {
      toast('Failed to post to feed', 'error')
    } finally {
      setPostingToFeed(false)
    }
  }

  // Share a babecock entry to a group chat
  const shareEntryToGroup = async (entry: BabecockEntry) => {
    if (!identity) return
    toast('Preparing image…', 'info')
    try {
      let file: File | null = null
      const mediaUrl = entry.content_url
      const blobFor = async (b: Blob): Promise<File> => {
        const type = entry.mime_type || b.type || 'image/jpeg'
        const ext = type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : type.includes('webp') ? 'webp' : type.includes('video') ? 'mp4' : 'jpg'
        return new File([b], `babecock-${entry.id.slice(0, 8)}.${ext}`, { type })
      }
      if (mediaUrl.startsWith('data:')) {
        const res = await fetch(mediaUrl)
        if (res.ok) file = await blobFor(await res.blob())
      } else if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
        const res = await fetch(mediaUrl)
        if (res.ok) file = await blobFor(await res.blob())
      } else {
        const res = await orbitFetch(mediaUrl, { method: 'GET' }, identity)
        if (res.ok) file = await blobFor(await res.blob())
      }
      if (!file) {
        toast('Could not load the image', 'error')
        return
      }
      // Zero-media P2P path: seed + register (never raw binary, which 422s).
      const forged = await forgeMediaLocally(file, identity, {
        caption: entry.id,
        isPublic: false,
        isChat: true,
      })
      if (forged?.id) {
        // Open attachment modal for group chat
        // We need to trigger this from parent - emit custom event
        window.dispatchEvent(new CustomEvent('babecock-share-to-group', {
          detail: { attachment: { id: forged.id, url: `/api/objects/${forged.id}`, isVideo: entry.mime_type.startsWith('video') } }
        }))
        toast('Ready to share. Pick a group chat.', 'success')
      } else {
        toast('Failed to prepare image', 'error')
      }
    } catch {
      toast('Failed to prepare image', 'error')
    }
  }

  // Drag and drop collage reordering
  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDropOnCell = (e: React.DragEvent, targetPosition: number) => {
    e.preventDefault()
    if (draggedIdx === null || !identity || !round || !amHost) return
    const entry = orderedEntries[draggedIdx]
    if (!entry) return
    const placements = orderedEntries.map((e, idx) => ({
      entry_id: e.id,
      grid_position: idx === draggedIdx ? targetPosition : (orderedEntries[idx]?.grid_position ?? idx),
    }))
    const uniquePositions = new Set(placements.map(p => p.grid_position))
    if (uniquePositions.size !== placements.length) {
      void refresh()
      setDraggedIdx(null)
      return
    }
    const newEntries = [...orderedEntries]
    const draggedEntry = newEntries[draggedIdx]
    newEntries.splice(draggedIdx, 1)
    newEntries.splice(targetPosition, 0, draggedEntry)
    setOrderedEntries(newEntries)
    setDraggedIdx(null)
    void orbitFetch(`/api/babecock/round/${round.id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placements: newEntries.map((e, idx) => ({ entry_id: e.id, grid_position: idx })),
      }),
    }, identity).then((res) => {
      if (!res.ok) void refresh()
    }).catch(() => { void refresh() })
  }

  const handleDragEnd = () => {
    setDraggedIdx(null)
  }

  const candidateUsers = (users || []).filter((u) => {
    if (!u.online) return false
    if (selfId && u.id === selfId) return false
    if (round && round.entries.some((e) => e.user_id === u.id)) return false
    return true
  })

  const amHost = Boolean(round && selfId && round.host_id === selfId)

  return (
    <div className="space-y-4 font-sans select-none">
      {/* Tutorial overlay */}
      {showTutorial && (
        <Modal onClose={closeTutorial} title="How the round works">
          <ol className="text-xs text-retro-muted space-y-2 leading-relaxed list-decimal list-inside">
            <li>A host starts the round with an <strong className="text-retro-fg">OP picture</strong>.</li>
            <li>Other players join with their own challenger pictures before the 3-minute timer expires.</li>
            <li>Organize cards into a <strong className="text-retro-fg">collage grid</strong> with the OP picture in the center.</li>
            <li>Finished rounds appear in the <strong className="text-retro-fg">gallery</strong> for 1 hour.</li>
          </ol>
          <Button variant="primary" className="w-full" onClick={closeTutorial}>
            Got it
          </Button>
        </Modal>
      )}

      {/* Invites Banner */}
      {invites.length > 0 && (
        <Card className="p-3.5 space-y-2">
          <Title>Invites ({invites.length})</Title>
          <div className="space-y-1.5">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 p-2.5 bg-glass-w5 border border-edge rounded-lg text-xs">
                <span className="text-retro-fg truncate">
                  <strong className="font-medium">{inv.host_name || 'Someone'}</strong> invited you to their round
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      void dismissInvite(inv.id)
                      openModal('join')
                    }}
                  >
                    Join
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Dismiss invite" onClick={() => dismissInvite(inv.id)} className="px-1.5">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Live Round Section */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={<Flame className="w-4 h-4" />}
          title="Live round"
          caption={round
            ? `Hosted by ${round.host_name || 'Anonymous'} · ${round.entries.length} entr${round.entries.length === 1 ? 'y' : 'ies'}`
            : 'No round running right now'}
          right={
            <>
              {round && (
                <span className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-md border flex items-center gap-1 ${secsLeft > 0 ? 'bg-danger/10 text-danger-fg border-danger/30' : 'text-retro-muted border-edge'
                  }`}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>{secsLeft > 0 ? fmt(secsLeft) : 'CLOSED'}</span>
                </span>
              )}
              {round && round.entries.length > 1 && (
                <Tabs
                  tabs={[{ id: 'collage' as const, label: 'Collage' }, { id: 'strip' as const, label: 'Strip' }]}
                  value={viewLayout}
                  onChange={(v) => setViewLayout(v)}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label={liveOpen ? "Collapse live round" : "Expand live round"}
                aria-expanded={liveOpen}
                onClick={() => setLiveOpen((v) => !v)}
                className="px-1.5"
              >
                {liveOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </Button>
            </>
          }
        />

        {liveOpen && (
          <div className="p-4 space-y-4">
            {loading ? (
              <div className="text-xs text-retro-muted py-6 text-center">Loading Babecock arena…</div>
            ) : !round ? (
              <div className="text-center py-10 space-y-3">
                <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-500 mx-auto">
                  <Flame className="w-6 h-6 text-orange-500" />
                </div>
                <p className="text-xs text-retro-muted max-w-sm mx-auto leading-relaxed">
                  No round is live. Start one by posting the OP image and inviting challengers.
                </p>
                <Button variant="primary" onClick={() => openModal('start')} className="mx-auto">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Start a round</span>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Collage Grid / Strip View */}
                {viewLayout === 'collage' ? (() => {
                  const n = orderedEntries.length
                  const { cols, rows, spanFor } = computeCollageGrid(n)
                  return (
                    <div
                      className="bg-retro-bg rounded-xl overflow-hidden w-full flex flex-col"
                      style={{ aspectRatio: `${cols} / ${rows}`, minHeight: 280, maxHeight: 'min(62vh, 560px)' }}
                    >
                      <div className="text-2xs uppercase font-bold text-retro-muted tracking-wider p-3 flex items-center justify-between border-b border-edge">
                        <span>Grid ({cols}×{rows}, {n} images)</span>
                        {amHost && <span className="text-retro-muted text-2xs flex items-center gap-1"><Move className="w-2.5 h-2.5" /> Drag to rearrange</span>}
                      </div>
                      <div
                        className="grid gap-0 flex-1 min-h-0"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
                      >
                        {n === 0 ? (
                          <div className="flex items-center justify-center text-2xs text-retro-muted uppercase tracking-wider">
                            No images yet
                          </div>
                        ) : orderedEntries.map((entry, pos) => {
                          const span = spanFor(pos)
                          const isOp = entry.user_id === round.host_id
                          return (
                            <div
                              key={entry.id}
                              draggable={amHost}
                              onDragStart={() => handleDragStart(pos)}
                              onDragOver={handleDragOver}
                              onDrop={(e) => handleDropOnCell(e, pos)}
                              onDragEnd={handleDragEnd}
                              style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
                              className={`relative bg-retro-bg overflow-hidden ${amHost ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedIdx === pos ? 'opacity-30' : ''}`}
                            >
                              {entry.mime_type.startsWith('video') ? (
                                <video src={resolveMediaUrl(entry.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                              ) : (
                                <ObjectImage contentUrl={entry.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                              )}
                              {isOp && (
                                <span className="absolute top-1 left-1 bg-warning text-retro-accent-text text-2xs font-black px-1.5 py-0.5 rounded shadow-xs flex items-center gap-0.5">
                                  <Sparkles className="w-2 h-2" />
                                  <span>OP</span>
                                </span>
                              )}
                              <span
                                onClick={() => onOpenProfile?.(entry.user_id)}
                                className="absolute bottom-1 left-1 right-1 text-2xs font-bold text-retro-fg bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded truncate cursor-pointer hover:bg-black/80"
                              >
                                {entry.display_name || 'Anonymous'}
                                {entry.user_id === selfId && ' (you)'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })() : (
                  <div className="flex items-end justify-center gap-3 overflow-x-auto styled-scrollbar pb-2">
                    {orderedEntries.map((entry) => {
                      const isOp = entry.user_id === round.host_id
                      return (
                        <div key={entry.id} className="flex flex-col items-center gap-1.5 shrink-0">
                          <div className={`rounded-xl overflow-hidden border-2 bg-retro-bg ${isOp ? 'border-warning w-44 h-60 shadow-xl' : 'border-edge w-32 h-44'}`}>
                            {entry.mime_type.startsWith('video') ? (
                              <video src={resolveMediaUrl(entry.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                            ) : (
                              <ObjectImage contentUrl={entry.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-2xs font-bold text-retro-muted max-w-full truncate">
                            {isOp && <Sparkles className="w-3 h-3 text-warning-fg" />}
                            <span className="truncate">{entry.display_name || 'Anonymous'}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Round Actions & Controls */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {amHost && secsLeft > 0 && (
                    <Button onClick={addMoreImages} disabled={addingImages}>
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>{addingImages ? 'Adding…' : 'Add images'}</span>
                    </Button>
                  )}
                  {round.my_entry ? (
                    <span className="px-3 py-1.5 text-xs font-semibold text-success-fg bg-success border border-success rounded-lg flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>You are in the round</span>
                    </span>
                  ) : secsLeft > 0 ? (
                    <Button variant="primary" onClick={() => openModal('join')}>
                      Join the round
                    </Button>
                  ) : (
                    <span className="px-3 py-1.5 text-xs font-semibold text-retro-muted border border-edge rounded-lg">Round finished</span>
                  )}

                  {amHost && secsLeft > 0 && (
                    <div className="relative">
                      <Button onClick={() => setInvitePickerOpen((v) => !v)}>
                        <Mail className="w-3.5 h-3.5" />
                        <span>{invitePickerOpen ? 'Close picker' : 'Invite a friend'}</span>
                      </Button>

                      {invitePickerOpen && (
                        <Card tone="raised" className="absolute z-30 top-full left-0 mt-1.5 w-64 max-h-72 overflow-y-auto styled-scrollbar p-2 space-y-1">
                          {candidateUsers.length === 0 ? (
                            <div className="text-xs text-retro-muted p-2 text-center">No online peers to invite.</div>
                          ) : (
                            candidateUsers.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                disabled={sendingInvite !== null}
                                onClick={() => sendInvite(u.id)}
                                className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-glass-w12 disabled:opacity-40 text-left cursor-pointer transition-colors"
                              >
                                <div className="w-7 h-7 rounded-full bg-glass-w12 border border-edge flex items-center justify-center text-xs font-bold text-retro-fg shrink-0">
                                  {(u.display_name?.trim() || 'Unknown User').slice(0, 1).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-retro-fg truncate">{u.display_name?.trim() || 'Unknown User'}</div>
                                </div>
                                {sendingInvite === u.id && (
                                  <span className="text-xs text-retro-muted animate-pulse">…</span>
                                )}
                              </button>
                            ))
                          )}
                        </Card>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Gallery Section */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={<Layers className="w-4 h-4" />}
          title="Gallery (past 1h)"
          right={
            <Button
              variant="ghost"
              size="sm"
              aria-label={galleryOpen ? 'Collapse gallery' : 'Expand gallery'}
              aria-expanded={galleryOpen}
              onClick={() => setGalleryOpen((v) => !v)}
              className="px-1.5"
            >
              {galleryOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          }
          className={galleryOpen ? '' : 'border-b-0'}
        />

        {galleryOpen && (
          <div className="p-4">
            {gallery.length === 0 ? (
              <div className="text-xs text-retro-muted py-6 text-center">No finished rounds in the past hour.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {gallery.map((g) => {
                  const op = g.entries.find((e) => e.user_id === g.host_id) || g.entries[0]
                  return (
                    <div
                      key={g.id}
                      onClick={() => setExpandedRound(g)}
                      className="bg-glass-w5 border border-edge rounded-lg overflow-hidden space-y-1.5 p-2 cursor-pointer group hover:bg-glass-w8 transition-colors"
                    >
                      {op && (
                        <div className="w-full aspect-square rounded-md overflow-hidden bg-retro-bg relative">
                          {op.mime_type.startsWith('video') ? (
                            <video src={resolveMediaUrl(op.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                          ) : (
                            <ObjectImage contentUrl={op.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          )}
                          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                            <ZoomIn className="w-6 h-6 text-retro-fg" />
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs text-retro-muted px-1">
                        <span className="font-semibold text-retro-fg truncate">{g.host_name || 'Host'}</span>
                        <span className="text-2xs text-retro-muted">{g.entries.length} cards</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Modal: Start or Join Round */}
      {modal && (
        <Modal
          title={modal === 'start' ? 'Post the OP picture' : 'Join with your picture'}
          onClose={() => setModal(null)}
          maxWidth="max-w-lg"
        >
        <Tabs
          tabs={[{ id: 'upload' as const, label: 'Upload' }, { id: 'url' as const, label: 'URL' }, { id: 'camera' as const, label: 'Camera' }]}
          value={mode}
          onChange={(m) => {
            setMode(m)
            setPreview(null)
            setUrlInput('')
            fileRef.current = null
            setHasFile(false)
          }}
        />

        <div className="space-y-3">
          {mode === 'camera' ? (
            <>
              <CameraCapture onCapture={handleCameraFile} onCancel={() => setMode('upload')} />
              {hasFile && (
                <div className="flex items-center gap-2 px-3 py-2 bg-success border border-success rounded-lg text-xs font-semibold text-success-fg">
                  <Check className="w-4 h-4" />
                  <span>Snapshot captured and ready.</span>
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { fileRef.current = null; setHasFile(false); setPreview(null) }}>
                    Discard
                  </Button>
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
                  placeholder="Paste an image or video link"
                  className="flex-1 bg-glass-w5 border border-edge rounded-lg px-3 py-2 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-retro-accent"
                />
              </div>
              {urlInput && (
                <div className="p-3 rounded-lg border border-edge bg-glass-w5 text-xs text-retro-fg flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-retro-muted shrink-0" />
                  <span className="truncate">Will be fetched and stored on submit</span>
                </div>
              )}
            </div>
          ) : (
            <>
              <DropZone onFiles={handleFile} onPasteUrl={handleUrl} compact={false} accept="image/jpeg, image/png, image/webp, image/gif" multiple={modal === 'start'}>
                <div className="space-y-1 text-center py-2">
                  <p className="text-xs text-retro-fg font-semibold">Drop an image/video or click to browse</p>
                  <p className="text-2xs text-retro-muted">JPG, PNG, WebP, GIF, MP4, WebM (up to 50MB)</p>
                </div>
              </DropZone>
              {preview && (
                preview.startsWith('data:video') || preview.startsWith('blob:') ? (
                  <video src={preview} controls className="w-full max-h-52 object-contain rounded-lg border border-edge bg-retro-bg" />
                ) : preview.startsWith('http://') || preview.startsWith('https://') ? (
                  <div className="w-full text-center py-3 rounded-lg border border-edge bg-glass-w5 text-xs text-retro-fg flex items-center justify-center gap-2">
                    <LinkIcon className="w-3.5 h-3.5 text-retro-muted" />
                    <span>Link ready to submit</span>
                  </div>
                ) : (
                  <img src={preview} alt="Preview" className="w-full max-h-52 object-contain rounded-lg border border-edge bg-retro-bg" />
                )
              )}
            </>
          )}
        </div>

        <div className="pt-2 border-t border-edge flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={submitting || (!hasFile && !urlInput.trim() && !preview)}
            onClick={submit}
          >
            {submitting ? 'Submitting…' : modal === 'start' ? 'Start round' : 'Join round'}
          </Button>
        </div>
        </Modal>
      )}

      {/* Expanded Gallery Round Lightbox */}
      {expandedRound && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setExpandedRound(null)}
        >
          <Card
            tone="raised"
            className="max-w-3xl w-full max-h-(--max-h-dialog) overflow-y-auto styled-scrollbar p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-edge">
              <div className="flex items-center gap-2 min-w-0">
                <Flame className="w-4 h-4 text-orange-500 shrink-0" />
                <Title className="truncate">Round by {expandedRound.host_name || 'Anonymous'}</Title>
                <span className="text-xs text-retro-muted shrink-0">{expandedRound.entries.length} cards</span>
              </div>
              <Button variant="ghost" size="sm" aria-label="Close" onClick={() => setExpandedRound(null)} className="px-1.5">
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {expandedRound.entries.map((entry) => (
                <div key={entry.id} className="relative aspect-square rounded-lg overflow-hidden bg-retro-bg group">
                  {entry.mime_type.startsWith('video') ? (
                    <video src={resolveMediaUrl(entry.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                  ) : (
                    <ObjectImage contentUrl={entry.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); shareEntryToGroup(entry); }}
                    className="absolute bottom-2 right-2 p-1.5 bg-black/70 rounded-lg text-retro-muted hover:text-retro-fg transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    title="Share to group chat"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {selfId === expandedRound.host_id && (
              <div className="flex justify-end pt-2 border-t border-edge">
                <Button
                  variant="primary"
                  disabled={postingToFeed}
                  onClick={() => postRoundToFeed(expandedRound)}
                >
                  {postingToFeed ? 'Posting…' : 'Post to feed'}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
