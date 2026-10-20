import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'

/**
 * Engagement notifications for the header centre: a comment notifies the post
 * owner, a reply notifies the comment author, a @mention notifies the named
 * user, and a comment like notifies its author — each exactly once, never the
 * actor themselves.
 *
 * The load-bearing bugs this pins:
 *  - `Comments.parent_comment_id` existed since migration 016 but was never
 *    written or read, so replies did not exist and notified nobody.
 *  - `createNotification` had no event key, so a retry (or a like/unlike/like)
 *    wrote a second row and fired a second push + sound.
 */

function auth(identity: TestIdentity, method: string, url: string, body?: string) {
  return { 'Content-Type': 'application/json', ...signRequestHeaders(identity, method, url, body) }
}

async function register(identity: TestIdentity) {
  await app.request('/api/users', { headers: signRequestHeaders(identity, 'GET', '/api/users') }, env)
}

async function name(identity: TestIdentity, displayName: string) {
  const body = JSON.stringify({ display_name: displayName })
  await app.request('/api/users/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...signRequestHeaders(identity, 'PATCH', '/api/users/profile', body) },
    body,
  }, env)
}

let blobNonce = 0

function makePngBlob(nonce = blobNonce++): Blob {
  const tail = new Uint8Array(64).fill(0)
  tail[tail.length - 1] = nonce & 0xFF
  tail[tail.length - 2] = (nonce >> 8) & 0xFF
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
  ])
  // Unique bytes per upload: the objects route dedupes identical content by
  // hash, so a repeated fixture would hand back the SAME object id.
  const merged = new Uint8Array(bytes.length + tail.length)
  merged.set(bytes)
  merged.set(tail, bytes.length)
  return new Blob([merged], { type: 'image/png' })
}

async function createPublicPost(identity: TestIdentity): Promise<string> {
  const form = new FormData()
  form.append('image', makePngBlob(), 'card.png')
  form.append('is_public', '1')
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: signRequestHeaders(identity, 'POST', '/api/objects'),
    body: form,
  }, env)
  const json: any = await res.json()
  return json.id as string
}

