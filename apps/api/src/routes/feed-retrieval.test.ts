import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'
import { conns, type WsConn } from '../ws-bus'

// Retrieve-by-force regressions:
// 1. POST /api/objects/register pushes a live feed event (like multipart).
// 2. post_group coalescing happens before pagination, so count-based
//    offsets can't skip rows or re-emit a group member as a new primary.
describe('Feed retrieval (retrieve-by-force)', () => {
  let env: any

  beforeEach(async () => {
    env = await createMockEnv()
    conns.clear()
  })

  function authedLobbyConn(): WsConn & { sent: string[] } {
    const sent: string[] = []
    const conn: WsConn & { sent: string[] } = {
      sent,
      send: (data: string) => {
        sent.push(data)
        return true
      },
      rooms: new Set(['lobby', 'global']),
      authed: true,
      userId: 'watcher-1',
    }
    conns.add(conn)
    return conn
  }

  async function register(
    identity: ReturnType<typeof createTestIdentity>,
    body: Record<string, unknown>,
  ) {
    const path = '/api/objects/register'
    const bodyStr = JSON.stringify(body)
    const headers = signRequestHeaders(identity, 'POST', path, bodyStr)
    headers['Content-Type'] = 'application/json'
    return app.request(path, { method: 'POST', headers, body: bodyStr }, env)
  }

  async function seedUser(identity: ReturnType<typeof createTestIdentity>, _name: string) {
    // Provision through the real endpoint (auth middleware needs the full row).
    await app.request('/api/users', {
      headers: signRequestHeaders(identity, 'GET', '/api/users'),
    }, env)
  }

  it('broadcasts a feed:new event when a public object registers', async () => {
    const id = createTestIdentity()
    await seedUser(id, 'Poster')
    const watcher = authedLobbyConn()

    const res = await register(id, {
      id: 'reg-broadcast-1',
      content_hash: 'c'.repeat(64),
      size_bytes: 1024,
      mime_type: 'image/jpeg',
      magnet_uri: 'magnet:?xt=urn:btih:cccc',
      post_caption: 'hello feed',
      is_public: 1,
    })
    expect(res.status).toBe(200)

    const frames = watcher.sent.map((s) => JSON.parse(s))
    const fresh = frames.find((f) => f.type === 'feed' && f.action === 'new')
    expect(fresh).toBeTruthy()
    expect(fresh.post.id).toBe('reg-broadcast-1')
    expect(fresh.post.caption).toBe('hello feed')
    conns.clear()
  })

  it('stays silent on private registrations', async () => {
    const id = createTestIdentity()
    await seedUser(id, 'Private')
    const watcher = authedLobbyConn()

    const res = await register(id, {
      id: 'reg-private-1',
      content_hash: 'd'.repeat(64),
      size_bytes: 1024,
      mime_type: 'image/jpeg',
      is_public: 0,
    })
    expect(res.status).toBe(200)
    expect(watcher.sent).toHaveLength(0)
    conns.clear()
  })

  it('broadcasts only the first row of a post_group', async () => {
    const id = createTestIdentity()
    await seedUser(id, 'Grouper')
    const watcher = authedLobbyConn()
    const group = 'grp-broadcast-1'

    for (const [i, h] of ['e', 'f'].entries()) {
      const res = await register(id, {
        id: `reg-group-${i}`,
        content_hash: h.repeat(64),
        size_bytes: 1024,
        mime_type: 'image/jpeg',
        magnet_uri: `magnet:?xt=urn:btih:${h.repeat(10)}`,
        is_public: 1,
        post_group: group,
      })
      expect(res.status).toBe(200)
    }

    const fresh = watcher.sent
      .map((s) => JSON.parse(s))
      .filter((f) => f.type === 'feed' && f.action === 'new')
    expect(fresh).toHaveLength(1)
    expect(fresh[0].post.id).toBe('reg-group-0')
    conns.clear()
  })

  it('paginates coalesced primaries without skips or duplicate primaries', async () => {
    const id = createTestIdentity()
    await seedUser(id, 'Pager')
    // Chronological inserts: single, 3-group, single (created_at explicit
    // so latest-sort order is deterministic).
    const rows: Array<[string, string | null, string]> = [
      ['pg-single-1', null, '2026-09-19T00:00:01.000Z'],
      ['pg-g1', 'grp-page-1', '2026-09-19T00:00:02.000Z'],
      ['pg-g2', 'grp-page-1', '2026-09-19T00:00:03.000Z'],
      ['pg-g3', 'grp-page-1', '2026-09-19T00:00:04.000Z'],
      ['pg-single-2', null, '2026-09-19T00:00:05.000Z'],
    ]
    for (const [oid, group, created] of rows) {
      await env.DB.prepare(
        `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_public, created_at, post_group)
         VALUES (?, ?, 10, 'image/jpeg', ?, 1, ?, ?)`,
      ).bind(oid, id.orbitId, `/api/objects/${oid}`, created, group).run()
    }

    const getPage = async (limit: number, offset: number) => {
      const path = `/api/posts?limit=${limit}&offset=${offset}&sort=latest`
      // Signatures cover the pathname only (server-side rule).
      const res = await app.request(path, { headers: signRequestHeaders(id, 'GET', '/api/posts') }, env)
      expect(res.status).toBe(200)
      return ((await res.json()) as any).posts as any[]
    }

    const page1 = await getPage(2, 0)
    const page2 = await getPage(2, 2)
    const ids1 = page1.map((p) => p.id)
    const ids2 = page2.map((p) => p.id)
    // Newest first: single-2, group primary (earliest group row), single-1.
    expect(ids1).toEqual(['pg-single-2', 'pg-g1'])
    expect(ids2).toEqual(['pg-single-1'])
    expect(new Set([...ids1, ...ids2]).size).toBe(3)
    // Group primary carries the full media array.
    expect(page1[1].media.map((m: any) => m.id)).toEqual(['pg-g1', 'pg-g2', 'pg-g3'])
  })
})
