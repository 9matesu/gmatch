// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { WorldSwitchOverlay } from './WorldSwitchOverlay'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

describe('WorldSwitchOverlay', () => {
  it('settles only once the new node answers healthy with THIS world id', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      // unhealthy at first, then the right world comes up
      if (calls < 2) return json({ db_ready: false }, 503)
      return json({ db_ready: true, world_id: 'w_deadbeef' })
    })
    const onSettled = vi.fn()
    const onFail = vi.fn()
    render(
      <WorldSwitchOverlay
        target={{ name: 'Friends', url: 'http://friends.test:8790', worldId: 'w_deadbeef' }}
        onSettled={onSettled}
        onFail={onFail}
        intervalMs={10}
        timeoutMs={2000}
        fetchImpl={fetchImpl as never}
      />,
    )
    expect(screen.getByTestId('world-switch-overlay')).toBeInTheDocument()
    expect(screen.getByText(/waiting for this world/i)).toBeInTheDocument()
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(onFail).not.toHaveBeenCalled()
  })

  it('refuses a node that answers as a DIFFERENT world', async () => {
    const fetchImpl = vi.fn(async () => json({ db_ready: true, world_id: 'w_other' }))
    const onSettled = vi.fn()
    const onFail = vi.fn()
    render(
      <WorldSwitchOverlay
        target={{ name: 'Friends', url: 'http://friends.test:8790', worldId: 'w_deadbeef' }}
        onSettled={onSettled}
        onFail={onFail}
        intervalMs={10}
        timeoutMs={120}
        fetchImpl={fetchImpl as never}
      />,
    )
    await waitFor(() => expect(onFail).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(onSettled).not.toHaveBeenCalled()
    expect(onFail.mock.calls[0][0]).toMatch(/did not come online/i)
    expect(await screen.findByText(/did not come online/i)).toBeInTheDocument()
  })

  it('accepts any healthy node when no world id is expected (client join)', async () => {
    const fetchImpl = vi.fn(async () => json({ db_ready: true }))
    const onSettled = vi.fn()
    render(
      <WorldSwitchOverlay
        target={{ name: 'Open', url: 'http://open.test:8790' }}
        onSettled={onSettled}
        onFail={() => {}}
        intervalMs={10}
        timeoutMs={2000}
        fetchImpl={fetchImpl as never}
      />,
    )
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
  })
})