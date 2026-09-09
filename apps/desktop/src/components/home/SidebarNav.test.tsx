// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarNav } from './SidebarNav'

// SidebarNav fetches the discord invite on mount — silence it.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}) }))
})

// UI-2: exactly ONE online indicator — the profile pill (the old top
// connection pill was redundant). It stays honest: live vs reconnecting.
describe('SidebarNav presence indicator', () => {
  it('shows a single status indicator, wired to the socket state', () => {
    render(<SidebarNav wsConnected />)
    const status = screen.getByRole('status', { name: 'Connected' })
    expect(status).toHaveTextContent(/Online/)
    // no second "RECONNECTING"-style pill anywhere else
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('never claims Online while the swarm socket is down', () => {
    render(<SidebarNav wsConnected={false} />)
    const status = screen.getByRole('status', { name: 'Reconnecting' })
    expect(status.textContent).not.toMatch(/Online/)
  })
})
// plan T4: HOST installs expose the admin suite button at the sidebar foot.
describe('SidebarNav admin entry', () => {
  it('shows Admin button only when this install hosts the server', async () => {
    // no bridge (browser/dev) -> no admin button
    const { unmount } = render(<SidebarNav />)
    expect(screen.queryByRole('button', { name: /open the admin suite/i })).not.toBeInTheDocument()
    unmount()
    // host bridge -> button appears (async serverState)
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [] }),
    }
    const setMainView = vi.fn()
    render(<SidebarNav setMainView={setMainView} />)
    const btn = await screen.findByRole('button', { name: /open the admin suite/i })
    fireEvent.click(btn)
    expect(setMainView).toHaveBeenCalledWith('admin')
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('CLIENT installs do not get the admin button', async () => {
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'client', url: 'http://192.168.0.9:8790', lanUrls: [] }),
    }
    render(<SidebarNav />)
    // give the async probe time to resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: /open the admin suite/i })).not.toBeInTheDocument()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })
})
