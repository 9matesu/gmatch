import { orbitFetch, type OrbitIdentityLike } from '../utils/api'
import { buildMagnetUri } from '../utils/magnet'
import { registerLocalObject } from '../utils/p2pSwarm'
import { resolveVideoMime, sniffFileHead } from '../utils/media'
import { enqueueOutbox, flushPostOutbox } from './postOutbox'

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
  // Loose like-type: callers hold local IdentityLike shapes (encryption keys
  // optional); identity passes straight through to orbitFetch, which already
  // accepts this contract and skips sealing without encryption keys.
  identity: OrbitIdentityLike,
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
    /** Display-name snapshot for the gossip envelope (falls back to storage). */
    authorName?: string
    /** Phase 3 durable publish: local commit first, metadata register + gossip
     *  queued through the persisted outbox and retried on reconnect/boot. The
     *  call never throws on network failure — the post stays local-first. */
    durable?: boolean
  } = {}
): Promise<ForgedMedia> {
  const contentHash = await hashFileSha256(file)
  const objectId = crypto.randomUUID()
  const magnetUri = buildMagnetUri(contentHash.slice(0, 40), options.caption || file.name)

  // Recover a lost video MIME (empty File.type on Windows/Electron MP4s):
  // without this the row registers as application/octet-stream and every
  // render gate treats video bytes as an image.
  let mimeType = file.type || 'application/octet-stream'
  if (!file.type || file.type === 'application/octet-stream') {
    const recovered = resolveVideoMime({
      type: file.type,
      name: file.name,
      bytes: await sniffFileHead(file).catch(() => null),
    })
    if (recovered) mimeType = recovered
  }

  // 1. Seed into the swarm store immediately (both by objectId and contentHash).
  // registerLocalObject persists to IndexedDB, so the bytes stay on this
  // machine's disk (packaged app) and this client keeps retransmitting them
  // to peers on SWARM_WANT after restarts. Owner/kind flags travel with the
  // bytes so gallery rebuilds never mistake a post/story/chat for a card.
  registerLocalObject(objectId, file, {
    ownerId: identity.orbitId,
    isPublic: options.isPublic ?? true,
    isStory: options.isStory ?? false,
    isAvatar: options.isAvatar ?? false,
    isChat: options.isChat ?? false,
  })
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
    mime_type: mimeType,
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

  const gossipable = (options.isPublic ?? true) && !options.isStory && !options.isAvatar && !options.isChat
  const gossipInput = gossipable
    ? {
        id: objectId,
        contentHash,
        mimeType,
        sizeBytes: file.size,
        magnetUri,
        caption: options.postCaption || options.caption,
        location: options.location || undefined,
        tags: options.tags || undefined,
        postGroup: options.postGroup || null,
        authorName: options.authorName,
      }
    : null

  if (options.durable) {
    // Phase 3 durable publish: the local commit above (swarm seed + session
    // URL) is already done, so the post is visible and survives restart even
    // with the network down. Register + gossip are queued and driven by
    // flushPostOutbox (this call, plus boot/reconnect), never blocking publish.
    enqueueOutbox({ objectId, postGroup: options.postGroup ?? null, registerBody: payload, gossipInput })
    void flushPostOutbox(identity).catch(() => { })
  } else {
  const res = await orbitFetch('/api/objects/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, identity)

  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error || 'Failed to register media metadata with central node')
  }

  // 4. Self-hosting relay (plan G1): gossip PUBLIC posts so other nodes can
  // pull them into their own dbs. Stories/avatars/chats/DMs never gossip —
  // same flags as the register payload above. Fire-and-forget: the post is
  // already live locally; relay failure must not fail the share.
  if (gossipInput) {
    try {
      const { gossipOwnPost } = await import('./gossip')
      void gossipOwnPost(identity, gossipInput).catch(() => { })
    } catch {
      /* gossip unavailable (tests/SSR) */
    }
  }
  }

  return {
    id: objectId,
    contentHash,
    mimeType,
    sizeBytes: file.size,
    localUrl,
    magnetUri,
  }
}
