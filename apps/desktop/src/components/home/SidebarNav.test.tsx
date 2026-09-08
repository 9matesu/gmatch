// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarNav } from './SidebarNav'

// SidebarNav fetches the discord invite on mount — silence it.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({}) }))
})

describe('SidebarNav connection pill', () => {
  it('shows ONLINE when the swarm socket is connected', () => {
    render(<SidebarNav wsConnected />)
    expect(screen.getByRole('status', { name: 'Connected' })).toHaveTextContent('ONLINE')
  })

  it('shows RECONNECTING when it is not — never silent', () => {
    render(<SidebarNav wsConnected={false} />)
    expect(screen.getByRole('status', { name: 'Reconnecting' })).toHaveTextContent(/RECONNECTING/i)
  })
})
