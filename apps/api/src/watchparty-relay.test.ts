// Large party videos (>50MB proxy cap) relay through the hub: the party
// stores the resolved upstream + page referer at creation, and
// GET /api/watchparty/:id/stream is a Range-passthrough to THAT upstream
// only. Not an open proxy: the URL can only be set by the create flow.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import type { TestIdentity } from './test-utils'

vi.mock('./proxy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proxy')>()
  return {
    ...actual,
    // >50MB path: store attempt fails, resolver finds the mp4.
    proxyAndStoreExternal: vi.fn(async () => null),
    classifyAndResolve: vi.fn(async (url: string) =>
      url.includes('junk') ? url : 'https://example.com/show.mp4'),
  }
})

import app from './index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from './test-utils'
import { __resetParties } from './watchparty'

let env: Awaited<ReturnType<typeof createMockEnv>>
let id: TestIdentity

function auth(method: string, url: string, body?: string) {
  return { 'Content-Type': 'application/json', ...signRequestHeaders(id, method, url, body) }
}

beforeAll(async () => {
  env = await createMockEnv()
  id = createTestIdentity()
  await app.request('/api/users', { headers: signRequestHeaders(id, 'GET', '/api/users') }, env)
})
afterEach(() => vi.unstubAllGlobals())

async function createRelayParty(): Promise<string> {
  __resetParties()
  const body = JSON.stringify({ url: 'https://pmvhaven.com/video/show_abc', name: 'T' })
  const res = await app.request('/api/watchparty', {
    method: 'POST',
    headers: auth('POST', '/api/watchparty', body),
    body,
  }, env)
  expect(res.status).toBe(201)
  const json: any = await res.json()
  expect(json.party.url).toBe(`/api/watchparty/${json.party.id}/stream`)
  return json.party.id
}

describe('POST /api/watchparty (relay fallback)', () => {
  it('creates a party streaming via the relay when the file is too big to store', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(80 * 1024 * 1024) } }),
    ))
    await createRelayParty()
  })

  it('rejects when the resolved upstream is not video', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }),
    ))
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/page' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(422)
  })

  it('rejects oversized relays (> 500MB)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(600 * 1024 * 1024) } }),
    ))
    __resetParties()
    const body = JSON.stringify({ url: 'https://example.com/page' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(422)
  })
})

