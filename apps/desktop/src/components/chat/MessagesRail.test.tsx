// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessagesRail } from './MessagesRail'

describe('MessagesRail', () => {
  it('collapsed: renders nothing when open is false', () => {
    render(<MessagesRail open={false}>child</MessagesRail>)
    expect(screen.queryByText('child')).not.toBeInTheDocument()
  })

  it('open: dock is a full-height flex sibling rendering children', () => {
    render(<MessagesRail open>child</MessagesRail>)
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('dock is compact: capped at 40vw/720px so the main column keeps room', () => {
    render(<MessagesRail open>child</MessagesRail>)
    const panel = screen.getByText('child').closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/w-\[min\(720px,40vw\)\]/)
  })

  it('dock occupies the same flex layer, aligned above the command island', () => {
    render(<MessagesRail open>child</MessagesRail>)
    const panel = screen.getByText('child').closest('[data-rail-panel]')
    // self-stretch (not h-full) so the island-clearance margin shortens the dock
    expect(panel!.className).toMatch(/self-stretch/)
    expect(panel!.className).toMatch(/shrink-0/)
    expect(panel!.className).toMatch(/mb-\[var\(--island-clearance\)\]/)
    expect(panel!.className).not.toMatch(/fixed/)
    expect(panel!.className).not.toMatch(/z-\[/)
  })

  it('side=left docks to the left with a right border (notifications)', () => {
    render(<MessagesRail open side="left" widthClass="w-[min(420px,32vw)]">n</MessagesRail>)
    const panel = screen.getByText('n').closest('[data-rail-panel]')
    expect(panel!.className).toMatch(/border-r/)
    expect(panel!.className).not.toMatch(/border-l/)
  })
})
