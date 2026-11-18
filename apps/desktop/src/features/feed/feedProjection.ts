import type { FeedPost } from '../../components/feed/GMatchFeed'
import { findUserById } from '../../utils/userLookup'
import type { User } from '@orbit/shared'

/**
 * Feed projection: the PURE half of the timeline.
 *
 * `App.tsx` used to build `feedPosts` inline (110 lines of merging in a useMemo).
 * The rule here is the same one the UI keeps: one row per post, no fabricated
 * row, and a source that cannot be identified is simply absent.
 *
 * Sources, in the order they outrank each other:
 *   1. optimistic (just published, not yet on the node)
 *   2. local durable outbox (survives a reload)
 *   3. pinned (deep link to a post the snapshot does not carry)
 *   4. peer-replicated rows from the operation log (L4)
 *   5. server snapshot
 *   6. reposts
 *   7. local/P2P public objects
 *   8. own profile posts fetched explicitly
 *
 * Nothing here reads the network, IndexedDB or localStorage: every input is an
 * argument, so the merge is unit-testable without rendering the app.
 */

export interface FeedProjectionInput {
  /** Locally-held objects (gallery/swarm store); a public one is a feed row. */
  items: readonly OrbitObjectLike[]
  /** Posts the user just published, before the node has indexed them. */
  optimisticPosts: readonly FeedPost[]
  /** Own durable posts the node has not echoed back yet. */
  localPending: readonly FeedPost[]
  /** A deep-linked post pinned by id. */
  pinnedPosts: readonly FeedPost[]
  /** Peer-replicated rows projected from the operation log. */
  peerFeedPosts: readonly FeedPost[]
  /** The server snapshot. */
  serverPosts: readonly FeedPost[]
  /** Reposted rows. */
  repostedPosts: readonly FeedPost[]
  /** Own posts fetched explicitly (author_id query). */
  myProfilePosts: readonly FeedPost[]
  /** Ids hidden by the user (deleted posts). */
  deletedPostIds: ReadonlySet<string>
  /** Ids the user archived. */
  archivedPostIds: ReadonlySet<string>
  /** The directory, for author name/avatar resolution. */
  users: readonly User[]
  /** Cached avatars by orbit id. */
  profilePics: Readonly<Record<string, string>>
  /** The current identity (null in a fresh install). */
  identity: { orbitId: string } | null
  /** The current profile (display name for "You"). */
  myProfile: { displayName: string }
  /** Server media arrays -> `mediaUrls` for the carousel. */
  normalizePost?: (post: FeedPost) => FeedPost
}

/** The subset of an `OrbitObject` the feed reads. Kept structural so tests can
 *  pass plain objects and callers need not import the full type. */
export interface OrbitObjectLike {
  id: string
  owner_id?: string | null
  content_url?: string | null
  source_url?: string | null
  data?: unknown
  url?: string | null
  mime_type?: string | null
  caption?: string | null
  post_caption?: string | null
  location?: string | null
  tags?: unknown
  created_at?: string | null
  likes_count?: number | null
  like_count?: number | null
  comment_count?: number | null
  is_public?: number | boolean | null
  owner_verified?: boolean | null
  author_name?: string | null
  sender_name?: string | null
}

function isMediaVideo(url: string): boolean {
  return /\.(?:mp4|webm|mov|m4v)(?:$|\?)/i.test(url)
}

/**
 * Build the visible timeline. Pure: same inputs -> same array (new reference,
 * but React only re-renders when a row actually changed, which is what
 * `sameTimeline` is for at the call site).
 */
