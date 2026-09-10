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
// plan T4: HOST installs + server-flagged admins get the Admin Panel button.
describe('SidebarNav admin entry', () => {
  it('shows Open Admin Panel only when host or isAdmin', async () => {
    // no bridge (browser/dev), no isAdmin -> no admin button
    const { unmount } = render(<SidebarNav />)
    expect(screen.queryByRole('button', { name: /open admin panel/i })).not.toBeInTheDocument()
    unmount()
    // host bridge -> button appears (async serverState)
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'host', url: 'http://127.0.0.1:8790', lanUrls: [] }),
    }
    const setMainView = vi.fn()
    render(<SidebarNav setMainView={setMainView} />)
    const btn = await screen.findByRole('button', { name: /open admin panel/i })
    fireEvent.click(btn)
    expect(setMainView).toHaveBeenCalledWith('admin')
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })

  it('server-admin CLIENT installs get the admin button via isAdmin prop', () => {
    render(<SidebarNav isAdmin />)
    expect(screen.getByRole('button', { name: /open admin panel/i })).toBeInTheDocument()
  })

  it('CLIENT installs without isAdmin do not get the admin button', async () => {
    ;(window as unknown as { gmatch: unknown }).gmatch = {
      serverState: async () => ({ packaged: true, mode: 'client', url: 'http://192.168.0.9:8790', lanUrls: [] }),
    }
    render(<SidebarNav />)
    // give the async probe time to resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: /open admin panel/i })).not.toBeInTheDocument()
    delete (window as unknown as { gmatch?: unknown }).gmatch
  })
})

describe('SidebarNav user-requested chrome', () => {
  it('does not render the Deck shortcut in the sidebar', () => {
    render(<SidebarNav />)
    expect(screen.queryByText('Deck')).not.toBeInTheDocument()
  })

  it('Servers is a flat button that navigates directly (no expand)', () => {
    const setMainView = vi.fn()
    render(<SidebarNav setMainView={setMainView} />)
    fireEvent.click(screen.getByRole('button', { name: 'Servers' }))
    expect(setMainView).toHaveBeenCalledWith('servers')
    expect(screen.queryByText('Mateus World')).not.toBeInTheDocument()
    expect(screen.queryByText('Browse servers')).not.toBeInTheDocument()
  })

  it('games group children are ordered: Play Cards, Gallery & Cards, Idle Clicker, Store, Babecock, Rankings', () => {
    render(
      <SidebarNav
        mainView="games"
        gamesSubTab="idle"
        onOpenGallery={() => {}}
        onOpenStore={() => {}}
      />,
    )
    const labels = ['Play Cards', 'Gallery & Cards', 'Idle Clicker', 'Store', 'Babecock', 'Rankings']
    const nodes = labels.map((l) => screen.getByText(l))
    // DOM order check: each label precedes the next in document position.
    for (let i = 1; i < nodes.length; i++) {
      expect(
        nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('collapses Porn Games when its header button is clicked again', () => {
    render(<SidebarNav mainView="games" gamesSubTab="idle" />)
    const header = screen.getByRole('button', { name: 'Porn Games' })
    expect(screen.getByText('Idle Clicker')).toBeInTheDocument()
    fireEvent.click(header)
    expect(screen.queryByText('Idle Clicker')).not.toBeInTheDocument()
  })

  it('back/forward chrome buttons drive window.history', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {})
    render(<SidebarNav />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(back).toHaveBeenCalled()
    expect(forward).toHaveBeenCalled()
    back.mockRestore()
    forward.mockRestore()
  })
})