describe('POST /api/watchparty/:id/video bulk', () => {
  async function makeRoom(): Promise<string> {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(80 * 1024 * 1024) } }),
    ))
    __resetParties()
    const body = JSON.stringify({ url: 'https://pmvhaven.com/video/show_abc', name: 'T' })
    const res = await app.request('/api/watchparty', { method: 'POST', headers: auth('POST', '/api/watchparty', body), body }, env)
    expect(res.status).toBe(201)
    const json: any = await res.json()
    vi.unstubAllGlobals()
    return json.party.id
  }

  it('adds many urls at once, reporting failures', async () => {
    const partyId = await makeRoom()
    vi.stubGlobal('fetch', vi.fn(async (u: string) =>
      String(u).includes('junk')
        ? new Response('nope', { status: 404 })
        : new Response('x', { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/10' } }),
    ))
    const body = JSON.stringify({ queueOnly: true, urls: ['https://ok.com/1', 'https://junk.com/2', 'https://ok.com/3'] })
    // resolveMedia probes the resolved URL; the mock resolver maps every
    // non-junk input to example.com and junk input through unchanged, so
    // only the fetch stub decides pass/fail per URL.
    const res = await app.request(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: auth('POST', `/api/watchparty/${partyId}/video`, body),
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.added.length).toBe(2)
    expect(json.failed).toEqual(['https://junk.com/2'])
  })

  it('rejects more than 10 urls per request', async () => {
    const partyId = await makeRoom()
    const body = JSON.stringify({ queueOnly: true, urls: Array.from({ length: 11 }, (_, i) => `https://ok.com/${i}`) })
    const res = await app.request(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: auth('POST', `/api/watchparty/${partyId}/video`, body),
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('bulk with zero resolved videos is a 422', async () => {
    const partyId = await makeRoom()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const body = JSON.stringify({ queueOnly: true, urls: ['https://ok.com/a', 'https://ok.com/b'] })
    const res = await app.request(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: auth('POST', `/api/watchparty/${partyId}/video`, body),
      body,
    }, env)
    expect(res.status).toBe(422)
  })
})

describe('GET /api/watchparty/:id/stream', () => {

  it('is reachable without auth headers (video tag cannot sign)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(80 * 1024 * 1024) } }),
    ))
    const partyId = await createRelayParty()
    const mock = vi.fn(async () => new Response('0123456789ABCDEF', {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-15/16', 'accept-ranges': 'bytes' },
    }))
    vi.stubGlobal('fetch', mock)
    const res = await app.request(`/api/watchparty/${partyId}/stream`, { headers: { Range: 'bytes=0-15' } }, env)
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-15/16')
    expect(await res.text()).toBe('0123456789ABCDEF')
    const [upUrl, upOpts] = mock.mock.calls[0] as unknown as [string, any]
    expect(upUrl).toBe('https://example.com/show.mp4')
    expect(upOpts.headers.Range).toBe('bytes=0-15')
    expect(upOpts.headers.Referer).toBe('https://pmvhaven.com/')
  })


describe('stream lifetime (no 15s body abort)', () => {
  it('serves a stream that lasts longer than the header window', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(80 * 1024 * 1024) } }),
    ))
    const partyId = await createRelayParty()
    // 21-chunk trickle (1 chunk/1.1s). The stub HONORS init.signal, so the
    // old AbortSignal.timeout(15000) really kills the body at 15s (RED);
    // the fix releases the timer at headers and the full stream lands.
    const slowStream = (signal?: AbortSignal | null) => new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([0]))
        let n = 1
        const t = setInterval(() => {
          if (signal?.aborted) { clearInterval(t); c.error(new Error('aborted')); return }
          if (n++ >= 20) { clearInterval(t); c.enqueue(new Uint8Array([n])); c.close() }
          else c.enqueue(new Uint8Array([n]))
        }, 1100)
        signal?.addEventListener?.('abort', () => { clearInterval(t); c.error(new Error('aborted')) })
      },
    })
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { signal?: AbortSignal | null }) => new Response(slowStream(init?.signal), {
      status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-21/22' },
    })))
    const res = await app.request(`/api/watchparty/${partyId}/stream`, {}, env)
    expect(res.status).toBe(206)
    const out = new Uint8Array(await res.arrayBuffer())
    expect(out.length).toBe(21)
  }, 60_000)
})

  it('404s for unknown or non-relay parties', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '1000' } }),
    ))
    const res = await app.request('/api/watchparty/deadbeef/stream', {}, env)
    expect(res.status).toBe(404)
  })
})

describe('pmvhaven playlist expansion (alpha)', () => {
  const PL = 'https://pmvhaven.com/playlists/6a815df3bc31b18d74b252f9?index=1'
  const A = '68f85da04414feeb2eb3ea97'
  const B = '68fa3323828ec8d0de64da03'

  function stubPlaylistApi() {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.includes('/api/playlists/')) {
        return new Response(JSON.stringify({ data: { videos: [A, { _id: B }] } }), { status: 200 })
      }
      return new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(80 * 1024 * 1024) } })
    }))
  }

  it('a playlist url expands in order through the video route', async () => {
    stubPlaylistApi()
    const partyId = await createRelayParty()
    const body = JSON.stringify({ queueOnly: true, urls: [PL] })
    const res = await app.request(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: auth('POST', `/api/watchparty/${partyId}/video`, body),
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.added.length).toBe(2)
    expect(json.failed).toEqual([])
    // both entries resolved to distinct queue slots (playlist order preserved)
    expect(json.added[0].id).not.toBe(json.added[1].id)
    vi.unstubAllGlobals()
  })

  it('unreachable playlist API keeps the raw url (fails as one entry, not silent)', async () => {
    stubPlaylistApi()
    const partyId = await createRelayParty()
    vi.mocked(fetch).mockImplementation(async (u: string) => {
      if (String(u).includes('/api/playlists/')) return new Response('nope', { status: 500 })
      return new Response(null, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(80 * 1024 * 1024) } })
    })
    const body = JSON.stringify({ queueOnly: true, urls: [PL] })
    const res = await app.request(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: auth('POST', `/api/watchparty/${partyId}/video`, body),
      body,
    }, env)
    // Playlist API down -> expansion keeps the raw url, which the generic
    // page resolver handles as ONE entry (not the 2-item expansion, not 0).
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.added.length).toBe(1)
    expect(json.failed).toEqual([])
    vi.unstubAllGlobals()
  })
})
