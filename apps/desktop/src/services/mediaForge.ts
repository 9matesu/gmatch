import { OrbitIdentity } from '@orbit/crypto'
import { orbitFetch } from '../utils/api'
import { buildMagnetUri } from '../utils/magnet'
import { registerLocalObject } from '../utils/p2pSwarm'

export interface ForgedMedia {
  id: string
  contentHash: string
  mimeType: string
  sizeBytes: number
  localUrl: string
  magnetUri: string
}

export async function hashFileSha256(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function forgeMediaLocally(
  file: File,
  identity: OrbitIdentity,
  options: {
    caption?: string
    postCaption?: string
    location?: string
    isPublic?: boolean
    isStory?: boolean
    isAvatar?: boolean
    isChat?: boolean
    postGroup?: string
    tags?: string
    recipients?: string
  } = {}
): Promise<ForgedMedia> {
  const contentHash = await hashFileSha256(file)
  const objectId = crypto.randomUUID()
  const magnetUri = buildMagnetUri(contentHash.slice(0, 40), options.caption || file.name)

  // 1. Seed into the swarm store immediately (both by objectId and contentHash).
  // registerLocalObject persists to IndexedDB, so the bytes stay on this
  // machine's disk (packaged app) and this client keeps retransmitting them
  // to peers on SWARM_WANT after restarts.
  registerLocalObject(objectId, file)
  registerLocalObject(contentHash, file)

  // 2. Keep a local reference for instant render (session object URL).
  // NOTE: the Electron vault is URL-keyed for http(s) fetches only — it
  // cannot pin a local:// blob, so don't call it here.
  let localUrl = ''
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    localUrl = URL.createObjectURL(file)
  }

  // 3. Register metadata ONLY with the backend — ZERO BINARY BYTES SENT TO FLY.IO
  const payload = {
    id: objectId,
    content_hash: contentHash,
    size_bytes: file.size,
    mime_type: file.type || 'application/octet-stream',
    magnet_uri: magnetUri,
    caption: options.caption || null,
    post_caption: options.postCaption || options.caption || null,
    location: options.location || null,
    is_public: options.isPublic ?? true,
    is_story: options.isStory ?? false,
    is_avatar: options.isAvatar ?? false,
    is_chat: options.isChat ?? false,
    post_group: options.postGroup || null,
    tags: options.tags || null,
    recipients: options.recipients || null,
  }

  const res = await orbitFetch('/api/objects/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, identity)

  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error || 'Failed to register media metadata with central node')
  }

  return {
    id: objectId,
    contentHash,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    localUrl,
    magnetUri,
  }
}
