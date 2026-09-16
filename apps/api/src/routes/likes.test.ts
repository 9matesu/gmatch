import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'

describe('Likes & Relationships API', () => {
  let env: any
  let userA: any
  let userB: any
  let userC: any

  beforeEach(async () => {
    env = await createMockEnv()
    userA = createTestIdentity()
    userB = createTestIdentity()
    userC = createTestIdentity()

    // Insert Users directly into DB
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userA.orbitId, userA.publicKeyHex, 'Alice').run()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userB.orbitId, userB.publicKeyHex, 'Bob').run()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(userC.orbitId, userC.publicKeyHex, 'Charlie').run()
  })

  it('handles likes, mutual matches, score updates, and relationship queries', async () => {
    // 1. Create object owned by User A, recipient User B
    const objIdA = 'obj-a-1'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objIdA, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objIdA, userB.orbitId).run()

    // 2. Create object owned by User B, recipient User A
    const objIdB = 'obj-b-1'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 2048, ?)').bind(objIdB, userB.orbitId, 'image/jpeg').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objIdB, userA.orbitId).run()

    // 3. User B likes User A's object
    const like1 = await app.fetch(
      new Request(`http://localhost/api/likes/${objIdA}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signRequestHeaders(userB, 'POST', `/api/likes/${objIdA}`, JSON.stringify({ decision: 'like' })),
        },
        body: JSON.stringify({ decision: 'like' }),
      }),
      env
    )
    expect(like1.status).toBe(200)
    const data1 = await like1.json()
    expect(data1.decision).toBe('like')
    // Like grants 30% of the +10 card delta as discovery influence (economy).
    expect(data1.points_awarded).toBe(3)
    expect(data1.matched).toBe(false)
    expect(data1.matches).toBe(0)
    expect(data1.tier).toBe(0)

    // 4. User A likes User B's object -> Mutual match created!
    const like2 = await app.fetch(
      new Request(`http://localhost/api/likes/${objIdB}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signRequestHeaders(userA, 'POST', `/api/likes/${objIdB}`, JSON.stringify({ decision: 'like' })),
        },
        body: JSON.stringify({ decision: 'like' }),
      }),
      env
    )
    expect(like2.status).toBe(200)
    const data2 = await like2.json()
    expect(data2.matched).toBe(true)
    expect(data2.matches).toBe(1)
    expect(data2.tier).toBe(1)
    expect(data2.tierColor).toMatch(/^#[0-9a-fA-F]{6}$/)

    // 5. Query relationships as User A
    const relRes = await app.fetch(
      new Request('http://localhost/api/relationships', {
        method: 'GET',
        headers: signRequestHeaders(userA, 'GET', '/api/relationships'),
      }),
      env
    )
    expect(relRes.status).toBe(200)
    const relData = await relRes.json()
    expect(relData.relationships.length).toBe(1)
    expect(relData.relationships[0].user.id).toBe(userB.orbitId)
    expect(relData.relationships[0].matches).toBe(1)
    expect(relData.relationships[0].tier).toBe(1)
    expect(relData.relationships[0].tierLabel).toBe('Acquaintance')
    expect(relData.stats.likes_given).toBe(1)
    expect(relData.stats.likes_received).toBe(1)
    expect(relData.stats.matches_total).toBe(1)
  })

  it('syncs a canonical card like_count and value when its media is liked', async () => {
    const objId = 'obj-card-1'
    const cardId = 'card-1'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objId, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objId, userB.orbitId).run()
    await env.DB.prepare(
      "INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, like_count, market_status, moderation_state) VALUES (?, ?, ?, ?, 'common', 0, 0, 'none', 'active')"
    ).bind(cardId, userA.orbitId, objId, 'Alice Card').run()

    const like = await app.fetch(new Request(`http://localhost/api/likes/${objId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(userB, 'POST', `/api/likes/${objId}`, JSON.stringify({ decision: 'like' })) },
      body: JSON.stringify({ decision: 'like' }),
    }), env)
    expect(like.status).toBe(200)

    let card = await env.DB.prepare('SELECT value, like_count FROM Cards WHERE id = ?').bind(cardId).first<{ value: number; like_count: number }>()
    expect(card?.value).toBe(10)
    expect(card?.like_count).toBe(1)

    // Rejecting an already-liked card reverts the like count and applies the -5 delta.
    const reject = await app.fetch(new Request(`http://localhost/api/likes/${objId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(userB, 'POST', `/api/likes/${objId}`, JSON.stringify({ decision: 'reject' })) },
      body: JSON.stringify({ decision: 'reject' }),
    }), env)
    expect(reject.status).toBe(200)

    card = await env.DB.prepare('SELECT value, like_count FROM Cards WHERE id = ?').bind(cardId).first<{ value: number; like_count: number }>()
    expect(card?.value).toBe(5)
    expect(card?.like_count).toBe(0)
  })

  it('does not re-match an already-matched pair on a new like (T-B1/T-B1b)', async () => {
    const objA1 = 'obj-a-m1'
    const objB1 = 'obj-b-m1'
    const objB2 = 'obj-b-m2'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objA1, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objA1, userB.orbitId).run()
    for (const o of [objB1, objB2]) {
      await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(o, userB.orbitId, 'image/png').run()
      await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(o, userA.orbitId).run()
    }

    // B likes A's objA1 (one-sided)
    await app.fetch(new Request(`http://localhost/api/likes/${objA1}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(userB, 'POST', `/api/likes/${objA1}`, JSON.stringify({ decision: 'like' })) },
      body: JSON.stringify({ decision: 'like' }),
    }), env)

    // A likes B's objB1 -> first match
    const first = await app.fetch(new Request(`http://localhost/api/likes/${objB1}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(userA, 'POST', `/api/likes/${objB1}`, JSON.stringify({ decision: 'like' })) },
      body: JSON.stringify({ decision: 'like' }),
    }), env)
    const firstData = await first.json()
    expect(firstData.matched).toBe(true)

    // A likes B's objB2 -> same pair already matched, NOT a new match
    const second = await app.fetch(new Request(`http://localhost/api/likes/${objB2}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(userA, 'POST', `/api/likes/${objB2}`, JSON.stringify({ decision: 'like' })) },
      body: JSON.stringify({ decision: 'like' }),
    }), env)
    const secondData = await second.json()
    expect(secondData.matched).toBe(false)
    expect(secondData.matches).toBe(1)

    // matches_total must equal the derived SUM over pairs of MIN(...) -> still 1, not 2
    const relRes = await app.fetch(new Request('http://localhost/api/relationships', {
      method: 'GET',
      headers: signRequestHeaders(userA, 'GET', '/api/relationships'),
    }), env)
    const relData = await relRes.json()
    expect(relData.stats.matches_total).toBe(1)
    expect(relData.relationships[0].matches).toBe(1)
  })

  it('undoing a like decrements matches_total back to the derived value (T-B3)', async () => {
    const objA1 = 'obj-a-u1'
    const objB1 = 'obj-b-u1'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objA1, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objA1, userB.orbitId).run()
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objB1, userB.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objB1, userA.orbitId).run()

    const like = (who: any, obj: string, decision: string) => app.fetch(new Request(`http://localhost/api/likes/${obj}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(who, 'POST', `/api/likes/${obj}`, JSON.stringify({ decision })) },
      body: JSON.stringify({ decision }),
    }), env)

    await like(userB, objA1, 'like')
    await like(userA, objB1, 'like')

    const relBefore = await (await app.fetch(new Request('http://localhost/api/relationships', {
      method: 'GET', headers: signRequestHeaders(userA, 'GET', '/api/relationships'),
    }), env)).json()
    expect(relBefore.stats.matches_total).toBe(1)

    // A undoes their like on B's objB1
    await like(userA, objB1, 'reject')

    const relAfter = await (await app.fetch(new Request('http://localhost/api/relationships', {
      method: 'GET', headers: signRequestHeaders(userA, 'GET', '/api/relationships'),
    }), env)).json()
    expect(relAfter.stats.likes_given).toBe(0)
    expect(relAfter.stats.matches_total).toBe(0)
    expect(relAfter.relationships.length).toBe(0)
  })

  it('purges Likes and recomputes counters when an object is deleted (T-D1)', async () => {
    const objA1 = 'obj-a-d1'
    const objB1 = 'obj-b-d1'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objA1, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objA1, userB.orbitId).run()
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objB1, userB.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objB1, userA.orbitId).run()

    const like = (who: any, obj: string, decision: string) => app.fetch(new Request(`http://localhost/api/likes/${obj}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(who, 'POST', `/api/likes/${obj}`, JSON.stringify({ decision })) },
      body: JSON.stringify({ decision }),
    }), env)

    await like(userB, objA1, 'like')
    await like(userA, objB1, 'like')

    // Owner A deletes objA1 (the object B had liked)
    const del = await app.fetch(new Request(`http://localhost/api/objects/${objA1}`, {
      method: 'DELETE',
      headers: signRequestHeaders(userA, 'DELETE', `/api/objects/${objA1}`),
    }), env)
    expect(del.status).toBe(200)

    // Orphan Likes rows must be purged
    const likesRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM Likes WHERE object_id = ?').bind(objA1).first<{ cnt: number }>()
    expect(Number(likesRow?.cnt || 0)).toBe(0)

    // matches_total must reflect the derived value after purge (0, since B's like on the deleted object no longer counts)
    const relB = await (await app.fetch(new Request('http://localhost/api/relationships', {
      method: 'GET', headers: signRequestHeaders(userB, 'GET', '/api/relationships'),
    }), env)).json()
    expect(relB.stats.likes_given).toBe(0)
    expect(relB.stats.matches_total).toBe(0)
    expect(relB.relationships.length).toBe(0)
  })

  it('does not count story likes toward matches (T-B5)', async () => {
    const objA1 = 'obj-a-s1'
    const storyId = 'story-s1'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objA1, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objA1, userB.orbitId).run()
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_story) VALUES (?, ?, 500, ?, 1)').bind(storyId, userB.orbitId, 'image/png').run()

    const like = (who: any, obj: string, decision: string) => app.fetch(new Request(`http://localhost/api/likes/${obj}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(who, 'POST', `/api/likes/${obj}`, JSON.stringify({ decision })) },
      body: JSON.stringify({ decision }),
    }), env)

    // B likes A's regular object; A likes B's STORY -> must NOT count as a match
    await like(userB, objA1, 'like')
    const storyLike = await like(userA, storyId, 'like')
    expect(storyLike.status).toBe(200)

    const rel = await (await app.fetch(new Request('http://localhost/api/relationships', {
      method: 'GET', headers: signRequestHeaders(userA, 'GET', '/api/relationships'),
    }), env)).json()
    expect(rel.stats.matches_total).toBe(0)
    expect(rel.relationships.length).toBe(0)
  })

  it('matches on mutual likes but awards no per-like points (points come from match outcomes only)', async () => {
    const objA1 = 'obj-a-b2'
    const objB1 = 'obj-b-b2'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objA1, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objA1, userB.orbitId).run()
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objB1, userB.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objB1, userA.orbitId).run()

    const like = (who: any, obj: string, decision: string) => app.fetch(new Request(`http://localhost/api/likes/${obj}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(who, 'POST', `/api/likes/${obj}`, JSON.stringify({ decision })) },
      body: JSON.stringify({ decision }),
    }), env)

    await like(userB, objA1, 'like')
    // The like that completes the mutual match marks matched. Like votes grant
    // 30% of the +10 card delta as discovery influence (economy).
    const res = await like(userA, objB1, 'like')
    const data = await res.json()
    expect(data.matched).toBe(true)
    expect(data.points_awarded).toBe(3)

    // A subsequent like on a new object of an already-matched user grants influence too
    const objB2 = 'obj-b-b2b'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objB2, userB.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objB2, userA.orbitId).run()
    const res2 = await like(userA, objB2, 'like')
    const data2 = await res2.json()
    expect(data2.matched).toBe(false)
    expect(data2.points_awarded).toBe(3)
  })

  it('awards discovery influence on likes but keeps match outcomes as the points source', async () => {
    const objA1 = 'obj-a-g1'
    const objB1 = 'obj-b-g1'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objA1, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objA1, userB.orbitId).run()
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objB1, userB.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objB1, userA.orbitId).run()

    const like = (who: any, obj: string, decision: string) => app.fetch(new Request(`http://localhost/api/likes/${obj}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(who, 'POST', `/api/likes/${obj}`, JSON.stringify({ decision })) },
      body: JSON.stringify({ decision }),
    }), env)

    await like(userB, objA1, 'like')
    await like(userA, objB1, 'like')

    // The mutual match marks matched; each voter earns 3 discovery influence
    // (30% of the +10 card delta) credited to their live score.
    const rel = await (await app.fetch(new Request('http://localhost/api/relationships', {
      method: 'GET', headers: signRequestHeaders(userA, 'GET', '/api/relationships'),
    }), env)).json()

    // B voted like on A's card → B gets +3 discovery influence and +2 creator XP.
    expect(rel.relationships[0].user.score).toBe(5)
    // A voted like on B's card → A gets +3 discovery influence and +2 creator XP.
    expect(rel.stats.score).toBe(5)
  })

  it('rejects illegal like operations', async () => {
    const objIdA = 'obj-a-2'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objIdA, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objIdA, userB.orbitId).run()

    // 1. Cannot decide on own image
    const ownLike = await app.fetch(
      new Request(`http://localhost/api/likes/${objIdA}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signRequestHeaders(userA, 'POST', `/api/likes/${objIdA}`, JSON.stringify({ decision: 'like' })),
        },
        body: JSON.stringify({ decision: 'like' }),
      }),
      env
    )
    expect(ownLike.status).toBe(400)

    // 2. User C (not recipient) cannot decide
    const nonRecipient = await app.fetch(
      new Request(`http://localhost/api/likes/${objIdA}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signRequestHeaders(userC, 'POST', `/api/likes/${objIdA}`, JSON.stringify({ decision: 'like' })),
        },
        body: JSON.stringify({ decision: 'like' }),
      }),
      env
    )
    expect(nonRecipient.status).toBe(403)

    // 3. Non-existent object -> 404
    const notFound = await app.fetch(
      new Request('http://localhost/api/likes/nonexistent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...signRequestHeaders(userB, 'POST', '/api/likes/nonexistent', JSON.stringify({ decision: 'like' })),
        },
        body: JSON.stringify({ decision: 'like' }),
      }),
      env
    )
    expect(notFound.status).toBe(404)
  })

  it('notifies the post owner on a new like, once (T-W3)', async () => {
    const objId = 'obj-a-notif'
    await env.DB.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, 1024, ?)').bind(objId, userA.orbitId, 'image/png').run()
    await env.DB.prepare('INSERT INTO Recipients (object_id, recipient_id) VALUES (?, ?)').bind(objId, userB.orbitId).run()

    const like = (decision: string) => app.fetch(new Request(`http://localhost/api/likes/${objId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signRequestHeaders(userB, 'POST', `/api/likes/${objId}`, JSON.stringify({ decision })) },
      body: JSON.stringify({ decision }),
    }), env)

    const count = async () => {
      const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM Notifications WHERE user_id = ? AND type = 'like'").bind(userA.orbitId).first<{ cnt: number }>()
      return Number(row?.cnt || 0)
    }

    expect((await like('like')).status).toBe(200)
    expect(await count()).toBe(1)

    // Re-liking the same object is not a new positive transition: no duplicate.
    expect((await like('like')).status).toBe(200)
    expect(await count()).toBe(1)

    // A reject on a previously-liked object is not a new like either.
    expect((await like('reject')).status).toBe(200)
    expect(await count()).toBe(1)
  })
})