export function projectFeed(input: FeedProjectionInput): FeedPost[] {
  const {
    items, optimisticPosts, localPending, pinnedPosts, peerFeedPosts,
    serverPosts, repostedPosts, myProfilePosts, deletedPostIds, archivedPostIds,
    users, profilePics, identity, myProfile, normalizePost,
  } = input

  const selfId = identity?.orbitId ?? null
  const normalize = normalizePost ?? ((p: FeedPost) => p)

  // Server snapshot: normalized + not deleted.
  const serverVisible = serverPosts
    .filter((p) => !deletedPostIds.has(p.id))
    .map(normalize)

  // Local public objects -> rows. An unverified owner claim is a relay, not a
  // proof: it may not borrow another user's directory name or avatar.
  const seenServerIds = new Set(serverVisible.map((p) => p.id))
  const localPublicPosts: FeedPost[] = items
    .filter((obj) => (obj.is_public === 1 || obj.is_public === true) && !deletedPostIds.has(obj.id) && !seenServerIds.has(obj.id))
    .map((obj) => {
      const isSelf = !!selfId && obj.owner_id === selfId
      const unverified = obj.owner_verified === false
      const authorUser = !isSelf && !unverified && obj.owner_id
        ? findUserById(users, obj.owner_id)
        : null
      const authorName = isSelf
        ? (myProfile.displayName || 'You')
        : (authorUser?.display_name || obj.author_name || obj.sender_name || 'Player')
      const authorAvatar = isSelf
        ? (profilePics[selfId ?? ''] || null)
        : (authorUser?.pfp_url || (!unverified && obj.owner_id ? profilePics[obj.owner_id] : null) || null)
      // `data` may be a legacy data-URL string; an ArrayBuffer here is raw
      // media, not a URL, and must never be coerced into one.
      const rawData = obj.data
      const legacyDataUrl = typeof rawData === 'string' && rawData.length > 0 ? rawData : ''
      const localUrl = obj.content_url || obj.source_url || legacyDataUrl || obj.url || `/api/objects/${obj.id}`
      return {
        id: obj.id,
        author_id: obj.owner_id || selfId || 'peer',
        author_name: authorName,
        author_avatar: authorAvatar,
        url: localUrl,
        mime_type: obj.mime_type || (isMediaVideo(localUrl) ? 'video/mp4' : 'image/jpeg'),
        caption: obj.caption || obj.post_caption || '',
        location: obj.location || '',
        tags: Array.isArray(obj.tags) ? obj.tags as string[] : [],
        created_at: obj.created_at || new Date().toISOString(),
        like_count: obj.likes_count || obj.like_count || 0,
        comment_count: obj.comment_count || 0,
        is_liked: false,
        is_saved: false,
        is_archived: archivedPostIds.has(obj.id),
      }
    })

  // A just-uploaded post outranks the server snapshot until the node indexes it.
  // Deduped by id, so the tile never appears twice once the row lands.
  const optimisticVisible = optimisticPosts.filter(
    (p) => !deletedPostIds.has(p.id) && !seenServerIds.has(p.id) && !localPublicPosts.some((l) => l.id === p.id),
  )

  // A deep-linked post the snapshot does not carry yet. Same dedupe rule.
  const pinnedVisible = pinnedPosts.filter(
    (p) => !deletedPostIds.has(p.id) && !seenServerIds.has(p.id),
  )

  // Peer-replicated rows: same media objectId as server/local rows, so a post
  // read from any source is ONE tile.
  const knownIds = new Set([
    ...seenServerIds,
    ...localPublicPosts.map((p) => p.id),
    ...optimisticVisible.map((p) => p.id),
  ])
  const peerVisible = peerFeedPosts
    .filter((p) => !deletedPostIds.has(p.id) && !knownIds.has(p.id))
    .map((p) => {
      const isSelf = !!selfId && p.author_id === selfId
      const author = findUserById(users, p.author_id)
      if (!isSelf && !author) return p
      return {
        ...p,
        author_name: isSelf ? (myProfile.displayName || 'You') : (author?.display_name || p.author_name),
        author_avatar: isSelf
          ? (profilePics[selfId ?? ''] || null)
          : (author?.pfp_url || p.author_avatar || null),
      }
    })

  // Own profile posts: dedupe against the server snapshot.
  const myProfileVisible = myProfilePosts.filter(
    (p) => !deletedPostIds.has(p.id) && !seenServerIds.has(p.id),
  )

  // One row per post: the local (durable) copy and the session optimistic copy
  // describe the same id, and without this a fresh publish rendered twice.
  const merged = [
    ...optimisticVisible, ...localPending, ...pinnedVisible, ...peerVisible,
    ...serverVisible, ...repostedPosts, ...localPublicPosts, ...myProfileVisible,
  ]
  const seen = new Set<string>()
  return merged.filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}