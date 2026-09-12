// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessagesRail } from './MessagesRail'

const base = {
  onToggle: vi.fn(),
  unreadCount: 2,
}

describe('MessagesRail', () => {
  it('collapsed: renders nothing when open is false', () => {
    render(<MessagesRail open={false} {...base}>child</MessagesRail>)
    expect(screen.queryByText('child')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand messages' })).not.toBeInTheDocument()
  })

  it('open: dock is a full-height flex sibling rendering children', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    expect(screen.getByText('child')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand messages' })).not.toBeInTheDocument()
  })

  it('dock is compact: capped at 40vw/720px so the main column keeps room', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    const panel = screen.getByText('child').closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/w-\[min\(720px,40vw\)\]/)
  })

  it('dock occupies the same flex layer: relative, full height, shrink-0, no fixed/z-index', () => {
    render(<MessagesRail open {...base}>child</MessagesRail>)
    const panel = screen.getByText('child').closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/\brelative\b/)
    expect(panel!.className).toMatch(/h-full/)
    expect(panel!.className).toMatch(/shrink-0/)
    expect(panel!.className).not.toMatch(/fixed/)
    expect(panel!.className).not.toMatch(/z-\[/)
  })
})
