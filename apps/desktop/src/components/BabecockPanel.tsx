"use client";

import { useState, useEffect, useRef, useCallback } from 'react'
import { type BabecockRound, type BabecockEntry, type BabecockInvite, type User } from '@orbit/shared'
import { orbitFetch } from '../utils/api'
import { ObjectImage } from './ObjectImage'
import { resolveMediaUrl, contentHash } from '../utils/media'
import { useToast } from './Toast'
import { DropZone } from './DropZone'
import { CameraCapture } from './CameraCapture'
import {
  Flame, Camera, UploadCloud, Link as LinkIcon, Clock,
  Sparkles, Check, X, Grid, Move, Users, RefreshCw, Mail,
  ChevronDown, ChevronRight, HelpCircle, Layers, ZoomIn, Share2, ImagePlus
} from 'lucide-react'
import { logger } from '../utils/logger'

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
        toast(err?.message || 'Failed to add images', 'error')
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
      void refresh()
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
        toast(modal === 'start' ? 'Babecock round started — challengers can now join!' : 'You joined the round!', 'success')
        setModal(null)
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error || 'Action failed', 'error')
        if (res.status === 409 && modal === 'start') {
          void refresh()
        }
      }
    } catch (err: any) {
      toast(err?.message || 'Action failed', 'error')
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
        toast('Invite sent!', 'success')
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error || 'Invite failed', 'error')
      }
    } catch {
      toast('Invite failed — try again', 'error')
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
      ctx.fillStyle = '#080A0D'
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

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) {
        toast('Failed to compose image', 'error')
        setPostingToFeed(false)
        return
      }
      const file = new File([blob], `babecock-${round.id.slice(0, 8)}.jpg`, { type: 'image/jpeg' })
      const form = new FormData()
      form.append('image', file, file.name)
      form.append('is_public', '1')
      form.append('post_caption', `Babecock grid by ${round.host_name || 'Anonymous'}`)
      form.append('tags', 'babecock')
      const res = await orbitFetch('/api/objects', { method: 'POST', body: form }, identity)
      if (res.ok) {
        toast('Posted to your feed!', 'success')
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error || 'Failed to post to feed', 'error')
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
      const form = new FormData()
      form.append('image', file, file.name)
      form.append('content_hash', await contentHash(file))
      form.append('is_story', 'false')
      const res = await orbitFetch('/api/objects', { method: 'POST', body: form }, identity)
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data?.id) {
          // Open attachment modal for group chat
          // We need to trigger this from parent - emit custom event
          window.dispatchEvent(new CustomEvent('babecock-share-to-group', {
            detail: { attachment: { id: data.id, url: `/api/objects/${data.id}`, isVideo: entry.mime_type.startsWith('video') } }
          }))
          toast('Ready to share — pick a group chat', 'success')
        }
      } else {
        const data = await res.json().catch(() => null)
        toast(data?.error || 'Failed to prepare image', 'error')
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
        <div className="fixed inset-0 z-[9997] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-raised border border-border-glass rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600">
                <Flame className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-black text-retro-fg uppercase tracking-wider">Welcome to Babecock</h2>
            </div>
            <ol className="text-xs text-retro-muted space-y-2 leading-relaxed list-decimal list-inside">
              <li>A host starts the round with an <strong className="text-retro-fg">OP picture</strong>.</li>
              <li>Other players join with their own challenger pictures before the 3-minute timer expires.</li>
              <li>Organize cards into an interconnected <strong className="text-retro-fg">collage grid</strong> with the OP picture in the center.</li>
              <li>Finished rounds appear in the <strong className="text-retro-fg">Babecock Gallery</strong> for 1 hour.</li>
            </ol>
            <button
              type="button"
              onClick={closeTutorial}
              className="w-full py-2.5 bg-black text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-surface-elevated transition-colors cursor-pointer shadow-xs"
            >
              Got it, let&apos;s go!
            </button>
          </div>
        </div>
      )}

      {/* Invites Banner */}
      {invites.length > 0 && (
        <div className="bg-cyan-500/10/80 border border-cyan-500/30 rounded-2xl p-3.5 space-y-2">
          <div className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-cyan-300" />
            <span>Babecock Invitations ({invites.length})</span>
          </div>
          <div className="space-y-1.5">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 p-2 bg-surface-raised border border-purple-100 rounded-xl text-xs shadow-xs">
                <span className="text-retro-body">
                  <strong className="text-retro-fg">{inv.host_name || 'Someone'}</strong> invited you to their round!
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void dismissInvite(inv.id)
                      openModal('join')
                    }}
                    className="px-3 py-1 bg-cyan-500 text-white font-bold text-[11px] rounded-lg hover:bg-cyan-600 cursor-pointer shadow-xs"
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissInvite(inv.id)}
                    className="p-1 text-retro-muted hover:text-retro-body rounded-lg cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Round Section */}
      <div className="bg-surface-raised border border-border-glass rounded-2xl overflow-hidden shadow-xs">
        <div className="flex items-center justify-between px-4 py-3.5 bg-surface-interactive border-b border-border-glass">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-retro-fg uppercase tracking-wider">Live Babecock</h2>
              <p className="text-[10px] text-retro-muted font-sans">
                {round
                  ? `Hosted by ${round.host_name || 'Anonymous'} — ${round.entries.length} entr${round.entries.length === 1 ? 'y' : 'ies'}`
                  : 'No round running right now'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {round && (
              <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border flex items-center gap-1 ${secsLeft > 0 ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse' : 'text-retro-muted border-border-glass'
                }`}>
                <Clock className="w-3 h-3" />
                <span>{secsLeft > 0 ? fmt(secsLeft) : 'CLOSED'}</span>
              </span>
            )}
            {round && round.entries.length > 1 && (
              <div className="flex bg-surface-interactive p-0.5 rounded-lg border border-border-glass text-[10px] font-semibold">
                <button
                  type="button"
                  onClick={() => setViewLayout('collage')}
                  className={`px-2 py-0.5 rounded-md cursor-pointer ${viewLayout === 'collage' ? 'bg-surface-raised text-retro-fg shadow-xs font-bold' : 'text-retro-muted'}`}
                  title="Collage Grid"
                >
                  <Grid className="w-3 h-3 inline mr-1" />
                  Collage
                </button>
                <button
                  type="button"
                  onClick={() => setViewLayout('strip')}
                  className={`px-2 py-0.5 rounded-md cursor-pointer ${viewLayout === 'strip' ? 'bg-surface-raised text-retro-fg shadow-xs font-bold' : 'text-retro-muted'}`}
                  title="Strip View"
                >
                  <Layers className="w-3 h-3 inline mr-1" />
                  Strip
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setLiveOpen((v) => !v)}
              className="p-1 text-retro-muted hover:text-retro-body cursor-pointer"
            >
              {liveOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {liveOpen && (
          <div className="p-4 space-y-4">
            {loading ? (
              <div className="text-xs text-retro-muted py-6 text-center">Loading Babecock arena…</div>
            ) : !round ? (
              <div className="text-center py-10 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-500 mx-auto">
                  <Flame className="w-6 h-6 text-orange-500" />
                </div>
                <p className="text-xs text-retro-muted max-w-sm mx-auto leading-relaxed">
                  No Babecock round is currently live. Start one by posting the OP image and inviting challengers!
                </p>
                <button
                  type="button"
                  onClick={() => openModal('start')}
                  className="px-4 py-2 bg-black hover:bg-surface-elevated text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Start a Round</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Collage Grid / Strip View */}
                {viewLayout === 'collage' ? (() => {
                  const n = orderedEntries.length
                  const { cols, rows, spanFor } = computeCollageGrid(n)
                  return (
                    <div
                      className="bg-black rounded-2xl overflow-hidden w-full flex flex-col"
                      style={{ aspectRatio: `${cols} / ${rows}`, minHeight: 280, maxHeight: 'min(62vh, 560px)' }}
                    >
                      <div className="text-[10px] uppercase font-bold text-retro-muted tracking-wider p-3 flex items-center justify-between border-b border-white/5">
                        <span>Grid ({cols}×{rows}, {n} images)</span>
                        {amHost && <span className="text-retro-muted text-[9px] flex items-center gap-1"><Move className="w-2.5 h-2.5" /> Drag to rearrange</span>}
                      </div>
                      <div
                        className="grid gap-0 flex-1 min-h-0"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
                      >
                        {n === 0 ? (
                          <div className="flex items-center justify-center text-[10px] text-retro-muted uppercase tracking-wider">
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
                              className={`relative bg-black overflow-hidden ${amHost ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedIdx === pos ? 'opacity-30' : ''}`}
                            >
                              {entry.mime_type.startsWith('video') ? (
                                <video src={resolveMediaUrl(entry.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                              ) : (
                                <ObjectImage contentUrl={entry.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                              )}
                              {isOp && (
                                <span className="absolute top-1 left-1 bg-amber-400 text-black text-[8px] font-black px-1.5 py-0.5 rounded shadow-xs flex items-center gap-0.5">
                                  <Sparkles className="w-2 h-2" />
                                  <span>OP</span>
                                </span>
                              )}
                              <span
                                onClick={() => onOpenProfile?.(entry.user_id)}
                                className="absolute bottom-1 left-1 right-1 text-[9px] font-bold text-white bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded truncate cursor-pointer hover:bg-black/80"
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
                          <div className={`rounded-xl overflow-hidden border-2 bg-black ${isOp ? 'border-amber-500 w-44 h-60 shadow-xl' : 'border-border-glass w-32 h-44'}`}>
                            {entry.mime_type.startsWith('video') ? (
                              <video src={resolveMediaUrl(entry.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                            ) : (
                              <ObjectImage contentUrl={entry.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] font-bold text-retro-muted max-w-full truncate">
                            {isOp && <Sparkles className="w-3 h-3 text-amber-500" />}
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
                    <button
                      type="button"
                      onClick={addMoreImages}
                      disabled={addingImages}
                      className="px-3 py-2 text-xs font-bold text-retro-body border border-border-glass hover:bg-white/10 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>{addingImages ? 'Adding...' : 'Add images'}</span>
                    </button>
                  )}
                  {round.my_entry ? (
                    <span className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>You are in the round</span>
                    </span>
                  ) : secsLeft > 0 ? (
                    <button
                      type="button"
                      onClick={() => openModal('join')}
                      className="px-4 py-2 bg-black hover:bg-surface-elevated text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer shadow-xs flex items-center gap-1.5"
                    >
                      <span>+ add yours or any cock!</span>
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-xs font-semibold text-retro-muted border border-border-glass rounded-xl">Round finished</span>
                  )}

                  {amHost && secsLeft > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setInvitePickerOpen((v) => !v)}
                        className="px-3.5 py-2 text-xs font-bold text-retro-body border border-border-glass hover:bg-white/10 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5 text-cyan-300" />
                        <span>{invitePickerOpen ? 'Close Picker' : 'Invite a Friend'}</span>
                      </button>

                      {invitePickerOpen && (
                        <div className="absolute z-30 top-full left-0 mt-1.5 w-64 max-h-72 overflow-y-auto styled-scrollbar bg-surface-raised border border-border-glass rounded-2xl shadow-xl p-2 space-y-1">
                          {candidateUsers.length === 0 ? (
                            <div className="text-xs text-retro-muted p-2 text-center">No online peers to invite.</div>
                          ) : (
                            candidateUsers.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                disabled={sendingInvite !== null}
                                onClick={() => sendInvite(u.id)}
                                className="w-full flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/10 disabled:opacity-40 text-left cursor-pointer transition-colors"
                              >
                                <div className="w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-xs font-bold text-cyan-300 shrink-0">
                                  {(u.display_name?.trim() || 'Unknown User').slice(0, 1).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-bold text-retro-body truncate">{u.display_name?.trim() || 'Unknown User'}</div>
                                </div>
                                {sendingInvite === u.id && (
                                  <span className="text-xs text-retro-muted animate-pulse">…</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Gallery Section */}
      <div className="bg-surface-raised border border-border-glass rounded-2xl overflow-hidden shadow-xs">
        <button
          type="button"
          onClick={() => setGalleryOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-surface-raised hover:bg-white/10 transition-colors cursor-pointer text-left border-b border-border-glass"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-retro-muted" />
            <h3 className="text-xs font-black text-retro-fg uppercase tracking-wider">
              Babecock Gallery <span className="text-retro-muted font-normal normal-case">(past 1h)</span>
            </h3>
          </div>
          <span className="text-xs text-retro-muted">{galleryOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
        </button>

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
                      className="bg-surface-raised border border-border-glass rounded-xl overflow-hidden space-y-1.5 p-2 shadow-xs cursor-pointer group hover:border-zinc-500 transition-colors"
                    >
                      {op && (
                        <div className="w-full aspect-square rounded-lg overflow-hidden bg-black relative">
                          {op.mime_type.startsWith('video') ? (
                            <video src={resolveMediaUrl(op.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                          ) : (
                            <ObjectImage contentUrl={op.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          )}
                          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                            <ZoomIn className="w-6 h-6 text-white" />
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[11px] text-retro-muted px-1">
                        <span className="font-bold text-retro-fg truncate">{g.host_name || 'Host'}</span>
                        <span className="text-[10px] text-retro-muted">{g.entries.length} cards</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: Start or Join Round */}
      {modal && (
        <div className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-raised border border-border-glass rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-border-glass pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-black text-retro-fg uppercase tracking-wider">
                    {modal === 'start' ? 'Post the OP Picture' : 'Join with your Picture'}
                  </h2>
                  <p className="text-[10px] text-retro-muted">
                    {modal === 'start' ? 'You start the round — challengers will compare against yours' : `Round finishes in ${fmt(secsLeft)}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
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
                  className={`flex-1 py-1.5 rounded-lg transition-all uppercase cursor-pointer flex items-center justify-center gap-1.5 ${mode === m ? 'bg-surface-raised text-retro-fg shadow-xs font-black' : 'text-retro-muted hover:text-retro-body'
                    }`}
                >
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
                      <span>Snapshot captured &amp; ready to post.</span>
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
                      <span className="truncate">URL ready — will be fetched and stored on submit</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <DropZone onFiles={handleFile} onPasteUrl={handleUrl} compact={false} accept="image/jpeg, image/png, image/webp, image/gif" multiple={modal === 'start'}>
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

            {/* Actions */}
            <div className="pt-2 border-t border-border-glass flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="px-4 py-2 text-xs font-bold text-retro-muted hover:text-retro-fg border border-border-glass rounded-xl cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || (!hasFile && !urlInput.trim() && !preview)}
                onClick={submit}
                className="px-5 py-2 bg-black hover:bg-surface-elevated text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting...' : modal === 'start' ? 'Start Round' : 'Join Round'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Gallery Round Lightbox */}
      {expandedRound && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-orbit-fade-in"
          onClick={() => setExpandedRound(null)}
        >
          <div
            className="bg-surface-raised border border-border-glass rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto styled-scrollbar p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-glass pb-3">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                <h3 className="text-sm font-black text-retro-fg">
                  Round by {expandedRound.host_name || 'Anonymous'}
                </h3>
                <span className="text-xs text-retro-muted">{expandedRound.entries.length} cards</span>
              </div>
              <button
                type="button"
                onClick={() => setExpandedRound(null)}
                className="text-retro-muted hover:text-retro-body p-1.5 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {expandedRound.entries.map((entry) => (
                <div key={entry.id} className="relative aspect-square rounded-xl overflow-hidden bg-black group">
                  {entry.mime_type.startsWith('video') ? (
                    <video src={resolveMediaUrl(entry.content_url)} muted loop playsInline autoPlay className="w-full h-full object-cover" />
                  ) : (
                    <ObjectImage contentUrl={entry.content_url} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); shareEntryToGroup(entry); }}
                    className="absolute bottom-2 right-2 p-1.5 bg-black/70 backdrop-blur-sm rounded-lg text-retro-muted hover:text-white transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    title="Share to Group Chat"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {selfId === expandedRound.host_id && (
              <div className="flex justify-end pt-2 border-t border-border-glass">
                <button
                  type="button"
                  disabled={postingToFeed}
                  onClick={() => postRoundToFeed(expandedRound)}
                  className="px-4 py-2 bg-black hover:bg-surface-elevated text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer shadow-xs disabled:opacity-40"
                >
                  {postingToFeed ? 'Posting…' : 'Post to Feed'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
