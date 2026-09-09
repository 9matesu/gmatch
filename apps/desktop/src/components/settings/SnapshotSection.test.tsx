// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SnapshotSection } from './SnapshotSection'
import { generateIdentity } from '@orbit/crypto'

const ident = generateIdentity()

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  } as Storage)
})

function okHandler() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/snapshot')) {
      return new Response(JSON.stringify({
        exported_at: '2026-09-09T00:00:00Z',
        tables: { Users: [{ id: 'u1', display_name: 'Alice' }], Objects: [] },
      }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  })
}

describe('SnapshotSection (T6)', () => {
  it('exports the snapshot via signed GET and triggers a download', async () => {
    const fetchFn = okHandler()
    vi.stubGlobal('fetch', fetchFn)
    let madeUrl = ''
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: (b: Blob) => { madeUrl = 'blob:test/' + b.size; return madeUrl },
      revokeObjectURL: () => {},
    }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<SnapshotSection identity={ident as never} isHost toast={vi.fn()} />)
    const btn = await screen.findByRole('button', { name: /export snapshot/i })
    fireEvent.click(btn)
    await waitFor(() => expect(madeUrl).toMatch(/^blob:test/))
    expect(clickSpy).toHaveBeenCalled()
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes('/api/snapshot'))).toBe(true)
  })

  it('import confirms then POSTs the parsed file', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, restored: { Users: 1 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchFn)
    const toast = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<SnapshotSection identity={ident as never} isHost toast={toast} />)
    const content = JSON.stringify({ exported_at: 'x', tables: { Users: [{ id: 'u1' }] } })
    const file = new File([content], 'snap.json', { type: 'application/json' })
    if (typeof file.text !== 'function') {
      // jsdom may lack Blob.text — provide the promise the component awaits
      Object.defineProperty(file, 'text', { value: async () => content })
    }
    const input = screen.getByLabelText(/snapshot file/i)
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)
    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/restored|imported/i), 'success'))
    const post = fetchFn.mock.calls.find((c) => String(c[0]).includes('/api/snapshot/import'))
    expect(post).toBeTruthy()
  })

  it('non-host sees nothing', async () => {
    vi.stubGlobal('fetch', okHandler())
    render(<SnapshotSection identity={ident as never} isHost={false} toast={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: /export snapshot/i })).not.toBeInTheDocument()
  })
})
