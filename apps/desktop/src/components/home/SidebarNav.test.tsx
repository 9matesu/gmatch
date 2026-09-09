// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
