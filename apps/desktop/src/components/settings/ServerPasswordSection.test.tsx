// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ServerPasswordSection } from './ServerPasswordSection'
import { generateIdentity } from '@orbit/crypto'
const identity = generateIdentity()

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  } as Storage)
})
afterEach(() => { vi.unstubAllGlobals() })

function mockStatusAndSet(setCalls: unknown[][]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/server/password-status')) {
      return new Response(JSON.stringify({ enabled: false }), { status: 200 })
    }
    if (url.includes('/api/server/password') && init?.method === 'POST') {
      setCalls.push([JSON.parse(String(init.body))])
      return new Response(JSON.stringify({ ok: true, enabled: true }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch)
}

describe('ServerPasswordSection', () => {
  it('loads status and lets the admin set a password (signed POST)', async () => {
    const setCalls: unknown[][] = []
    mockStatusAndSet(setCalls)
    const toast = vi.fn()
    render(<ServerPasswordSection identity={identity as never} isHost toast={toast} />)
    const input = await screen.findByLabelText(/server password/i)
    fireEvent.change(input, { target: { value: 'letmein' } })
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('required'), 'success'))
    // sealed request path: orbitFetch signs; we only assert the payload shape
    await waitFor(() => expect(setCalls.length).toBe(1))
    expect(setCalls[0][0]).toEqual({ password: 'letmein' })
  })

  it('non-host users see no form', async () => {
    mockStatusAndSet([])
    render(<ServerPasswordSection identity={identity as never} isHost={false} toast={() => {}} />)
    await waitFor(() => expect(screen.queryByLabelText(/server password/i)).not.toBeInTheDocument())
  })
})