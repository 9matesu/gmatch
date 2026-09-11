// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessagesRail } from './MessagesRail'

const base = {
  onToggle: vi.fn(),
  unreadCount: 2,
  users: [],
  profilePics: {},
  onOpenProfile: vi.fn(),
  groups: [],
}

describe('MessagesRail', () => {
  it('collapsed: handle is fixed to the bottom-right corner and nothing else renders', () => {
    render(<MessagesRail open={false} {...base}>child</MessagesRail>)
    const handle = screen.getByRole('button', { name: 'Expand messages' })
    expect(handle.className).toMatch(/fixed/)
    expect(handle.className).toMatch(/bottom-2/)
    expect(handle.className).toMatch(/right-0/)
    expect(screen.queryByText('child')).not.toBeInTheDocument()
    fireEvent.click(handle)
    expect(base.onToggle).toHaveBeenCalled()
  })

  it('open: drawer renders above the corner, handle is gone, collapse control lives in the panel header', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    expect(screen.getByText('child')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand messages' })).not.toBeInTheDocument()
    const collapse = screen.getByRole('button', { name: 'Collapse messages' })
    expect(collapse.closest('[data-rail-panel]')).toBeTruthy()
    fireEvent.click(collapse)
    expect(base.onToggle).toHaveBeenCalled()
  })

  it('drawer is height-capped so it never overflows the viewport', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    const panel = screen.getByRole('button', { name: 'Collapse messages' }).closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/max-h-\[calc\(100vh-6\.5rem\)\]/)
    expect(panel!.className).toMatch(/z-\[var\(--z-dropdown\)\]/)
  })
})
