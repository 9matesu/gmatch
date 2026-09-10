// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CentralAdminPanel } from './CentralAdminPanel'
import { generateIdentity } from '@orbit/crypto'

const identity = generateIdentity() as never
const CENTRAL = 'https://central.test'

let calls: { url: string; method: string; body?: string }[] = []

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: (init?.method || 'GET'), body: init?.body ? String(init.body) : undefined })
    return handler(url, init)
  }) as unknown as typeof fetch)
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size },
  } as Storage)
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('CentralAdminPanel', () => {
  it('renders nothing when the caller is not the central admin (403)', async () => {
    stubFetch(async (url) => {
      if (url.includes('/admin/dashboard')) return json({ error: 'Forbidden' }, 403)
      return json({})
    })
    render(<CentralAdminPanel central={CENTRAL} identity={identity} toast={() => {}} />)
    await waitFor(() => expect(calls.some((c) => c.url.includes('/admin/dashboard'))).toBe(true))
    expect(screen.queryByLabelText('Central admin')).not.toBeInTheDocument()
  })

  it('shows totals + directory for the admin and can hide an entry', async () => {
    let hidden = false
    stubFetch(async (url, init) => {
      if (url.includes('/admin/dashboard')) return json({ totals: { total: 3, online: 2, stale: 1, hidden: hidden ? 1 : 0, blocked: 0 }, recent: [] })
      if (url.includes('/admin/directory') && (init?.method || 'GET') === 'PATCH') {
        hidden = true
        return json({ server: { id: 's1', name: 'Alpha Node', hidden: 1, blocked: 0 } })
      }
      if (url.includes('/admin/directory')) return json({ servers: [{ id: 's1', name: 'Alpha Node', endpoint_hint: 'a.test:1', hidden: hidden ? 1 : 0, blocked: 0 }] })
      return json({})
    })
    render(<CentralAdminPanel central={CENTRAL} identity={identity} toast={() => {}} />)
    await waitFor(() => expect(screen.getByText('Alpha Node')).toBeInTheDocument())
    expect(screen.getByText(/total 3/)).toBeInTheDocument()

    fireEvent.click(screen.getByTitle(/hide from public/i))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/admin/directory/s1'))).toBe(true))
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(JSON.parse(patch!.body!)).toMatchObject({ hidden: true })
  })
})
