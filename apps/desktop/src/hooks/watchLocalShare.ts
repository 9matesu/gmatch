import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyLocalFile } from '@orbit/shared'
import { forgeMediaLocally, hashFileSha256 } from '../services/mediaForge'
import { requestSwarmObject, cancelSwarmObject, hasLocalObject } from '../utils/p2pSwarm'
import { sendRoomFrame, type PartyRuntime } from './watchPartyStore'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export interface LocalFileMeta {
  name: string
  size: number
  mime: string
  hash: string
  duration: number | null
}

/** Read static metadata + SHA-256 + duration without uploading anything. */
export async function describeLocalFile(file: File): Promise<LocalFileMeta> {
  const hint = classifyLocalFile({ name: file.name, type: file.type })
  if (!hint.ok) throw new Error(hint.reason || 'That file is not a playable video.')
  const hash = await hashFileSha256(file)
  const duration = await readVideoDuration(file).catch(() => null)
  return { name: file.name, size: file.size, mime: file.type || 'video/mp4', hash, duration }
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const done = () => {
      URL.revokeObjectURL(url)
      resolve(v.duration)
    }
    v.onloadedmetadata = done
    v.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that video file.'))
    }
    v.src = url
  })
}

/**
 * Grab a poster frame from a local video (max 1280px wide, JPEG).
 *
 * Shared entries used to reach the room as a bare filename: no still in the
 * queue, and a black frame until the whole file transferred. The poster is
 * forged as a normal swarm object so peers fetch it over the SAME P2P path as
 * the video — a sender's local path/blob URL would mean nothing to them.
 *
 * Best-effort: any failure (no canvas, undecodable codec, seek timeout) returns
 * null and the share proceeds without a poster.
 */
export async function makeVideoPoster(file: File, maxWidth = 1280): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  try {
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000)
      video.onloadeddata = () => { clearTimeout(timer); resolve(true) }
      video.onerror = () => { clearTimeout(timer); resolve(false) }
      video.src = url
    })
    if (!ready) return null
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    // A frame ~1s in (or a third of a very short clip) beats the black intro.
    video.currentTime = duration > 0 ? Math.min(1, duration / 3) : 0
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2000)
      video.onseeked = () => { clearTimeout(timer); resolve() }
    })
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null
    const scale = Math.min(1, maxWidth / w)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72)
      } catch {
        resolve(null)
      }
    })
  } catch {
    return null
  } finally {
    video.onloadeddata = null
    video.onerror = null
    video.onseeked = null
    URL.revokeObjectURL(url)
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Consent-gated local share. Registers metadata + seeds swarm bytes, then
 * queues a local entry. Bytes never touch the server: the entry URL is a
 * register-only object id the room resolves peer-to-peer.
 *
 * Recipients are the room's CURRENT members; a late joiner is not covered and
 * the host can re-share. That limitation is stated in the UI, not hidden.
 */
export async function shareLocalFile(
  identity: IdentityLike,
  party: PartyRuntime,
  file: File,
  meta: LocalFileMeta,
  opts: { playNow?: boolean } = {},
): Promise<{ ok: boolean; entryId?: string; error?: string }> {
  const recipients = party.members.map((m) => m.id).filter(Boolean).join(',')
  let forged
  try {
    forged = await forgeMediaLocally(file, identity as never, {
      caption: meta.name,
      isPublic: false,
      isChat: true,
      recipients: recipients || undefined,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not prepare that file for sharing.' }
  }
  const entryId = forged.id.slice(0, 8)
  // Own bytes are verified by construction (we just hashed them).
  markVerified(forged.id, meta.hash)
  // Poster still, distributed like any other object. Never a local path: the
  // room is on other machines.
  let thumb: string | undefined
  try {
    const poster = await makeVideoPoster(file)
    if (poster) {
      const forgedThumb = await forgeMediaLocally(
        new File([poster], `${entryId}-poster.jpg`, { type: 'image/jpeg' }),
        identity as never,
        { caption: `${meta.name} (poster)`.slice(0, 60), isPublic: false, isChat: true, recipients: recipients || undefined },
      )
      if (forgedThumb?.id) thumb = `/api/objects/${forgedThumb.id}`
    }
  } catch {
    /* a missing poster is cosmetic: never fail the share for it */
  }
  sendRoomFrame('watch.queue', {
    party: party.id,
    op: 'add',
    id: entryId,
    name: meta.name.slice(0, 60),
    url: `/api/objects/${forged.id}`,
    hash: meta.hash,
    size: meta.size,
    local: true,
    ...(thumb ? { thumb } : {}),
    provider: 'local',
  })
  if (opts.playNow) {
    sendRoomFrame('watch.queue', { party: party.id, op: 'play', id: entryId })
  }
  return { ok: true, entryId }
}

/** Tell the room this client verified a queue entry's bytes. */
export function signalLocalReady(partyId: string, entryId: string, hash?: string): void {
  sendRoomFrame('watch.ready', { party: partyId, id: entryId, ...(hash ? { hash } : {}) })
}

/**
 * Ids whose bytes this client verified (own forged files, or swarm transfers
 * that passed the expected-hash check). Only these may claim readiness.
 */
const verifiedIds = new Set<string>()
export function markVerified(...ids: Array<string | undefined>): void {
  for (const id of ids) if (id) verifiedIds.add(id)
}
export function isVerified(...ids: Array<string | undefined>): boolean {
  return ids.some((id) => id !== undefined && verifiedIds.has(id as string))
}

export type TransferStatus = 'idle' | 'have-local' | 'receiving' | 'ready' | 'failed' | 'cancelled'

/**
 * Receiver-side transfer for a consent-shared local entry. Drives an explicit
 * swarm fetch with integrity + progress + cancel, and signals readiness only
 * after the bytes verify. Never auto-starts: the room calls receive().
 */
export function useLocalEntryTransfer(objectId: string | null, hash?: string) {
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [received, setReceived] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const activeId = useRef<string | null>(null)

  useEffect(() => {
    if (!objectId) {
      setStatus('idle')
      return
    }
    setError('')
    if (hasLocalObject(objectId) || (hash && hasLocalObject(hash))) {
      setStatus('have-local')
    } else {
      setStatus('idle')
    }
    activeId.current = objectId
    return () => {
      if (activeId.current) cancelSwarmObject(activeId.current)
      activeId.current = null
    }
  }, [objectId, hash])

  const receive = useCallback(async () => {
    if (!objectId) return
    setError('')
    setStatus('receiving')
    setReceived(0)
    // Large files need room: 15s default covers clips, not movies.
    try {
      await requestSwarmObject(objectId, 120_000, {
        expectedHash: hash,
        onProgress: (r, t) => {
          setReceived(r)
          setTotal(t)
        },
      })
      markVerified(objectId, hash)
      setStatus('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transfer failed.'
      if (/cancelled/i.test(msg)) setStatus('cancelled')
      else {
        setStatus('failed')
        setError(msg)
      }
    }
  }, [objectId, hash])

  const cancel = useCallback(() => {
    if (objectId) cancelSwarmObject(objectId)
  }, [objectId])

  return { status, received, total, error, receive, cancel }
}