async function addComment(
  identity: TestIdentity,
  postId: string,
  text: string,
  parentCommentId?: string,
): Promise<string> {
  const body = JSON.stringify({ body: text, ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}) })
  const res = await app.request(`/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: auth(identity, 'POST', `/api/posts/${postId}/comments`, body),
    body,
  }, env)
  expect(res.status).toBe(201)
  const json: any = await res.json()
  return json.id as string
}

async function notificationsOf(identity: TestIdentity) {
  const res = await app.request('/api/notifications', { headers: auth(identity, 'GET', '/api/notifications') }, env)
  const json: any = await res.json()
  return (json.notifications || []) as any[]
}

let env: Awaited<ReturnType<typeof createMockEnv>>
const author = createTestIdentity()
const commenter = createTestIdentity()
const replier = createTestIdentity()
const liker = createTestIdentity()
let postId: string
let authorCommentId: string

describe('engagement notifications (comment / reply / mention / comment like)', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    for (const id of [author, commenter, replier, liker]) await register(id)
    await name(author, 'Alice Arcade')
    await name(commenter, 'Bob Builder')
    await name(replier, 'Carol Coral')
    await name(liker, 'Dan Dune')
    postId = await createPublicPost(author)
    authorCommentId = await addComment(author, postId, 'first!')
  })

  it('notifies the post owner of a comment, and never the commenter', async () => {
    await addComment(commenter, postId, 'nice shot')
    const authorNotifs = await notificationsOf(author)
    expect(authorNotifs.some((n) => n.type === 'comment')).toBe(true)
    const commenterNotifs = await notificationsOf(commenter)
    expect(commenterNotifs.some((n) => n.type === 'comment')).toBe(false)
  })

  it('stores parent_comment_id and notifies the parent author on a reply', async () => {
    await addComment(replier, postId, 'agreed', authorCommentId)
    const authorNotifs = await notificationsOf(author)
    expect(authorNotifs.some((n) => n.type === 'reply')).toBe(true)

    const res = await app.request(`/api/posts/${postId}/comments`, { headers: auth(author, 'GET', `/api/posts/${postId}/comments`) }, env)
    const list: any[] = await res.json()
    const reply = list.find((c) => c.text === 'agreed')
    expect(reply.parent_comment_id).toBe(authorCommentId)
  })

  it('does not notify the parent author twice when they also own the post', async () => {
    // The commenter replies to the author's own comment on the author's post:
    // the author gets ONE reply notice, not a reply plus a comment notice.
    const owner = createTestIdentity()
    await register(owner)
    await name(owner, 'Owner Olly')
    const ownPost = await createPublicPost(owner)
    const ownComment = await addComment(owner, ownPost, 'my own comment')
    await addComment(commenter, ownPost, 'replying here', ownComment)
    const notifs = await notificationsOf(owner)
    const forThisPost = notifs.filter((n) => {
      const data = typeof n.data === 'string' ? JSON.parse(n.data) : (n.data || {})
      return data.post_id === ownPost
    })
    expect(forThisPost.length).toBe(1)
    expect(forThisPost[0].type).toBe('reply')
  })

  it('resolves an @mention to the named user and notifies them', async () => {
    await addComment(commenter, postId, 'hey @carol_coral look at this')
    const notifs = await notificationsOf(replier)
    const mention = notifs.find((n) => n.type === 'mention')
    expect(mention).toBeTruthy()
    const data = typeof mention.data === 'string' ? JSON.parse(mention.data) : mention.data
    expect(data.post_id).toBe(postId)
  })

  it('does not notify anyone for an @token that names no user', async () => {
    const before = await notificationsOf(replier)
    await addComment(commenter, postId, 'hello @nobody_at_all_here')
    const after = await notificationsOf(replier)
    expect(after.length).toBe(before.length)
  })

  it('never notifies you about your own mention', async () => {
    const before = await notificationsOf(commenter)
    await addComment(commenter, postId, 'note to self @bob_builder')
    const after = await notificationsOf(commenter)
    expect(after.length).toBe(before.length)
  })

  it('notifies the comment author on the first like, exactly once on a retry', async () => {
    const commentId = await addComment(commenter, postId, 'like me please')
    const before = await notificationsOf(commenter)
    for (let i = 0; i < 3; i += 1) {
      const res = await app.request(`/api/posts/${postId}/comments/${commentId}/like`, {
        method: 'POST',
        headers: auth(liker, 'POST', `/api/posts/${postId}/comments/${commentId}/like`),
      }, env)
      expect(res.status).toBe(200)
    }
    const after = await notificationsOf(commenter)
    const added = after.filter((n) => !before.some((b) => b.id === n.id))
    expect(added.filter((n) => n.type === 'comment_like').length).toBe(1)
  })

  it('never notifies you for liking your own comment', async () => {
    const commentId = await addComment(commenter, postId, 'self like')
    const before = await notificationsOf(commenter)
    await app.request(`/api/posts/${postId}/comments/${commentId}/like`, {
      method: 'POST',
      headers: auth(commenter, 'POST', `/api/posts/${postId}/comments/${commentId}/like`),
    }, env)
    const after = await notificationsOf(commenter)
    expect(after.length).toBe(before.length)
  })

  it('ignores a parent_comment_id that is not on this post', async () => {
    const other = await createPublicPost(author)
    const otherComment = await addComment(author, other, 'elsewhere')
    const body = JSON.stringify({ body: 'cross-post reply', parent_comment_id: otherComment })
    const res = await app.request(`/api/posts/${postId}/comments`, {
      method: 'POST',
      headers: auth(replier, 'POST', `/api/posts/${postId}/comments`, body),
      body,
    }, env)
    expect(res.status).toBe(201)
    const json: any = await res.json()
    // Stored as a top-level comment rather than aiming a notification at a
    // comment on another post.
    expect(json.parent_comment_id).toBe(null)
  })

  it('idempotency is time-bounded: a retry is suppressed, a later real event is not', async () => {
    const { createNotification } = await import('../notifications')
    const data = { post_id: 'p-dedupe', liker_id: 'l-dedupe' }
    const first = await createNotification(env.DB, author.orbitId, 'like', 'liked', null, data)
    expect(first).not.toBeNull()
    // Same event again immediately (retry / double-tap): no second row, so no
    // second push and no second sound.
    const retry = await createNotification(env.DB, author.orbitId, 'like', 'liked', null, data)
    expect(retry).toBeNull()
    // Backdate past the window: like → unlike → like again IS a new event and
    // must notify. An unbounded window would swallow it.
    await env.DB
      .prepare('UPDATE Notifications SET created_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 60 * 60 * 1000).toISOString(), first!.id)
      .run()
    const later = await createNotification(env.DB, author.orbitId, 'like', 'liked', null, data)
    expect(later).not.toBeNull()
  })
})
