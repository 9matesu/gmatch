import { orbitFetch, type OrbitIdentityLike } from '../utils/api'
import { buildMagnetUri } from '../utils/magnet'
import { registerLocalObject } from '../utils/p2pSwarm'
import { resolveVideoMime, sniffFileHead } from '../utils/media'
import { enqueueOutbox, flushPostOutbox } from './postOutbox'
import { shouldEmitSocialOperation } from './socialPublish'

export interface ForgedMedia {
  id: string
  contentHash: string
  mimeType: string
  sizeBytes: number
  localUrl: string
  magnetUri: string
  /** Present when a signed v1 social operation was durably committed for this
   *  forge (public durable posts). Absent = not eligible or the commit failed;
   *  the legacy outbox remains the product delivery path either way. */
  socialOperationId?: string
}

export async function hashFileSha256(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Bytes for the metadata registration, or undefined.
 *
 * The node is the only place a PEER can read a post's media from. Until this
 * existed, a publish registered metadata only and the bytes stayed in this
 * machine's IndexedDB — so `GET /api/objects/:id` answered `bytes missing for
 * row` for everyone else, and for this same user after a reinstall.
 *
 * `data_base64` is the least invasive channel: a registration that carries no
 * bytes is byte-identical on the wire to the old JSON-only body, so a node
 * running older code still accepts it (it ignores the field).
 *
 * Bounded at 1 MB ON PURPOSE. The outbox lives in localStorage, whose whole
 * origin budget is ~5 MB: one 4 MB image (5.3 MB as base64) would blow the
 * quota and `setItem` would fail, silently destroying the outbox — the post
 * AND every other pending write. Bigger media keeps its IndexedDB bytes and
 * relies on the swarm, which is the existing durable path.
 */
const REGISTER_ATTACH_CAP = 1 * 1024 * 1024

async function attachBytes(file: File): Promise<Record<string, unknown> | undefined> {
  if (file.size > REGISTER_ATTACH_CAP) return undefined
  const b64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  }).catch(() => '')
  if (!b64) return undefined
  // No hash travels with the bytes on purpose: the node hashes what it STORES.
  // The client can only hash the file it holds (pre-crop / pre-metadata-strip),
  // which legitimately differs from the canonical row bytes - sending it would
  // make every real post look like a mismatch.
  return { data_base64: b64, data_mime: file.type || 'application/octet-stream' }
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
  let socialOperationId: string | undefined

  // 3. Register metadata with the backend. The bytes travel WITH the
  // registration when they are small enough: the node is where a peer reads a
  // post from, and a row without bytes answers `bytes missing for row` for
  // everyone but the machine that authored it (and for that same user after a
  // reinstall). A node that does not know `data_base64` ignores the field, so
  // this stays compatible with an older server.
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
    ...(await attachBytes(file)),
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

    // Experimental v1 protocol bookkeeping (roadmap L1/L4): public durable
    // feed posts also commit a SIGNED post.create operation to the durable
    // operation log. Additive only — a failure here never breaks the share,
    // the field's absence on ForgedMedia is the honest signal.
    if (shouldEmitSocialOperation(options)) {
      try {
        const { publishSignedPostOperation } = await import('./socialPublish')
        const { sharedSocialOperationLog } = await import('./socialOperationLog')
        const operation = await publishSignedPostOperation(identity, {
          objectId,
          contentCid: contentHash,
          mimeType,
          sizeBytes: file.size,
          caption: options.postCaption || options.caption,
          tags: options.tags,
        }, sharedSocialOperationLog())
        socialOperationId = operation.operationId
      } catch (error) {
        console.warn('[socialPublish] v1 operation commit skipped:', error instanceof Error ? error.message : error)
      }
    }
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
    socialOperationId,
  }
}
