import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'

const owner = createTestIdentity()
const reporter = createTestIdentity()
const secondReporter = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function registerUser(env: any, identity: ReturnType<typeof createTestIdentity>) {
  await app.request('/api/users', { headers: authHeaders(identity, 'GET', '/api/users') }, env)
}

async function report(env: any, reporterIdentity: ReturnType<typeof createTestIdentity>, body: any, url = '/api/report') {
  const payload = JSON.stringify(body)
  const res = await app.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(reporterIdentity, 'POST', url, payload) },
    body: payload,
  }, env)
  return { status: res.status, json: await res.json().catch(() => null) as any }
}

describe('Unified content reporting — instant hide for every content type', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  beforeAll(async () => {
    env = await createMockEnv()
    await registerUser(env, owner)
    await registerUser(env, reporter)
    await registerUser(env, secondReporter)
  })

  it('rejects unreportable target types', async () => {
    const { status, json } = await report(env, reporter, { target_type: 'banana', target_id: 'x' })
    expect(status).toBe(400)
    expect(json.error).toBe('Unsupported target type')
  })

  it('rejects reporting your own content', async () => {
    const { status, json } = await report(env, owner, { target_type: 'post', target_id: 'nope' })
    expect(status).toBe(404) // content doesn't exist yet — fails existence check first
    // Now a real self-report against an existing row:
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ', 1)"
    ).bind('self-report-post', owner.orbitId).run()
    const self = await report(env, owner, { target_type: 'post', target_id: 'self-report-post' })
    expect(self.status).toBe(400)
    expect(self.json.error).toBe('Cannot report your own content')
  })

  it('reporting a post comment hides it instantly and dedupes per reporter', async () => {
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ', 1)"
    ).bind('comment-post', owner.orbitId).run()
    await env.DB.prepare(
      'INSERT INTO Comments (id, object_id, author_id, body) VALUES (?, ?, ?, ?)'
    ).bind('report-comment-1', 'comment-post', owner.orbitId, 'bad comment').run()

    const { status, json } = await report(env, reporter, { target_type: 'post_comment', target_id: 'report-comment-1', reason: 'nasty' })
    expect(status).toBe(201)
    expect(json.reported).toBe(true)
    expect(json.hidden).toBe(true)

    const row = await env.DB.prepare('SELECT hidden_at FROM Comments WHERE id = ?').bind('report-comment-1').first<{ hidden_at: string | null }>()
    expect(row?.hidden_at).toBeTruthy()

    // The post comment list no longer serves the hidden comment.
    const comments = await app.request(`/api/posts/comment-post/comments`, { headers: authHeaders(reporter, 'GET', `/api/posts/comment-post/comments`) }, env)
    const commentsJson: any = await comments.json()
    expect(commentsJson.find((c: any) => c.id === 'report-comment-1')).toBeUndefined()

    // Duplicate reporter is a no-op; a second reporter still queues theirs.
    const dup = await report(env, reporter, { target_type: 'post_comment', target_id: 'report-comment-1' })
    expect(dup.json.reported).toBe(false)
    const other = await report(env, secondReporter, { target_type: 'post_comment', target_id: 'report-comment-1' })
    expect(other.json.reported).toBe(true)
  })

  it('reporting a private message hides it instantly', async () => {
    await env.DB.prepare(
      'INSERT INTO PrivateMessages (id, sender_id, recipient_id, body) VALUES (?, ?, ?, ?)'
    ).bind('report-pm-1', owner.orbitId, reporter.orbitId, 'enc:v1:placeholder').run()

    const { status, json } = await report(env, reporter, { target_type: 'private_message', target_id: 'report-pm-1' })
    expect(status).toBe(201)
    expect(json.hidden).toBe(true)

    const row = await env.DB.prepare('SELECT hidden_at FROM PrivateMessages WHERE id = ?').bind('report-pm-1').first<{ hidden_at: string | null }>()
    expect(row?.hidden_at).toBeTruthy()
  })

  it('reporting a lobby chat message hides it instantly', async () => {
    await env.DB.prepare(
      'INSERT INTO LobbyChat (id, sender_id, sender_name, body) VALUES (?, ?, ?, ?)'
    ).bind('report-chat-1', owner.orbitId, 'Owner', 'spam').run()

    const { status, json } = await report(env, reporter, { target_type: 'lobby_chat', target_id: 'report-chat-1' })
    expect(status).toBe(201)
    expect(json.hidden).toBe(true)

    const row = await env.DB.prepare('SELECT hidden_at FROM LobbyChat WHERE id = ?').bind('report-chat-1').first<{ hidden_at: string | null }>()
    expect(row?.hidden_at).toBeTruthy()

    const chat = await app.request('/api/lobby/chat', { headers: authHeaders(reporter, 'GET', '/api/lobby/chat') }, env)
    const chatJson: any = await chat.json()
    expect(chatJson.messages.find((m: any) => m.id === 'report-chat-1')).toBeUndefined()
  })

  it('reporting a card hides it from every non-owner view', async () => {
    await env.DB.prepare(
      'INSERT INTO Cards (id, creator_id, media_object_id, name, rarity) VALUES (?, ?, ?, ?, ?)'
    ).bind('report-card-1', owner.orbitId, 'comment-post', 'Cardy', 'common').run()

    const { status, json } = await report(env, reporter, { target_type: 'card', target_id: 'report-card-1' })
    expect(status).toBe(201)
    expect(json.hidden).toBe(true)

    const row = await env.DB.prepare('SELECT moderation_state FROM Cards WHERE id = ?').bind('report-card-1').first<{ moderation_state: string }>()
    expect(row?.moderation_state).toBe('hidden')
  })

  it('reporting a story hides it from the stories feed', async () => {
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ', 1)"
    ).bind('report-story-1', owner.orbitId).run()

    const { status, json } = await report(env, reporter, { target_type: 'story', target_id: 'report-story-1' })
    expect(status).toBe(201)
    expect(json.hidden).toBe(true)

    const stories = await app.request('/api/objects/stories', { headers: authHeaders(reporter, 'GET', '/api/objects/stories') }, env)
    const storiesJson: any = await stories.json()
    expect(storiesJson.find((s: any) => s.id === 'report-story-1')).toBeUndefined()
  })

  it('does not leak hidden media via the raw object route', async () => {
    await env.DB.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public) VALUES (?, ?, 4, 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ', 1)"
    ).bind('hidden-lookup-post', owner.orbitId).run()
    await report(env, reporter, { target_type: 'post', target_id: 'hidden-lookup-post' })

    const res = await app.request('/api/objects/hidden-lookup-post', { headers: authHeaders(reporter, 'GET', '/api/objects/hidden-lookup-post') }, env)
    expect(res.status).toBe(404)
  })

  it('caps the number of open reports a single user can spawn (griefing guard)', async () => {
    const capReporter = createTestIdentity()
    await registerUser(env, capReporter)
    const victim = createTestIdentity()
    await registerUser(env, victim)

    for (let i = 1; i <= 51; i++) {
      await env.DB.prepare(
        'INSERT INTO LobbyImages (id, owner_id, content_url) VALUES (?, ?, ?)'
      ).bind(`cap-victim-${i}`, victim.orbitId, 'data:image/jpeg;base64,/9j/4AAQ').run()
    }
    // 50 reports succeed, the 51st hits the daily cap → 429.
    for (let i = 1; i <= 50; i++) {
      const { status } = await report(env, capReporter, { target_type: 'lobby_image', target_id: `cap-victim-${i}` })
      expect(status).toBe(201)
    }
    const { status } = await report(env, capReporter, { target_type: 'lobby_image', target_id: 'cap-victim-51' })
    expect(status).toBe(429)
  })
})