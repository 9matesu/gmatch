// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessagesRail } from './MessagesRail'

const base = {
  onToggle: vi.fn(),
  unreadCount: 2,
}

describe('MessagesRail', () => {
  it('collapsed: tab is pinned bottom-right and nothing else renders', () => {
    render(<MessagesRail open={false} {...base}>child</MessagesRail>)
    const handle = screen.getByRole('button', { name: 'Expand messages' })
    expect(handle.className).toMatch(/fixed/)
    expect(handle.className).toMatch(/bottom-2/)
    expect(handle.className).toMatch(/right-2/)
    expect(screen.queryByText('child')).not.toBeInTheDocument()
    fireEvent.click(handle)
    expect(base.onToggle).toHaveBeenCalled()
  })

  it('open: dock is a full-height flex sibling (pushes content, never overlays), handle is gone, collapse control lives in the panel header', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    expect(screen.getByText('child')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand messages' })).not.toBeInTheDocument()
    const collapse = screen.getByRole('button', { name: 'Collapse messages' })
    expect(collapse.closest('[data-rail-panel]')).toBeTruthy()
    fireEvent.click(collapse)
    expect(base.onToggle).toHaveBeenCalled()
  })

  it('dock is compact: capped at 40vw/720px so the main column keeps room', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    const panel = screen.getByRole('button', { name: 'Collapse messages' }).closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/w-\[min\(720px,40vw\)\]/)
  })

  it('dock occupies the same flex layer: relative, full height, shrink-0, no fixed/z-index', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    const panel = screen.getByRole('button', { name: 'Collapse messages' }).closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/\brelative\b/)
    expect(panel!.className).toMatch(/h-full/)
    expect(panel!.className).toMatch(/shrink-0/)
    expect(panel!.className).not.toMatch(/fixed/)
    expect(panel!.className).not.toMatch(/z-\[/)
  })
})
